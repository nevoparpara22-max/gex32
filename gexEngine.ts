/**
 * lib/gexEngine.ts
 *
 * Mathematical core of the GEX (Gamma Exposure) analytics engine.
 * Pure functions only - no I/O, no framework dependencies - so this
 * module can be unit tested in isolation and reused on both server
 * (API routes / cron jobs) and client (if ever needed) sides.
 */

import type {
  OptionContract,
  StrikeGexSummary,
  GexAnalysisResult,
  MarketRegime,
  UnderlyingSymbol,
  FuturesConversionConfig,
} from "../types/gex";

// Re-exported so existing consumers of this module can keep importing
// UnderlyingSymbol / FuturesConversionConfig from "lib/gexEngine" as well
// as from "types/gex" - the canonical definitions live in types/gex.ts.
export type { UnderlyingSymbol, FuturesConversionConfig } from "../types/gex";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Standard equity/index option contract multiplier (1 contract = 100 shares) */
const CONTRACT_MULTIPLIER = 100;

/**
 * Scaling factor applied in the dollar-GEX formula. Converts gamma
 * (change in delta per 1-point move) into an exposure figure expressed
 * per 1% move in the underlying, which is the convention most GEX
 * dashboards (GEXBot, SpotGamma, etc.) use for cross-strike comparison.
 */
const DOLLAR_GEX_SCALE = 0.01;

/** SPY trades at approximately 1/10th the level of SPX */
const SPY_TO_SPX_MULTIPLIER = 10;

// ---------------------------------------------------------------------------
// Futures conversion
// ---------------------------------------------------------------------------

/**
 * Converts an SPX index level or SPY share price into the equivalent
 * ES futures price level.
 *
 * @param level  Price level to convert (SPX index points, or SPY share price)
 * @param config Conversion settings: underlying symbol + current basis offset
 * @returns Equivalent ES futures price level
 */
export function convertToFuturesLevel(
  level: number,
  config: FuturesConversionConfig
): number {
  const spxEquivalentLevel =
    config.underlying === "SPY" ? level * SPY_TO_SPX_MULTIPLIER : level;

  return spxEquivalentLevel + config.basisOffset;
}

// ---------------------------------------------------------------------------
// Per-contract / per-strike dollar GEX calculation
// ---------------------------------------------------------------------------

/**
 * Calculates the dollar GEX contribution of a single option contract.
 *
 *   Call GEX =  Gamma * OpenInterest * 100 * SpotPrice * 0.01
 *   Put GEX  =  Gamma * OpenInterest * 100 * SpotPrice * 0.01 * (-1)
 *
 * Puts are negated by convention: dealers are assumed to be long calls /
 * short puts against customer flow, so put gamma exposure pushes dealer
 * hedging in the opposite direction of call gamma exposure.
 *
 * @param contract  The option contract
 * @param spotPrice Current spot price of the underlying
 * @returns Signed dollar GEX for this single contract
 */
export function calculateContractGex(
  contract: OptionContract,
  spotPrice: number
): number {
  const magnitude =
    contract.gamma *
    contract.openInterest *
    CONTRACT_MULTIPLIER *
    spotPrice *
    DOLLAR_GEX_SCALE;

  return contract.type === "put" ? magnitude * -1 : magnitude;
}

/**
 * Aggregates a flat list of option contracts into per-strike GEX
 * summaries. Contracts sharing the same strike (across any included
 * expirations) are combined into a single StrikeGexSummary entry.
 *
 * @param contracts     Raw option contracts (any mix of expirations/types)
 * @param spotPrice     Current spot price of the underlying
 * @param futuresConfig Conversion settings used to populate convertedFuturesPrice
 * @returns Per-strike GEX summaries, sorted ascending by strike
 */
export function aggregateStrikeGex(
  contracts: OptionContract[],
  spotPrice: number,
  futuresConfig: FuturesConversionConfig
): StrikeGexSummary[] {
  const byStrike = new Map<number, { callGex: number; putGex: number }>();

  for (const contract of contracts) {
    const entry = byStrike.get(contract.strike) ?? { callGex: 0, putGex: 0 };
    const contractGex = calculateContractGex(contract, spotPrice);

    if (contract.type === "call") {
      entry.callGex += contractGex;
    } else {
      entry.putGex += contractGex;
    }

    byStrike.set(contract.strike, entry);
  }

  const summaries: StrikeGexSummary[] = Array.from(byStrike.entries()).map(
    ([strike, { callGex, putGex }]) => ({
      strike,
      callGex,
      putGex,
      netGex: callGex + putGex,
      convertedFuturesPrice: convertToFuturesLevel(strike, futuresConfig),
    })
  );

  return summaries.sort((a, b) => a.strike - b.strike);
}

// ---------------------------------------------------------------------------
// Zero Gamma (Gamma Flip) detection
// ---------------------------------------------------------------------------

/**
 * Locates the Zero Gamma / Gamma Flip level: the price at which
 * cumulative net GEX (summed strike-by-strike, from lowest to highest
 * strike) transitions from negative to positive or vice versa.
 *
 * Implementation note: this walks the strike ladder and linearly
 * interpolates between the two strikes that bracket the sign change.
 * This is a first-order approximation that treats each contract's
 * supplied `gamma` as valid at (or very near) the current spot price.
 * A more precise implementation would recompute Black-Scholes gamma
 * across a grid of hypothetical spot prices and re-sum the full GEX
 * profile at each point - a good candidate for a later optimization
 * step once a pricing/vol-surface module is available.
 *
 * @param strikes Per-strike GEX summaries (any order; will be sorted internally)
 * @returns Interpolated zero gamma price level, or null if no sign change is found
 */
export function findZeroGamma(strikes: StrikeGexSummary[]): number | null {
  if (strikes.length === 0) return null;

  const sorted = [...strikes].sort((a, b) => a.strike - b.strike);

  let cumulative = 0;
  let prevCumulative = 0;
  let prevStrike = sorted[0].strike;

  for (const s of sorted) {
    prevCumulative = cumulative;
    cumulative += s.netGex;

    const signChanged =
      prevCumulative !== 0 && Math.sign(prevCumulative) !== Math.sign(cumulative);

    if (signChanged) {
      // Linear interpolation between prevStrike and s.strike, weighted
      // by how close each side's cumulative value is to zero.
      const totalSpan = Math.abs(prevCumulative) + Math.abs(cumulative);
      const ratio = totalSpan === 0 ? 0 : Math.abs(prevCumulative) / totalSpan;
      return prevStrike + ratio * (s.strike - prevStrike);
    }

    prevStrike = s.strike;
  }

  // No sign change across the available strike range: all strikes share
  // the same net GEX sign, so no flip level exists within this range.
  return null;
}

// ---------------------------------------------------------------------------
// Call Wall / Put Wall detection
// ---------------------------------------------------------------------------

/**
 * Identifies the Call Wall: the strike with the highest positive net GEX.
 * This level tends to act as resistance / a magnet for price (dealers
 * hedge by selling into rallies as spot approaches this strike).
 */
export function findCallWall(strikes: StrikeGexSummary[]): number | null {
  if (strikes.length === 0) return null;

  const top = strikes.reduce((max, s) => (s.netGex > max.netGex ? s : max), strikes[0]);
  return top.netGex > 0 ? top.strike : null;
}

/**
 * Identifies the Put Wall: the strike with the highest negative (most
 * negative) net GEX. This level tends to act as support (dealers hedge
 * by buying into selloffs as spot approaches this strike).
 */
export function findPutWall(strikes: StrikeGexSummary[]): number | null {
  if (strikes.length === 0) return null;

  const bottom = strikes.reduce((min, s) => (s.netGex < min.netGex ? s : min), strikes[0]);
  return bottom.netGex < 0 ? bottom.strike : null;
}

/**
 * Finds the strike in `strikes` closest to a given continuous price level.
 * Useful for UI components that need to visually anchor a continuous value
 * (e.g., spot price, or the interpolated zero gamma level - which will
 * rarely land exactly on a listed strike) to a discrete strike row or bar.
 *
 * @param strikes Per-strike GEX summaries
 * @param target  Continuous price level to match against
 * @returns The nearest strike price, or null if `strikes` is empty
 */
export function findNearestStrike(strikes: StrikeGexSummary[], target: number): number | null {
  if (strikes.length === 0) return null;

  return strikes.reduce((closest, s) =>
    Math.abs(s.strike - target) < Math.abs(closest.strike - target) ? s : closest
  , strikes[0]).strike;
}

// ---------------------------------------------------------------------------
// Market Regime classification
// ---------------------------------------------------------------------------

/**
 * Classifies the current market regime.
 *
 * Primary method: compare spot price to the zero gamma (flip) level.
 * Above the flip, dealers are net long gamma and hedge counter-trend
 * (buy dips / sell rips), which dampens realized volatility and favors
 * mean reversion. Below the flip, dealers are net short gamma and hedge
 * with-trend (sell into weakness / buy into strength), which amplifies
 * realized volatility and favors momentum / trend continuation.
 *
 * Fallback method: if no zero gamma crossing exists within the observed
 * strike range (e.g., extremely one-sided positioning), fall back to
 * the sign of total net GEX as a secondary indicator.
 *
 * @param spotPrice   Current spot price of the underlying
 * @param zeroGamma   Zero gamma level from findZeroGamma(), or null
 * @param netTotalGex Sum of net GEX across all strikes
 */
export function determineMarketRegime(
  spotPrice: number,
  zeroGamma: number | null,
  netTotalGex: number
): MarketRegime {
  if (zeroGamma !== null) {
    return spotPrice >= zeroGamma
      ? "LONG GAMMA - Low Volatility / Mean Reversion"
      : "SHORT GAMMA - High Volatility / Momentum";
  }

  return netTotalGex >= 0
    ? "LONG GAMMA - Low Volatility / Mean Reversion"
    : "SHORT GAMMA - High Volatility / Momentum";
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Runs the full GEX analysis pipeline: aggregates raw contracts into
 * per-strike GEX, locates the zero gamma level, call wall, and put wall,
 * and classifies the market regime.
 *
 * @param contracts     Raw option contracts for the underlying (any mix of expirations)
 * @param spotPrice     Current spot price of the underlying
 * @param futuresConfig Conversion settings for translating strikes to futures levels
 * @returns Complete GEX analysis result ready for the UI / API layer
 */
export function analyzeGex(
  contracts: OptionContract[],
  spotPrice: number,
  futuresConfig: FuturesConversionConfig
): GexAnalysisResult {
  const strikes = aggregateStrikeGex(contracts, spotPrice, futuresConfig);
  const netTotalGex = strikes.reduce((sum, s) => sum + s.netGex, 0);
  const zeroGamma = findZeroGamma(strikes);
  const callWall = findCallWall(strikes);
  const putWall = findPutWall(strikes);
  const regime = determineMarketRegime(spotPrice, zeroGamma, netTotalGex);

  return {
    spotPrice,
    zeroGamma,
    callWall,
    putWall,
    netTotalGex,
    regime,
    strikes,
  };
}
