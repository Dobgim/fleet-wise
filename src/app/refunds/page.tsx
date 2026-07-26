import type { Metadata } from "next";
import { LegalPage, Section } from "@/components/legal";
import { SUPPORT_EMAIL } from "@/lib/company";

export const metadata: Metadata = {
  title: "Refund Policy — Fleet Wise",
  description: "When and how you can get a refund from Fleet Wise.",
};

export default function RefundsPage() {
  return (
    <LegalPage title="Refund Policy" updated="26 July 2026">
      <Section heading="Try before you pay">
        <p>
          Fleet Wise has a free plan that needs no card. We would rather you
          used it first and upgraded only when the paid limits are worth it
          to you.
        </p>
      </Section>

      <Section heading="14-day money back">
        <p>
          If a paid plan is not right for you, email us within{" "}
          <strong>14 days</strong> of the charge and we will refund it in full.
          You do not need to give a reason.
        </p>
      </Section>

      <Section heading="After 14 days">
        <p>
          You can cancel at any time and will not be billed again. Access
          continues until the end of the period you have already paid for. We
          do not automatically refund part-used months, but if you were charged
          by mistake — a duplicate payment, a renewal you had cancelled, or a
          plan you never used — write to us and we will put it right.
        </p>
      </Section>

      <Section heading="If the service does not work">
        <p>
          If Fleet Wise is substantially unavailable or a paid feature does not
          function for an extended period, tell us. We will fix it, extend your
          plan, or refund you.
        </p>
      </Section>

      <Section heading="How to request a refund">
        <p>
          Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
            {SUPPORT_EMAIL}
          </a>{" "}
          from the address on your account, and include the date of the charge.
          We aim to reply within two business days.
        </p>
        <p>
          Payments are processed by Paddle as merchant of record, so refunds are
          issued through Paddle and returned to the original payment method.
          Depending on your bank, the money can take a few days to appear.
        </p>
      </Section>
    </LegalPage>
  );
}
