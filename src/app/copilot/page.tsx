"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { askCopilot } from "@/lib/copilot";
import { PLANS } from "@/lib/plans";
import { useFleet } from "@/lib/store";

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
  const { ready, vehicles, records, plan, aiRemaining, recordAiQuestion } =
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

  if (!ready)
    return <p className="p-8 text-sm text-[var(--text-muted)]">Loading…</p>;

  const quotaExhausted = aiRemaining !== null && aiRemaining <= 0;

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || thinking || quotaExhausted) return;
    recordAiQuestion();
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setThinking(true);

    // Try the LLM endpoint first; fall back to the local rules engine when
    // no API key is configured or the request fails.
    let answer: string | null = null;
    let source: "llm" | "rules" = "llm";
    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          vehicles: vehicles.map((v) => ({
            id: v.id,
            registration: v.registration,
            make: v.make,
            model: v.model,
            mileage: v.mileage,
          })),
          records: records.map((r) => ({
            vehicleId: r.vehicleId,
            type: r.type,
            cost: r.cost,
            serviceDate: r.serviceDate,
            notes: r.notes,
          })),
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as { answer?: string };
        answer = json.answer ?? null;
      }
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
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">AI Copilot</h1>
        <Link
          href="/pricing"
          className="rounded-full border border-neutral-300 px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {aiRemaining === null
            ? `${PLANS[plan].name} plan · unlimited questions`
            : `${PLANS[plan].name} plan · ${aiRemaining} question${aiRemaining === 1 ? "" : "s"} left this month`}
        </Link>
      </div>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        Answers are grounded in your fleet data. With an OpenAI key configured
        the copilot uses the LLM; otherwise it falls back to built-in rules.
      </p>

      {quotaExhausted && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          You&apos;ve used all {PLANS[plan].aiQuestionsPerMonth} AI questions on
          the {PLANS[plan].name} plan this month.{" "}
          <Link href="/pricing" className="font-semibold underline">
            Upgrade to Premium ($20/mo) or Business ($100/mo)
          </Link>{" "}
          to keep asking.
        </div>
      )}

      <div className="mt-4 flex-1 space-y-3 overflow-y-auto rounded-xl border border-neutral-200 bg-[var(--surface-1)] p-4 dark:border-neutral-800">
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

      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => send(s)}
            className="rounded-full border border-neutral-300 px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {s}
          </button>
        ))}
      </div>

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
          className="flex-1 rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-500 disabled:opacity-50 dark:border-neutral-700"
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
