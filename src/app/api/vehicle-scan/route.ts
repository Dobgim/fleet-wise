import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { MFA_REQUIRED } from "@/lib/mfa";
import { createClient } from "@/lib/supabase/server";
import { aiBaseUrl, aiChatUrl, aiHeaders, describeAiFailure } from "@/lib/ai";

/**
 * Read a vehicle's details from a photo.
 *
 * Users who do not know what a VIN is, or where to find it, can photograph
 * the car, its registration document, or the odometer, and have the fields
 * filled in for them. The model returns structured JSON which the form
 * pre-fills — the user always confirms before anything is saved.
 *
 * Vision calls are more expensive than text, so this needs more of the daily
 * budget than a chat question and is metered the same way.
 */

// A low-detail image plus a short JSON reply costs roughly 1,000–1,400
// tokens. The reserve sits just above that: high enough that a scan cannot
// overrun the budget, low enough that a Free user (3,000/day) can still add
// their one vehicle by photo — the feature that best shows the product off.
const SCAN_MIN_TOKENS = 1500;
const MAX_IMAGE_BYTES = 4_500_000; // ~4.5MB after base64 decoding

const bodySchema = z.object({
  // data URL: data:image/jpeg;base64,...
  image: z
    .string()
    .regex(
      /^data:image\/(jpeg|jpg|png|webp|heic);base64,[A-Za-z0-9+/=]+$/,
      "Unsupported image format"
    ),
});

const SYSTEM_PROMPT = `You read vehicle details from photographs for a vehicle maintenance app.

FIRST decide what the photo actually shows, then extract. Classification comes first and is the most important part of your answer — a wrong extraction wastes a user's time, but a wrong classification makes the app look broken.

Return ONLY a JSON object with these keys:
{
  "image_type": "vehicle" | "plate" | "document" | "vin_plate" | "odometer" | "unclear" | "not_vehicle",
  "subject": string,            // 1-4 words naming what is actually in the photo, e.g. "a dog", "a laptop", "a hand", "a Toyota Hilux"
  "registration": string|null,  // number plate / licence plate, uppercase, keep hyphens as shown
  "make": string|null,          // manufacturer, e.g. "Toyota"
  "model": string|null,         // e.g. "Hilux"
  "vin": string|null,           // 17 characters if visible
  "mileage": number|null,       // odometer reading in km, digits only
  "notes": string               // one short sentence to the user: what you saw, and what they should check or photograph next
}

Choosing image_type:
- "vehicle"    — a real road-going motor vehicle: car, van, truck, bus, motorcycle, tractor, trailer.
- "plate"      — a number plate, close up.
- "document"   — a registration, insurance or logbook document for a vehicle.
- "vin_plate"  — a VIN stamped plate or door-jamb sticker.
- "odometer"   — a dashboard or odometer reading.
- "unclear"    — it may well be a vehicle or vehicle document, but it is too blurry, dark, angled or cropped to read anything from.
- "not_vehicle" — anything else at all.

Be strict. Use "not_vehicle" for people, animals, food, furniture, screens, buildings, scenery, documents unrelated to a vehicle, toy or model cars, and drawings or cartoons of cars. A photo of a real car on a poster, screen or advert is still "not_vehicle" — it is not the user's vehicle. When you are genuinely torn between "not_vehicle" and anything else, choose "not_vehicle".

When image_type is "not_vehicle" or "unclear", every other field MUST be null. Name what you actually saw in "subject" — the app shows it to the user, so it must be honest and specific.

Extraction rules:
- Read ONLY what is genuinely visible. Never guess a plate, VIN or mileage.
- If you can identify the make and model from the vehicle's appearance, do so, and say in notes that it was identified visually and should be confirmed.
- Never invent a plausible-looking VIN or registration. A null is always better than a guess.`;

/** The classifications we accept as a genuine attempt to scan a vehicle. */
const VEHICLE_TYPES = new Set([
  "vehicle",
  "plate",
  "document",
  "vin_plate",
  "odometer",
]);

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const base64 = parsed.data.image.split(",")[1] ?? "";
  if (base64.length * 0.75 > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "That image is too large — please use one under 4MB." },
      { status: 413 }
    );
  }

  const supabase = await createClient();
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: budgetData, error: budgetError } =
    await supabase.rpc("check_ai_budget");
  if (budgetError) {
    // Postgres raises this when a 2FA-enabled user has not cleared their
    // second factor. It is a legitimate refusal, not a fault.
    if (budgetError.message?.includes("Two-factor authentication required")) {
      return NextResponse.json({ error: MFA_REQUIRED }, { status: 403 });
    }
    console.error("budget rpc failed", budgetError.message);
    return NextResponse.json(
      { error: "Could not verify your token budget" },
      { status: 500 }
    );
  }
  const budget = budgetData as {
    limit: number;
    used: number;
    remaining: number;
    resets_at: string;
  };
  // Vision costs more than chat, so it needs a larger reserve.
  if (budget.remaining < SCAN_MIN_TOKENS) {
    return NextResponse.json(
      {
        error: "quota_exceeded",
        message: `Reading a photo needs about ${SCAN_MIN_TOKENS.toLocaleString("en-US")} tokens and you have ${budget.remaining.toLocaleString("en-US")} left today. Your budget refills at midnight UTC, or you can fill the form in yourself.`,
        budget,
      },
      { status: 402 }
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "unavailable",
        message:
          "Photo scanning isn't available right now. Please fill the form in manually.",
      },
      { status: 503 }
    );
  }

  const res = await fetch(aiChatUrl(), {
    method: "POST",
    headers: aiHeaders(apiKey),
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL || "gpt-4o-mini",
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Read this vehicle photo and return the JSON object.",
            },
            {
              type: "image_url",
              image_url: { url: parsed.data.image, detail: "low" },
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("vision error", aiBaseUrl(), res.status, detail.slice(0, 400));
    return NextResponse.json(
      {
        error: "unavailable",
        message:
          describeAiFailure(res.status, detail) ||
          "Couldn't read the photo right now. Please fill the form in manually.",
      },
      { status: 502 }
    );
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { total_tokens?: number };
  };

  const spent = json.usage?.total_tokens ?? 0;
  const { data: updatedBudget } = await supabase.rpc("record_ai_tokens", {
    p_tokens: spent,
  });

  let fields: Record<string, unknown> = {};
  try {
    fields = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
  } catch {
    return NextResponse.json(
      {
        error: "unreadable",
        message: "Couldn't make sense of that photo. Try a clearer one.",
        budget: updatedBudget ?? budget,
      },
      { status: 422 }
    );
  }

  // Trust nothing from the model: normalise and drop anything malformed.
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null"
      ? v.trim().slice(0, max)
      : null;

  // Reject before extracting. The prompt already tells the model to null the
  // fields when the photo is not a vehicle, but a model that ignores that
  // instruction would otherwise pre-fill a form from a photo of someone's
  // lunch — so the refusal is enforced here, not merely requested there.
  const imageType = str(fields.image_type, 20)?.toLowerCase() ?? "";
  const subject = str(fields.subject, 60);

  if (!VEHICLE_TYPES.has(imageType)) {
    const seen = subject ? `That looks like ${subject}` : "That doesn't look like a vehicle";
    const message =
      imageType === "unclear"
        ? `${subject ? `I can see ${subject}, but it's` : "That photo is"} too blurry or dark to read. Try again in better light, holding steady and closer.`
        : `${seen} — not a vehicle. Photograph the vehicle itself, its number plate, its VIN plate, the odometer, or the registration document.`;

    return NextResponse.json(
      {
        error: imageType === "unclear" ? "unclear" : "not_vehicle",
        message,
        subject,
        budget: updatedBudget ?? budget,
      },
      { status: 422 }
    );
  }

  const mileage =
    typeof fields.mileage === "number" && Number.isFinite(fields.mileage)
      ? Math.max(0, Math.round(fields.mileage))
      : null;
  const vin = str(fields.vin, 17);

  return NextResponse.json({
    imageType,
    registration: str(fields.registration, 20)?.toUpperCase() ?? null,
    make: str(fields.make, 40),
    model: str(fields.model, 40),
    vin: vin && vin.length >= 11 ? vin.toUpperCase() : null,
    mileage,
    notes: str(fields.notes, 300) ?? "",
    spent,
    budget: updatedBudget ?? budget,
  });
}
