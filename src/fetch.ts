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

import type { BenchmarkDataWithDates } from "./types";

const TICKERS = ["SPY", "QQQ", "TLT", "VT", "TIP", "GLD", "DBC"] as const;

interface YahooChartResult {
  timestamp: number[];
  indicators: {
    quote: Array<{ open: number[]; close: number[] }>;
    adjclose?: Array<{ adjclose: number[] }>;
  };
}

interface YahooResponse {
  chart: {
    result: YahooChartResult[];
    error: unknown;
  };
}

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

interface TickerSeries {
  dates: string[];
  prices: number[];
  opens: number[];
  returns: number[];
}

// ─── FRED M2 Money Supply ──────────────────────────────────────────────

interface FredObservation {
  date: string;
  value: string;
}

interface FredResponse {
  observations: FredObservation[];
}

interface M2Series {
  /** Monthly M2 values, carried forward to each trading date */
  values: number[];
  /** Year-over-year growth rate at each trading date */
  yoyGrowth: number[];
}

async function fetchFredM2(startDate: string, endDate: string, apiKey?: string): Promise<Map<string, number>> {
  const lookbackStart = new Date(startDate);
  lookbackStart.setMonth(lookbackStart.getMonth() - 14);
  const fredStart = lookbackStart.toISOString().slice(0, 10);

  if (apiKey) {
    // Authenticated FRED API
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=M2SL&observation_start=${fredStart}&observation_end=${endDate}&api_key=${apiKey}&file_type=json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`FRED API returned ${response.status}`);

    const data = (await response.json()) as FredResponse;
    const monthly = new Map<string, number>();
    for (const obs of data.observations) {
      if (obs.value !== ".") monthly.set(obs.date, parseFloat(obs.value));
    }
    return monthly;
  }

  // Fallback: FRED CSV endpoint (no API key required)
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=M2SL&cosd=${fredStart}&coed=${endDate}`;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`FRED CSV returned ${response.status}`);

  const csv = await response.text();
  const monthly = new Map<string, number>();
  for (const line of csv.trim().split("\n").slice(1)) {
    const [date, value] = line.split(",");
    if (date && value && value !== ".") monthly.set(date, parseFloat(value));
  }
  return monthly;
}

function buildM2DailySeries(monthlyM2: Map<string, number>, tradingDates: string[]): M2Series {
  // Sort monthly dates for carry-forward
  const monthlyDates = [...monthlyM2.keys()].sort();
  if (monthlyDates.length < 13) {
    return {
      values: Array(tradingDates.length).fill(NaN),
      yoyGrowth: Array(tradingDates.length).fill(NaN),
    };
  }

  const values: number[] = [];
  const yoyGrowth: number[] = [];

  for (const date of tradingDates) {
    // Find most recent M2 observation on or before this date
    let currentM2 = NaN;
    let priorYearM2 = NaN;

    for (let i = monthlyDates.length - 1; i >= 0; i--) {
      if (monthlyDates[i]! <= date) {
        currentM2 = monthlyM2.get(monthlyDates[i]!)!;
        // Find the observation ~12 months prior
        const targetMonth = new Date(monthlyDates[i]!);
        targetMonth.setMonth(targetMonth.getMonth() - 12);
        const targetStr = targetMonth.toISOString().slice(0, 10);
        // Find closest month to 12 months ago
        for (let j = i; j >= 0; j--) {
          if (monthlyDates[j]! <= targetStr) {
            priorYearM2 = monthlyM2.get(monthlyDates[j]!)!;
            break;
          }
        }
        break;
      }
    }

    values.push(currentM2);
    if (!isNaN(currentM2) && !isNaN(priorYearM2) && priorYearM2 > 0) {
      yoyGrowth.push((currentM2 - priorYearM2) / priorYearM2);
    } else {
      yoyGrowth.push(NaN);
    }
  }

  return { values, yoyGrowth };
}

async function fetchTicker(ticker: string, period1: number, period2: number): Promise<TickerSeries> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${period1}&period2=${period2}&interval=1d&includeAdjustedClose=true`;

  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (market-regimes)" },
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance returned ${response.status} for ${ticker}`);
  }

  const data = (await response.json()) as YahooResponse;

  if (data.chart.error) {
    throw new Error(`Yahoo Finance error for ${ticker}: ${JSON.stringify(data.chart.error)}`);
  }

  const result = data.chart.result[0]!;
  const timestamps = result.timestamp;
  const quote = result.indicators.quote[0]!;
  const adjClose = result.indicators.adjclose?.[0]?.adjclose ?? quote.close;

  const dates: string[] = [];
  const prices: number[] = [];
  const opens: number[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const price = adjClose[i]!;
    const open = quote.open[i];
    if (price == null || isNaN(price)) continue;

    const d = new Date(timestamps[i]! * 1000);
    dates.push(d.toISOString().slice(0, 10));
    prices.push(price);
    opens.push(open ?? price);
  }

  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i]! - prices[i - 1]!) / prices[i - 1]!);
  }

  return { dates, prices, opens, returns };
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
export async function fetchBenchmarkData(options: FetchOptions = {}): Promise<BenchmarkDataWithDates> {
  const {
    lookbackDays = 756,
    rateLimitMs = 500,
    fredApiKey,
    fetchM2: shouldFetchM2 = true,
  } = options;

  const endDate = options.endDate ?? new Date().toISOString().slice(0, 10);
  const startDate = options.startDate ??
    new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const period1 = Math.floor(new Date(startDate).getTime() / 1000);
  const period2 = Math.floor(new Date(endDate).getTime() / 1000);

  // Fetch all tickers
  const tickerData: Record<string, TickerSeries> = {};
  for (const ticker of TICKERS) {
    try {
      tickerData[ticker] = await fetchTicker(ticker, period1, period2);
    } catch {
      // Tickers with shorter histories may fail for early start dates
      tickerData[ticker] = { dates: [], prices: [], opens: [], returns: [] };
    }
    if (rateLimitMs > 0) {
      await new Promise((r) => setTimeout(r, rateLimitMs));
    }
  }

  // Align to common dates (SPY ∩ TLT as anchor — both required)
  const spyDates = new Set(tickerData["SPY"]!.dates);
  const tltDates = new Set(tickerData["TLT"]!.dates);
  const commonDates = [...spyDates].filter((d) => tltDates.has(d)).sort();

  if (commonDates.length === 0) {
    throw new Error("No common trading dates between SPY and TLT — check date range or network");
  }

  // Build aligned series per ticker
  const buildSeries = (ticker: string): { prices: number[]; opens: number[]; returns: number[] } => {
    const td = tickerData[ticker]!;
    if (td.dates.length === 0) {
      return {
        prices: Array(commonDates.length).fill(NaN) as number[],
        opens: Array(commonDates.length).fill(NaN) as number[],
        returns: Array(commonDates.length).fill(NaN) as number[],
      };
    }

    const dateIdx = new Map(td.dates.map((d, i) => [d, i]));
    const prices: number[] = [];
    const opens: number[] = [];
    let lastPrice = NaN;
    let lastOpen = NaN;

    for (const d of commonDates) {
      const idx = dateIdx.get(d);
      if (idx !== undefined) {
        lastPrice = td.prices[idx]!;
        lastOpen = td.opens[idx]!;
      }
      prices.push(lastPrice);
      opens.push(lastOpen);
    }

    // Recompute returns from aligned prices
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      if (isNaN(prices[i]!) || isNaN(prices[i - 1]!)) {
        returns.push(NaN);
      } else {
        returns.push((prices[i]! - prices[i - 1]!) / prices[i - 1]!);
      }
    }

    return { prices, opens, returns };
  };

  // Fetch M2 money supply from FRED (uses CSV fallback if no API key)
  let m2: { values: number[]; yoyGrowth: number[] } | undefined;
  if (shouldFetchM2) {
    try {
      const monthlyM2 = await fetchFredM2(startDate, endDate, fredApiKey);
      m2 = buildM2DailySeries(monthlyM2, commonDates);
    } catch {
      // FRED unavailable — QE detector falls back to bond-only weighting
      m2 = undefined;
    }
  }

  return {
    dates: commonDates,
    spy: buildSeries("SPY"),
    qqq: buildSeries("QQQ"),
    tlt: buildSeries("TLT"),
    vt: buildSeries("VT"),
    tip: buildSeries("TIP"),
    gld: buildSeries("GLD"),
    dbc: buildSeries("DBC"),
    ...(m2 ? { m2 } : {}),
  };
}
