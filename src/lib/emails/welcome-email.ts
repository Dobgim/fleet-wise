/**
 * The welcome email — the first thing MotorWise ever says to a customer.
 *
 * Same table-based layout and inline styles as the reminder email, for the
 * same reason: it is the only thing every email client renders reliably.
 *
 * The copy is deliberately short and points at one action. A new user who
 * adds a vehicle in the first session is a user who comes back; a new user
 * who reads a feature list is not.
 */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function step(n: number, title: string, body: string): string {
  return `
  <tr>
    <td style="padding:14px 0;border-bottom:1px solid #eeece6;">
      <table cellpadding="0" cellspacing="0" role="presentation"><tr>
        <td valign="top" width="30" style="padding-right:12px;">
          <span style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;background:#0b0b0b;color:#ffffff;border-radius:12px;font-size:13px;font-weight:700;">${n}</span>
        </td>
        <td valign="top">
          <div style="font-size:15px;font-weight:600;color:#0b0b0b;">${title}</div>
          <div style="font-size:13px;line-height:1.6;color:#898781;padding-top:3px;">${body}</div>
        </td>
      </tr></table>
    </td>
  </tr>`;
}

export function buildWelcomeEmail(params: {
  firstName?: string | null;
  freeVehicles: number;
  pricePerVehicle: number;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
}): { subject: string; html: string } {
  const {
    firstName,
    freeVehicles,
    pricePerVehicle,
    siteUrl,
    logoUrl,
    supportEmail,
  } = params;

  // A bare "Welcome" is what every other SaaS sends. Naming the first action
  // in the subject line is what gets it opened.
  const subject = "Welcome to MotorWise — add your first vehicle";

  const greeting = firstName?.trim()
    ? `Welcome, ${esc(firstName.trim())}`
    : "Welcome to MotorWise";

  const vehicleWord = freeVehicles === 1 ? "vehicle" : "vehicles";

  // "No card" is worth saying plainly: the commonest reason a signup never
  // becomes a first vehicle is a suspicion that a bill is waiting.
  const planLine = `Your account includes <b>${freeVehicles} ${vehicleWord} free</b> — no card, no time limit. Add more whenever you need them at $${pricePerVehicle} per vehicle per month, and cancel in one click.`;

  const html = `
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f4f4f2;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px;background-color:#ffffff;border-radius:16px;padding:36px 32px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
      <tr><td style="padding-bottom:22px;">
        <img src="${logoUrl}" width="44" height="44" alt="MotorWise" style="display:block;border:0;border-radius:11px;" />
      </td></tr>
      <tr><td style="font-size:22px;font-weight:700;color:#0b0b0b;padding-bottom:10px;">
        ${greeting}
      </td></tr>
      <tr><td style="font-size:14px;line-height:1.6;color:#52514e;padding-bottom:6px;">
        MotorWise watches your vehicles' service history and tells you what's
        about to need attention — before it becomes a breakdown, a tow truck
        and a bill you didn't plan for.
      </td></tr>
      <tr><td style="font-size:14px;line-height:1.6;color:#52514e;padding-bottom:22px;">
        ${planLine}
      </td></tr>
      <tr><td style="font-size:13px;font-weight:700;color:#0b0b0b;text-transform:uppercase;letter-spacing:0.5px;padding-bottom:2px;">
        Three steps to your first prediction
      </td></tr>
      <tr><td>
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
          ${step(1, "Add a vehicle", "Registration, make, model and current mileage. Takes about twenty seconds.")}
          ${step(2, "Log its last service", "Even one past oil change is enough for MotorWise to start predicting the next one.")}
          ${step(3, "Let the reminders run", "We email you before something falls due, so nothing is missed because nobody wrote it down.")}
        </table>
      </td></tr>
      <tr><td align="left" style="padding-top:26px;">
        <a href="${siteUrl}/dashboard"
           style="display:inline-block;background-color:#0b0b0b;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 26px;border-radius:10px;">
          Add my first vehicle
        </a>
      </td></tr>
      <tr><td style="border-top:1px solid #e1e0d9;padding-top:18px;font-size:12px;line-height:1.6;color:#898781;">
        Stuck, or want something MotorWise doesn't do yet? Reply to this email
        or write to <a href="mailto:${esc(supportEmail)}" style="color:#52514e;">${esc(supportEmail)}</a> —
        a real person reads it.<br />— MotorWise · <a href="${siteUrl}" style="color:#898781;">motorwise.co</a>
      </td></tr>
    </table>
  </td></tr>
</table>`;

  return { subject, html };
}
