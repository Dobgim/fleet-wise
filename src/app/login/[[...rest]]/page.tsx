import { SignIn } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-appearance";

/**
 * Catch-all on purpose: sign-in is not one screen. Clerk routes the password
 * step, the 2FA code step, "forgot password" and email verification as
 * sub-paths of this URL, so /login must match /login/factor-two and friends.
 */
export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <SignIn appearance={clerkAppearance} />
    </main>
  );
}
