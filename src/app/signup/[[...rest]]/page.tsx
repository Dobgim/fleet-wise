import { SignUp } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-appearance";

/**
 * Catch-all: Clerk puts the email-verification step at /signup/verify-email-address.
 * A plain /signup route would 404 the moment someone submitted the form.
 */
export default function SignupPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <SignUp appearance={clerkAppearance} />
    </main>
  );
}
