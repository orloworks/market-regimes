// src/types.ts
var REGIME_TYPES = ["volatile", "trendDrawdown", "choppy", "inflationary", "qe", "crisis", "newsDriven"];
var REGIME_DETECTOR_VERSION = 6;
var CONFIRMATION_RULES = {
  volatile: { activateDays: 2, deactivateDays: 7 },
  trendDrawdown: { activateDays: 3, deactivateDays: 10 },
  choppy: { activateDays: 3, deactivateDays: 5 },
  inflationary: { activateDays: 5, deactivateDays: 10 },
  qe: { activateDays: 7, deactivateDays: 10 },
  crisis: { activateDays: 1, deactivateDays: 3 },
  newsDriven: { activateDays: 3, deactivateDays: 5 }
};

// src/detectors.ts
import { std, rollingCorrelation, rollingVolatility, comp } from "nanuquant-ts";

// src/helpers.ts
import { mean, kurtosis } from "nanuquant-ts";
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
function dailyReturns(prices) {
  const r = [];
  for (let i = 1; i < prices.length; i++) {
    r.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  return r;
}
function SMA(prices, period) {
  const result = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += prices[j];
      result.push(sum / period);
    }
  }
  return result;
}
function countCrossovers(prices, sma, window) {
  let crossCount = 0;
  const start = Math.max(0, prices.length - window);
  for (let i = start + 1; i < prices.length; i++) {
    if (isNaN(sma[i]) || isNaN(sma[i - 1])) continue;
    const prevAbove = prices[i - 1] > sma[i - 1];
    const currAbove = prices[i] > sma[i];
    if (prevAbove !== currAbove) crossCount++;
  }
  return crossCount;
}
function percentileRank(value, distribution) {
  const valid = distribution.filter((x) => !isNaN(x));
  if (valid.length === 0) return NaN;
  const below = valid.filter((x) => x < value).length;
  return below / valid.length;
}
function averageStreakLength(returns) {
  if (returns.length === 0) return 0;
  const streaks = [];
  let currentLen = 1;
  for (let i = 1; i < returns.length; i++) {
    if (returns[i] >= 0 === returns[i - 1] >= 0) {
      currentLen++;
    } else {
      streaks.push(currentLen);
      currentLen = 1;
    }
  }
  streaks.push(currentLen);
  return streaks.length > 0 ? streaks.reduce((a, b) => a + b, 0) / streaks.length : 0;
}
function variance(arr) {
  const m = mean(arr);
  return mean(arr.map((x) => (x - m) ** 2));
}
function excessKurtosis(returns) {
  return kurtosis(returns);
}
function rollingKurtosis(returns, window) {
  const result = [];
  for (let i = 0; i < returns.length; i++) {
    if (i < window - 1) {
      result.push(NaN);
    } else {
      const slice = returns.slice(i - window + 1, i + 1);
      try {
        result.push(kurtosis(slice));
      } catch {
        result.push(NaN);
      }
    }
  }
  return result;
}

// src/detectors.ts
var PERCENTILE_HISTORY_DAYS = 504;
var SEVERITY_PCTILE = { mild: 0.6, moderate: 0.75, severe: 0.9 };
function severityFromPercentile(pctile) {
  if (pctile >= SEVERITY_PCTILE.severe) return "severe";
  if (pctile >= SEVERITY_PCTILE.moderate) return "moderate";
  if (pctile >= SEVERITY_PCTILE.mild) return "mild";
  return "off";
}
function truncateData(data, daysBack) {
  if (daysBack <= 0) return data;
  const s = (arr) => arr.slice(0, -daysBack);
  return {
    spy: { prices: s(data.spy.prices), opens: s(data.spy.opens), returns: s(data.spy.returns) },
    qqq: { prices: s(data.qqq.prices), opens: s(data.qqq.opens), returns: s(data.qqq.returns) },
    tlt: { prices: s(data.tlt.prices), opens: s(data.tlt.opens), returns: s(data.tlt.returns) },
    vt: { prices: s(data.vt.prices), returns: s(data.vt.returns) },
    tip: { prices: s(data.tip.prices), returns: s(data.tip.returns) },
    gld: { prices: s(data.gld.prices), returns: s(data.gld.returns) },
    dbc: { prices: s(data.dbc.prices), returns: s(data.dbc.returns) },
    ...data.m2 ? { m2: data.m2 } : {}
    // M2 is monthly; don't truncate daily
  };
}
function detectCrisis(data) {
  const OFF = { active: false, severity: "off", score: 0, signals: {} };
  const spyPrices = data.spy.prices;
  const vtPrices = data.vt?.prices ?? [];
  const spyReturns = data.spy.returns;
  const tltReturns = data.tlt.returns;
  if (spyPrices.length < 10 || spyReturns.length < 10) return OFF;
  const lookback = Math.min(spyPrices.length, 252);
  const recentPrices = spyPrices.slice(-lookback);
  const spyHigh252 = Math.max(...recentPrices);
  const spyLast = spyPrices[spyPrices.length - 1];
  const spyDrawdown = (spyLast - spyHigh252) / spyHigh252;
  const ddScore = clamp(-spyDrawdown / 0.2, 0, 1);
  let globalConfirm = 0;
  const vtLast = vtPrices.length > 0 ? vtPrices[vtPrices.length - 1] : NaN;
  const vtHasData = vtPrices.length >= 10 && !isNaN(vtLast) && vtLast > 0;
  if (vtHasData) {
    const vtLookback = Math.min(vtPrices.length, 252);
    const recentVt = vtPrices.slice(-vtLookback).filter((p) => !isNaN(p) && p > 0);
    if (recentVt.length >= 10) {
      const vtHigh252 = Math.max(...recentVt);
      const vtDrawdown = (vtLast - vtHigh252) / vtHigh252;
      globalConfirm = clamp(-vtDrawdown / 0.2, 0, 1);
    }
  }
  let corrCrisis = 0;
  let spyTltCorr21 = 0;
  if (spyReturns.length >= 21 && tltReturns.length >= 21) {
    const minLen = Math.min(spyReturns.length, tltReturns.length);
    const spyR = spyReturns.slice(-minLen);
    const tltR = tltReturns.slice(-minLen);
    const rollCorr = rollingCorrelation(spyR, tltR, 21);
    for (let i = rollCorr.length - 1; i >= 0; i--) {
      if (!isNaN(rollCorr[i])) {
        spyTltCorr21 = rollCorr[i];
        break;
      }
    }
    corrCrisis = clamp(spyTltCorr21 / 0.5, 0, 1);
  }
  const recent21 = spyReturns.slice(-21);
  const extremeDays = recent21.filter((r) => r < -0.02).length;
  const tailScore = clamp(extremeDays / 4, 0, 1);
  let crisisScore;
  if (vtHasData) {
    crisisScore = ddScore * 0.35 + globalConfirm * 0.2 + corrCrisis * 0.25 + tailScore * 0.2;
  } else {
    const w = 0.35 + 0.25 + 0.2;
    crisisScore = ddScore * (0.35 / w) + corrCrisis * (0.25 / w) + tailScore * (0.2 / w);
  }
  const signals = {
    spyDrawdown,
    ddScore,
    globalConfirm,
    spyTltCorr21,
    corrCrisis,
    extremeDays,
    tailScore,
    crisisScore
  };
  if (Object.values(signals).some((v) => isNaN(v))) {
    return OFF;
  }
  if (spyDrawdown < -0.15 && spyTltCorr21 > 0.3) {
    signals._crisisOverride = 1;
  }
  const hasDrawdown = spyDrawdown < -0.15;
  const hasConcentratedSelling = tailScore >= 0.75;
  const gateActive = hasDrawdown && hasConcentratedSelling;
  signals._gateActive = gateActive ? 1 : 0;
  return {
    active: gateActive,
    severity: "off",
    // placeholder — percentile assigns real severity
    score: crisisScore,
    signals
  };
}
function detectVolatile(data) {
  const OFF = { active: false, severity: "off", score: 0, signals: {} };
  const spyReturns = data.spy.returns;
  if (spyReturns.length < 21) return OFF;
  const recent21 = spyReturns.slice(-21);
  const vol21 = std(recent21, 1) * Math.sqrt(252);
  const volHistory = rollingVolatility(spyReturns, {
    rollingPeriod: 21,
    periodsPerYear: 252
  });
  const volPercentile = percentileRank(vol21, volHistory);
  const signals = { vol21, volPercentile };
  if (isNaN(vol21) || isNaN(volPercentile)) return OFF;
  const gateActive = vol21 >= 0.2;
  signals._gateActive = gateActive ? 1 : 0;
  return {
    active: gateActive,
    severity: "off",
    score: volPercentile,
    signals
  };
}
function detectTrendDrawdown(data) {
  const OFF = { active: false, severity: "off", score: 0, signals: {} };
  const spyPrices = data.spy.prices;
  if (spyPrices.length < 50) return OFF;
  const sma50 = SMA(spyPrices, 50);
  const sma200 = spyPrices.length >= 200 ? SMA(spyPrices, 200) : [];
  const lastSma50 = sma50[sma50.length - 1];
  const lastSma200 = sma200.length > 0 ? sma200[sma200.length - 1] : NaN;
  if (isNaN(lastSma50)) return OFF;
  const hasSma200 = !isNaN(lastSma200) && lastSma200 > 0;
  const maCrossover = hasSma200 ? lastSma50 / lastSma200 : 1;
  const crossScore = hasSma200 ? clamp((1 - maCrossover) / 0.05, 0, 1) : 0;
  const lookback = Math.min(spyPrices.length, 252);
  const recentPrices = spyPrices.slice(-lookback);
  const peak252 = Math.max(...recentPrices);
  const current = spyPrices[spyPrices.length - 1];
  const drawdownDepth = peak252 > 0 ? Math.max(0, (peak252 - current) / peak252) : 0;
  const ddScore = clamp(drawdownDepth / 0.2, 0, 1);
  let peakIndex = 0;
  for (let i = 0; i < recentPrices.length; i++) {
    if (recentPrices[i] >= peak252) peakIndex = i;
  }
  const drawdownDuration = recentPrices.length - 1 - peakIndex;
  const durationScore = clamp(drawdownDuration / 63, 0, 1);
  const belowBoth = current < lastSma50 && (!hasSma200 || current < lastSma200) ? 1 : 0;
  const trendScore = crossScore * 0.2 + ddScore * 0.4 + durationScore * 0.15 + belowBoth * 0.25;
  const signals = {
    maCrossover,
    crossScore,
    drawdownDepth,
    ddScore,
    drawdownDuration,
    durationScore,
    belowBoth,
    trendScore
  };
  if (Object.values(signals).some((v) => isNaN(v))) return OFF;
  const gateActive = drawdownDepth >= 0.1;
  signals._gateActive = gateActive ? 1 : 0;
  return {
    active: gateActive,
    severity: "off",
    score: trendScore,
    signals
  };
}
function detectChoppy(data) {
  const OFF = { active: false, severity: "off", score: 0, signals: {} };
  const spyPrices = data.spy.prices;
  const spyReturns = data.spy.returns;
  if (spyPrices.length < 63 || spyReturns.length < 63) return OFF;
  const sma50 = SMA(spyPrices, 50);
  const sma50Recent = sma50.slice(-21).filter((v) => !isNaN(v));
  let smaFlatness = 0;
  if (sma50Recent.length >= 2) {
    const sma50Returns = dailyReturns(sma50Recent);
    const smaSlope = sma50Returns.reduce((a, b) => a + b, 0) / sma50Returns.length;
    smaFlatness = 1 - Math.min(Math.abs(smaSlope) / 2e-3, 1);
  }
  const crossCount = countCrossovers(spyPrices, sma50, 42);
  const crossScore = Math.min(crossCount / 8, 1);
  let meanRevScore = 0;
  let vrMin = 1;
  if (spyReturns.length >= 63) {
    const recent63 = spyReturns.slice(-63);
    const var1 = variance(recent63);
    if (var1 > 0) {
      for (const q of [2, 5, 10]) {
        const qReturns = [];
        for (let i = q - 1; i < recent63.length; i++) {
          let cum = 0;
          for (let j = i - q + 1; j <= i; j++) cum += recent63[j];
          qReturns.push(cum);
        }
        const vr = variance(qReturns) / (q * var1);
        if (vr < vrMin) vrMin = vr;
      }
      meanRevScore = clamp((1 - vrMin) / 0.5, 0, 1);
    }
  }
  const recent63Returns = spyReturns.slice(-63);
  const avgStreak = averageStreakLength(recent63Returns);
  const streakScore = 1 - Math.min((avgStreak - 1) / 3, 1);
  const chopScore = smaFlatness * 0.15 + crossScore * 0.15 + meanRevScore * 0.35 + streakScore * 0.35;
  const signals = {
    smaFlatness,
    crossCount,
    crossScore,
    vrMin,
    meanRevScore,
    avgStreak,
    streakScore,
    chopScore
  };
  if (Object.values(signals).some((v) => isNaN(v))) return OFF;
  const gateActive = vrMin < 0.85 && crossCount >= 2;
  signals._gateActive = gateActive ? 1 : 0;
  return {
    active: gateActive,
    severity: "off",
    score: chopScore,
    signals
  };
}
function detectInflationary(data) {
  const OFF = { active: false, severity: "off", score: 0, signals: {} };
  const tipPrices = data.tip?.prices ?? [];
  const tltPrices = data.tlt.prices;
  const gldPrices = data.gld?.prices ?? [];
  const dbcPrices = data.dbc?.prices ?? [];
  if (tipPrices.length < 64 || tltPrices.length < 64 || gldPrices.length < 64 || dbcPrices.length < 64) return OFF;
  const tipLast = tipPrices[tipPrices.length - 1];
  const tltLast = tltPrices[tltPrices.length - 1];
  const gldLast = gldPrices[gldPrices.length - 1];
  const dbcLast = dbcPrices[dbcPrices.length - 1];
  if (!tipLast || !tltLast || !gldLast || !dbcLast) return OFF;
  if (isNaN(tipLast) || isNaN(tltLast) || isNaN(gldLast) || isNaN(dbcLast)) return OFF;
  const tipTltLast = tipLast / tltLast;
  const idx63 = tipPrices.length - 64;
  const tipTlt63Ago = tipPrices[idx63] / tltPrices[idx63];
  if (!tipTlt63Ago || isNaN(tipTlt63Ago) || tipTlt63Ago === 0) return OFF;
  const tipTltRatio63 = tipTltLast / tipTlt63Ago - 1;
  const tipTltScore = clamp(tipTltRatio63 / 0.05, 0, 1);
  const dbcReturns = dailyReturns(dbcPrices);
  const dbcRecent63 = dbcReturns.slice(-63);
  const dbcReturn63 = comp(dbcRecent63);
  const dbcScore = clamp(dbcReturn63 / 0.1, 0, 1);
  const gldReturns = dailyReturns(gldPrices);
  const gldRecent63 = gldReturns.slice(-63);
  const gldReturn63 = comp(gldRecent63);
  const gldScore = clamp(gldReturn63 / 0.1, 0, 1);
  const tltReturns = dailyReturns(tltPrices);
  const tltRecent63 = tltReturns.slice(-63);
  const tltReturn63 = comp(tltRecent63);
  const tltWeakScore = clamp(-tltReturn63 / 0.08, 0, 1);
  const inflationScore = tipTltScore * 0.35 + dbcScore * 0.25 + gldScore * 0.2 + tltWeakScore * 0.2;
  const signals = {
    tipTltRatio63,
    tipTltScore,
    dbcReturn63,
    dbcScore,
    gldReturn63,
    gldScore,
    tltReturn63,
    tltWeakScore,
    inflationScore
  };
  if (Object.values(signals).some((v) => isNaN(v))) return OFF;
  const breakevensRising = tipTltRatio63 > 0.02;
  const bondsWeak = tltReturn63 < -0.02;
  const realAssetConfirmation = dbcReturn63 > 0.03 || gldReturn63 > 0.04;
  const gateActive = breakevensRising && bondsWeak && realAssetConfirmation;
  signals._gateActive = gateActive ? 1 : 0;
  return {
    active: gateActive,
    severity: "off",
    score: inflationScore,
    signals
  };
}
function detectQE(data) {
  const OFF = { active: false, severity: "off", score: 0, signals: {} };
  const spyReturns = data.spy.returns;
  const tltReturns = data.tlt.returns;
  const spyPrices = data.spy.prices;
  if (spyReturns.length < 63 || tltReturns.length < 63 || spyPrices.length < 50) return OFF;
  const spyReturn63 = comp(spyReturns.slice(-63));
  const equityMomentum = clamp(spyReturn63 / 0.1, 0, 1);
  const tltReturn63 = comp(tltReturns.slice(-63));
  const bondStrength = clamp((tltReturn63 + 0.05) / 0.1, 0, 1);
  let spyTltCorr21 = 0;
  const minLen = Math.min(spyReturns.length, tltReturns.length);
  if (minLen >= 21) {
    const spyR = spyReturns.slice(-minLen);
    const tltR = tltReturns.slice(-minLen);
    const rollCorr = rollingCorrelation(spyR, tltR, 21);
    for (let i = rollCorr.length - 1; i >= 0; i--) {
      if (!isNaN(rollCorr[i])) {
        spyTltCorr21 = rollCorr[i];
        break;
      }
    }
  }
  const decorrelation = clamp(-spyTltCorr21, 0, 1);
  const vol21 = std(spyReturns.slice(-21), 1) * Math.sqrt(252);
  const sma50 = SMA(spyPrices, 50);
  const lastSma50 = sma50[sma50.length - 1];
  const spyAboveSma = !isNaN(lastSma50) && spyPrices[spyPrices.length - 1] > lastSma50;
  const meltUpScore = spyAboveSma ? clamp((0.12 - vol21) / 0.07, 0, 1) : 0;
  const m2 = data.m2;
  const hasM2 = m2 && m2.yoyGrowth.length > 0;
  const m2YoY = hasM2 ? m2.yoyGrowth[m2.yoyGrowth.length - 1] : NaN;
  const m2GrowthScore = hasM2 && !isNaN(m2YoY) ? clamp(m2YoY / 0.15, 0, 1) : NaN;
  let qeScore;
  if (!isNaN(m2GrowthScore)) {
    qeScore = equityMomentum * 0.25 + bondStrength * 0.15 + decorrelation * 0.2 + meltUpScore * 0.15 + m2GrowthScore * 0.25;
  } else {
    qeScore = equityMomentum * 0.3 + bondStrength * 0.25 + decorrelation * 0.25 + meltUpScore * 0.2;
  }
  const signals = {
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
    qeScore
  };
  if (isNaN(qeScore)) return OFF;
  const hasStrongMomentum = spyReturn63 > 0.05;
  const hasEasyConditions = meltUpScore > 0.15 || decorrelation > 0.3;
  const gateActive = hasStrongMomentum && spyAboveSma && hasEasyConditions;
  signals._gateActive = gateActive ? 1 : 0;
  return {
    active: gateActive,
    severity: "off",
    score: qeScore,
    signals
  };
}
function detectNewsDriven(data) {
  const OFF = { active: false, severity: "off", score: 0, signals: {} };
  const spyPrices = data.spy.prices;
  const spyOpens = data.spy.opens;
  const spyReturns = data.spy.returns;
  const qqqPrices = data.qqq.prices;
  const qqqOpens = data.qqq.opens;
  const qqqReturns = data.qqq.returns;
  if (spyPrices.length < 42 || spyOpens.length < 42) return OFF;
  if (spyReturns.length < 42) return OFF;
  const LARGE_GAP = 0.015;
  const lookback = 21;
  const start = spyPrices.length - lookback;
  let spyLargeGaps = 0;
  let qqqLargeGaps = 0;
  let maxGap = 0;
  for (let i = start; i < spyPrices.length; i++) {
    if (i < 1) continue;
    const spyGap = Math.abs(spyOpens[i] - spyPrices[i - 1]) / spyPrices[i - 1];
    if (!isNaN(spyGap)) {
      if (spyGap > LARGE_GAP) spyLargeGaps++;
      if (spyGap > maxGap) maxGap = spyGap;
    }
    if (qqqPrices.length > i && qqqOpens.length > i) {
      const qqqGap = Math.abs(qqqOpens[i] - qqqPrices[i - 1]) / qqqPrices[i - 1];
      if (!isNaN(qqqGap)) {
        if (qqqGap > LARGE_GAP) qqqLargeGaps++;
        if (qqqGap > maxGap) maxGap = qqqGap;
      }
    }
  }
  const avgLargeGaps = (spyLargeGaps + qqqLargeGaps) / 2;
  const gapFreqScore = clamp(avgLargeGaps / 6, 0, 1);
  const recentSpyReturns = spyReturns.slice(-lookback);
  const recentQqqReturns = qqqReturns.slice(-lookback);
  const spyOutliers = recentSpyReturns.filter((r) => Math.abs(r) > 0.015).length;
  const qqqOutliers = recentQqqReturns.filter((r) => Math.abs(r) > 0.015).length;
  const avgOutliers = (spyOutliers + qqqOutliers) / 2;
  const outlierScore = clamp(avgOutliers / 7, 0, 1);
  const recent42 = spyReturns.slice(-42);
  let kurt = 0;
  if (recent42.length >= 20) {
    try {
      kurt = excessKurtosis(recent42);
    } catch {
    }
  }
  const kurtScore = clamp(kurt / 5, 0, 1);
  const newsScore = gapFreqScore * 0.35 + outlierScore * 0.4 + kurtScore * 0.25;
  const signals = {
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
    newsScore
  };
  if (Object.values(signals).some((v) => isNaN(v))) return OFF;
  const gateActive = avgOutliers >= 7 && avgLargeGaps >= 5;
  signals._gateActive = gateActive ? 1 : 0;
  return {
    active: gateActive,
    severity: "off",
    score: newsScore,
    signals
  };
}
var DETECTORS = {
  volatile: detectVolatile,
  trendDrawdown: detectTrendDrawdown,
  choppy: detectChoppy,
  inflationary: detectInflationary,
  qe: detectQE,
  crisis: detectCrisis,
  newsDriven: detectNewsDriven
};
function detectAllRegimesRaw(data) {
  const results = {};
  for (const rt of REGIME_TYPES) {
    results[rt] = DETECTORS[rt](data);
  }
  return results;
}
function detectAllRegimes(data) {
  const currentResults = detectAllRegimesRaw(data);
  const maxHistory = Math.min(PERCENTILE_HISTORY_DAYS, data.spy.prices.length - 200);
  const historyByType = {};
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
  const results = {};
  for (const rt of REGIME_TYPES) {
    const raw = currentResults[rt];
    const history = historyByType[rt];
    if (rt === "newsDriven" && raw.score === 0 && !raw.active) {
      results[rt] = raw;
      continue;
    }
    const pctile = history.length > 10 ? percentileRank(raw.score, history) : raw.score;
    let severity = severityFromPercentile(pctile);
    let active = severity !== "off";
    if (raw.signals._gateActive !== void 0 && raw.signals._gateActive !== 1) {
      active = false;
      severity = "off";
    }
    if (rt === "crisis" && raw.signals._crisisOverride === 1) {
      active = true;
      severity = "severe";
    }
    results[rt] = {
      active,
      severity,
      score: pctile,
      signals: { ...raw.signals, rawScore: raw.score, percentile: pctile }
    };
  }
  return results;
}

// src/classify.ts
function shouldTransition(regimeType, currentSeverity, proposedSeverity, consecutiveDays) {
  if (currentSeverity === proposedSeverity) return false;
  const rules = CONFIRMATION_RULES[regimeType];
  if (proposedSeverity === "off") {
    return consecutiveDays >= rules.deactivateDays;
  }
  if (currentSeverity === "off") {
    return consecutiveDays >= rules.activateDays;
  }
  return true;
}
function buildSlice(input, sliceEnd) {
  return {
    spy: {
      prices: input.spy.prices.slice(0, sliceEnd),
      opens: input.spy.opens?.slice(0, sliceEnd) ?? [],
      returns: input.spy.returns.slice(0, sliceEnd)
    },
    qqq: {
      prices: input.qqq.prices.slice(0, sliceEnd),
      opens: input.qqq.opens?.slice(0, sliceEnd) ?? [],
      returns: input.qqq.returns.slice(0, sliceEnd)
    },
    tlt: {
      prices: input.tlt.prices.slice(0, sliceEnd),
      opens: input.tlt.opens?.slice(0, sliceEnd) ?? [],
      returns: input.tlt.returns.slice(0, sliceEnd)
    },
    vt: {
      prices: input.vt.prices.slice(0, sliceEnd),
      returns: input.vt.returns.slice(0, sliceEnd)
    },
    tip: {
      prices: input.tip.prices.slice(0, sliceEnd),
      returns: input.tip.returns.slice(0, sliceEnd)
    },
    gld: {
      prices: input.gld.prices.slice(0, sliceEnd),
      returns: input.gld.returns.slice(0, sliceEnd)
    },
    dbc: {
      prices: input.dbc.prices.slice(0, sliceEnd),
      returns: input.dbc.returns.slice(0, sliceEnd)
    },
    ...input.m2 ? {
      m2: {
        values: input.m2.values.slice(0, sliceEnd),
        yoyGrowth: input.m2.yoyGrowth.slice(0, sliceEnd)
      }
    } : {}
  };
}
function classifyRegimeSeries(input) {
  const { dates } = input;
  const rawByDay = [];
  for (let i = 0; i < dates.length; i++) {
    const sliceData = buildSlice(input, i + 1);
    rawByDay.push(detectAllRegimesRaw(sliceData));
  }
  const results = [];
  const accumulators = {};
  for (const rt of REGIME_TYPES) {
    accumulators[rt] = { currentSeverity: "off", consecutiveDays: 0, pendingSeverity: null };
  }
  for (let i = 0; i < dates.length; i++) {
    const dayResults = {};
    for (const rt of REGIME_TYPES) {
      const raw = rawByDay[i][rt];
      if (rt === "newsDriven" && raw.score === 0 && !raw.active) {
        dayResults[rt] = raw;
        continue;
      }
      const histStart = Math.max(0, i - PERCENTILE_HISTORY_DAYS);
      const history = [];
      for (let j = histStart; j < i; j++) {
        history.push(rawByDay[j][rt].score);
      }
      const pctile = history.length > 10 ? percentileRank(raw.score, history) : raw.score;
      let proposedSeverity = severityFromPercentile(pctile);
      if (raw.signals._gateActive !== void 0 && raw.signals._gateActive !== 1) {
        proposedSeverity = "off";
      }
      if (rt === "crisis" && raw.signals._crisisOverride === 1) {
        proposedSeverity = "severe";
      }
      const acc = accumulators[rt];
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
            signals: raw.signals
          };
        } else {
          dayResults[rt] = {
            active: acc.currentSeverity !== "off",
            severity: acc.currentSeverity,
            score: pctile,
            signals: raw.signals
          };
        }
      } else {
        acc.pendingSeverity = null;
        acc.consecutiveDays = 0;
        dayResults[rt] = {
          active: acc.currentSeverity !== "off",
          severity: acc.currentSeverity,
          score: pctile,
          signals: raw.signals
        };
      }
    }
    results.push(dayResults);
  }
  return results;
}
function segmentReturnsByRegime(regimeSeries, symphonyReturns) {
  const result = {};
  for (const rt of REGIME_TYPES) {
    result[rt] = { onReturns: [], offReturns: [] };
  }
  const len = Math.min(regimeSeries.length, symphonyReturns.length);
  for (let i = 0; i < len; i++) {
    for (const rt of REGIME_TYPES) {
      if (regimeSeries[i][rt].active) {
        result[rt].onReturns.push(symphonyReturns[i]);
      } else {
        result[rt].offReturns.push(symphonyReturns[i]);
      }
    }
  }
  return result;
}
export {
  CONFIRMATION_RULES,
  PERCENTILE_HISTORY_DAYS,
  REGIME_DETECTOR_VERSION,
  REGIME_TYPES,
  SMA,
  averageStreakLength,
  clamp,
  classifyRegimeSeries,
  countCrossovers,
  dailyReturns,
  detectAllRegimes,
  detectAllRegimesRaw,
  detectChoppy,
  detectCrisis,
  detectInflationary,
  detectNewsDriven,
  detectQE,
  detectTrendDrawdown,
  detectVolatile,
  excessKurtosis,
  percentileRank,
  rollingKurtosis,
  segmentReturnsByRegime,
  severityFromPercentile,
  shouldTransition,
  variance
};
//# sourceMappingURL=index.mjs.map