import { SERVICE_TYPE_LABELS } from "../types";
import type { MaintenanceItem } from "../insights";

/**
 * Branded maintenance-reminder email. Table-based layout with inline styles —
 * the only thing email clients render reliably.
 */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function days(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

function row(item: MaintenanceItem): string {
  const overdue = item.status === "overdue";
  const label = overdue
    ? `${days(item.daysDiff)} overdue`
    : item.daysDiff === 0
      ? "due today"
      : `due in ${days(item.daysDiff)}`;
  const badge = overdue
    ? `<span style="display:inline-block;background:#fdeeee;color:#8a1f1f;font-size:12px;font-weight:600;padding:2px 8px;border-radius:10px;">${label}</span>`
    : `<span style="display:inline-block;background:#fdf6e3;color:#7a5b12;font-size:12px;font-weight:600;padding:2px 8px;border-radius:10px;">${label}</span>`;

  return `
  <tr>
    <td style="padding:12px 0;border-bottom:1px solid #eeece6;">
      <div style="font-size:15px;font-weight:600;color:#0b0b0b;">
        ${esc(item.vehicle.registration)} — ${esc(SERVICE_TYPE_LABELS[item.type])}
      </div>
      <div style="font-size:13px;color:#898781;padding-top:2px;">
        ${esc(item.vehicle.make)} ${esc(item.vehicle.model)} ·
        last done ${esc(item.lastDate)} · ${badge}
      </div>
    </td>
  </tr>`;
}

export function buildReminderEmail(params: {
  garageName: string;
  items: MaintenanceItem[];
  siteUrl: string;
  logoUrl: string;
}): { subject: string; html: string } {
  const { garageName, items, siteUrl, logoUrl } = params;
  const overdue = items.filter((i) => i.status === "overdue");
  const upcoming = items.filter((i) => i.status === "upcoming");

  const subject = overdue.length
    ? `${overdue.length} overdue service${overdue.length === 1 ? "" : "s"} in ${garageName}`
    : `${upcoming.length} service${upcoming.length === 1 ? "" : "s"} due soon in ${garageName}`;

  const summary = [
    overdue.length
      ? `<b style="color:#8a1f1f;">${overdue.length} overdue</b>`
      : "",
    upcoming.length ? `${upcoming.length} due within the next week` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const html = `
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f4f4f2;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px;background-color:#ffffff;border-radius:16px;padding:36px 32px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
      <tr><td style="padding-bottom:22px;">
        <img src="${logoUrl}" width="44" height="44" alt="Fleet Wise" style="display:block;border:0;border-radius:11px;" />
      </td></tr>
      <tr><td style="font-size:22px;font-weight:700;color:#0b0b0b;padding-bottom:8px;">
        Maintenance due in ${esc(garageName)}
      </td></tr>
      <tr><td style="font-size:14px;line-height:1.6;color:#52514e;padding-bottom:20px;">
        ${summary}. Booking these before they fail is almost always cheaper than
        the breakdown that follows.
      </td></tr>
      <tr><td>
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
          ${items.map(row).join("")}
        </table>
      </td></tr>
      <tr><td align="left" style="padding-top:26px;">
        <a href="${siteUrl}/dashboard"
           style="display:inline-block;background-color:#0b0b0b;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 26px;border-radius:10px;">
          Open my dashboard
        </a>
      </td></tr>
      <tr><td style="border-top:1px solid #e1e0d9;padding-top:18px;margin-top:26px;font-size:12px;line-height:1.6;color:#898781;">
        You're receiving this because email reminders are on for ${esc(garageName)}.
        Turn them off any time from your dashboard.<br />— Fleet Wise
      </td></tr>
    </table>
  </td></tr>
</table>`;

  return { subject, html };
}
