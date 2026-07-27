"use client";

import { normalizeCode } from "@/lib/mfa";

/**
 * The 6-digit box for authenticator codes.
 *
 * inputMode="numeric" brings up the number pad on a phone, autoComplete
 * "one-time-code" lets iOS and Android offer the code from the clipboard, and
 * the wide letter-spacing makes it obvious how many digits are wanted.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  autoFocus,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Fired once six digits are present, so the user need not press a button. */
  onComplete?: (code: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  return (
    <input
      className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-3 text-center font-mono text-2xl tracking-[0.4em] outline-none focus:border-neutral-500 disabled:opacity-50 dark:border-neutral-700"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      placeholder="000000"
      // eslint-disable-next-line jsx-a11y/no-autofocus -- the code box is the
      // only thing on the screen at this point; focusing it saves a tap.
      autoFocus={autoFocus}
      disabled={disabled}
      value={value}
      onChange={(e) => {
        const next = normalizeCode(e.target.value);
        onChange(next);
        if (next.length === 6) onComplete?.(next);
      }}
    />
  );
}
