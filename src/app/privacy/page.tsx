import type { Metadata } from "next";
import { LegalPage, Section } from "@/components/legal";
import { SUPPORT_EMAIL } from "@/lib/company";

export const metadata: Metadata = {
  title: "Privacy Policy — MotorWise",
  description: "What MotorWise collects, why, and who it is shared with.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="26 July 2026">
      <Section heading="What we collect">
        <p>
          <strong>Account details:</strong> your email address, and the garage
          or company name you choose.
        </p>
        <p>
          <strong>Vehicle data you enter:</strong> registration, make, model,
          mileage, optional VIN, and the service records you log — dates, costs
          and notes.
        </p>
        <p>
          <strong>Usage data:</strong> how much AI allowance your account has
          used each day, and which reminder emails we have sent you, so we do
          not send the same one twice.
        </p>
        <p>
          We do not collect payment card details. Those go directly to our
          payment provider and never reach our servers.
        </p>
      </Section>

      <Section heading="Why we use it">
        <p>
          To run the service: keep your records, work out when a service is due,
          email you before it is, answer your questions with the AI assistant,
          and apply your plan&rsquo;s limits. We also use your email to send
          account messages such as verification and password resets.
        </p>
        <p>We do not sell your data, and we do not use it for advertising.</p>
      </Section>

      <Section heading="Who we share it with">
        <p>
          Only the providers needed to operate MotorWise, and only what they
          need:
        </p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Supabase</strong> — stores your account and vehicle data.
          </li>
          <li>
            <strong>Vercel</strong> — hosts and serves the application.
          </li>
          <li>
            <strong>OpenAI</strong> — receives your question and a summary of
            your own vehicle records when you use the AI assistant, in order to
            produce the answer.
          </li>
          <li>
            <strong>Resend</strong> — delivers reminder and account emails.
          </li>
          <li>
            <strong>Paddle</strong> — our merchant of record; processes payments
            and holds billing information.
          </li>
        </ul>
      </Section>

      <Section heading="The AI assistant">
        <p>
          When you ask the assistant a question, your question and a summary of
          your own vehicles and service records are sent to OpenAI so it can
          answer. Only data from your own account is sent — never another
          customer&rsquo;s.
        </p>
        <p>
          <strong>Your data is not used to train AI models.</strong> We use
          OpenAI&rsquo;s API, and content sent through it is not used for
          training. The assistant is not &ldquo;learning&rdquo; from your fleet
          in the background; it reads the records fresh on each question.
        </p>
      </Section>

      <Section heading="Keeping it separate and secure">
        <p>
          Each account&rsquo;s data is isolated at the database level, so one
          customer cannot read another&rsquo;s records even if they try to query
          the database directly. Connections are encrypted, and secrets such as
          API keys are held server-side only.
        </p>
      </Section>

      <Section heading="How long we keep it">
        <p>
          For as long as your account exists. Delete a vehicle or record and it
          is removed. Close your account and we delete your data, except where
          we must keep transaction records for accounting and tax purposes.
        </p>
      </Section>

      <Section heading="Your rights">
        <p>
          You can access, correct, export or delete your data. Most of this you
          can do yourself in the app; for anything else, write to us and we will
          help. You can also switch off reminder emails at any time from your
          dashboard.
        </p>
      </Section>

      <Section heading="Contact">
        <p>
          Questions or requests about your data:{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
