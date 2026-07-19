"use client";

import { useState } from "react";
import { formatMoney, type MonthCost } from "@/lib/insights";

/**
 * Dependency-free SVG charts. Single-series, so identity is carried by the
 * title (no legend needed); values surface via hover tooltip.
 */

function niceMax(n: number): number {
  if (n <= 0) return 100;
  const pow = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / pow) * pow;
}

export function MonthlyCostChart({ data }: { data: MonthCost[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560;
  const H = 220;
  const pad = { top: 16, right: 8, bottom: 28, left: 48 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const max = niceMax(Math.max(...data.map((d) => d.total)));
  const band = plotW / data.length;
  const barW = Math.min(40, band * 0.55);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Monthly repair cost, last 6 months"
    >
      {[0.25, 0.5, 0.75, 1].map((f) => {
        const y = pad.top + plotH * (1 - f);
        return (
          <g key={f}>
            <line
              x1={pad.left}
              x2={W - pad.right}
              y1={y}
              y2={y}
              stroke="var(--gridline)"
              strokeWidth={1}
            />
            <text
              x={pad.left - 8}
              y={y + 3}
              textAnchor="end"
              fontSize={10}
              fill="var(--text-muted)"
            >
              {formatMoney(max * f)}
            </text>
          </g>
        );
      })}
      <line
        x1={pad.left}
        x2={W - pad.right}
        y1={pad.top + plotH}
        y2={pad.top + plotH}
        stroke="var(--baseline)"
        strokeWidth={1}
      />
      {data.map((d, i) => {
        const h = max === 0 ? 0 : (d.total / max) * plotH;
        const x = pad.left + band * i + (band - barW) / 2;
        const y = pad.top + plotH - h;
        return (
          <g
            key={d.month}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            {/* invisible hit target wider than the bar */}
            <rect
              x={pad.left + band * i}
              y={pad.top}
              width={band}
              height={plotH}
              fill="transparent"
            />
            <path
              d={`M${x},${y + h} L${x},${y + 4} Q${x},${y} ${x + 4},${y} L${x + barW - 4},${y} Q${x + barW},${y} ${x + barW},${y + 4} L${x + barW},${y + h} Z`}
              fill="var(--series-1)"
              opacity={hover === null || hover === i ? 1 : 0.45}
            />
            {hover === i && d.total > 0 && (
              <text
                x={x + barW / 2}
                y={y - 6}
                textAnchor="middle"
                fontSize={11}
                fontWeight={600}
                fill="var(--foreground)"
              >
                {formatMoney(d.total)}
              </text>
            )}
            <text
              x={pad.left + band * i + band / 2}
              y={H - 8}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text-muted)"
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function TopVehiclesChart({
  data,
}: {
  data: { label: string; total: number }[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560;
  const rowH = 34;
  const pad = { top: 4, right: 70, bottom: 4, left: 76 };
  const H = pad.top + pad.bottom + rowH * data.length;
  const plotW = W - pad.left - pad.right;
  const max = Math.max(...data.map((d) => d.total), 1);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Top vehicles by maintenance cost"
    >
      {data.map((d, i) => {
        const w = (d.total / max) * plotW;
        const y = pad.top + rowH * i + (rowH - 16) / 2;
        return (
          <g
            key={d.label}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <rect
              x={0}
              y={pad.top + rowH * i}
              width={W}
              height={rowH}
              fill="transparent"
            />
            <text
              x={pad.left - 8}
              y={y + 12}
              textAnchor="end"
              fontSize={11}
              fill="var(--text-secondary)"
            >
              {d.label}
            </text>
            <path
              d={`M${pad.left},${y} L${pad.left + Math.max(w, 8) - 4},${y} Q${pad.left + Math.max(w, 8)},${y} ${pad.left + Math.max(w, 8)},${y + 4} L${pad.left + Math.max(w, 8)},${y + 12} Q${pad.left + Math.max(w, 8)},${y + 16} ${pad.left + Math.max(w, 8) - 4},${y + 16} L${pad.left},${y + 16} Z`}
              fill="var(--series-1)"
              opacity={hover === null || hover === i ? 1 : 0.45}
            />
            <text
              x={pad.left + Math.max(w, 8) + 8}
              y={y + 12}
              fontSize={11}
              fontWeight={hover === i ? 700 : 400}
              fill="var(--text-secondary)"
            >
              {formatMoney(d.total)}
            </text>
          </g>
        );
      })}
      <line
        x1={pad.left}
        x2={pad.left}
        y1={pad.top}
        y2={H - pad.bottom}
        stroke="var(--baseline)"
        strokeWidth={1}
      />
    </svg>
  );
}
