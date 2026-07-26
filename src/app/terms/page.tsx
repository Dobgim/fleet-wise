import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, Section } from "@/components/legal";
import { SUPPORT_EMAIL } from "@/lib/company";

export const metadata: Metadata = {
  title: "Terms of Service — Fleet Wise",
  description: "The terms you agree to when using Fleet Wise.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="26 July 2026">
      <Section heading="1. Who we are">
        <p>
          Fleet Wise (&ldquo;we&rdquo;, &ldquo;us&rdquo;) provides a web
          application that records vehicle maintenance, predicts when services
          are due, and answers questions about your own records using
          artificial intelligence. By creating an account you agree to these
          terms.
        </p>
      </Section>

      <Section heading="2. Your account">
        <p>
          You must give an email address you control and keep your password
          secure. You are responsible for activity on your account. You must be
          old enough to enter a contract in your country.
        </p>
      </Section>

      <Section heading="3. Your data belongs to you">
        <p>
          Vehicles, service records and any other content you enter remain
          yours. We store them so the service can work, and we do not sell them.
          You can edit or delete them at any time, and deleting your account
          removes them. See our{" "}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>
          .
        </p>
      </Section>

      <Section heading="4. Plans, billing and payment">
        <p>
          Fleet Wise offers a free plan and paid plans. Paid plans are billed
          monthly in advance and renew automatically until cancelled.
        </p>
        <p>
          <strong>Payments are processed by Paddle</strong>, which acts as the
          merchant of record for all purchases. Paddle handles billing, payment
          and applicable sales tax, and its terms apply to the transaction. Your
          receipt comes from Paddle and includes a link to manage or cancel your
          subscription.
        </p>
        <p>
          We may change prices with at least 30 days&rsquo; notice by email.
          Continuing to use a paid plan after that means accepting the new
          price.
        </p>
      </Section>

      <Section heading="5. Cancellation and refunds">
        <p>
          You can cancel at any time; access continues to the end of the period
          you have paid for. Refunds are covered by our{" "}
          <Link href="/refunds" className="underline">
            Refund Policy
          </Link>
          .
        </p>
      </Section>

      <Section heading="6. Usage limits">
        <p>
          Each plan includes a daily allowance of AI usage, measured in tokens,
          and a limit on the number of vehicles. Allowances reset daily. We
          apply these limits to keep the service sustainable, and we may adjust
          them with notice.
        </p>
      </Section>

      <Section heading="7. Acceptable use">
        <p>
          Do not use Fleet Wise to break the law, to store data you have no
          right to hold, to attempt to access other users&rsquo; data, or to
          overload or probe our systems. We may suspend accounts that do.
        </p>
      </Section>

      <Section heading="8. The AI, and what it is not">
        <p>
          The AI assistant answers using the records in your own account and
          standard service intervals. It is a planning aid, not a mechanic, and
          it does not inspect your vehicle. Its predictions are estimates and
          can be wrong. Always rely on a qualified professional for diagnosis,
          repair and roadworthiness decisions.
        </p>
      </Section>

      <Section heading="9. Availability">
        <p>
          We work to keep Fleet Wise available but do not guarantee
          uninterrupted service. We may change or discontinue features. If we
          discontinue the service entirely, we will give reasonable notice and
          a way to export your data.
        </p>
      </Section>

      <Section heading="10. Liability">
        <p>
          Fleet Wise is provided &ldquo;as is&rdquo;. To the extent permitted by
          law, we are not liable for vehicle damage, breakdowns, missed
          servicing, lost profits or indirect losses arising from use of the
          service. Our total liability is limited to the amount you paid us in
          the twelve months before the claim.
        </p>
      </Section>

      <Section heading="11. Ending your account">
        <p>
          You may close your account at any time. We may suspend or close an
          account that breaches these terms, and will explain why where we can.
        </p>
      </Section>

      <Section heading="12. Changes and contact">
        <p>
          We may update these terms; material changes will be notified by email
          or in the app. Questions go to{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
