/**
 * app/api/gex/route.ts
 *
 * GET /api/gex?ticker=SPX&expiry=ALL&futuresOffset=15.25
 *
 * Query parameters:
 *   - ticker        "SPX" | "SPY"   (default: "SPX")
 *   - expiry        "0DTE" | "ALL"  (default: "ALL")
 *   - futuresOffset number, e.g. 15.25 or -3.5 (default: 0)
 *
 * Fetches the raw option chain (live via Polygon.io, or mock as a
 * fallback - see lib/services/dataService.ts), runs it through the GEX
 * engine (lib/gexEngine.ts), and returns the fully processed analysis
 * as JSON, typed per types/api.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { analyzeGex } from "../../../lib/gexEngine";
import { getOptionChain } from "../../../lib/services/dataService";
import type { UnderlyingSymbol, FuturesConversionConfig } from "../../../types/gex";
import type { ExpiryFilter, GexApiResponse, GexApiErrorResponse } from "../../../types/api";

// This endpoint serves real-time-ish financial data - never let Next.js
// serve a cached/static response for it.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const VALID_TICKERS: readonly UnderlyingSymbol[] = ["SPX", "SPY"];
const VALID_EXPIRIES: readonly ExpiryFilter[] = ["0DTE", "ALL"];

/** Thrown for malformed/invalid request input; mapped to an HTTP 400 response below. */
class RequestValidationError extends Error {}

interface ParsedGexQuery {
  ticker: UnderlyingSymbol;
  expiry: ExpiryFilter;
  futuresOffset: number;
}

/**
 * Parses and validates the incoming query string, throwing
 * RequestValidationError for any malformed input so the handler can
 * return a clean 400 response instead of crashing or misbehaving.
 */
function parseQuery(searchParams: URLSearchParams): ParsedGexQuery {
  const tickerRaw = (searchParams.get("ticker") ?? "SPX").toUpperCase();
  const expiryRaw = (searchParams.get("expiry") ?? "ALL").toUpperCase();
  const futuresOffsetRaw = searchParams.get("futuresOffset");

  if (!VALID_TICKERS.includes(tickerRaw as UnderlyingSymbol)) {
    throw new RequestValidationError(
      `Invalid "ticker" parameter: "${tickerRaw}". Expected one of: ${VALID_TICKERS.join(", ")}.`
    );
  }

  if (!VALID_EXPIRIES.includes(expiryRaw as ExpiryFilter)) {
    throw new RequestValidationError(
      `Invalid "expiry" parameter: "${expiryRaw}". Expected one of: ${VALID_EXPIRIES.join(", ")}.`
    );
  }

  let futuresOffset = 0;
  if (futuresOffsetRaw !== null && futuresOffsetRaw.trim() !== "") {
    const parsed = Number(futuresOffsetRaw);
    if (!Number.isFinite(parsed)) {
      throw new RequestValidationError(
        `Invalid "futuresOffset" parameter: "${futuresOffsetRaw}". Expected a finite number (e.g. 15.25).`
      );
    }
    futuresOffset = parsed;
  }

  return { ticker: tickerRaw as UnderlyingSymbol, expiry: expiryRaw as ExpiryFilter, futuresOffset };
}

/** Today's date (server local time), formatted YYYY-MM-DD, used to scope 0DTE requests. */
function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function GET(
  request: NextRequest
): Promise<NextResponse<GexApiResponse | GexApiErrorResponse>> {
  try {
    const { ticker, expiry, futuresOffset } = parseQuery(request.nextUrl.searchParams);

    const expirationDate = expiry === "0DTE" ? todayIsoDate() : undefined;

    const { contracts, spotPrice, source } = await getOptionChain(ticker, { expirationDate });

    // Defensive second filter: guarantees a 0DTE request never leaks
    // contracts from other expirations, regardless of how the underlying
    // data source behaved (live providers don't always honor filters exactly).
    const scopedContracts = expirationDate
      ? contracts.filter((c) => c.expiration === expirationDate)
      : contracts;

    if (scopedContracts.length === 0) {
      return NextResponse.json<GexApiErrorResponse>(
        { error: `No option contracts available for ${ticker} (${expiry}).` },
        { status: 404 }
      );
    }

    const futuresConfig: FuturesConversionConfig = { underlying: ticker, basisOffset: futuresOffset };
    const analysis = analyzeGex(scopedContracts, spotPrice, futuresConfig);

    const payload: GexApiResponse = {
      ...analysis,
      ticker,
      expiry,
      futuresOffset,
      dataSource: source,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json<GexApiErrorResponse>({ error: error.message }, { status: 400 });
    }

    // Unexpected/programmer errors: log full detail server-side, but never
    // leak internals to the client.
    console.error("[api/gex] Unexpected error while building GEX analysis:", error);
    return NextResponse.json<GexApiErrorResponse>(
      { error: "Internal server error while computing GEX analysis." },
      { status: 500 }
    );
  }
}
