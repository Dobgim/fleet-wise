"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { askCopilot } from "@/lib/copilot";
import { formatTokens, PLANS } from "@/lib/plans";
import { useFleet } from "@/lib/store";
import type { AiBudget } from "@/lib/types";

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

const SUGGESTIONS = [
  "Which vehicles need servicing this month?",
  "Which vehicles cost the most?",
  "Which vehicles are becoming unreliable?",
  "Predict the next oil change for VAN-101",
  "Explain TRK-012's history",
  "Summarize last month",
  "Find duplicate repairs",
  "Suggest preventive maintenance",
];

export default function CopilotPage() {
  const { ready, vehicles, records, plan, budget, applyBudget, refreshBudget } =
    useFleet();
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Hi! I'm your fleet copilot. Ask me about servicing due, costs, reliability, or any vehicle by its registration.",
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

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
      {/* Token budget meter */}
      {budget.limit > 0 && (
        <div className="mb-3 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, (budget.used / budget.limit) * 100)}%`,
                background: quotaExhausted
                  ? "var(--status-critical)"
                  : "var(--chart-1, #3987e5)",
              }}
            />
          </div>
          <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
            {formatTokens(budget.remaining)} / {formatTokens(budget.limit)}{" "}
            tokens left today
          </span>
        </div>
      )}

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

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border border-neutral-200 bg-[var(--surface-1)] p-4 dark:border-neutral-800">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm ${
              m.role === "user"
                ? "ml-auto bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "bg-neutral-100 dark:bg-neutral-800"
            }`}
          >
            {m.text}
            {m.source && (
              <span className="mt-1.5 block text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                {m.source === "llm" ? "AI answer" : "Offline answer (rules)"}
              </span>
            )}
          </div>
        ))}
        {thinking && (
          <div className="w-fit rounded-xl bg-neutral-100 px-3.5 py-2.5 text-sm text-[var(--text-muted)] dark:bg-neutral-800">
            Thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Starter prompts: one swipeable row on mobile, wrapped on desktop;
          hidden once the conversation is underway to give the chat room */}
      {messages.length <= 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="shrink-0 rounded-full border border-neutral-300 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            quotaExhausted
              ? "Monthly AI limit reached — upgrade to continue"
              : "Ask about your fleet…"
          }
          disabled={quotaExhausted}
          className="flex-1 rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base sm:text-sm outline-none focus:border-neutral-500 disabled:opacity-50 dark:border-neutral-700"
        />
        <button
          type="submit"
          disabled={thinking || !input.trim() || quotaExhausted}
          className="rounded-md bg-neutral-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          Send
        </button>
      </form>
    </main>
  );
}
