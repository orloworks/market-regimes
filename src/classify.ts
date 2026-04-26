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

import type { BenchmarkData, BenchmarkDataWithDates, RegimeResult, RegimeType, Severity } from "./types";
import { REGIME_TYPES, CONFIRMATION_RULES } from "./types";
import { detectAllRegimesRaw, severityFromPercentile, PERCENTILE_HISTORY_DAYS } from "./detectors";
import { percentileRank } from "./helpers";

export function shouldTransition(
  regimeType: RegimeType,
  currentSeverity: Severity,
  proposedSeverity: Severity,
  consecutiveDays: number
): boolean {
  if (currentSeverity === proposedSeverity) return false;
  const rules = CONFIRMATION_RULES[regimeType];
  if (proposedSeverity === "off") {
    return consecutiveDays >= rules.deactivateDays;
  }
  if (currentSeverity === "off") {
    return consecutiveDays >= rules.activateDays;
  }
  // Within-active severity change: immediate
  return true;
}

/**
 * Build a truncated BenchmarkData slice ending at `sliceEnd`.
 */
function buildSlice(input: BenchmarkDataWithDates, sliceEnd: number): BenchmarkData {
  return {
    spy: {
      prices: input.spy.prices.slice(0, sliceEnd),
      opens: input.spy.opens?.slice(0, sliceEnd) ?? [],
      returns: input.spy.returns.slice(0, sliceEnd),
    },
    qqq: {
      prices: input.qqq.prices.slice(0, sliceEnd),
      opens: input.qqq.opens?.slice(0, sliceEnd) ?? [],
      returns: input.qqq.returns.slice(0, sliceEnd),
    },
    tlt: {
      prices: input.tlt.prices.slice(0, sliceEnd),
      opens: input.tlt.opens?.slice(0, sliceEnd) ?? [],
      returns: input.tlt.returns.slice(0, sliceEnd),
    },
    vt: {
      prices: input.vt.prices.slice(0, sliceEnd),
      returns: input.vt.returns.slice(0, sliceEnd),
    },
    tip: {
      prices: input.tip.prices.slice(0, sliceEnd),
      returns: input.tip.returns.slice(0, sliceEnd),
    },
    gld: {
      prices: input.gld.prices.slice(0, sliceEnd),
      returns: input.gld.returns.slice(0, sliceEnd),
    },
    dbc: {
      prices: input.dbc.prices.slice(0, sliceEnd),
      returns: input.dbc.returns.slice(0, sliceEnd),
    },
    ...(input.m2 ? {
      m2: {
        values: input.m2.values.slice(0, sliceEnd),
        yoyGrowth: input.m2.yoyGrowth.slice(0, sliceEnd),
      },
    } : {}),
  };
}

/**
 * Process a multi-year date series sequentially through all detectors.
 *
 * Pass 1: Compute raw composite scores for every day.
 * Pass 2: Percentile-rank each day against a trailing window of prior
 *         scores, assign severity, then apply confirmation/hysteresis.
 */
export function classifyRegimeSeries(
  input: BenchmarkDataWithDates
): Array<Record<RegimeType, RegimeResult>> {
  const { dates } = input;

  // ── Pass 1: raw scores for all days ──

  const rawByDay: Array<Record<RegimeType, RegimeResult>> = [];
  for (let i = 0; i < dates.length; i++) {
    const sliceData = buildSlice(input, i + 1);
    rawByDay.push(detectAllRegimesRaw(sliceData));
  }

  // ── Pass 2: percentile-rank + confirmation ──

  const results: Array<Record<RegimeType, RegimeResult>> = [];

  // Per-regime accumulators for confirmation
  const accumulators: Record<
    RegimeType,
    { currentSeverity: Severity; consecutiveDays: number; pendingSeverity: Severity | null }
  > = {} as Record<RegimeType, { currentSeverity: Severity; consecutiveDays: number; pendingSeverity: Severity | null }>;
  for (const rt of REGIME_TYPES) {
    accumulators[rt] = { currentSeverity: "off", consecutiveDays: 0, pendingSeverity: null };
  }

  for (let i = 0; i < dates.length; i++) {
    const dayResults = {} as Record<RegimeType, RegimeResult>;

    for (const rt of REGIME_TYPES) {
      const raw = rawByDay[i]![rt];

      // News-driven with insufficient data: pass through raw
      if (rt === "newsDriven" && raw.score === 0 && !raw.active) {
        dayResults[rt] = raw;
        continue;
      }

      // Build trailing score history (expanding window, capped at PERCENTILE_HISTORY_DAYS)
      const histStart = Math.max(0, i - PERCENTILE_HISTORY_DAYS);
      const history: number[] = [];
      for (let j = histStart; j < i; j++) {
        history.push(rawByDay[j]![rt].score);
      }

      // Percentile-rank current score against prior history
      const pctile = history.length > 10
        ? percentileRank(raw.score, history)
        : raw.score; // insufficient history: use raw score as-is

      // Determine proposed severity from percentile
      let proposedSeverity = severityFromPercentile(pctile);

      // Respect activation gate for all regimes that have one.
      // Gate ensures raw signals are genuinely distinctive before
      // percentile-based severity is applied.
      if (raw.signals._gateActive !== undefined && raw.signals._gateActive !== 1) {
        proposedSeverity = "off";
      }

      // Crisis override: immediate severe on extreme drawdown + correlation spike
      if (rt === "crisis" && raw.signals._crisisOverride === 1) {
        proposedSeverity = "severe";
      }

      // Apply confirmation/hysteresis logic
      const acc = accumulators[rt];

      // Crisis override bypasses confirmation
      if (rt === "crisis" && raw.signals._crisisOverride === 1) {
        acc.currentSeverity = "severe";
        acc.consecutiveDays = 1;
        acc.pendingSeverity = null;
        dayResults[rt] = { active: true, severity: "severe", score: pctile, signals: raw.signals };
        continue;
      }

      if (proposedSeverity !== acc.currentSeverity) {
        if (acc.pendingSeverity === proposedSeverity) {
          acc.consecutiveDays++;
        } else {
          acc.pendingSeverity = proposedSeverity;
          acc.consecutiveDays = 1;
        }

        if (shouldTransition(rt, acc.currentSeverity, proposedSeverity, acc.consecutiveDays)) {
          acc.currentSeverity = proposedSeverity;
          acc.pendingSeverity = null;
          dayResults[rt] = {
            active: acc.currentSeverity !== "off",
            severity: acc.currentSeverity,
            score: pctile,
            signals: raw.signals,
          };
        } else {
          // Hold at current severity until confirmation threshold met
          dayResults[rt] = {
            active: acc.currentSeverity !== "off",
            severity: acc.currentSeverity,
            score: pctile,
            signals: raw.signals,
          };
        }
      } else {
        acc.pendingSeverity = null;
        acc.consecutiveDays = 0;
        dayResults[rt] = {
          active: acc.currentSeverity !== "off",
          severity: acc.currentSeverity,
          score: pctile,
          signals: raw.signals,
        };
      }
    }

    results.push(dayResults);
  }

  return results;
}

export function segmentReturnsByRegime(
  regimeSeries: Array<Record<RegimeType, RegimeResult>>,
  symphonyReturns: number[]
): Record<RegimeType, { onReturns: number[]; offReturns: number[] }> {
  const result = {} as Record<RegimeType, { onReturns: number[]; offReturns: number[] }>;
  for (const rt of REGIME_TYPES) {
    result[rt] = { onReturns: [], offReturns: [] };
  }

  const len = Math.min(regimeSeries.length, symphonyReturns.length);
  for (let i = 0; i < len; i++) {
    for (const rt of REGIME_TYPES) {
      if (regimeSeries[i]![rt].active) {
        result[rt].onReturns.push(symphonyReturns[i]!);
      } else {
        result[rt].offReturns.push(symphonyReturns[i]!);
      }
    }
  }

  return result;
}
