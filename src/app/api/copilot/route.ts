import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * LLM-backed copilot endpoint. The OpenAI key never leaves the server; the
 * browser sends the question plus the org's (currently local) fleet data, we
 * build a compact grounded context and ask the model. Falls back is handled
 * client-side: if this route errors, the UI uses the local rules engine.
 */

const serviceRecordSchema = z.object({
  vehicleId: z.string(),
  type: z.enum(["oil", "brakes", "tires", "battery", "engine", "other"]),
  cost: z.number().nonnegative(),
  serviceDate: z.string(),
  notes: z.string().max(500),
});

const bodySchema = z.object({
  question: z.string().min(1).max(500),
  vehicles: z
    .array(
      z.object({
        id: z.string(),
        registration: z.string().max(30),
        make: z.string().max(60),
        model: z.string().max(60),
        mileage: z.number().nonnegative(),
      })
    )
    .max(300),
  records: z.array(serviceRecordSchema).max(2000),
});

function buildContext(data: z.infer<typeof bodySchema>): string {
  const lines: string[] = [];
  for (const v of data.vehicles) {
    lines.push(
      `Vehicle ${v.registration}: ${v.make} ${v.model}, ${v.mileage} km`
    );
    const recs = data.records
      .filter((r) => r.vehicleId === v.id)
      .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));
    for (const r of recs) {
      lines.push(
        `  - ${r.serviceDate} ${r.type} $${r.cost}${r.notes ? ` (${r.notes})` : ""}`
      );
    }
    if (recs.length === 0) lines.push("  - no service records");
  }
  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are an AI copilot for a vehicle fleet maintenance app.
Answer the user's question using ONLY the fleet data provided. Rules:
- Never invent vehicles, dates, costs or repairs. If the data needed is missing, say so plainly.
- Be concise and practical; a fleet manager is reading. Use plain English, short lists where helpful.
- Assume standard service intervals when predicting: oil ~6 months, brakes/tires ~12 months, battery ~24 months.
- Amounts are in US dollars. Today's date is {today}.`;

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured" },
      { status: 503 }
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const today = new Date().toISOString().slice(0, 10);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 600,
      messages: [
        { role: "system", content: SYSTEM_PROMPT.replace("{today}", today) },
        {
          role: "user",
          content: `FLEET DATA:\n${buildContext(parsed.data)}\n\nQUESTION: ${parsed.data.question}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("OpenAI error", res.status, detail.slice(0, 500));
    return NextResponse.json(
      { error: `LLM request failed (${res.status})` },
      { status: 502 }
    );
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const answer = json.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    return NextResponse.json({ error: "Empty LLM response" }, { status: 502 });
  }

  return NextResponse.json({ answer, model });
}
