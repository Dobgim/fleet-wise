"use client";

import Link from "next/link";
import { MonthlyCostChart, TopVehiclesChart } from "@/components/charts";
import {
  detectAnomalies,
  formatMoney,
  getMaintenanceItems,
  getMonthlyCosts,
  getTopVehiclesByCost,
} from "@/lib/insights";
import { useFleet } from "@/lib/store";
import { SERVICE_TYPE_LABELS } from "@/lib/types";

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-[var(--surface-1)] p-4 dark:border-neutral-800">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-[var(--surface-1)] p-4 dark:border-neutral-800">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const { ready, vehicles, records, remindersEnabled, setRemindersEnabled } =
    useFleet();

  if (!ready)
    return <p className="p-8 text-sm text-[var(--text-muted)]">Loading…</p>;

  const items = getMaintenanceItems(vehicles, records);
  const overdue = items.filter((i) => i.status === "overdue");
  const upcoming = items.filter((i) => i.status === "upcoming");
  const monthly = getMonthlyCosts(records, 6);
  const thisMonth = monthly[monthly.length - 1];
  const top = getTopVehiclesByCost(vehicles, records, 6);
  const anomalies = detectAnomalies(vehicles, records);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={remindersEnabled}
            onChange={(e) => setRemindersEnabled(e.target.checked)}
            className="h-4 w-4 accent-neutral-900 dark:accent-white"
          />
          Email me maintenance reminders
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Vehicles" value={String(vehicles.length)} />
        <StatTile
          label="Repair cost this month"
          value={formatMoney(thisMonth?.total ?? 0)}
          sub={thisMonth?.month}
        />
        <StatTile
          label="Overdue services"
          value={String(overdue.length)}
          sub={overdue.length ? "Needs attention" : "All clear"}
        />
        <StatTile
          label="Due in next 30 days"
          value={String(upcoming.length)}
        />
      </div>

      {anomalies.length > 0 && (
        <Card title="⚠ AI predictions — abnormal patterns">
          <ul className="space-y-2">
            {anomalies.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background:
                      a.severity === "critical"
                        ? "var(--status-critical)"
                        : "var(--status-serious)",
                  }}
                />
                <span>
                  <Link
                    href={`/vehicles/${a.vehicleId}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {a.registration}
                  </Link>{" "}
                  — {a.message.replace(`${a.registration} `, "")}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Monthly repair cost (last 6 months)">
          <MonthlyCostChart data={monthly} />
        </Card>
        <Card title="Top vehicles by cost (last 6 months)">
          {top.length ? (
            <TopVehiclesChart
              data={top.map((t) => ({
                label: t.vehicle.registration,
                total: t.total,
              }))}
            />
          ) : (
            <p className="text-sm text-[var(--text-muted)]">No costs recorded yet.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Overdue maintenance">
          {overdue.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">Nothing overdue. 🎉</p>
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {overdue.map((it, i) => (
                <li key={i} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    <Link
                      href={`/vehicles/${it.vehicle.id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {it.vehicle.registration}
                    </Link>{" "}
                    · {SERVICE_TYPE_LABELS[it.type]}
                  </span>
                  <span className="font-medium" style={{ color: "var(--status-critical)" }}>
                    {it.daysDiff} days overdue
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Upcoming (next 30 days)">
          {upcoming.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">Nothing due in the next 30 days.</p>
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {upcoming.map((it, i) => (
                <li key={i} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    <Link
                      href={`/vehicles/${it.vehicle.id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {it.vehicle.registration}
                    </Link>{" "}
                    · {SERVICE_TYPE_LABELS[it.type]}
                  </span>
                  <span className="text-[var(--text-secondary)]">due {it.dueDate}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </main>
  );
}
