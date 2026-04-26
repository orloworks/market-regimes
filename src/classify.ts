/**
 * Time-series classification with confirmation logic.
 *
 * classifyRegimeSeries processes a multi-year date series sequentially,
 * applying shouldTransition confirmation rules to smooth regime activations.
 */

import type { BenchmarkData, BenchmarkDataWithDates, RegimeResult, RegimeType, Severity } from "./types";
import { REGIME_TYPES, CONFIRMATION_RULES } from "./types";
import { detectAllRegimesRaw } from "./detectors";

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
 * Process a multi-year date series sequentially through all detectors.
 * Returns per-day regime classifications with confirmation logic applied.
 */
export function classifyRegimeSeries(
  input: BenchmarkDataWithDates
): Array<Record<RegimeType, RegimeResult>> {
  const { dates } = input;
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
    // Build a BenchmarkData slice up to day i (inclusive)
    const sliceEnd = i + 1;
    const sliceData: BenchmarkData = {
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

    const dayResults = detectAllRegimesRaw(sliceData);

    // Apply confirmation logic per regime
    for (const rt of REGIME_TYPES) {
      const raw = dayResults[rt];
      const acc = accumulators[rt];

      // Crisis override bypasses confirmation
      if (
        rt === "crisis" &&
        raw.severity === "severe" &&
        raw.signals["spyDrawdown"] !== undefined &&
        raw.signals["spyDrawdown"]! < -0.15 &&
        raw.signals["spyTltCorr21"] !== undefined &&
        raw.signals["spyTltCorr21"]! > 0.30
      ) {
        acc.currentSeverity = "severe";
        acc.consecutiveDays = 1;
        acc.pendingSeverity = null;
        dayResults[rt] = raw;
        continue;
      }

      if (raw.severity !== acc.currentSeverity) {
        if (acc.pendingSeverity === raw.severity) {
          acc.consecutiveDays++;
        } else {
          acc.pendingSeverity = raw.severity;
          acc.consecutiveDays = 1;
        }

        if (shouldTransition(rt, acc.currentSeverity, raw.severity, acc.consecutiveDays)) {
          acc.currentSeverity = raw.severity;
          acc.pendingSeverity = null;
          dayResults[rt] = { ...raw, severity: acc.currentSeverity, active: acc.currentSeverity !== "off" };
        } else {
          dayResults[rt] = {
            ...raw,
            severity: acc.currentSeverity,
            active: acc.currentSeverity !== "off",
          };
        }
      } else {
        acc.pendingSeverity = null;
        acc.consecutiveDays = 0;
        dayResults[rt] = { ...raw, severity: acc.currentSeverity, active: acc.currentSeverity !== "off" };
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
