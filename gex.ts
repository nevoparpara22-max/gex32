/**
 * types/gex.ts
 *
 * Core type definitions for the GEX (Gamma Exposure) analytics engine.
 * These types model raw options contracts, per-strike GEX aggregates,
 * and the final analysis result consumed by the UI / API layer.
 */

/** Option contract side */
export type OptionType = "call" | "put";

/** Underlying symbol supported by the platform */
export type UnderlyingSymbol = "SPX" | "SPY";

/**
 * Configuration for converting an index/ETF price level into the
 * equivalent futures (e.g., ES) price level.
 */
export interface FuturesConversionConfig {
  /** Underlying symbol being converted from */
  underlying: UnderlyingSymbol;
  /**
   * Basis offset between the futures contract and the SPX-equivalent
   * level, expressed in index points. Positive when futures trade at a
   * premium to the index (typical, due to cost-of-carry / dividends),
   * negative when at a discount. This is not static - it should be
   * refreshed intraday (e.g., basisOffset = ES last price - SPX last
   * price) by the caller and passed in here.
   */
  basisOffset: number;
}

/**
 * A single options contract for a given strike / expiration / type.
 * This is the raw unit of data ingested from the options chain provider
 * (e.g., CBOE, ORATS, Polygon, ThetaData) before any GEX aggregation.
 */
export interface OptionContract {
  /** Strike price of the contract (in underlying's native units, e.g. SPX index points) */
  strike: number;
  /** Contract type: "call" or "put" */
  type: OptionType;
  /** Expiration date, ISO 8601 format (YYYY-MM-DD) */
  expiration: string;
  /** Option gamma, per share, as provided/computed at current spot price */
  gamma: number;
  /** Open interest: number of outstanding contracts */
  openInterest: number;
  /** Trading volume for the current session */
  volume: number;
  /** Implied volatility, expressed as a decimal (e.g., 0.15 = 15%) */
  iv: number;
}

/**
 * Aggregated dollar GEX values for a single strike, combining every call
 * and put contract present at that strike (across all included expirations).
 */
export interface StrikeGexSummary {
  /** Strike price */
  strike: number;
  /** Total dollar gamma exposure contributed by calls at this strike (>= 0 by convention) */
  callGex: number;
  /** Total dollar gamma exposure contributed by puts at this strike (<= 0 by convention) */
  putGex: number;
  /** Net GEX at this strike: callGex + putGex */
  netGex: number;
  /** This strike converted to the equivalent futures price level (e.g., ES) */
  convertedFuturesPrice: number;
}

/**
 * Market regime classification derived from the relationship between spot
 * price, the zero gamma ("flip") level, and total net GEX.
 */
export type MarketRegime =
  | "LONG GAMMA - Low Volatility / Mean Reversion"
  | "SHORT GAMMA - High Volatility / Momentum";

/**
 * Full output of a GEX analysis run for a given underlying, spot price,
 * and set of option contracts.
 */
export interface GexAnalysisResult {
  /** Current spot price of the underlying (e.g., SPX index value) */
  spotPrice: number;
  /**
   * Zero Gamma / Gamma Flip level: the price at which cumulative net GEX
   * transitions from negative to positive (or vice versa). Null if no
   * sign change is found across the available strikes.
   */
  zeroGamma: number | null;
  /** Strike with the highest positive net GEX - acts as key resistance / pin */
  callWall: number | null;
  /** Strike with the highest negative net GEX - acts as key support */
  putWall: number | null;
  /** Sum of net GEX across all strikes */
  netTotalGex: number;
  /** Classified market regime for the current session */
  regime: MarketRegime;
  /** Per-strike GEX breakdown, sorted ascending by strike */
  strikes: StrikeGexSummary[];
}
