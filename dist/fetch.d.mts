import { B as BenchmarkDataWithDates } from './types-CQUVxWi5.mjs';

/**
 * Fetch benchmark data from Yahoo Finance.
 *
 * Provides a ready-to-use BenchmarkDataWithDates for regime detection
 * by downloading daily adjusted close prices for all 7 required tickers.
 *
 * Usage:
 *   import { fetchBenchmarkData } from "market-regimes/fetch";
 *   const data = await fetchBenchmarkData({ lookbackDays: 504 });
 *   const regimes = detectAllRegimes(data);
 */

interface FetchOptions {
    /** Number of calendar days to look back from today. Default: 756 (~3 years / ~504 trading days). */
    lookbackDays?: number;
    /** Start date override (ISO string, e.g. "2020-01-01"). Takes precedence over lookbackDays. */
    startDate?: string;
    /** End date override (ISO string). Default: today. */
    endDate?: string;
    /** Delay between Yahoo requests in ms. Default: 500. */
    rateLimitMs?: number;
    /** FRED API key for M2 money supply data. If omitted, falls back to FRED CSV endpoint (no auth). */
    fredApiKey?: string;
    /** Set to false to skip M2 fetch entirely. Default: true. */
    fetchM2?: boolean;
}
/**
 * Fetch benchmark data from Yahoo Finance for all 7 required tickers.
 *
 * Downloads daily adjusted close prices, aligns to common trading dates,
 * and computes returns. Tickers with shorter histories (VT, TIP, GLD, DBC)
 * get NaN-filled for dates before their inception.
 *
 * @example
 * ```typescript
 * import { fetchBenchmarkData } from "market-regimes/fetch";
 * import { detectAllRegimes } from "market-regimes";
 *
 * const data = await fetchBenchmarkData({ lookbackDays: 756 });
 * const regimes = detectAllRegimes(data);
 * ```
 */
declare function fetchBenchmarkData(options?: FetchOptions): Promise<BenchmarkDataWithDates>;

export { fetchBenchmarkData };
