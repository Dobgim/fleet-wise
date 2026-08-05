/**
 * Makes Clerk's hosted UI look like the rest of MotorWise.
 *
 * Colours are given as literals rather than var(--brand): Clerk renders parts
 * of its UI in a shadow root, where the app's CSS custom properties are not
 * in scope. These are the same values as globals.css.
 */
export const clerkAppearance = {
  variables: {
    colorPrimary: "#2f6fd0",
    colorText: "#0b0b0b",
    borderRadius: "0.625rem",
    fontFamily: "var(--font-geist-sans), -apple-system, 'Segoe UI', sans-serif",
  },
  elements: {
    // The page already sits on a card-like background; Clerk's own shadow on
    // top of it reads as a box inside a box.
    card: "shadow-none border border-neutral-200 dark:border-neutral-800",
    headerTitle: "tracking-tight",
    formButtonPrimary: "text-sm normal-case font-medium",
    footerActionLink: "font-medium underline",
  },
};
