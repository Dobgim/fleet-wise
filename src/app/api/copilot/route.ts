import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * LLM-backed copilot endpoint.
 *
 * Trust model: the browser sends only the question. Identity comes from the
 * session cookie, the quota is consumed by a SECURITY DEFINER function in
 * Postgres, and the fleet context is read from the database under RLS — so a
 * user cannot spend more questions than their plan allows, nor ask about
 * another org's vehicles, by editing anything client-side.
 */

const bodySchema = z.object({
  question: z.string().min(1).max(500),
});

interface VehicleRow {
  id: string;
  registration: string;
  make: string;
  model: string;
  mileage: number;
}

interface RecordRow {
  vehicle_id: string;
  type: string;
  cost: number;
  service_date: string;
  notes: string | null;
}

function buildContext(vehicles: VehicleRow[], records: RecordRow[]): string {
  const lines: string[] = [];
  for (const v of vehicles) {
    lines.push(
      `Vehicle ${v.registration}: ${v.make} ${v.model}, ${v.mileage} km`
    );
    const recs = records
      .filter((r) => r.vehicle_id === v.id)
      .sort((a, b) => a.service_date.localeCompare(b.service_date));
    for (const r of recs) {
      lines.push(
        `  - ${r.service_date} ${r.type} $${r.cost}${r.notes ? ` (${r.notes})` : ""}`
      );
    }
    if (recs.length === 0) lines.push("  - no service records");
  }
  return lines.join("\n") || "The fleet has no vehicles yet.";
}

const SYSTEM_PROMPT = `You are an AI copilot for a vehicle fleet maintenance app.
Answer the user's question using ONLY the fleet data provided. Rules:
- Never invent vehicles, dates, costs or repairs. If the data needed is missing, say so plainly.
- Be concise and practical; a fleet manager is reading. Use plain English, short lists where helpful.
- Assume standard service intervals when predicting: oil ~6 months, brakes/tires ~12 months, battery ~24 months.
- Amounts are in US dollars. Today's date is {today}.`;

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Consume one question against the org's plan — authoritative, in Postgres.
  const { data: quota, error: quotaError } = await supabase.rpc(
    "consume_ai_question"
  );
  if (quotaError) {
    console.error("quota rpc failed", quotaError.message);
    return NextResponse.json(
      { error: "Could not verify your plan usage" },
      { status: 500 }
    );
  }
  const q = quota as {
    allowed: boolean;
    count: number;
    limit: number | null;
    remaining: number | null;
  };
  if (!q.allowed) {
    return NextResponse.json(
      {
        error: "quota_exceeded",
        message: `You've used all ${q.limit} AI questions included in your plan this month. Upgrade to keep asking.`,
        remaining: 0,
      },
      { status: 402 }
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Client falls back to its local rules engine.
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured", remaining: q.remaining },
      { status: 503 }
    );
  }

  // Fleet context straight from the database (RLS scopes it to this user).
  const [{ data: vehicles }, { data: records }] = await Promise.all([
    supabase
      .from("vehicles")
      .select("id, registration, make, model, mileage")
      .limit(300),
    supabase
      .from("service_records")
      .select("vehicle_id, type, cost, service_date, notes")
      .order("service_date")
      .limit(2000),
  ]);

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
          content: `FLEET DATA:\n${buildContext(
            (vehicles ?? []) as VehicleRow[],
            (records ?? []) as RecordRow[]
          )}\n\nQUESTION: ${parsed.data.question}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("OpenAI error", res.status, detail.slice(0, 500));
    return NextResponse.json(
      { error: `LLM request failed (${res.status})`, remaining: q.remaining },
      { status: 502 }
    );
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const answer = json.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    return NextResponse.json(
      { error: "Empty LLM response", remaining: q.remaining },
      { status: 502 }
    );
  }

  return NextResponse.json({ answer, model, remaining: q.remaining });
}
