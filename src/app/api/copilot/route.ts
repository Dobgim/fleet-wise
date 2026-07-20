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

interface Budget {
  limit: number;
  used: number;
  remaining: number;
  requests: number;
  resets_at: string;
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

  // Pre-flight: does this org have enough of today's token budget left?
  const { data: budgetData, error: budgetError } =
    await supabase.rpc("check_ai_budget");
  if (budgetError) {
    console.error("budget rpc failed", budgetError.message);
    return NextResponse.json(
      { error: "Could not verify your token budget" },
      { status: 500 }
    );
  }
  const budget = budgetData as Budget & { allowed: boolean };
  if (!budget.allowed) {
    return NextResponse.json(
      {
        error: "quota_exceeded",
        message: `You've used today's ${budget.limit.toLocaleString("en-US")} AI tokens. Your budget refills at midnight UTC — or upgrade for a bigger daily allowance.`,
        budget,
      },
      { status: 402 }
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Client falls back to its local rules engine. Nothing was spent, so the
    // budget is returned untouched.
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured", budget },
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

  // Never let one reply overshoot the remaining budget by more than a little:
  // cap the answer length to what is actually left (600 tokens at most).
  const replyCap = Math.max(120, Math.min(600, budget.remaining - 200));

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: replyCap,
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
    // Failed calls are not charged to the user.
    return NextResponse.json(
      { error: `LLM request failed (${res.status})`, budget },
      { status: 502 }
    );
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  const answer = json.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    return NextResponse.json(
      { error: "Empty LLM response", budget },
      { status: 502 }
    );
  }

  // Debit what the model actually consumed. The provider reports this on
  // every response, which is why no training or estimation is involved.
  const spent = json.usage?.total_tokens ?? 0;
  const { data: updated, error: debitError } = await supabase.rpc(
    "record_ai_tokens",
    { p_tokens: spent }
  );
  if (debitError) {
    // The answer is already paid for upstream; log loudly but still reply.
    console.error("token debit failed", debitError.message, "tokens:", spent);
  }

  return NextResponse.json({
    answer,
    model,
    spent,
    budget: (updated as Budget) ?? budget,
  });
}
