"use client";

/**
 * components/HeaderControls.tsx
 *
 * Top control bar for the GEX dashboard: instrument selector, expiration
 * filter, ES futures basis offset input, auto-refresh cadence, and a
 * live/demo data status badge.
 *
 * This is a fully controlled, presentational component - it holds no
 * data-fetching or polling logic itself. The parent page is expected to
 * own the actual state and pass it down along with change handlers (this
 * keeps HeaderControls trivially reusable/testable and keeps the eventual
 * polling `setInterval` logic in one place higher up the tree).
 */

import { useEffect, useState } from "react";
import { ArrowLeftRight, Zap } from "lucide-react";
import type { DataSource } from "../types/api";
import { formatRelativeTime } from "../lib/format";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Tickers offered in the selector. Note: the backend (types/gex.ts
 * UnderlyingSymbol, lib/services/dataService.ts) currently only computes
 * GEX for "SPX" | "SPY". "QQQ" is included here as a forward-looking UI
 * option and will need the data/engine layer extended before it can be
 * wired to real data.
 */
export type TickerSymbol = "SPX" | "SPY" | "QQQ";

/**
 * Expiration scopes offered in the filter. Note: the backend
 * (types/api.ts ExpiryFilter) currently only supports "0DTE" | "ALL".
 * "NEXT_EXPIRY" is a forward-looking UI option pending backend support
 * for filtering to the nearest non-zero-DTE expiration.
 */
export type ExpiryOption = "0DTE" | "NEXT_EXPIRY" | "ALL";

export type RefreshInterval = "off" | "5s" | "15s";

export interface HeaderControlsProps {
  ticker: TickerSymbol;
  onTickerChange: (ticker: TickerSymbol) => void;

  expiry: ExpiryOption;
  onExpiryChange: (expiry: ExpiryOption) => void;

  /** ES futures basis offset, in index points (e.g. 15.5 for "+15.50") */
  futuresOffset: number;
  onFuturesOffsetChange: (offset: number) => void;

  refreshInterval: RefreshInterval;
  onRefreshIntervalChange: (interval: RefreshInterval) => void;

  /** Whether the data currently on screen is live or simulated. Defaults to "mock". */
  dataSource?: DataSource;
  /** Timestamp of the last successful data refresh, shown next to the live badge. */
  lastUpdatedAt?: string | Date;
}

// ---------------------------------------------------------------------------
// Option catalogs
// ---------------------------------------------------------------------------

interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

const TICKER_OPTIONS: SegmentOption<TickerSymbol>[] = [
  { value: "SPX", label: "SPX" },
  { value: "SPY", label: "SPY" },
  { value: "QQQ", label: "QQQ" },
];

const EXPIRY_OPTIONS: SegmentOption<ExpiryOption>[] = [
  { value: "0DTE", label: "0DTE" },
  { value: "NEXT_EXPIRY", label: "Next Expiry" },
  { value: "ALL", label: "All Expirations" },
];

const REFRESH_OPTIONS: SegmentOption<RefreshInterval>[] = [
  { value: "off", label: "Off" },
  { value: "5s", label: "5s" },
  { value: "15s", label: "15s" },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function HeaderControls({
  ticker,
  onTickerChange,
  expiry,
  onExpiryChange,
  futuresOffset,
  onFuturesOffsetChange,
  refreshInterval,
  onRefreshIntervalChange,
  dataSource = "mock",
  lastUpdatedAt,
}: HeaderControlsProps) {
  return (
    <header className="w-full border-b border-slate-800 bg-zinc-950">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        {/* Brand mark */}
        <div className="flex items-center gap-2 pr-2">
          <span className="flex h-7 w-7 items-center justify-center rounded bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/30">
            <Zap className="h-4 w-4 text-emerald-400" strokeWidth={2.5} />
          </span>
          <span className="text-sm font-semibold tracking-wide text-slate-100">GEX TERMINAL</span>
        </div>

        <Divider />

        <ControlGroup label="Ticker">
          <SegmentedControl options={TICKER_OPTIONS} value={ticker} onChange={onTickerChange} />
        </ControlGroup>

        <Divider className="hidden lg:block" />

        <ControlGroup label="Expiration">
          <SegmentedControl options={EXPIRY_OPTIONS} value={expiry} onChange={onExpiryChange} />
        </ControlGroup>

        <Divider className="hidden lg:block" />

        <ControlGroup label="ES Basis Offset">
          <FuturesOffsetInput value={futuresOffset} onChange={onFuturesOffsetChange} />
        </ControlGroup>

        <div className="ml-auto flex items-center gap-4">
          <ControlGroup label="Auto-Refresh">
            <SegmentedControl options={REFRESH_OPTIONS} value={refreshInterval} onChange={onRefreshIntervalChange} />
          </ControlGroup>

          <LiveBadge dataSource={dataSource} isPolling={refreshInterval !== "off"} lastUpdatedAt={lastUpdatedAt} />
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Divider({ className = "" }: { className?: string }) {
  return <div className={["hidden h-6 w-px bg-slate-800 sm:block", className].join(" ")} />;
}

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</span>
      {children}
    </div>
  );
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md bg-slate-900 p-0.5 ring-1 ring-inset ring-slate-800">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={[
              "rounded px-2.5 py-1 text-xs font-medium transition-colors",
              active ? "bg-slate-700 text-slate-50 shadow-sm" : "text-slate-400 hover:text-slate-200",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function formatOffsetDraft(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

function FuturesOffsetInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(formatOffsetDraft(value));

  // Keep the draft in sync if the value changes externally (e.g. reset elsewhere)
  useEffect(() => {
    setDraft(formatOffsetDraft(value));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) {
      onChange(parsed);
      setDraft(formatOffsetDraft(parsed));
    } else {
      setDraft(formatOffsetDraft(value)); // revert invalid input
    }
  };

  return (
    <div className="flex items-center gap-1.5 rounded-md bg-slate-900 px-2 py-1 ring-1 ring-inset ring-slate-800 focus-within:ring-emerald-500/50">
      <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="w-16 bg-transparent text-right font-mono text-xs tabular-nums text-slate-100 outline-none placeholder:text-slate-600"
        placeholder="+15.50"
        aria-label="ES futures basis offset, in index points"
      />
      <span className="text-[10px] text-slate-500">pts</span>
    </div>
  );
}

function LiveBadge({
  dataSource,
  isPolling,
  lastUpdatedAt,
}: {
  dataSource: DataSource;
  isPolling: boolean;
  lastUpdatedAt?: string | Date;
}) {
  const isLive = dataSource === "live";

  return (
    <div className="flex items-center gap-2">
      <div
        className={[
          "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset",
          isLive
            ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30"
            : "bg-amber-500/10 text-amber-400 ring-amber-500/30",
        ].join(" ")}
      >
        <span className="relative flex h-1.5 w-1.5">
          {isPolling && (
            <span
              className={[
                "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                isLive ? "bg-emerald-400" : "bg-amber-400",
              ].join(" ")}
            />
          )}
          <span
            className={["relative inline-flex h-1.5 w-1.5 rounded-full", isLive ? "bg-emerald-400" : "bg-amber-400"].join(
              " "
            )}
          />
        </span>
        {isLive ? "Live" : "Demo Data"}
      </div>
      {lastUpdatedAt && (
        <span className="hidden font-mono text-[10px] text-slate-600 sm:inline">
          {formatRelativeTime(lastUpdatedAt)}
        </span>
      )}
    </div>
  );
}
