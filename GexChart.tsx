"use client";

/**
 * components/GexChart.tsx
 *
 * Horizontal bar chart of Net GEX by strike (Y = strike price, X = Net
 * GEX in $ millions), with reference lines for spot price, zero gamma,
 * call wall, and put wall, plus a detailed hover tooltip.
 *
 * Technical note on reference lines: the Y axis here is a Recharts
 * *category* axis (each strike is a discrete row/bar slot), which is
 * required for Bar to render discrete rows. Category axes can only place
 * a ReferenceLine exactly on an existing category value - they can't
 * interpolate a line at an arbitrary continuous position the way a
 * numeric axis can. Since spot price and the zero-gamma level are
 * continuous values that rarely land exactly on a listed strike, those
 * two reference lines are snapped to the nearest displayed strike via
 * findNearestStrike() from lib/gexEngine.ts. Call Wall and Put Wall are
 * themselves exact strikes (from findCallWall/findPutWall), so they need
 * no snapping. The exact underlying value is still shown in each line's
 * label and in the tooltip.
 */

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import { findNearestStrike } from "../lib/gexEngine";
import type { StrikeGexSummary } from "../types/gex";
import type { GexApiResponse } from "../types/api";
import { formatPrice, formatCompactCurrency } from "../lib/format";

// Exact colors as specified for the GEX profile: positive = green, negative = red.
const POSITIVE_COLOR = "#22c55e";
const NEGATIVE_COLOR = "#ef4444";
const SPOT_COLOR = "#22d3ee"; // cyan-400
const ZERO_GAMMA_COLOR = "#fbbf24"; // amber-400

const ZOOM_OPTIONS = [15, 30, 60] as const;
type ZoomOption = (typeof ZOOM_OPTIONS)[number];

export interface GexChartProps {
  data: GexApiResponse;
  /** Initial number of strikes shown, centered on spot price. Defaults to 30. */
  defaultZoom?: ZoomOption;
}

interface ChartDatum {
  strike: number;
  callGex: number;
  putGex: number;
  netGex: number;
  netGexM: number;
  convertedFuturesPrice: number;
}

/** Selects a window of strikes centered on spot price, for a readable chart at any chain size. */
function selectStrikeWindow(strikes: StrikeGexSummary[], spotPrice: number, windowSize: number): StrikeGexSummary[] {
  if (strikes.length <= windowSize) return strikes;

  const sorted = [...strikes].sort((a, b) => a.strike - b.strike);
  let nearestIndex = 0;
  let nearestDistance = Infinity;

  sorted.forEach((s, i) => {
    const distance = Math.abs(s.strike - spotPrice);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = i;
    }
  });

  const half = Math.floor(windowSize / 2);
  let start = Math.max(0, nearestIndex - half);
  let end = Math.min(sorted.length, start + windowSize);
  start = Math.max(0, end - windowSize);

  return sorted.slice(start, end);
}

function buildChartData(strikes: StrikeGexSummary[]): ChartDatum[] {
  return strikes
    .map((s) => ({
      strike: s.strike,
      callGex: s.callGex,
      putGex: s.putGex,
      netGex: s.netGex,
      netGexM: s.netGex / 1_000_000,
      convertedFuturesPrice: s.convertedFuturesPrice,
    }))
    .sort((a, b) => b.strike - a.strike); // highest strike first -> renders at top of the chart
}

export default function GexChart({ data, defaultZoom = 30 }: GexChartProps) {
  const [zoom, setZoom] = useState<ZoomOption>(defaultZoom);
  const { spotPrice, zeroGamma, callWall, putWall, strikes } = data;

  const windowedStrikes = useMemo(
    () => selectStrikeWindow(strikes, spotPrice, zoom),
    [strikes, spotPrice, zoom]
  );
  const chartData = useMemo(() => buildChartData(windowedStrikes), [windowedStrikes]);

  // Snap continuous levels (spot, zero gamma) onto a strike present in the
  // currently-displayed window, so their reference lines are always visible.
  const spotStrike = useMemo(() => findNearestStrike(windowedStrikes, spotPrice), [windowedStrikes, spotPrice]);
  const zeroGammaStrike = useMemo(
    () => (zeroGamma !== null ? findNearestStrike(windowedStrikes, zeroGamma) : null),
    [windowedStrikes, zeroGamma]
  );
  const callWallInView = callWall !== null && windowedStrikes.some((s) => s.strike === callWall) ? callWall : null;
  const putWallInView = putWall !== null && windowedStrikes.some((s) => s.strike === putWall) ? putWall : null;

  const chartHeight = Math.max(360, chartData.length * 26);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">GEX Profile by Strike</h2>
          <p className="text-xs text-slate-500">Net Gamma Exposure, $ Millions</p>
        </div>

        <div className="flex items-center gap-3">
          <ChartLegend />
          <div className="inline-flex rounded-md bg-slate-950 p-0.5 ring-1 ring-inset ring-slate-800">
            {ZOOM_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setZoom(opt)}
                aria-pressed={zoom === opt}
                className={[
                  "rounded px-2 py-1 text-[11px] font-medium transition-colors",
                  zoom === opt ? "bg-slate-700 text-slate-50" : "text-slate-400 hover:text-slate-200",
                ].join(" ")}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
            <XAxis
              type="number"
              dataKey="netGexM"
              tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v.toFixed(0)}M`}
              stroke="#64748b"
              tick={{ fontSize: 11, fontFamily: "ui-monospace, monospace" }}
              axisLine={{ stroke: "#334155" }}
            />
            <YAxis
              type="category"
              dataKey="strike"
              width={64}
              tickFormatter={(v: number) => v.toLocaleString("en-US")}
              stroke="#64748b"
              tick={{ fontSize: 11, fontFamily: "ui-monospace, monospace" }}
              axisLine={{ stroke: "#334155" }}
            />
            <Tooltip content={ChartTooltip} cursor={{ fill: "rgba(148, 163, 184, 0.06)" }} />

            <Bar dataKey="netGexM" radius={[2, 2, 2, 2]} maxBarSize={18}>
              {chartData.map((entry) => (
                <Cell key={entry.strike} fill={entry.netGex >= 0 ? POSITIVE_COLOR : NEGATIVE_COLOR} />
              ))}
            </Bar>

            {spotStrike !== null && (
              <ReferenceLine
                y={spotStrike}
                stroke={SPOT_COLOR}
                strokeWidth={2}
                ifOverflow="extendDomain"
                label={{ value: "SPOT", position: "insideTopRight", fill: SPOT_COLOR, fontSize: 10 }}
              />
            )}
            {zeroGammaStrike !== null && (
              <ReferenceLine
                y={zeroGammaStrike}
                stroke={ZERO_GAMMA_COLOR}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                ifOverflow="extendDomain"
                label={{ value: "FLIP", position: "insideBottomRight", fill: ZERO_GAMMA_COLOR, fontSize: 10 }}
              />
            )}
            {callWallInView !== null && (
              <ReferenceLine
                y={callWallInView}
                stroke={POSITIVE_COLOR}
                strokeWidth={1.5}
                strokeDasharray="2 2"
                ifOverflow="extendDomain"
              />
            )}
            {putWallInView !== null && (
              <ReferenceLine
                y={putWallInView}
                stroke={NEGATIVE_COLOR}
                strokeWidth={1.5}
                strokeDasharray="2 2"
                ifOverflow="extendDomain"
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ChartLegend() {
  return (
    <div className="flex items-center gap-3 text-[10px] text-slate-500">
      <LegendItem color={POSITIVE_COLOR} label="Call-dominant" />
      <LegendItem color={NEGATIVE_COLOR} label="Put-dominant" />
      <LegendItem color={SPOT_COLOR} label="Spot" />
      <LegendItem color={ZERO_GAMMA_COLOR} label="Flip" />
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

/**
 * Custom tooltip content. Recharts types the raw payload entry's
 * `.payload` field as `any` (it's generic over arbitrary chart data), so
 * we narrow it to ChartDatum here at the single point where it enters our
 * code, rather than threading `any` further into the component.
 */
function ChartTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;

  const datum = payload[0]?.payload as ChartDatum | undefined;
  if (!datum) return null;

  return (
    <div className="rounded-md border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs shadow-xl">
      <p className="mb-1.5 font-mono text-sm font-semibold tabular-nums text-slate-100">{formatPrice(datum.strike)}</p>
      <dl className="space-y-0.5">
        <TooltipRow label="Call GEX" value={formatCompactCurrency(datum.callGex)} valueClassName="text-emerald-400" />
        <TooltipRow label="Put GEX" value={formatCompactCurrency(datum.putGex)} valueClassName="text-rose-400" />
        <TooltipRow
          label="Net GEX"
          value={formatCompactCurrency(datum.netGex)}
          valueClassName={datum.netGex >= 0 ? "text-emerald-400" : "text-rose-400"}
        />
        <TooltipRow label="ES Level" value={formatPrice(datum.convertedFuturesPrice)} valueClassName="text-slate-300" />
      </dl>
    </div>
  );
}

function TooltipRow({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className={["font-mono tabular-nums", valueClassName ?? "text-slate-200"].join(" ")}>{value}</dd>
    </div>
  );
}
