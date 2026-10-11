"use client";

/**
 * components/StrikeTable.tsx
 *
 * Dense, scrollable strike-by-strike GEX data table: strike price,
 * converted ES futures price, call/put/net GEX in $ millions, and a
 * role label identifying pivot strikes (Spot, Zero Gamma, Call Wall,
 * Put Wall). Supports filtering to a strike-price range for quickly
 * zeroing in on a region of the chain.
 */

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { findNearestStrike } from "../lib/gexEngine";
import type { StrikeGexSummary } from "../types/gex";
import type { GexApiResponse } from "../types/api";
import { formatPrice, formatMillions } from "../lib/format";

export interface StrikeTableProps {
  data: GexApiResponse;
}

type RoleKind = "spot" | "zero-gamma" | "call-wall" | "put-wall";

interface RoleBadge {
  kind: RoleKind;
  label: string;
}

const ROLE_BADGE_STYLES: Record<RoleKind, string> = {
  spot: "bg-cyan-500/10 text-cyan-400 ring-cyan-500/30",
  "zero-gamma": "bg-amber-500/10 text-amber-400 ring-amber-500/30",
  "call-wall": "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30",
  "put-wall": "bg-rose-500/10 text-rose-400 ring-rose-500/30",
};

// Row background priority when a strike carries more than one role -
// spot is what the trader is anchored to right now, so it wins visually.
const ROW_TINT_BY_PRIORITY: { kind: RoleKind; className: string }[] = [
  { kind: "spot", className: "bg-cyan-500/[0.06]" },
  { kind: "call-wall", className: "bg-emerald-500/[0.06]" },
  { kind: "put-wall", className: "bg-rose-500/[0.06]" },
  { kind: "zero-gamma", className: "bg-amber-500/[0.06]" },
];

export default function StrikeTable({ data }: StrikeTableProps) {
  const { spotPrice, zeroGamma, callWall, putWall, strikes } = data;

  const [minStrike, setMinStrike] = useState("");
  const [maxStrike, setMaxStrike] = useState("");

  const spotStrike = useMemo(() => findNearestStrike(strikes, spotPrice), [strikes, spotPrice]);
  const zeroGammaStrike = useMemo(
    () => (zeroGamma !== null ? findNearestStrike(strikes, zeroGamma) : null),
    [strikes, zeroGamma]
  );

  const rolesByStrike = useMemo(() => {
    const map = new Map<number, RoleBadge[]>();
    const add = (strike: number | null, badge: RoleBadge) => {
      if (strike === null) return;
      const existing = map.get(strike) ?? [];
      existing.push(badge);
      map.set(strike, existing);
    };

    add(spotStrike, { kind: "spot", label: "SPOT" });
    add(zeroGammaStrike, { kind: "zero-gamma", label: "FLIP" });
    add(callWall, { kind: "call-wall", label: "CALL WALL" });
    add(putWall, { kind: "put-wall", label: "PUT WALL" });

    return map;
  }, [spotStrike, zeroGammaStrike, callWall, putWall]);

  const sortedStrikes = useMemo(() => [...strikes].sort((a, b) => b.strike - a.strike), [strikes]);

  const filteredStrikes = useMemo(() => {
    const min = minStrike.trim() === "" ? -Infinity : Number(minStrike);
    const max = maxStrike.trim() === "" ? Infinity : Number(maxStrike);
    if (!Number.isFinite(min) && min !== -Infinity) return sortedStrikes;
    if (!Number.isFinite(max) && max !== Infinity) return sortedStrikes;

    return sortedStrikes.filter((s) => s.strike >= min && s.strike <= max);
  }, [sortedStrikes, minStrike, maxStrike]);

  const hasFilter = minStrike.trim() !== "" || maxStrike.trim() !== "";

  const focusOnAtm = () => {
    setMinStrike(String(Math.round(spotPrice - 100)));
    setMaxStrike(String(Math.round(spotPrice + 100)));
  };

  const clearFilter = () => {
    setMinStrike("");
    setMaxStrike("");
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Strike-Level GEX Detail</h2>
          <p className="text-xs text-slate-500">
            {filteredStrikes.length} of {strikes.length} strikes
          </p>
        </div>

        <div className="flex items-center gap-2">
          <StrikeRangeInput label="Min" value={minStrike} onChange={setMinStrike} />
          <span className="text-slate-600">–</span>
          <StrikeRangeInput label="Max" value={maxStrike} onChange={setMaxStrike} />

          <button
            type="button"
            onClick={focusOnAtm}
            className="rounded-md bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-slate-100"
          >
            Near ATM
          </button>

          {hasFilter && (
            <button
              type="button"
              onClick={clearFilter}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium text-slate-500 transition-colors hover:text-slate-300"
              aria-label="Clear strike range filter"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="max-h-[520px] overflow-y-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-slate-900">
            <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
              <Th align="left">Strike</Th>
              <Th align="right">ES Price</Th>
              <Th align="right">Call GEX ($M)</Th>
              <Th align="right">Put GEX ($M)</Th>
              <Th align="right">Net GEX ($M)</Th>
              <Th align="left">Role</Th>
            </tr>
          </thead>
          <tbody>
            {filteredStrikes.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No strikes in this range.
                </td>
              </tr>
            ) : (
              filteredStrikes.map((s) => (
                <StrikeRow key={s.strike} strike={s} roles={rolesByStrike.get(s.strike) ?? []} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StrikeRangeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md bg-slate-950 px-2 py-1 ring-1 ring-inset ring-slate-800 focus-within:ring-emerald-500/50">
      <Search className="h-3 w-3 text-slate-600" />
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        aria-label={`${label} strike`}
        className="w-16 bg-transparent font-mono text-[11px] tabular-nums text-slate-100 outline-none placeholder:text-slate-600"
      />
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align: "left" | "right" }) {
  return <th className={["px-4 py-2 font-medium", align === "right" ? "text-right" : "text-left"].join(" ")}>{children}</th>;
}

function StrikeRow({ strike, roles }: { strike: StrikeGexSummary; roles: RoleBadge[] }) {
  const primaryRole = ROW_TINT_BY_PRIORITY.find((r) => roles.some((role) => role.kind === r.kind));
  const rowTint = primaryRole?.className ?? "";

  return (
    <tr className={["border-b border-slate-800/60 transition-colors hover:bg-slate-800/40", rowTint].join(" ")}>
      <td className="px-4 py-1.5 font-mono tabular-nums text-slate-200">{formatPrice(strike.strike)}</td>
      <td className="px-4 py-1.5 text-right font-mono tabular-nums text-slate-400">
        {formatPrice(strike.convertedFuturesPrice)}
      </td>
      <td className="px-4 py-1.5 text-right font-mono tabular-nums text-emerald-400">{formatMillions(strike.callGex)}</td>
      <td className="px-4 py-1.5 text-right font-mono tabular-nums text-rose-400">{formatMillions(strike.putGex)}</td>
      <td
        className={[
          "px-4 py-1.5 text-right font-mono font-semibold tabular-nums",
          strike.netGex >= 0 ? "text-emerald-400" : "text-rose-400",
        ].join(" ")}
      >
        {formatMillions(strike.netGex)}
      </td>
      <td className="px-4 py-1.5">
        <div className="flex flex-wrap gap-1">
          {roles.map((role) => (
            <span
              key={role.kind}
              className={[
                "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ring-1 ring-inset",
                ROLE_BADGE_STYLES[role.kind],
              ].join(" ")}
            >
              {role.label}
            </span>
          ))}
        </div>
      </td>
    </tr>
  );
}
