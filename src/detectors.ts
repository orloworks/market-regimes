/**
 * Regime detectors — pure functions, zero framework dependencies.
 *
 * Each detector takes BenchmarkData and returns RegimeResult.
 * All 5 active detectors implemented (crisis, choppy, volatile, inflationary, QE).
 * News-Driven is a deferred stub (pending FinGPT integration).
 */

import { std, rollingCorrelation, rollingVolatility, comp } from "nanuquant";
import type { BenchmarkData, RegimeResult, RegimeType, Severity } from "./types";
import { REGIME_TYPES } from "./types";
import {
  clamp,
  dailyReturns,
  SMA,
  countCrossovers,
  percentileRank,
  averageStreakLength,
  variance,
} from "./helpers";

// ─── Detector: Crisis ───────────────────────────────────────────────────

export function detectCrisis(data: BenchmarkData): RegimeResult {
  const OFF: RegimeResult = { active: false, severity: "off", score: 0, signals: {} };

  const spyPrices = data.spy.prices;
  const vtPrices = data.vt?.prices ?? [];
  const spyReturns = data.spy.returns;
  const tltReturns = data.tlt.returns;

  if (spyPrices.length < 10 || spyReturns.length < 10) return OFF;

  // 1. SPY drawdown depth from trailing 252-day high
  const lookback = Math.min(spyPrices.length, 252);
  const recentPrices = spyPrices.slice(-lookback);
  const spyHigh252 = Math.max(...recentPrices);
  const spyLast = spyPrices[spyPrices.length - 1]!;
  const spyDrawdown = (spyLast - spyHigh252) / spyHigh252; // negative

  const ddScore = clamp(-spyDrawdown / 0.20, 0, 1);

  // 2. Global confirmation: VT drawdown corroborates SPY
  let globalConfirm = 0;
  const vtLast = vtPrices.length > 0 ? vtPrices[vtPrices.length - 1]! : NaN;
  const vtHasData = vtPrices.length >= 10 && !isNaN(vtLast) && vtLast > 0;
  if (vtHasData) {
    const vtLookback = Math.min(vtPrices.length, 252);
    const recentVt = vtPrices.slice(-vtLookback).filter((p) => !isNaN(p) && p > 0);
    if (recentVt.length >= 10) {
      const vtHigh252 = Math.max(...recentVt);
      const vtDrawdown = (vtLast - vtHigh252) / vtHigh252;
      globalConfirm = clamp(-vtDrawdown / 0.20, 0, 1);
    }
  }

  // 3. Correlation spike: equity-bond correlation going positive = crisis
  let corrCrisis = 0;
  let spyTltCorr21 = 0;
  if (spyReturns.length >= 21 && tltReturns.length >= 21) {
    const minLen = Math.min(spyReturns.length, tltReturns.length);
    const spyR = spyReturns.slice(-minLen);
    const tltR = tltReturns.slice(-minLen);
    const rollCorr = rollingCorrelation(spyR, tltR, 21);
    for (let i = rollCorr.length - 1; i >= 0; i--) {
      if (!isNaN(rollCorr[i]!)) {
        spyTltCorr21 = rollCorr[i]!;
        break;
      }
    }
    corrCrisis = clamp(spyTltCorr21 / 0.50, 0, 1);
  }

  // 4. Tail risk realization: recent extreme negative days
  const recent21 = spyReturns.slice(-21);
  const extremeDays = recent21.filter((r) => r < -0.02).length;
  const tailScore = clamp(extremeDays / 4, 0, 1);

  // Composite: spec weights (Pagan & Sossounov 2003, Ang & Chen 2002, Cont 2001)
  let crisisScore: number;
  if (vtHasData) {
    crisisScore =
      ddScore * 0.35 + globalConfirm * 0.20 + corrCrisis * 0.25 + tailScore * 0.20;
  } else {
    const w = 0.35 + 0.25 + 0.20;
    crisisScore =
      ddScore * (0.35 / w) + corrCrisis * (0.25 / w) + tailScore * (0.20 / w);
  }

  const signals: Record<string, number> = {
    spyDrawdown,
    ddScore,
    globalConfirm,
    spyTltCorr21,
    corrCrisis,
    extremeDays,
    tailScore,
    crisisScore,
  };

  if (Object.values(signals).some((v) => isNaN(v))) {
    return OFF;
  }

  // Override: immediate severe at -15% drawdown + positive corr (Pagan & Sossounov early-warning)
  if (spyDrawdown < -0.15 && spyTltCorr21 > 0.30) {
    return { active: true, severity: "severe", score: crisisScore, signals };
  }

  let severity: Severity = "off";
  if (crisisScore >= 0.75) severity = "severe";
  else if (crisisScore >= 0.50) severity = "moderate";
  else if (crisisScore >= 0.25) severity = "mild";

  return {
    active: severity !== "off",
    severity,
    score: crisisScore,
    signals,
  };
}

// ─── Detector: Volatile ─────────────────────────────────────────────────

export function detectVolatile(data: BenchmarkData): RegimeResult {
  const OFF: RegimeResult = { active: false, severity: "off", score: 0, signals: {} };

  const spyReturns = data.spy.returns;
  if (spyReturns.length < 21) return OFF;

  // 1. Current 21-day realized volatility, annualized
  const recent21 = spyReturns.slice(-21);
  const vol21 = std(recent21, 1) * Math.sqrt(252);

  // 2. Rolling 21-day vol history for percentile ranking
  const volHistory = rollingVolatility(spyReturns, {
    rollingPeriod: 21,
    periodsPerYear: 252,
  });

  // 3. Percentile rank of current vol vs trailing history
  const volPercentile = percentileRank(vol21, volHistory);

  const signals: Record<string, number> = { vol21, volPercentile };

  if (isNaN(vol21) || isNaN(volPercentile)) return OFF;

  // Severity thresholds (Whaley 2009, Giot 2005)
  let severity: Severity = "off";
  if (volPercentile >= 0.90) severity = "severe";
  else if (volPercentile >= 0.75) severity = "moderate";
  else if (volPercentile >= 0.60) severity = "mild";

  return {
    active: severity !== "off",
    severity,
    score: volPercentile,
    signals,
  };
}

// ─── Detector: Choppy ───────────────────────────────────────────────────

export function detectChoppy(data: BenchmarkData): RegimeResult {
  const OFF: RegimeResult = { active: false, severity: "off", score: 0, signals: {} };

  const spyPrices = data.spy.prices;
  const spyReturns = data.spy.returns;

  if (spyPrices.length < 63 || spyReturns.length < 63) return OFF;

  // 1. SMA flatness (Lo & MacKinlay 1988)
  const sma50 = SMA(spyPrices, 50);
  const sma50Recent = sma50.slice(-21).filter((v) => !isNaN(v));
  let smaFlatness = 0;
  if (sma50Recent.length >= 2) {
    const sma50Returns = dailyReturns(sma50Recent);
    const smaSlope = sma50Returns.reduce((a, b) => a + b, 0) / sma50Returns.length;
    smaFlatness = 1 - Math.min(Math.abs(smaSlope) / 0.002, 1);
  }

  // 2. Price-SMA oscillation: crossover count in last 42 trading days (Elder 1993)
  const crossCount = countCrossovers(spyPrices, sma50, 42);
  const crossScore = Math.min(crossCount / 8, 1);

  // 3. Variance ratio test (Lo & MacKinlay 1988)
  let meanRevScore = 0;
  let vrMin = 1;
  if (spyReturns.length >= 63) {
    const recent63 = spyReturns.slice(-63);
    const var1 = variance(recent63);
    if (var1 > 0) {
      for (const q of [2, 5, 10]) {
        const qReturns: number[] = [];
        for (let i = q - 1; i < recent63.length; i++) {
          let cum = 0;
          for (let j = i - q + 1; j <= i; j++) cum += recent63[j]!;
          qReturns.push(cum);
        }
        const vr = variance(qReturns) / (q * var1);
        if (vr < vrMin) vrMin = vr;
      }
      meanRevScore = clamp((1 - vrMin) / 0.50, 0, 1);
    }
  }

  // 4. Win streak analysis: short streaks = choppy (Lo 1991)
  const recent63Returns = spyReturns.slice(-63);
  const avgStreak = averageStreakLength(recent63Returns);
  const streakScore = 1 - Math.min((avgStreak - 1) / 3, 1);

  // Composite — Lo & MacKinlay primary, Elder secondary
  const chopScore =
    smaFlatness * 0.15 + crossScore * 0.15 + meanRevScore * 0.35 + streakScore * 0.35;

  const signals: Record<string, number> = {
    smaFlatness,
    crossCount,
    crossScore,
    vrMin,
    meanRevScore,
    avgStreak,
    streakScore,
    chopScore,
  };

  if (Object.values(signals).some((v) => isNaN(v))) return OFF;

  let severity: Severity = "off";
  if (chopScore >= 0.75) severity = "severe";
  else if (chopScore >= 0.55) severity = "moderate";
  else if (chopScore >= 0.35) severity = "mild";

  return {
    active: severity !== "off",
    severity,
    score: chopScore,
    signals,
  };
}

// ─── Detector: Inflationary ─────────────────────────────────────────────

export function detectInflationary(data: BenchmarkData): RegimeResult {
  const OFF: RegimeResult = { active: false, severity: "off", score: 0, signals: {} };

  const tipPrices = data.tip?.prices ?? [];
  const tltPrices = data.tlt.prices;
  const gldPrices = data.gld?.prices ?? [];
  const dbcPrices = data.dbc?.prices ?? [];

  if (tipPrices.length < 64 || tltPrices.length < 64 || gldPrices.length < 64 || dbcPrices.length < 64) return OFF;

  const tipLast = tipPrices[tipPrices.length - 1]!;
  const tltLast = tltPrices[tltPrices.length - 1]!;
  const gldLast = gldPrices[gldPrices.length - 1]!;
  const dbcLast = dbcPrices[dbcPrices.length - 1]!;
  if (!tipLast || !tltLast || !gldLast || !dbcLast) return OFF;
  if (isNaN(tipLast) || isNaN(tltLast) || isNaN(gldLast) || isNaN(dbcLast)) return OFF;

  // 1. TIP/TLT ratio trend: TIPS outperforming nominal bonds
  const tipTltLast = tipLast / tltLast;
  const idx63 = tipPrices.length - 64;
  const tipTlt63Ago = tipPrices[idx63]! / tltPrices[idx63]!;
  if (!tipTlt63Ago || isNaN(tipTlt63Ago) || tipTlt63Ago === 0) return OFF;
  const tipTltRatio63 = tipTltLast / tipTlt63Ago - 1;
  const tipTltScore = clamp(tipTltRatio63 / 0.05, 0, 1);

  // 2. Commodity momentum (Gorton & Rouwenhorst 2006)
  const dbcReturns = dailyReturns(dbcPrices);
  const dbcRecent63 = dbcReturns.slice(-63);
  const dbcReturn63 = comp(dbcRecent63);
  const dbcScore = clamp(dbcReturn63 / 0.10, 0, 1);

  // 3. Gold momentum
  const gldReturns = dailyReturns(gldPrices);
  const gldRecent63 = gldReturns.slice(-63);
  const gldReturn63 = comp(gldRecent63);
  const gldScore = clamp(gldReturn63 / 0.10, 0, 1);

  // 4. Nominal bond weakness: TLT declining = rates rising
  const tltReturns = dailyReturns(tltPrices);
  const tltRecent63 = tltReturns.slice(-63);
  const tltReturn63 = comp(tltRecent63);
  const tltWeakScore = clamp(-tltReturn63 / 0.08, 0, 1);

  // Composite (Gorton & Rouwenhorst 2006 weighting)
  const inflationScore =
    tipTltScore * 0.35 + dbcScore * 0.25 + gldScore * 0.20 + tltWeakScore * 0.20;

  const signals: Record<string, number> = {
    tipTltRatio63,
    tipTltScore,
    dbcReturn63,
    dbcScore,
    gldReturn63,
    gldScore,
    tltReturn63,
    tltWeakScore,
    inflationScore,
  };

  if (Object.values(signals).some((v) => isNaN(v))) return OFF;

  let severity: Severity = "off";
  if (inflationScore >= 0.75) severity = "severe";
  else if (inflationScore >= 0.55) severity = "moderate";
  else if (inflationScore >= 0.30) severity = "mild";

  return {
    active: severity !== "off",
    severity,
    score: inflationScore,
    signals,
  };
}

// ─── Detector: QE / Risk-On ─────────────────────────────────────────────

export function detectQE(data: BenchmarkData): RegimeResult {
  const OFF: RegimeResult = { active: false, severity: "off", score: 0, signals: {} };

  const spyReturns = data.spy.returns;
  const tltReturns = data.tlt.returns;
  const spyPrices = data.spy.prices;

  if (spyReturns.length < 63 || tltReturns.length < 63 || spyPrices.length < 50) return OFF;

  // 1. Equity momentum: sustained broad equity uptrend
  const spyReturn63 = comp(spyReturns.slice(-63));
  const equityMomentum = clamp(spyReturn63 / 0.10, 0, 1);

  // 2. Bond stability or strength: rates not rising aggressively
  const tltReturn63 = comp(tltReturns.slice(-63));
  const bondStrength = clamp((tltReturn63 + 0.05) / 0.10, 0, 1);

  // 3. Equity-bond decorrelation: negative correlation = normal, healthy QE-like
  let spyTltCorr21 = 0;
  const minLen = Math.min(spyReturns.length, tltReturns.length);
  if (minLen >= 21) {
    const spyR = spyReturns.slice(-minLen);
    const tltR = tltReturns.slice(-minLen);
    const rollCorr = rollingCorrelation(spyR, tltR, 21);
    for (let i = rollCorr.length - 1; i >= 0; i--) {
      if (!isNaN(rollCorr[i]!)) {
        spyTltCorr21 = rollCorr[i]!;
        break;
      }
    }
  }
  const decorrelation = clamp(-spyTltCorr21, 0, 1);

  // 4. Low volatility with uptrend: the "melt-up" signature (Ang & Timmermann 2012, Ilmanen 2003)
  const vol21 = std(spyReturns.slice(-21), 1) * Math.sqrt(252);
  const sma50 = SMA(spyPrices, 50);
  const lastSma50 = sma50[sma50.length - 1]!;
  const spyAboveSma = !isNaN(lastSma50) && spyPrices[spyPrices.length - 1]! > lastSma50;
  const meltUpScore = spyAboveSma ? clamp((0.12 - vol21) / 0.07, 0, 1) : 0;

  // 5. M2 money supply growth: direct measure of monetary expansion (FRED M2SL)
  //    Normalized so 15%+ YoY growth = max score. Stays elevated during QE even when bonds sell off.
  const m2 = data.m2;
  const hasM2 = m2 && m2.yoyGrowth.length > 0;
  const m2YoY = hasM2 ? m2.yoyGrowth[m2.yoyGrowth.length - 1]! : NaN;
  const m2GrowthScore = hasM2 && !isNaN(m2YoY) ? clamp(m2YoY / 0.15, 0, 1) : NaN;

  // Composite: with M2 data, bondStrength is demoted (M2 directly measures policy stance)
  let qeScore: number;
  if (!isNaN(m2GrowthScore)) {
    // Full model: M2 replaces bond prices as primary policy signal
    qeScore =
      equityMomentum * 0.25 + bondStrength * 0.15 + decorrelation * 0.20 + meltUpScore * 0.15 + m2GrowthScore * 0.25;
  } else {
    // Fallback: original weighting when M2 data unavailable (Ilmanen 2003)
    qeScore =
      equityMomentum * 0.30 + bondStrength * 0.25 + decorrelation * 0.25 + meltUpScore * 0.20;
  }

  const signals: Record<string, number> = {
    spyReturn63,
    equityMomentum,
    tltReturn63,
    bondStrength,
    spyTltCorr21,
    decorrelation,
    vol21,
    meltUpScore,
    m2YoY: isNaN(m2YoY) ? 0 : m2YoY,
    m2GrowthScore: isNaN(m2GrowthScore) ? 0 : m2GrowthScore,
    qeScore,
  };

  if (isNaN(qeScore)) return OFF;

  let severity: Severity = "off";
  if (qeScore >= 0.80) severity = "severe";
  else if (qeScore >= 0.60) severity = "moderate";
  else if (qeScore >= 0.40) severity = "mild";

  return {
    active: severity !== "off",
    severity,
    score: qeScore,
    signals,
  };
}

// ─── Detector: News-Driven (stub) ──────────────────────────────────────

export function detectNewsDriven(_data: BenchmarkData): RegimeResult {
  return { active: false, severity: "off", score: 0, signals: {} };
}

// ─── Aggregate ──────────────────────────────────────────────────────────

const DETECTORS: Record<RegimeType, (data: BenchmarkData) => RegimeResult> = {
  volatile: detectVolatile,
  choppy: detectChoppy,
  inflationary: detectInflationary,
  qe: detectQE,
  crisis: detectCrisis,
  newsDriven: detectNewsDriven,
};

export function detectAllRegimes(
  data: BenchmarkData
): Record<RegimeType, RegimeResult> {
  const results = {} as Record<RegimeType, RegimeResult>;
  for (const rt of REGIME_TYPES) {
    results[rt] = DETECTORS[rt](data);
  }
  return results;
}
