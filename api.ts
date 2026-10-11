/**
 * types/api.ts
 *
 * Type contracts specific to the HTTP API layer (Next.js route handlers).
 * These build on the core GEX types but describe how analysis results are
 * shaped once serialized as JSON for API consumers - they are not part of
 * the math engine itself.
 *
 * Layering note: this file only depends on types/gex.ts, never on lib/*.
 * lib/* (e.g., dataService.ts) is free to depend on these types instead.
 */

import type { GexAnalysisResult, UnderlyingSymbol } from "./gex";

/** Expiration scope requested by the client: today only, or all available expirations */
export type ExpiryFilter = "0DTE" | "ALL";

/** Where the underlying option chain data came from for a given response */
export type DataSource = "live" | "mock";

/**
 * Successful response payload for GET /api/gex.
 * Extends the core analysis result with request/response metadata.
 */
export interface GexApiResponse extends GexAnalysisResult {
  /** Underlying symbol that was analyzed */
  ticker: UnderlyingSymbol;
  /** Expiration scope that was applied */
  expiry: ExpiryFilter;
  /** Basis offset (in index points) used to convert strikes to futures levels */
  futuresOffset: number;
  /** Whether the underlying option chain came from a live provider or the mock generator */
  dataSource: DataSource;
  /** ISO 8601 timestamp of when this analysis was generated */
  generatedAt: string;
}

/** Error response payload for GET /api/gex */
export interface GexApiErrorResponse {
  /** Human-readable error message */
  error: string;
}
