import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

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

const SCAN_MIN_TOKENS = 3000;
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

const SYSTEM_PROMPT = `You read vehicle details from photographs for a fleet maintenance app.

The photo may show: the outside of a vehicle, a number plate, a registration/insurance document, a VIN plate or door sticker, or an odometer.

Return ONLY a JSON object with these keys:
{
  "registration": string|null,  // number plate / licence plate, uppercase, keep hyphens as shown
  "make": string|null,          // manufacturer, e.g. "Toyota"
  "model": string|null,         // e.g. "Hilux"
  "vin": string|null,           // 17 characters if visible
  "mileage": number|null,       // odometer reading in km, digits only
  "notes": string               // one short sentence to the user: what you saw, and what they should check or photograph next
}

Rules:
- Read ONLY what is genuinely visible. Never guess a plate, VIN or mileage.
- If you can identify the make and model from the car's appearance, do so, and say in notes that it was identified visually and should be confirmed.
- If the image is not a vehicle or is unreadable, set every field to null and explain in notes.
- Never invent a plausible-looking VIN or registration. A null is always better than a guess.`;

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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: budgetData, error: budgetError } =
    await supabase.rpc("check_ai_budget");
  if (budgetError) {
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

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
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
    console.error("vision error", res.status, detail.slice(0, 400));
    return NextResponse.json(
      {
        error: "unavailable",
        message:
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
  const mileage =
    typeof fields.mileage === "number" && Number.isFinite(fields.mileage)
      ? Math.max(0, Math.round(fields.mileage))
      : null;
  const vin = str(fields.vin, 17);

  return NextResponse.json({
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
