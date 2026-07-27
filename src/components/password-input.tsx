"use client";

import { useState } from "react";

/**
 * Password field with a show/hide toggle.
 *
 * Typing a password blind is the main reason sign-ups fail on phones, where
 * autocorrect and small keys make mistakes invisible. The eye reveals what
 * was actually typed; it starts hidden so a password is never exposed by
 * default on a shared screen.
 */
export function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
  id = "password",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  id?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        // pr-11 keeps the typed text clear of the toggle button.
        className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 pr-11 text-base sm:text-sm outline-none focus:border-neutral-500 dark:border-neutral-700"
        type={visible ? "text" : "password"}
        required
        placeholder={placeholder}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        // Announced to screen readers, which cannot see the icon change.
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        // Touch targets need height; -translate keeps it centred on the input.
        className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.6 5.2A9.9 9.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.2 6.2A17.6 17.6 0 0 0 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.1-1.4" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m2 2 20 20" />
    </svg>
  );
}
