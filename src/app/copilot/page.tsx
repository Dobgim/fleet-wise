"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { askCopilot } from "@/lib/copilot";
import { formatTokens, PLANS } from "@/lib/plans";
import { useFleet } from "@/lib/store";
import type { AiBudget, ServiceRecord, Vehicle } from "@/lib/types";

function resetsIn(iso: string): string {
  if (!iso) return "midnight UTC";
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "shortly";
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.round((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

interface Message {
  role: "user" | "assistant";
  text: string;
  source?: "llm" | "rules";
}

/**
 * Starter prompts built from the user's own fleet — a prompt naming a
 * vehicle they do not own is worse than no prompt at all.
 */
function buildSuggestions(
  vehicles: Vehicle[],
  records: ServiceRecord[]
): string[] {
  if (vehicles.length === 0) {
    return [
      "What can you help me with?",
      "What should I track for my vehicles?",
      "How do you decide when a service is due?",
    ];
  }

  // Prefer the vehicle whose oil change is oldest — the likeliest to be due.
  const lastOil = new Map<string, string>();
  for (const r of records) {
    if (r.type !== "oil") continue;
    const prev = lastOil.get(r.vehicleId);
    if (!prev || r.serviceDate > prev) lastOil.set(r.vehicleId, r.serviceDate);
  }
  const byOilAge = [...vehicles].sort((a, b) =>
    (lastOil.get(a.id) ?? "0000-00-00").localeCompare(
      lastOil.get(b.id) ?? "0000-00-00"
    )
  );
  const primary = byOilAge[0];
  const secondary =
    vehicles.find((v) => v.id !== primary.id) ?? primary;

  const out: string[] = [];
  out.push(
    vehicles.length > 1
      ? "Which vehicles need servicing soon?"
      : `Does ${primary.registration} need servicing soon?`
  );
  out.push(`Predict the next oil change for ${primary.registration}`);
  if (records.length > 0) {
    out.push(
      vehicles.length > 1
        ? "Which vehicle costs me the most?"
        : `How much have I spent on ${primary.registration}?`
    );
    out.push(`Explain ${secondary.registration}'s service history`);
  }
  if (vehicles.length > 1) out.push("Which vehicles are becoming unreliable?");
  if (records.length > 2) out.push("Find repairs that look duplicated");
  out.push("Suggest preventive maintenance");
  return out;
}

export default function CopilotPage() {
  const { ready, vehicles, records, plan, budget, applyBudget, refreshBudget } =
    useFleet();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const suggestions = useMemo(
    () => buildSuggestions(vehicles, records),
    [vehicles, records]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  // Budget may have refilled (new UTC day) since the app loaded.
  useEffect(() => {
    void refreshBudget();
  }, [refreshBudget]);

  if (!ready)
    return <p className="p-8 text-sm text-[var(--text-muted)]">Loading…</p>;

  // 600 tokens is the headroom the server requires to start a request.
  const quotaExhausted = budget.limit > 0 && budget.remaining < 600;

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || thinking || quotaExhausted) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setThinking(true);

    // The server owns identity, quota and the fleet context — the browser
    // only sends the question. Falls back to the local rules engine when the
    // LLM is unavailable (no key, no credit, outage).
    let answer: string | null = null;
    let source: "llm" | "rules" = "llm";
    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        answer?: string;
        message?: string;
        spent?: number;
        budget?: AiBudget;
      };
      if (json.budget) applyBudget(json.budget);

      if (res.status === 402) {
        // Quota spent — server refused, and it is the authority.
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text:
              json.message ??
              "You've used all the AI questions included in your plan this month.",
          },
        ]);
        setThinking(false);
        return;
      }
      if (res.ok) answer = json.answer ?? null;
    } catch {
      // network/server error — fall back below
    }
    if (!answer) {
      answer = askCopilot(q, { vehicles, records });
      source = "rules";
    }

    setMessages((m) => [...m, { role: "assistant", text: answer!, source }]);
    setThinking(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
  };

  return (
    <main className="mx-auto flex h-[calc(100dvh-62px)] w-full max-w-3xl flex-col p-4 sm:p-6">
      {quotaExhausted && (
        <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          You&apos;ve used today&apos;s {formatTokens(PLANS[plan].dailyTokens)}{" "}
          AI tokens on the {PLANS[plan].name} plan. They refill in{" "}
          <b>{resetsIn(budget.resets_at)}</b>, or{" "}
          <Link href="/pricing" className="font-semibold underline">
            upgrade for a bigger daily allowance
          </Link>
          .
        </div>
      )}

      {/* Conversation — no container, messages sit on the page like ChatGPT */}
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pb-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <h2 className="text-xl font-semibold sm:text-2xl">
              {vehicles.length === 0
                ? "Add a vehicle to get started"
                : "What would you like to know?"}
            </h2>
            <p className="mt-2 max-w-sm text-sm text-[var(--text-secondary)]">
              {vehicles.length === 0
                ? "Once you add a vehicle and log its services, I can tell you what's due, what it costs you, and which repairs look suspicious."
                : `Ask me anything about your ${vehicles.length} vehicle${vehicles.length === 1 ? "" : "s"} — servicing, costs, or reliability.`}
            </p>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div
                className="max-w-[80%] whitespace-pre-wrap rounded-3xl px-4 py-2.5 text-[15px] leading-relaxed"
                style={{
                  background: "var(--brand)",
                  color: "var(--brand-ink)",
                }}
              >
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="whitespace-pre-wrap text-[15px] leading-relaxed">
              {m.text}
              {m.source === "rules" && (
                <span className="mt-1.5 block text-[11px] text-[var(--text-muted)]">
                  Offline answer — the AI is unreachable right now
                </span>
              )}
            </div>
          )
        )}
        {thinking && (
          <div className="flex gap-1.5 py-1" aria-label="Thinking">
            <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.3s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.15s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-400" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Starter prompts, only before the conversation begins */}
      {messages.length === 0 && (
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="shrink-0 rounded-full border border-neutral-200 px-3.5 py-2 text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Composer — single rounded pill with the send arrow inside */}
      <form
        onSubmit={submit}
        className="flex items-end gap-2 rounded-[26px] border border-neutral-200 bg-[var(--surface-1)] px-4 py-2.5 shadow-sm focus-within:border-neutral-400 dark:border-neutral-700 dark:focus-within:border-neutral-500"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            quotaExhausted ? "Daily tokens used up" : "Ask anything"
          }
          disabled={quotaExhausted}
          className="min-w-0 flex-1 border-0 bg-transparent py-1.5 text-base outline-none placeholder:text-[var(--text-muted)] disabled:opacity-50 sm:text-[15px]"
        />
        <button
          type="submit"
          aria-label="Send message"
          disabled={thinking || !input.trim() || quotaExhausted}
          style={{ background: "var(--brand)", color: "var(--brand-ink)" }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-opacity disabled:opacity-30"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M8 13V3M8 3L3.5 7.5M8 3l4.5 4.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </button>
      </form>

      {budget.limit > 0 && (
        <p className="pt-2 text-center text-[11px] text-[var(--text-muted)]">
          {formatTokens(budget.remaining)} of {formatTokens(budget.limit)} daily
          AI tokens left · refills in {resetsIn(budget.resets_at)}
        </p>
      )}
    </main>
  );
}
