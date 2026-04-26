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

import { std, rollingCorrelation, rollingVolatility, comp } from "nanuquant-ts";
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
  excessKurtosis,
} from "./helpers";

// ─── Percentile-based severity ─────────────────────────────────────────

/** Number of trailing trading days used to build the percentile distribution */
export const PERCENTILE_HISTORY_DAYS = 504;

/** Uniform severity thresholds applied to all detectors */
const SEVERITY_PCTILE = { mild: 0.60, moderate: 0.75, severe: 0.90 } as const;

export function severityFromPercentile(pctile: number): Severity {
  if (pctile >= SEVERITY_PCTILE.severe) return "severe";
  if (pctile >= SEVERITY_PCTILE.moderate) return "moderate";
  if (pctile >= SEVERITY_PCTILE.mild) return "mild";
  return "off";
}

/**
 * Truncate BenchmarkData to end at `length - daysBack`, simulating
 * "what the data looked like daysBack trading days ago."
 */
function truncateData(data: BenchmarkData, daysBack: number): BenchmarkData {
  if (daysBack <= 0) return data;
  const s = <T>(arr: T[]): T[] => arr.slice(0, -daysBack);
  return {
    spy: { prices: s(data.spy.prices), opens: s(data.spy.opens), returns: s(data.spy.returns) },
    qqq: { prices: s(data.qqq.prices), opens: s(data.qqq.opens), returns: s(data.qqq.returns) },
    tlt: { prices: s(data.tlt.prices), opens: s(data.tlt.opens), returns: s(data.tlt.returns) },
    vt: { prices: s(data.vt.prices), returns: s(data.vt.returns) },
    tip: { prices: s(data.tip.prices), returns: s(data.tip.returns) },
    gld: { prices: s(data.gld.prices), returns: s(data.gld.returns) },
    dbc: { prices: s(data.dbc.prices), returns: s(data.dbc.returns) },
    ...(data.m2 ? { m2: data.m2 } : {}), // M2 is monthly; don't truncate daily
  };
}

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

  // Raw score returned; severity assigned by percentile in detectAllRegimes.
  // Keep special override flag in signals for classifyRegimeSeries crisis fast-path.
  if (spyDrawdown < -0.15 && spyTltCorr21 > 0.30) {
    signals._crisisOverride = 1;
  }
  // Bug 10: very deep drawdown (>30% from peak) is always severe crisis
  if (spyDrawdown < -0.30) {
    signals._crisisOverride = 1;
  }

  // Bug 5: fast velocity path — catches early COVID-style crashes where drawdown
  // hasn't yet hit -15% but selling intensity is extreme (>5% drop in 5 days).
  const recentPrices5d = spyPrices.slice(-6);
  const velocity5d =
    recentPrices5d.length >= 6
      ? (recentPrices5d[recentPrices5d.length - 1]! - recentPrices5d[0]!) /
        recentPrices5d[0]!
      : 0;
  const hasVelocity = velocity5d < -0.05;
  signals.velocity5d = velocity5d;

  // Activation gate: crisis = acute panic requiring deep drawdown AND
  // concentrated selling pressure (3+ extreme days in 21d). A sustained
  // -20% bear market is trendDrawdown — crisis is the acute selloff episodes.
  // Velocity path allows early detection before full -15% threshold is reached.
  const hasDrawdown = spyDrawdown < -0.15;
  const hasConcentratedSelling = tailScore >= 0.75; // 3+ extreme days in 21d
  const gateActive = (hasDrawdown && hasConcentratedSelling) || (hasVelocity && hasConcentratedSelling);
  signals._gateActive = gateActive ? 1 : 0;

  return {
    active: gateActive,
    severity: "off", // placeholder — percentile assigns real severity
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

  // Activation gate: vol must be genuinely elevated (≥20% annualized).
  // Long-term SPY vol averages ~15%, so 20% is meaningfully above normal.
  const gateActive = vol21 >= 0.20;
  signals._gateActive = gateActive ? 1 : 0;

  return {
    active: gateActive,
    severity: "off",
    score: volPercentile,
    signals,
  };
}

// ─── Detector: Trend Drawdown ───────────────────────────────────────────

export function detectTrendDrawdown(data: BenchmarkData): RegimeResult {
  const OFF: RegimeResult = { active: false, severity: "off", score: 0, signals: {} };

  const spyPrices = data.spy.prices;
  if (spyPrices.length < 50) return OFF;

  // 1. Death cross: 50-day SMA below 200-day SMA (Brock, Lakonishok & LeBaron 1992)
  // SMA200 may not be available for early data — treat as neutral if missing.
  const sma50 = SMA(spyPrices, 50);
  const sma200 = spyPrices.length >= 200 ? SMA(spyPrices, 200) : [];
  const lastSma50 = sma50[sma50.length - 1]!;
  const lastSma200 = sma200.length > 0 ? sma200[sma200.length - 1]! : NaN;

  if (isNaN(lastSma50)) return OFF;

  const hasSma200 = !isNaN(lastSma200) && lastSma200 > 0;
  const maCrossover = hasSma200 ? lastSma50 / lastSma200 : 1;
  const crossScore = hasSma200 ? clamp((1 - maCrossover) / 0.05, 0, 1) : 0;

  // 2. Drawdown from trailing 252-day high (Pagan & Sossounov 2003)
  const lookback = Math.min(spyPrices.length, 252);
  const recentPrices = spyPrices.slice(-lookback);
  const peak252 = Math.max(...recentPrices);
  const current = spyPrices[spyPrices.length - 1]!;
  const drawdownDepth = peak252 > 0 ? Math.max(0, (peak252 - current) / peak252) : 0;
  const ddScore = clamp(drawdownDepth / 0.20, 0, 1);

  // 3. Drawdown duration: days since the 252-day high
  let peakIndex = 0;
  for (let i = 0; i < recentPrices.length; i++) {
    if (recentPrices[i]! >= peak252) peakIndex = i;
  }
  const drawdownDuration = recentPrices.length - 1 - peakIndex;
  const durationScore = clamp(drawdownDuration / 63, 0, 1);

  // 4. Price below both SMAs: trend confirmation (Faber 2007)
  // If SMA200 not available, just check SMA50.
  const belowBoth = current < lastSma50 && (!hasSma200 || current < lastSma200) ? 1 : 0;

  // Reweight: drawdown depth is primary, SMA cross is confirming (not gating).
  // Death cross lags weeks behind fast selloffs (COVID, Liberation Day).
  const trendScore = crossScore * 0.20 + ddScore * 0.40 + durationScore * 0.15 + belowBoth * 0.25;

  const signals: Record<string, number> = {
    maCrossover,
    crossScore,
    drawdownDepth,
    ddScore,
    drawdownDuration,
    durationScore,
    belowBoth,
    trendScore,
  };

  if (Object.values(signals).some((v) => isNaN(v))) return OFF;

  // Activation gate: drawdown from peak is the primary gate (≥10%).
  // Death cross is a weight component but NOT required — it lags too much
  // for fast crashes (COVID dropped 34% before 50 SMA crossed 200 SMA).
  const gateActive = drawdownDepth >= 0.10;
  signals._gateActive = gateActive ? 1 : 0;

  return {
    active: gateActive,
    severity: "off",
    score: trendScore,
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

  // Bug 3: current realized vol — suppress gate if market is genuinely volatile
  // (>30% annualized). Choppy ≠ volatile; choppy is directionless low-amplitude noise.
  const spyVol21 = std(spyReturns.slice(-21), 1) * Math.sqrt(252);

  // Bug 8: net 63-day return — suppress gate during directional markets. A market
  // that moved >8% in one direction over 3 months is trending, not choppy.
  const netReturn63 = comp(recent63Returns);

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
    spyVol21,
    netReturn63,
    chopScore,
  };

  if (Object.values(signals).some((v) => isNaN(v))) return OFF;

  // Activation gate: require mean-reversion signal (variance ratio below 1)
  // AND price-SMA oscillation, EXCLUDING genuine volatile markets (vol >30%)
  // and directional markets (>8% net move in 63 days).
  const isVolatile = spyVol21 >= 0.30;
  const isDirectional = Math.abs(netReturn63) > 0.08;
  const gateActive = vrMin < 0.85 && crossCount >= 2 && !isVolatile && !isDirectional;
  signals._gateActive = gateActive ? 1 : 0;

  return {
    active: gateActive,
    severity: "off",
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
  // Bug 9: guard against zeros in DBC data pre-2006 (ETF launched Feb 2006).
  // If any of the last 64 DBC prices are zero or NaN, skip DBC signal.
  const dbcReturns = dailyReturns(dbcPrices);
  const dbcHasValidData = dbcPrices.slice(-64).every((p) => p > 0 && !isNaN(p));
  const dbcReturn63 = dbcHasValidData ? comp(dbcReturns.slice(-63)) : NaN;
  const dbcScore = dbcHasValidData && !isNaN(dbcReturn63) ? clamp(dbcReturn63 / 0.10, 0, 1) : 0;

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
    dbcReturn63: isNaN(dbcReturn63) ? 0 : dbcReturn63,
    dbcScore,
    gldReturn63,
    gldScore,
    tltReturn63,
    tltWeakScore,
    inflationScore,
  };

  if (Object.values(signals).some((v) => isNaN(v))) return OFF;

  // Activation gate: breakeven inflation (TIP/TLT) must be clearly rising —
  // this is required. At least ONE of {bonds weakening, commodity confirmation}
  // must also be present. Requiring all three was too strict and missed 2021 H2.
  //
  // Bug 6: commodity confirmation requires BOTH DBC AND GLD (changed from OR).
  //   In 2009, oil recovery pushed DBC without GLD — that was commodity rebound,
  //   not inflation. Requiring both prevents single-commodity false positives.
  //
  // Bug 1: changed to 2-of-3 gate (breakevens always required, plus at least
  //   one of bondsWeak or realAssetConfirmation) to catch 2021 H2 where bonds
  //   were weakening gradually (tltReturn63 < -0.01) but not sharply (-0.02).
  const breakevensRising = tipTltRatio63 > 0.02;
  const bondsWeak = tltReturn63 < -0.02;
  const dbcStrong = dbcHasValidData && !isNaN(dbcReturn63) && dbcReturn63 > 0.03;
  const gldStrong = gldReturn63 > 0.04;
  const realAssetConfirmation = dbcStrong && gldStrong; // Bug 6: AND not OR
  const gateActive = breakevensRising && (bondsWeak || realAssetConfirmation);
  signals._gateActive = gateActive ? 1 : 0;

  return {
    active: gateActive,
    severity: "off",
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
  const m2 = data.m2;
  const hasM2 = m2 && m2.yoyGrowth.length > 0;
  const m2YoY = hasM2 ? m2.yoyGrowth[m2.yoyGrowth.length - 1]! : NaN;
  const m2GrowthScore = hasM2 && !isNaN(m2YoY) ? clamp(m2YoY / 0.15, 0, 1) : NaN;

  // Composite
  let qeScore: number;
  if (!isNaN(m2GrowthScore)) {
    qeScore =
      equityMomentum * 0.25 + bondStrength * 0.15 + decorrelation * 0.20 + meltUpScore * 0.15 + m2GrowthScore * 0.25;
  } else {
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

  // Activation gate: equity momentum must be present AND price above trend
  // AND either low vol (melt-up) or negative equity-bond correlation.
  // QE/risk-on means genuinely easy financial conditions.
  //
  // Bug 2: lowered momentum threshold from 5% to 3% — early QE periods (2009
  // Q4, 2010 H1) had equities recovering but hadn't yet clocked 5% in 63 days.
  // Also added M2 expansion path: if M2 is growing >5% YoY (direct monetary
  // stimulus), that alone satisfies the momentum requirement even without 3% equity
  // return — captures QE1/QE2 windows where prices lagged the money supply signal.
  const hasStrongMomentum = spyReturn63 > 0.03; // was 0.05
  const hasM2Expansion = Boolean(hasM2) && !isNaN(m2YoY) && m2YoY > 0.05;
  const hasEasyConditions = meltUpScore > 0.15 || decorrelation > 0.30;
  const gateActive = (hasStrongMomentum || hasM2Expansion) && spyAboveSma && hasEasyConditions;
  signals._gateActive = gateActive ? 1 : 0;

  return {
    active: gateActive,
    severity: "off",
    score: qeScore,
    signals,
  };
}

// ─── Detector: News-Driven ────��─────────────────��──────────────────────

/**
 * Detects news-driven regimes via large gap frequency, return outliers,
 * and excess kurtosis.
 *
 * News-driven markets are characterized by:
 * 1. Frequent large overnight gaps (>1.5% — well above median ~0.9%)
 * 2. Return outlier clustering (many days with |return| > 1.5%)
 * 3. Fat-tailed return distribution (excess kurtosis)
 *
 * Note: gap threshold must be high (≥1.5%) because Yahoo Finance's
 * adjusted close vs raw open creates baseline gaps of ~0.5-1% on most days.
 *
 * References: Barclay & Hendershott (2003), French & Roll (1986), Cont (2001)
 */
export function detectNewsDriven(data: BenchmarkData): RegimeResult {
  const OFF: RegimeResult = { active: false, severity: "off", score: 0, signals: {} };

  const spyPrices = data.spy.prices;
  const spyOpens = data.spy.opens;
  const spyReturns = data.spy.returns;
  const qqqPrices = data.qqq.prices;
  const qqqOpens = data.qqq.opens;
  const qqqReturns = data.qqq.returns;

  if (spyPrices.length < 42 || spyOpens.length < 42) return OFF;
  if (spyReturns.length < 42) return OFF;

  // 1. Large gap frequency: overnight gaps in last 21 days.
  // Bug 4: use vol-normalized threshold so "large" is relative to the current
  // volatility regime. In calm markets (daily vol ~0.7%), 1.5% is genuinely large.
  // In stressed markets (daily vol ~2%), 1.5% is unremarkable noise — scale up.
  // Minimum stays at 1.5% to avoid triggering on normal low-vol gaps.
  const dailyVol = spyReturns.length >= 21 ? std(spyReturns.slice(-21), 1) : 0.007;
  const LARGE_GAP = Math.max(0.015, dailyVol * 1.5);
  const lookback = 21;
  const start = spyPrices.length - lookback;
  let spyLargeGaps = 0;
  let qqqLargeGaps = 0;
  let maxGap = 0;

  for (let i = start; i < spyPrices.length; i++) {
    if (i < 1) continue;
    const spyGap = Math.abs(spyOpens[i]! - spyPrices[i - 1]!) / spyPrices[i - 1]!;
    if (!isNaN(spyGap)) {
      if (spyGap > LARGE_GAP) spyLargeGaps++;
      if (spyGap > maxGap) maxGap = spyGap;
    }

    if (qqqPrices.length > i && qqqOpens.length > i) {
      const qqqGap = Math.abs(qqqOpens[i]! - qqqPrices[i - 1]!) / qqqPrices[i - 1]!;
      if (!isNaN(qqqGap)) {
        if (qqqGap > LARGE_GAP) qqqLargeGaps++;
        if (qqqGap > maxGap) maxGap = qqqGap;
      }
    }
  }

  const avgLargeGaps = (spyLargeGaps + qqqLargeGaps) / 2;
  // 6+ large gaps in 21 days = score of 1 (calm markets have 2-4)
  const gapFreqScore = clamp(avgLargeGaps / 6, 0, 1);

  // 2. Return outlier frequency: |daily return| > 1.5% in last 21 days
  const recentSpyReturns = spyReturns.slice(-lookback);
  const recentQqqReturns = qqqReturns.slice(-lookback);
  const spyOutliers = recentSpyReturns.filter(r => Math.abs(r) > 0.015).length;
  const qqqOutliers = recentQqqReturns.filter(r => Math.abs(r) > 0.015).length;
  const avgOutliers = (spyOutliers + qqqOutliers) / 2;
  // 7+ outlier days in 21 = score of 1 (calm markets have 2-3)
  const outlierScore = clamp(avgOutliers / 7, 0, 1);

  // 3. Excess kurtosis: fat tails indicate event-driven returns (Cont 2001)
  const recent42 = spyReturns.slice(-42);
  let kurt = 0;
  if (recent42.length >= 20) {
    try {
      kurt = excessKurtosis(recent42);
    } catch { /* fallback to 0 */ }
  }
  // Normal dist kurtosis = 0 (excess). News-driven markets show kurtosis > 2.
  const kurtScore = clamp(kurt / 5, 0, 1);

  // Composite
  const newsScore = gapFreqScore * 0.35 + outlierScore * 0.40 + kurtScore * 0.25;

  const signals: Record<string, number> = {
    spyLargeGaps,
    qqqLargeGaps,
    avgLargeGaps,
    gapFreqScore,
    maxGap,
    spyOutliers,
    qqqOutliers,
    avgOutliers,
    outlierScore,
    kurtosis: kurt,
    kurtScore,
    newsScore,
  };

  if (Object.values(signals).some((v) => isNaN(v))) return OFF;

  // Activation gate: require BOTH elevated return outliers AND frequent large
  // gaps. Either alone is too common; together they indicate a genuinely
  // news-driven market where overnight information + intraday moves cluster.
  const gateActive = avgOutliers >= 7 && avgLargeGaps >= 5;
  signals._gateActive = gateActive ? 1 : 0;

  return {
    active: gateActive,
    severity: "off",
    score: newsScore,
    signals,
  };
}

// ─── Raw aggregate (no percentile — used by classifyRegimeSeries) ──────

const DETECTORS: Record<RegimeType, (data: BenchmarkData) => RegimeResult> = {
  volatile: detectVolatile,
  trendDrawdown: detectTrendDrawdown,
  choppy: detectChoppy,
  inflationary: detectInflationary,
  qe: detectQE,
  crisis: detectCrisis,
  newsDriven: detectNewsDriven,
};

/**
 * Run all detectors and return raw composite scores (no percentile ranking).
 * Used by classifyRegimeSeries which applies its own per-series percentile.
 */
export function detectAllRegimesRaw(
  data: BenchmarkData
): Record<RegimeType, RegimeResult> {
  const results = {} as Record<RegimeType, RegimeResult>;
  for (const rt of REGIME_TYPES) {
    results[rt] = DETECTORS[rt](data);
  }
  return results;
}

// ─── Percentile-wrapped aggregate (main public API) ────────────────────

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
export function detectAllRegimes(
  data: BenchmarkData
): Record<RegimeType, RegimeResult> {
  // 1. Run raw detection for current day
  const currentResults = detectAllRegimesRaw(data);

  // 2. Build historical score distributions (504 trailing days)
  const maxHistory = Math.min(PERCENTILE_HISTORY_DAYS, data.spy.prices.length - 200);
  const historyByType: Record<RegimeType, number[]> = {} as Record<RegimeType, number[]>;
  for (const rt of REGIME_TYPES) {
    historyByType[rt] = [];
  }

  if (maxHistory > 10) {
    for (let d = 1; d <= maxHistory; d++) {
      const truncated = truncateData(data, d);
      const dayResults = detectAllRegimesRaw(truncated);
      for (const rt of REGIME_TYPES) {
        historyByType[rt].push(dayResults[rt].score);
      }
    }
  }

  // 3. Percentile-rank and assign uniform severity
  const results = {} as Record<RegimeType, RegimeResult>;

  for (const rt of REGIME_TYPES) {
    const raw = currentResults[rt];
    const history = historyByType[rt];

    // News-driven with insufficient data — pass through raw
    if (rt === "newsDriven" && raw.score === 0 && !raw.active) {
      results[rt] = raw;
      continue;
    }

    // Compute percentile of current raw score vs trailing history
    const pctile = history.length > 10
      ? percentileRank(raw.score, history)
      : raw.score; // fallback if insufficient history

    // Determine severity from percentile
    let severity = severityFromPercentile(pctile);
    let active = severity !== "off";

    // Respect activation gate for all regimes that have one.
    if (raw.signals._gateActive !== undefined && raw.signals._gateActive !== 1) {
      active = false;
      severity = "off";
    }

    // Crisis override: immediate severe on extreme drawdown + correlation spike
    if (rt === "crisis" && raw.signals._crisisOverride === 1) {
      active = true;
      severity = "severe";
    }

    results[rt] = {
      active,
      severity,
      score: pctile,
      signals: { ...raw.signals, rawScore: raw.score, percentile: pctile },
    };
  }

  return results;
}
