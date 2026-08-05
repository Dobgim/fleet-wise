import { FREE_VEHICLES, PLANS, type PaidPlanId } from "../plans";

/**
 * Sent by us when a subscription becomes active.
 *
 * This is NOT the invoice — Paddle is the merchant of record and emails the
 * official receipt with a PDF invoice itself. This is the brand's own
 * welcome: what the customer just unlocked, and where to go next.
 */
export function buildSubscriptionEmail(params: {
  garageName: string;
  plan: PaidPlanId;
  /** Premium only: vehicles paid for. */
  seats?: number | null;
  siteUrl: string;
  logoUrl: string;
}): { subject: string; html: string } {
  const { garageName, plan, seats, siteUrl, logoUrl } = params;
  const cfg = PLANS[plan];
  const qty = Math.max(1, seats ?? 1);

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const perks = [
    cfg.perVehicle
      ? `${FREE_VEHICLES + qty} vehicles — the first ${FREE_VEHICLES} free, ${qty} at $${cfg.price} each`
      : "Unlimited vehicles",
    "AI predictive maintenance across your whole fleet",
    "Maintenance reminders a week and three days before each service",
    "No contract — change or cancel any time",
  ];

  return {
    subject: `${cfg.name} is active — welcome to MotorWise`,
    html: `
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f4f4f2;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px;background-color:#ffffff;border-radius:16px;padding:38px 32px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
      <tr><td style="padding-bottom:22px;">
        <img src="${logoUrl}" width="46" height="46" alt="MotorWise" style="display:block;border:0;border-radius:11px;" />
      </td></tr>
      <tr><td style="font-size:23px;font-weight:700;color:#0b0b0b;padding-bottom:10px;">
        ${esc(cfg.name)} is now active
      </td></tr>
      <tr><td style="font-size:15px;line-height:1.6;color:#52514e;padding-bottom:22px;">
        Thank you for subscribing. <b>${esc(garageName)}</b> is on the
        ${esc(cfg.name)} plan, effective immediately. Here is what you can now
        do:
      </td></tr>
      <tr><td style="padding-bottom:24px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
          ${perks
            .map(
              (p) => `<tr><td style="padding:7px 0;border-bottom:1px solid #eeece6;font-size:15px;color:#0b0b0b;">
                        <span style="color:#2f6fd0;font-weight:700;">&#10003;</span>&nbsp; ${esc(p)}
                      </td></tr>`
            )
            .join("")}
        </table>
      </td></tr>
      <tr><td align="left" style="padding-bottom:26px;">
        <a href="${siteUrl}/dashboard"
           style="display:inline-block;background-color:#2f6fd0;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:10px;">
          Open my dashboard
        </a>
      </td></tr>
      <tr><td style="border-top:1px solid #e1e0d9;padding-top:18px;font-size:12px;line-height:1.6;color:#898781;">
        Your invoice is emailed separately by <b>Paddle</b>, which handles
        billing for MotorWise. Use the link in that receipt to update your
        card or cancel at any time.<br /><br />
        &mdash; The MotorWise team
      </td></tr>
    </table>
  </td></tr>
</table>`,
  };
}
