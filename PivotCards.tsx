"use client";

/**
 * components/PivotCards.tsx
 *
 * Renders the market regime banner and the four key pivot-level cards
 * (Spot Price, Zero Gamma / Flip, Call Wall, Put Wall) from a single
 * GexApiResponse payload. All futures-level conversions reuse
 * convertToFuturesLevel() from lib/gexEngine.ts so the UI never
 * re-implements (and risks drifting from) the conversion math.
 */

import type { ReactNode } from "react";
import { ArrowDownToLine, ArrowUpToLine, Crosshair, ShieldCheck, AlertTriangle, TrendingUp, TrendingDown, Zap } from "lucide-react";
import { convertToFuturesLevel, type FuturesConversionConfig } from "../lib/gexEngine";
import type { MarketRegime } from "../types/gex";
import type { GexApiResponse } from "../types/api";
import { formatPrice, formatCompactCurrency } from "../lib/format";

export interface PivotCardsProps {
  data: GexApiResponse;
}

export default function PivotCards({ data }: PivotCardsProps) {
  const { spotPrice, zeroGamma, callWall, putWall, regime, strikes, ticker, futuresOffset } = data;

  const futuresConfig: FuturesConversionConfig = { underlying: ticker, basisOffset: futuresOffset };
  const spotFutures = convertToFuturesLevel(spotPrice, futuresConfig);
  const zeroGammaFutures = zeroGamma !== null ? convertToFuturesLevel(zeroGamma, futuresConfig) : null;
  const callWallFutures = callWall !== null ? convertToFuturesLevel(callWall, futuresConfig) : null;
  const putWallFutures = putWall !== null ? convertToFuturesLevel(putWall, futuresConfig) : null;

  const callWallSummary = callWall !== null ? strikes.find((s) => s.strike === callWall) : undefined;
  const putWallSummary = putWall !== null ? strikes.find((s) => s.strike === putWall) : undefined;

  const distanceToFlip = zeroGamma !== null ? spotPrice - zeroGamma : null;

  return (
    <section className="flex flex-col gap-4">
      <RegimeBanner regime={regime} spotPrice={spotPrice} zeroGamma={zeroGamma} callWall={callWall} putWall={putWall} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <PivotCard
          icon={<Crosshair className="h-3.5 w-3.5" />}
          label={`${ticker} Spot Price`}
          accent="cyan"
          value={formatPrice(spotPrice)}
          subline={`ES ${formatPrice(spotFutures)}`}
        />

        <PivotCard
          icon={<Zap className="h-3.5 w-3.5" />}
          label="Zero Gamma (Flip)"
          accent="amber"
          value={zeroGamma !== null ? formatPrice(zeroGamma) : "—"}
          subline={zeroGammaFutures !== null ? `ES ${formatPrice(zeroGammaFutures)}` : "No crossing in range"}
          footer={
            distanceToFlip !== null ? (
              <span
                className={[
                  "mt-1 inline-flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
                  distanceToFlip >= 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400",
                ].join(" ")}
              >
                {distanceToFlip >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {Math.abs(distanceToFlip).toFixed(2)} pts {distanceToFlip >= 0 ? "above" : "below"}
              </span>
            ) : undefined
          }
        />

        <PivotCard
          icon={<ArrowUpToLine className="h-3.5 w-3.5" />}
          label="Call Wall · Resistance"
          accent="emerald"
          value={callWall !== null ? formatPrice(callWall) : "—"}
          subline={callWallFutures !== null ? `ES ${formatPrice(callWallFutures)}` : undefined}
          footer={
            callWallSummary ? (
              <span className="mt-1 font-mono text-[11px] tabular-nums text-emerald-400">
                {formatCompactCurrency(callWallSummary.netGex)} GEX
              </span>
            ) : undefined
          }
        />

        <PivotCard
          icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
          label="Put Wall · Support"
          accent="rose"
          value={putWall !== null ? formatPrice(putWall) : "—"}
          subline={putWallFutures !== null ? `ES ${formatPrice(putWallFutures)}` : undefined}
          footer={
            putWallSummary ? (
              <span className="mt-1 font-mono text-[11px] tabular-nums text-rose-400">
                {formatCompactCurrency(putWallSummary.netGex)} GEX
              </span>
            ) : undefined
          }
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Regime banner + flip-proximity gauge
// ---------------------------------------------------------------------------

function RegimeBanner({
  regime,
  spotPrice,
  zeroGamma,
  callWall,
  putWall,
}: {
  regime: MarketRegime;
  spotPrice: number;
  zeroGamma: number | null;
  callWall: number | null;
  putWall: number | null;
}) {
  const isLongGamma = regime.startsWith("LONG GAMMA");
  const [label, sublabel] = regime.split(" - ");

  const gaugeValues = [putWall, zeroGamma, spotPrice, callWall].filter((v): v is number => v !== null);
  const min = gaugeValues.length ? Math.min(...gaugeValues) : spotPrice - 50;
  const max = gaugeValues.length ? Math.max(...gaugeValues) : spotPrice + 50;

  return (
    <div
      className={[
        "relative overflow-hidden rounded-lg border px-4 py-3 sm:px-5",
        isLongGamma ? "border-emerald-500/30 bg-emerald-500/[0.06]" : "border-rose-500/30 bg-rose-500/[0.06]",
      ].join(" ")}
    >
      <div className={["absolute inset-y-0 left-0 w-1", isLongGamma ? "bg-emerald-500" : "bg-rose-500"].join(" ")} />

      <div className="flex flex-col gap-3 pl-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span
            className={[
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset",
              isLongGamma ? "bg-emerald-500/10 ring-emerald-500/40" : "bg-rose-500/10 ring-rose-500/40",
            ].join(" ")}
          >
            {isLongGamma ? (
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-rose-400" />
            )}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={["text-sm font-bold tracking-wide", isLongGamma ? "text-emerald-400" : "text-rose-400"].join(" ")}>
                {label}
              </span>
              <span
                className={[
                  "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset",
                  isLongGamma
                    ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30"
                    : "bg-rose-500/10 text-rose-400 ring-rose-500/30",
                ].join(" ")}
              >
                {isLongGamma ? "Dealers Long Gamma" : "Dealers Short Gamma"}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">{sublabel}</p>
          </div>
        </div>

        <FlipProximityGauge min={min} max={max} putWall={putWall} zeroGamma={zeroGamma} spotPrice={spotPrice} callWall={callWall} />
      </div>
    </div>
  );
}

/**
 * Signature "flip proximity" gauge: places Put Wall, Zero Gamma, Spot, and
 * Call Wall on a shared horizontal number line so the trader can see at a
 * glance how close spot sits to flipping the dealer gamma regime, without
 * reading raw numbers.
 */
function FlipProximityGauge({
  min,
  max,
  putWall,
  zeroGamma,
  spotPrice,
  callWall,
}: {
  min: number;
  max: number;
  putWall: number | null;
  zeroGamma: number | null;
  spotPrice: number;
  callWall: number | null;
}) {
  const PAD = 6;
  const pos = (v: number) => (max === min ? 50 : PAD + ((v - min) / (max - min)) * (100 - PAD * 2));

  return (
    <div className="w-full sm:w-64">
      <div className="relative h-1.5 rounded-full bg-slate-800">
        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-rose-500/25 via-slate-700/40 to-emerald-500/25" />

        {zeroGamma !== null && (
          <div
            className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-amber-400"
            style={{ left: `${pos(zeroGamma)}%` }}
            title={`Zero Gamma: ${zeroGamma.toFixed(2)}`}
          />
        )}
        {putWall !== null && (
          <div
            className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-400"
            style={{ left: `${pos(putWall)}%` }}
            title={`Put Wall: ${putWall}`}
          />
        )}
        {callWall !== null && (
          <div
            className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400"
            style={{ left: `${pos(callWall)}%` }}
            title={`Call Wall: ${callWall}`}
          />
        )}
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-50 shadow-[0_0_8px_2px_rgba(255,255,255,0.5)] ring-2 ring-slate-950"
          style={{ left: `${pos(spotPrice)}%` }}
          title={`Spot: ${spotPrice}`}
        />
      </div>
      <div className="mt-1 flex justify-between text-[9px] font-mono tabular-nums text-slate-600">
        <span>{putWall !== null ? putWall.toFixed(0) : "—"}</span>
        <span>{callWall !== null ? callWall.toFixed(0) : "—"}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card shell
// ---------------------------------------------------------------------------

type CardAccent = "cyan" | "amber" | "emerald" | "rose";

const ACCENT_ICON_WRAP: Record<CardAccent, string> = {
  cyan: "bg-cyan-500/10 text-cyan-400",
  amber: "bg-amber-500/10 text-amber-400",
  emerald: "bg-emerald-500/10 text-emerald-400",
  rose: "bg-rose-500/10 text-rose-400",
};

function PivotCard({
  icon,
  label,
  accent,
  value,
  subline,
  footer,
}: {
  icon: ReactNode;
  label: string;
  accent: CardAccent;
  value: string;
  subline?: string;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</span>
        <span className={["flex h-6 w-6 items-center justify-center rounded", ACCENT_ICON_WRAP[accent]].join(" ")}>{icon}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="font-mono text-2xl font-semibold tabular-nums text-slate-50">{value}</span>
      </div>
      {subline && <p className="font-mono text-xs tabular-nums text-slate-400">{subline}</p>}
      {footer}
    </div>
  );
}
