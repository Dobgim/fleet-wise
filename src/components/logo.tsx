/** The wordmark: "Fleet" in the page's text colour, "Wise" in brand blue. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={className}>
      Fleet<span style={{ color: "var(--brand)" }}>Wise</span>
    </span>
  );
}

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="shrink-0"
    >
      <defs>
        <linearGradient id="fw-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3987e5" />
          <stop offset="1" stopColor="#4a3aa7" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#fw-grad)" />
      {/* vehicle-health pulse */}
      <path
        d="M6 18 H10.5 L13 11.5 L16.5 23 L19 15.5 L20.5 18 H24"
        stroke="#ffffff"
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="26.6" cy="18" r="1.8" fill="#ffffff" />
    </svg>
  );
}
