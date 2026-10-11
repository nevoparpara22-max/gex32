/**
 * lib/services/dataService.ts
 *
 * Options chain data provider. Exposes a single orchestrating function,
 * getOptionChain(), which:
 *   - fetches a live snapshot from Polygon.io when POLYGON_API_KEY is set
 *   - falls back to a realistic mock generator when it is not set, or
 *     whenever the live fetch fails for any reason
 *
 * This keeps the rest of the app (API routes, tests, local dev) working
 * without requiring a paid data subscription.
 */

import type { OptionContract, OptionType, UnderlyingSymbol } from "../../types/gex";
import type { DataSource } from "../../types/api";

// ---------------------------------------------------------------------------
// Shared result shape
// ---------------------------------------------------------------------------

export interface OptionChainRequestOptions {
  /** Restrict results to a single expiration date (ISO, YYYY-MM-DD). Omit for all available expirations. */
  expirationDate?: string;
  /** Override the spot price used by the mock generator only (ignored for live fetches). */
  mockSpotPriceOverride?: number;
}

export interface OptionChainResult {
  contracts: OptionContract[];
  spotPrice: number;
  source: DataSource;
}

// =============================================================================
// SECTION 1: Mock Data Generator
// =============================================================================

const OPTION_TYPES: OptionType[] = ["call", "put"];
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const CALENDAR_DAYS_PER_YEAR = 365;

/** Assumed hours remaining in the session when generating 0DTE mock contracts (avoids T=0 in Black-Scholes) */
const ZERO_DTE_HOURS_REMAINING = 4;

/** Approximate short-term risk-free rate used for the mock gamma model */
const RISK_FREE_RATE = 0.045;

/** Approximate SPX dividend yield used for the mock gamma model */
const DIVIDEND_YIELD = 0.013;

interface MockExpirationConfig {
  /** ISO date (YYYY-MM-DD) */
  date: string;
  /** Calendar days between "today" and this expiration */
  daysToExpiry: number;
}

export interface MockChainOptions {
  /** Number of strikes generated on each side of spot (total strikes = 2 * strikeCount + 1) */
  strikeCount: number;
  /** Distance between adjacent strikes, in underlying points */
  strikeInterval: number;
  /** At-the-money base implied volatility (decimal, e.g. 0.14 = 14%) */
  baseIv: number;
  /** Controls how steeply IV rises for downside (put-side) strikes vs upside (call-side) strikes */
  skewSlope: number;
  /** Expirations to generate. Defaults to a realistic 0DTE + weekly + monthly set. */
  expirations?: MockExpirationConfig[];
}

/** Default mock chain shape per underlying (SPX trades in $5 strikes, SPY in $1 strikes) */
function defaultMockOptions(ticker: UnderlyingSymbol): MockChainOptions {
  return ticker === "SPY"
    ? { strikeCount: 40, strikeInterval: 1, baseIv: 0.14, skewSlope: 0.35 }
    : { strikeCount: 40, strikeInterval: 5, baseIv: 0.14, skewSlope: 0.35 };
}

function formatIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

/** Next Friday on/after `from` (0 days out if `from` is itself a Friday) */
function nextFriday(from: Date): Date {
  const day = from.getDay(); // 0 = Sunday ... 5 = Friday ... 6 = Saturday
  const daysUntilFriday = (5 - day + 7) % 7;
  return addDays(from, daysUntilFriday);
}

/** Third Friday of a given month/year - the standard SPX/SPY monthly expiration */
function thirdFridayOfMonth(year: number, monthIndex: number): Date {
  const firstOfMonth = new Date(year, monthIndex, 1);
  const firstFridayOffset = (5 - firstOfMonth.getDay() + 7) % 7;
  const firstFriday = addDays(firstOfMonth, firstFridayOffset);
  return addDays(firstFriday, 14); // third Friday = first Friday + 2 weeks
}

/**
 * Builds a realistic default expiration set relative to a reference date:
 * today (0DTE), the upcoming weekly Friday, and the upcoming monthly
 * (third Friday) expiration. Duplicate/degenerate entries are skipped.
 */
function buildDefaultExpirations(referenceDate: Date = new Date()): MockExpirationConfig[] {
  const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());

  const expirations: MockExpirationConfig[] = [{ date: formatIsoDate(today), daysToExpiry: 0 }];

  const weekly = nextFriday(today);
  const weeklyDays = Math.round((weekly.getTime() - today.getTime()) / MS_PER_DAY);
  if (weeklyDays > 0) {
    expirations.push({ date: formatIsoDate(weekly), daysToExpiry: weeklyDays });
  }

  let monthly = thirdFridayOfMonth(today.getFullYear(), today.getMonth());
  if (monthly.getTime() <= today.getTime()) {
    monthly = thirdFridayOfMonth(today.getFullYear(), today.getMonth() + 1);
  }
  const monthlyDays = Math.round((monthly.getTime() - today.getTime()) / MS_PER_DAY);
  if (monthlyDays > weeklyDays) {
    expirations.push({ date: formatIsoDate(monthly), daysToExpiry: monthlyDays });
  }

  return expirations;
}

function timeToExpiryYears(daysToExpiry: number): number {
  if (daysToExpiry <= 0) {
    return ZERO_DTE_HOURS_REMAINING / (24 * CALENDAR_DAYS_PER_YEAR);
  }
  return daysToExpiry / CALENDAR_DAYS_PER_YEAR;
}

/** Standard normal probability density function */
function standardNormalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Black-Scholes gamma. Identical for calls and puts at a given strike, so
 * the sign convention (call GEX positive / put GEX negative) is applied
 * later in the GEX engine, not here.
 */
function blackScholesGamma(
  spot: number,
  strike: number,
  timeToExpiryYears: number,
  iv: number,
  riskFreeRate: number,
  dividendYield: number
): number {
  const sqrtT = Math.sqrt(timeToExpiryYears);
  const d1 =
    (Math.log(spot / strike) + (riskFreeRate - dividendYield + 0.5 * iv * iv) * timeToExpiryYears) /
    (iv * sqrtT);

  return (Math.exp(-dividendYield * timeToExpiryYears) * standardNormalPdf(d1)) / (spot * iv * sqrtT);
}

/**
 * Applies a simplified index-option volatility skew: IV rises as strike
 * falls below spot (put side / downside protection demand) and eases as
 * strike rises above spot (call side), plus a small extra lift for deep
 * OTM puts to mimic real "tail hedge" demand. Small multiplicative noise
 * is added so identical strikes don't look artificially uniform.
 */
function computeSkewedIv(
  strike: number,
  spot: number,
  baseIv: number,
  skewSlope: number,
  type: OptionType
): number {
  const moneyness = (strike - spot) / spot; // negative = below spot, positive = above spot

  let iv = baseIv - skewSlope * moneyness;

  if (type === "put" && moneyness < -0.05) {
    iv += Math.abs(moneyness) * 0.15;
  }

  const noise = 1 + (Math.random() - 0.5) * 0.04; // +/- 2% multiplicative noise
  return Math.max(0.03, iv * noise); // floor at 3% IV to avoid degenerate gamma
}

function roundToInterval(value: number, interval: number): number {
  return Math.round(value / interval) * interval;
}

/**
 * Estimates open interest for a mock strike/type/expiration combination.
 * Models the well-known real-world effects that shape an actual SPX/SPY
 * GEX profile:
 *   - OI decays with distance from spot
 *   - puts concentrate below spot (downside hedging demand) while calls
 *     concentrate above spot (upside speculation / covered-call writing) -
 *     this asymmetry is what produces a realistic zero-gamma crossing
 *     near/above spot, rather than a uniformly one-sided profile
 *   - OI clusters at round-number strikes and near-dated expirations
 */
function estimateOpenInterest(strike: number, spot: number, type: OptionType, daysToExpiry: number): number {
  const distanceRatio = Math.abs(strike - spot) / spot;
  const baseOi = 5000 * Math.exp(-Math.pow(distanceRatio * 12, 2));

  const isBelowSpot = strike < spot;
  // Symmetric magnitude (+/- 0.4 around 1.0) on both sides so the profile
  // doesn't end up net-negative or net-positive overall by construction -
  // only the per-strike distribution shapes where the zero crossing falls.
  const sideMultiplier =
    type === "put" ? (isBelowSpot ? 1.4 : 0.9) : isBelowSpot ? 0.9 : 1.4;

  const roundBonus = strike % 100 === 0 ? 1.6 : strike % 50 === 0 ? 1.3 : strike % 25 === 0 ? 1.15 : 1;
  const dteMultiplier = daysToExpiry <= 1 ? 1.4 : daysToExpiry <= 7 ? 1.1 : 0.8;
  const noise = 0.85 + Math.random() * 0.3; // +/- 15% random noise

  return Math.max(0, Math.round(baseOi * sideMultiplier * roundBonus * dteMultiplier * noise));
}

/** Volume is modeled as a random fraction of open interest, as is typical intraday */
function estimateVolume(openInterest: number): number {
  return Math.round(openInterest * (0.1 + Math.random() * 0.4));
}

/**
 * Generates a realistic mock SPX/SPY option chain around a given spot
 * price, suitable for local development, demos, and testing without a
 * live market data subscription. Gamma is computed via Black-Scholes
 * using a skewed IV surface, and open interest / volume follow the
 * distance-from-spot, put-skew, and round-strike patterns seen in real
 * index option chains.
 *
 * @param spotPrice Spot price to center the chain around
 * @param ticker    Underlying symbol - determines default strike interval
 * @param overrides Optional overrides for strike count/interval, IV, skew, expirations
 */
export function generateMockOptionChain(
  spotPrice: number,
  ticker: UnderlyingSymbol = "SPX",
  overrides: Partial<MockChainOptions> = {}
): OptionContract[] {
  const opts: MockChainOptions = { ...defaultMockOptions(ticker), ...overrides };
  const expirations = opts.expirations ?? buildDefaultExpirations();
  const contracts: OptionContract[] = [];

  for (const exp of expirations) {
    const t = timeToExpiryYears(exp.daysToExpiry);

    for (let i = -opts.strikeCount; i <= opts.strikeCount; i++) {
      const strike = roundToInterval(spotPrice + i * opts.strikeInterval, opts.strikeInterval);
      if (strike <= 0) continue;

      for (const type of OPTION_TYPES) {
        const iv = computeSkewedIv(strike, spotPrice, opts.baseIv, opts.skewSlope, type);
        const gamma = blackScholesGamma(spotPrice, strike, t, iv, RISK_FREE_RATE, DIVIDEND_YIELD);
        const openInterest = estimateOpenInterest(strike, spotPrice, type, exp.daysToExpiry);
        const volume = estimateVolume(openInterest);

        contracts.push({ strike, type, expiration: exp.date, gamma, openInterest, volume, iv });
      }
    }
  }

  return contracts;
}

// =============================================================================
// SECTION 2: Polygon.io Live Data Fetcher
// =============================================================================

const POLYGON_BASE_URL = "https://api.polygon.io";
/** Safety cap on snapshot pagination so a misbehaving API can never hang the request indefinitely */
const MAX_SNAPSHOT_PAGES = 10;
const POLYGON_PAGE_LIMIT = 250;

interface PolygonOptionContract {
  day?: { volume?: number };
  details?: {
    contract_type?: "call" | "put";
    expiration_date?: string;
    strike_price?: number;
  };
  greeks?: { gamma?: number };
  implied_volatility?: number;
  open_interest?: number;
  underlying_asset?: { price?: number };
}

interface PolygonSnapshotResponse {
  results?: PolygonOptionContract[];
  next_url?: string;
  status?: string;
}

/** Maps the Polygon underlying ticker format for the two symbols this app supports */
function toPolygonUnderlyingTicker(ticker: UnderlyingSymbol): string {
  return ticker === "SPX" ? "I:SPX" : "SPY";
}

/**
 * Maps a raw Polygon snapshot contract into our internal OptionContract
 * shape. Returns null (rather than guessing/zeroing) for entries missing
 * fields essential to a correct GEX calculation, so malformed API entries
 * are dropped instead of silently corrupting the analysis.
 */
function mapPolygonContract(raw: PolygonOptionContract): OptionContract | null {
  const type = raw.details?.contract_type;
  const strike = raw.details?.strike_price;
  const expiration = raw.details?.expiration_date;
  const gamma = raw.greeks?.gamma;

  if (type !== "call" && type !== "put") return null;
  if (typeof strike !== "number" || typeof expiration !== "string") return null;
  if (typeof gamma !== "number") return null;

  return {
    strike,
    type,
    expiration,
    gamma,
    openInterest: raw.open_interest ?? 0,
    volume: raw.day?.volume ?? 0,
    iv: raw.implied_volatility ?? 0,
  };
}

/**
 * Fetches a full options snapshot for a given underlying from Polygon.io,
 * following pagination (`next_url`) until either the results are
 * exhausted or the safety page cap is reached. Requires greeks to be
 * present in the snapshot response (Polygon's `greeks=true` snapshot
 * parameter / plan tier) since gamma is essential to this app.
 *
 * Throws on any HTTP failure or if the response is missing data essential
 * to GEX analysis (spot price or usable contracts) - callers are expected
 * to catch and fall back to mock data (see getOptionChain below).
 */
async function fetchPolygonOptionChain(
  ticker: UnderlyingSymbol,
  apiKey: string,
  expirationDate?: string
): Promise<{ contracts: OptionContract[]; spotPrice: number }> {
  const polygonUnderlying = toPolygonUnderlyingTicker(ticker);

  const params = new URLSearchParams({ apiKey, limit: String(POLYGON_PAGE_LIMIT), greeks: "true" });
  if (expirationDate) params.set("expiration_date", expirationDate);

  let url: string | null = `${POLYGON_BASE_URL}/v3/snapshot/options/${polygonUnderlying}?${params.toString()}`;

  const contracts: OptionContract[] = [];
  let spotPrice: number | null = null;
  let pageCount = 0;

  while (url && pageCount < MAX_SNAPSHOT_PAGES) {
    const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });

    if (!response.ok) {
      throw new Error(`Polygon API request failed with status ${response.status} (${response.statusText})`);
    }

    const payload = (await response.json()) as PolygonSnapshotResponse;

    for (const raw of payload.results ?? []) {
      const mapped = mapPolygonContract(raw);
      if (mapped) contracts.push(mapped);
      if (spotPrice === null && typeof raw.underlying_asset?.price === "number") {
        spotPrice = raw.underlying_asset.price;
      }
    }

    // Polygon's next_url is a fully-qualified URL but does not preserve the
    // API key, so it must be re-appended on every subsequent page request.
    url = payload.next_url ? `${payload.next_url}&apiKey=${apiKey}` : null;
    pageCount += 1;
  }

  if (spotPrice === null) {
    throw new Error("Polygon response did not include an underlying spot price");
  }
  if (contracts.length === 0) {
    throw new Error("Polygon response contained no usable option contracts");
  }

  return { contracts, spotPrice };
}

// =============================================================================
// SECTION 3: Public Orchestrator
// =============================================================================

function buildMockResult(ticker: UnderlyingSymbol, options: OptionChainRequestOptions): OptionChainResult {
  const spotPrice = options.mockSpotPriceOverride ?? (ticker === "SPY" ? 500 : 5000);
  const contracts = generateMockOptionChain(spotPrice, ticker);

  const filtered = options.expirationDate
    ? contracts.filter((c) => c.expiration === options.expirationDate)
    : contracts;

  return { contracts: filtered, spotPrice, source: "mock" };
}

/**
 * Fetches an options chain for the given underlying, preferring live data
 * from Polygon.io and transparently degrading to the mock generator when:
 *   - no POLYGON_API_KEY environment variable is configured, or
 *   - the live fetch fails for any reason (network error, bad response,
 *     malformed payload, etc.)
 *
 * This function never throws for data-availability reasons; callers only
 * need to handle truly unexpected errors (e.g., programmer error).
 */
export async function getOptionChain(
  ticker: UnderlyingSymbol,
  options: OptionChainRequestOptions = {}
): Promise<OptionChainResult> {
  const apiKey = process.env.POLYGON_API_KEY;

  if (!apiKey) {
    // No credentials configured - serve mock data so the app remains usable
    // in local development / demos without a paid market data subscription.
    return buildMockResult(ticker, options);
  }

  try {
    const { contracts, spotPrice } = await fetchPolygonOptionChain(ticker, apiKey, options.expirationDate);
    return { contracts, spotPrice, source: "live" };
  } catch (error) {
    // Robust fallback: never let a live-data outage break the endpoint.
    // Log for observability, then degrade gracefully to mock data.
    console.error("[dataService] Polygon fetch failed, falling back to mock data:", error);
    return buildMockResult(ticker, options);
  }
}
