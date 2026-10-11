"use client";

/**
 * app/page.tsx
 *
 * Main GEX dashboard page. Owns all interactive state (ticker, expiry,
 * futures offset, auto-refresh cadence) and the data-fetching/polling
 * logic, then hands the result down to the presentational components
 * built in Steps 3-4.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import HeaderControls, {
  type TickerSymbol,
  type ExpiryOption,
  type RefreshInterval,
} from "../components/HeaderControls";
import PivotCards from "../components/PivotCards";
import GexChart from "../components/GexChart";
import StrikeTable from "../components/StrikeTable";
import type { GexApiResponse, GexApiErrorResponse } from "../types/api";

// Only these tickers are wired to the backend today (see lib/services/dataService.ts
// and types/gex.ts UnderlyingSymbol). "QQQ" is offered in the selector as a
// forward-looking option - see HeaderControls.tsx for details.
const SUPPORTED_TICKERS = new Set<TickerSymbol>(["SPX", "SPY"]);

const REFRESH_MS: Record<RefreshInterval, number | null> = {
  off: null,
  "5s": 5000,
  "15s": 15000,
};

export default function GexDashboardPage() {
  // --- Controlled UI state (owned here, passed down to HeaderControls) ---
  const [ticker, setTicker] = useState<TickerSymbol>("SPX");
  const [expiry, setExpiry] = useState<ExpiryOption>("ALL");
  const [futuresOffset, setFuturesOffset] = useState<number>(15.25);
  const [refreshInterval, setRefreshInterval] = useState<RefreshInterval>("15s");

  // --- Data state ---
  const [data, setData] = useState<GexApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | undefined>(undefined);

  // Guards against a slow, stale request overwriting a newer one's result.
  const requestIdRef = useRef(0);
  // Tracks whether we've completed at least one successful load for the
  // *current* param set, so background auto-refresh polls don't re-trigger
  // the full-page skeleton (only the initial load / param change should).
  const hasLoadedOnceRef = useRef(false);

  const isTickerSupported = SUPPORTED_TICKERS.has(ticker);

  const load = useCallback(async () => {
    if (!isTickerSupported) {
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    if (!hasLoadedOnceRef.current) setIsLoading(true);
    setError(null);

    try {
      // The backend (types/api.ts ExpiryFilter) only supports "0DTE" | "ALL"
      // today. "NEXT_EXPIRY" is a forward-looking UI option (see
      // HeaderControls.tsx) - map it to "ALL" for now rather than sending an
      // invalid param, and surface a notice in the UI (see NoticeBanner below).
      const backendExpiry = expiry === "NEXT_EXPIRY" ? "ALL" : expiry;

      const qs = new URLSearchParams({
        ticker,
        expiry: backendExpiry,
        futuresOffset: String(futuresOffset),
      });

      const response = await fetch(`/api/gex?${qs.toString()}`, { cache: "no-store" });
      const body = (await response.json()) as GexApiResponse | GexApiErrorResponse;

      if (requestId !== requestIdRef.current) return; // a newer request has already superseded this one

      if (!response.ok) {
        throw new Error((body as GexApiErrorResponse).error ?? `Request failed with status ${response.status}`);
      }

      setData(body as GexApiResponse);
      setLastUpdatedAt(new Date());
      hasLoadedOnceRef.current = true;
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load GEX data.");
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [ticker, expiry, futuresOffset, isTickerSupported]);

  // Param change (ticker / expiry / futuresOffset / ticker support) -> full
  // reset so stale data is never shown under a different label.
  useEffect(() => {
    setData(null);
    hasLoadedOnceRef.current = false;
    load();
  }, [load]);

  // Auto-refresh polling. Re-armed whenever the interval or the fetch
  // params change; background polls reuse hasLoadedOnceRef so they don't
  // flash the full skeleton over existing data.
  useEffect(() => {
    const ms = REFRESH_MS[refreshInterval];
    if (ms === null) return;

    const id = setInterval(() => {
      load();
    }, ms);

    return () => clearInterval(id);
  }, [refreshInterval, load]);

  const retry = () => {
    load();
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-slate-200">
      <HeaderControls
        ticker={ticker}
        onTickerChange={setTicker}
        expiry={expiry}
        onExpiryChange={setExpiry}
        futuresOffset={futuresOffset}
        onFuturesOffsetChange={setFuturesOffset}
        refreshInterval={refreshInterval}
        onRefreshIntervalChange={setRefreshInterval}
        dataSource={data?.dataSource}
        lastUpdatedAt={lastUpdatedAt}
      />

      <main className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6">
        {expiry === "NEXT_EXPIRY" && (
          <NoticeBanner>
            &ldquo;Next Expiry&rdquo; filtering isn&rsquo;t wired to the backend yet - showing all available
            expirations instead.
          </NoticeBanner>
        )}

        {!isTickerSupported ? (
          <UnsupportedTickerNotice ticker={ticker} />
        ) : error && !data ? (
          <ErrorState message={error} onRetry={retry} />
        ) : isLoading && !data ? (
          <LoadingSkeleton />
        ) : data ? (
          <>
            {error && <InlineErrorBanner message={error} />}
            <PivotCards data={data} />
            <GexChart data={data} />
            <StrikeTable data={data} />
          </>
        ) : null}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading / error / notice states
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-4">
      <div className="h-16 rounded-lg bg-slate-900" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-lg bg-slate-900" />
        ))}
      </div>
      <div className="h-[400px] rounded-lg bg-slate-900" />
      <div className="h-64 rounded-lg bg-slate-900" />
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-rose-500/30 bg-rose-500/[0.06] px-6 py-16 text-center">
      <AlertTriangle className="h-8 w-8 text-rose-400" />
      <p className="text-sm font-medium text-slate-100">Failed to load GEX data</p>
      <p className="max-w-md text-xs text-slate-400">{message}</p>
      <button
        type="button"
        onClick={() => onRetry()}
        className="mt-2 flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Retry
      </button>
    </div>
  );
}

function InlineErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-300">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      Last refresh failed ({message}). Showing the most recent successful data.
    </div>
  );
}

function NoticeBanner({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-400">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-slate-500" />
      {children}
    </div>
  );
}

function UnsupportedTickerNotice({ ticker }: { ticker: TickerSymbol }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-6 py-16 text-center">
      <p className="text-sm font-medium text-slate-200">{ticker} support is coming soon</p>
      <p className="max-w-md text-xs text-slate-500">
        The GEX engine currently computes analytics for SPX and SPY only. Switch back to one of those tickers to see
        live data.
      </p>
    </div>
  );
}
