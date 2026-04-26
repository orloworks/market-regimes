import { a as BenchmarkData, R as RegimeType, b as RegimeResult, S as Severity, B as BenchmarkDataWithDates } from './types-CQUVxWi5.js';
export { C as CONFIRMATION_RULES, c as REGIME_DETECTOR_VERSION, d as REGIME_TYPES } from './types-CQUVxWi5.js';

/**
 * Regime detectors — pure functions, zero framework dependencies.
 *
 * Each detector takes BenchmarkData and returns RegimeResult.
 * All 7 detectors implemented (crisis, volatile, trendDrawdown, choppy,
 * inflationary, QE, newsDriven stub).
 *
 * Severity is percentile-based: each detector's raw composite score is
 * ranked against a trailing 504-day (2-year) history of that same score.
 * Uniform thresholds:
 *   - mild     ≥ 60th percentile
 *   - moderate ≥ 75th percentile
 *   - severe   ≥ 90th percentile
 *
 * This ensures severity is empirically grounded ("how unusual is today's
 * reading vs recent history?") rather than relying on arbitrary score cutoffs.
 */

/** Number of trailing trading days used to build the percentile distribution */
declare const PERCENTILE_HISTORY_DAYS = 504;
declare function severityFromPercentile(pctile: number): Severity;
declare function detectCrisis(data: BenchmarkData): RegimeResult;
declare function detectVolatile(data: BenchmarkData): RegimeResult;
declare function detectTrendDrawdown(data: BenchmarkData): RegimeResult;
declare function detectChoppy(data: BenchmarkData): RegimeResult;
declare function detectInflationary(data: BenchmarkData): RegimeResult;
declare function detectQE(data: BenchmarkData): RegimeResult;
declare function detectNewsDriven(_data: BenchmarkData): RegimeResult;
/**
 * Run all detectors and return raw composite scores (no percentile ranking).
 * Used by classifyRegimeSeries which applies its own per-series percentile.
 */
declare function detectAllRegimesRaw(data: BenchmarkData): Record<RegimeType, RegimeResult>;
/**
 * Run all 7 regime detectors with percentile-based severity.
 *
 * For each detector:
 * 1. Compute raw composite score for today
 * 2. Compute raw composite scores for each of the trailing 504 trading days
 * 3. Percentile-rank today's score against that 2-year distribution
 * 4. Apply uniform severity: mild ≥ 60th, moderate ≥ 75th, severe ≥ 90th
 *
 * The `score` field in the result is the percentile rank (0–1).
 * The raw composite score is preserved in `signals.rawScore`.
 *
 * Special cases:
 * - Trend drawdown has an activation gate (death cross + 5% drawdown).
 *   Percentile only determines severity when the gate is active.
 * - Crisis has an override: -15% drawdown + positive SPY-TLT correlation
 *   immediately triggers "severe" regardless of percentile.
 * - News-Driven is a stub (always off).
 */
declare function detectAllRegimes(data: BenchmarkData): Record<RegimeType, RegimeResult>;

/**
 * Time-series classification with percentile-based severity and confirmation logic.
 *
 * Two-pass approach:
 *   Pass 1: Compute raw composite scores for every day in the series.
 *   Pass 2: Percentile-rank each day's score against a trailing window of
 *           prior scores (expanding up to 504 days), assign severity using
 *           uniform thresholds, then apply hysteresis confirmation rules.
 *
 * This ensures the historical regime bands use the same percentile-based
 * severity as the current-day snapshot (detectAllRegimes).
 */

declare function shouldTransition(regimeType: RegimeType, currentSeverity: Severity, proposedSeverity: Severity, consecutiveDays: number): boolean;
/**
 * Process a multi-year date series sequentially through all detectors.
 *
 * Pass 1: Compute raw composite scores for every day.
 * Pass 2: Percentile-rank each day against a trailing window of prior
 *         scores, assign severity, then apply confirmation/hysteresis.
 */
declare function classifyRegimeSeries(input: BenchmarkDataWithDates): Array<Record<RegimeType, RegimeResult>>;
declare function segmentReturnsByRegime(regimeSeries: Array<Record<RegimeType, RegimeResult>>, symphonyReturns: number[]): Record<RegimeType, {
    onReturns: number[];
    offReturns: number[];
}>;

declare function clamp(value: number, min: number, max: number): number;
declare function dailyReturns(prices: number[]): number[];
declare function SMA(prices: number[], period: number): number[];
declare function countCrossovers(prices: number[], sma: number[], window: number): number;
declare function percentileRank(value: number, distribution: number[]): number;
declare function averageStreakLength(returns: number[]): number;
declare function variance(arr: number[]): number;
declare function excessKurtosis(returns: number[]): number;
declare function rollingKurtosis(returns: number[], window: number): number[];

export { BenchmarkData, BenchmarkDataWithDates, PERCENTILE_HISTORY_DAYS, RegimeResult, RegimeType, SMA, Severity, averageStreakLength, clamp, classifyRegimeSeries, countCrossovers, dailyReturns, detectAllRegimes, detectAllRegimesRaw, detectChoppy, detectCrisis, detectInflationary, detectNewsDriven, detectQE, detectTrendDrawdown, detectVolatile, excessKurtosis, percentileRank, rollingKurtosis, segmentReturnsByRegime, severityFromPercentile, shouldTransition, variance };
