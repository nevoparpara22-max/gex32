/**
 * lib/format.ts
 *
 * Shared display-formatting helpers for price/currency/time values used
 * across the dashboard UI components. Pure functions, no React/DOM deps,
 * so they're trivially unit-testable on their own.
 */

/** Formats a price level with thousands separators and 2 decimals, e.g. 5015.25 -> "5,015.25" */
export function formatPrice(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Formats a large dollar magnitude (typically a GEX value in raw dollars)
 * into a compact human-readable string, e.g. 1_420_000_000 -> "$1.42B",
 * -856_300_000 -> "-$856.3M".
 */
export function formatCompactCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/**
 * Formats a dollar magnitude in fixed $ millions with 2 decimals, e.g.
 * 1_420_000 -> "$1.42M". Used by the chart/table where every value shares
 * the same unit (so a mixed-unit compact format would be harder to scan
 * column-by-column than a fixed one).
 */
export function formatMillions(value: number): string {
  const millions = value / 1_000_000;
  const sign = millions > 0 ? "+" : "";
  return `${sign}${millions.toFixed(2)}M`;
}

/** Formats a Date/ISO timestamp as a short relative-time string, e.g. "Updated 3s ago" */
export function formatRelativeTime(value: string | Date, now: Date = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const diffSec = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));

  if (diffSec < 1) return "Updated just now";
  if (diffSec < 60) return `Updated ${diffSec}s ago`;

  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `Updated ${diffMin}m ago`;

  const diffHr = Math.round(diffMin / 60);
  return `Updated ${diffHr}h ago`;
}
