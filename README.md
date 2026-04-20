# market-regimes

Market regime detection for quantitative finance, grounded in academic methodology.

Rule-based classification of market conditions into 5 regimes, sense-checked against 22 years of daily data (2002–2024). Zero machine learning — all signals derive from peer-reviewed statistical tests and asset-class relationships. The academic papers provide **methodology and parameters**, not date-window results. We apply those methodologies to market data and verify the output makes sense against known historical events.

## Table of Contents

- [Regimes Detected](#regimes-detected)
- [Quick Start](#quick-start)
- [Interpreting Results](#interpreting-results)
- [Detailed Regime Logic](#detailed-regime-logic)
  - [Crisis](#1-crisis)
  - [Volatile](#2-volatile)
  - [Choppy](#3-choppy)
  - [Inflationary](#4-inflationary)
  - [QE / Risk-On](#5-qe--risk-on)
  - [News-Driven (stub)](#6-news-driven-stub)
- [Confirmation Logic](#confirmation-logic)
- [API Reference](#api-reference)
- [Data Requirements](#data-requirements)
- [Sense Check: Paper → Detector → Verification](#sense-check-paper--detector--verification)
- [Smoke Tests (Known Market Events)](#smoke-tests-known-market-events)
- [Academic References](#academic-references)
- [Contributing](#contributing)
- [License](#license)

## Regimes Detected

| Regime | What it captures | Primary papers |
|--------|-----------------|----------------|
| **Crisis** | Severe equity drawdowns confirmed globally | Pagan & Sossounov 2003; Ang & Chen 2002; Cont 2001 |
| **Volatile** | Realized vol elevated vs own history | Whaley 2009; Giot 2005 |
| **Choppy** | Mean-reverting, trendless, short streaks | Lo & MacKinlay 1988; Lo 1991; Elder 1993 |
| **Inflationary** | Real rates rising, commodities strong, nominals weak | Gorton & Rouwenhorst 2006; Erb & Harvey 2006 |
| **QE / Risk-On** | Equity uptrend, low vol, negative stock-bond corr | Ilmanen 2003; Campbell et al. 2017 |
| **News-Driven** | *(Stub — pending FinGPT/NLP integration)* | — |

## Quick Start

```bash
npm install market-regimes nanuquant
```

### Fastest path: built-in Yahoo Finance fetcher

```typescript
import { fetchBenchmarkData } from "market-regimes/fetch";
import { detectAllRegimes, classifyRegimeSeries } from "market-regimes";

// Fetch 3 years of daily data for all 7 tickers from Yahoo Finance
const data = await fetchBenchmarkData({ lookbackDays: 756 });

// What regime is the market in today?
const regimes = detectAllRegimes(data);
console.log(regimes.crisis);
// { active: false, severity: "off", score: 0.12, signals: { spyDrawdown: -0.03, ... } }

// Full time-series with hysteresis confirmation
const dailyRegimes = classifyRegimeSeries(data);
// Array of per-day regime results — one entry per trading day
```

`fetchBenchmarkData` options:

```typescript
await fetchBenchmarkData({
  lookbackDays: 756,        // Calendar days back from today (default: 756 = ~3yr)
  startDate: "2020-01-01",  // Override: absolute start (takes precedence over lookbackDays)
  endDate: "2024-12-31",    // Override: absolute end (default: today)
  rateLimitMs: 500,         // Delay between Yahoo requests (default: 500ms)
});
```

### Bring your own data

If you already have a market data pipeline:

```typescript
import { detectAllRegimes } from "market-regimes";
import type { BenchmarkData } from "market-regimes";

const snapshot: BenchmarkData = {
  spy: { prices: [...], opens: [...], returns: [...] },
  qqq: { prices: [...], opens: [...], returns: [...] },
  tlt: { prices: [...], opens: [...], returns: [...] },
  vt:  { prices: [...], returns: [...] },
  tip: { prices: [...], returns: [...] },
  gld: { prices: [...], returns: [...] },
  dbc: { prices: [...], returns: [...] },
};

const regimes = detectAllRegimes(snapshot);
// {
//   crisis:       { active: false, severity: "off", score: 0.12, signals: {...} },
//   volatile:     { active: true,  severity: "moderate", score: 0.78, signals: {...} },
//   choppy:       { active: false, severity: "off", score: 0.22, signals: {...} },
//   inflationary: { active: true,  severity: "mild", score: 0.35, signals: {...} },
//   qe:           { active: false, severity: "off", score: 0.18, signals: {...} },
//   newsDriven:   { active: false, severity: "off", score: 0, signals: {} },
// }

```

## Interpreting Results

Each `RegimeResult` contains:

```typescript
{
  active: true,              // regime is ON (severity > "off")
  severity: "moderate",      // categorical: off | mild | moderate | severe
  score: 0.78,              // continuous 0–1 composite signal strength
  signals: {                 // decomposed sub-signals for diagnostics
    vol21: 0.24,
    volPercentile: 0.78,
  }
}
```

### Score vs Severity

The **score** is a continuous 0–1 composite of weighted sub-signals. It represents signal strength, not a probability. Higher = more evidence for the regime.

**Severity** is derived from score thresholds (different per detector):

| Severity | Meaning | Typical action |
|----------|---------|----------------|
| `off` | Regime not active | Normal operations |
| `mild` | Early/weak signal | Monitor; no action required |
| `moderate` | Clear regime presence | Consider defensive positioning |
| `severe` | Strong/extreme regime | Active risk management warranted |

### Score interpretation by regime

| Regime | Score meaning | 0.3 | 0.5 | 0.8 |
|--------|--------------|-----|-----|-----|
| [**Crisis**](#1-crisis) | Drawdown depth + contagion breadth | Minor correction | Bear market developing | Full crisis underway |
| [**Volatile**](#2-volatile) | Percentile rank vs own history | Above-average vol | Top quartile vol | Top decile vol |
| [**Choppy**](#3-choppy) | Mean-reversion strength | Slight chop | Trendless, mean-reverting | Strong anti-persistence |
| [**Inflationary**](#4-inflationary) | Breadth of inflation signals | One signal firing | Multiple inflation confirmations | Broad-based inflationary regime |
| [**QE / Risk-On**](#5-qe--risk-on) | Strength of risk-on fingerprint | Mild uptrend | Clear accommodative signal | Full melt-up environment |

### Using the signals field

The `signals` object exposes every intermediate calculation. Use it for:
- **Debugging:** Why did the detector fire? Which sub-signal is dominant?
- **Visualization:** Plot individual signals over time to see which component drove regime changes
- **Custom thresholds:** Override severity with your own logic based on raw signal values

Example: checking which crisis signal is dominant:
```typescript
const { signals } = regimes.crisis;
if (signals.ddScore > 0.5 && signals.corrCrisis < 0.2) {
  // Drawdown-driven, but stock-bond diversification still working
  // Less dangerous than correlation breakdown
}
```

---

## Detailed Regime Logic

Each detector is a pure function: `BenchmarkData → RegimeResult`. No side effects, no state between calls. State management (confirmation/hysteresis) is handled separately by `classifyRegimeSeries`.

---

### 1. Crisis

**Thesis:** Equity bear markets exhibit drawdown clustering, global contagion, and breakdown of the stock-bond diversification relationship (correlations go positive under stress).

**Signals:**

| Signal | Weight | Calculation | Rationale |
|--------|--------|-------------|-----------|
| `ddScore` | 0.35 | SPY drawdown from 252-day high, normalized by 20% | Pagan & Sossounov (2003) — bear markets defined by 20%+ peak-to-trough |
| `globalConfirm` | 0.20 | VT drawdown from 252-day high, same normalization | Contagion confirmation — local-only drawdowns (sector rotation) filtered out |
| `corrCrisis` | 0.25 | 21-day rolling SPY-TLT correlation / 0.50 | Ang & Chen (2002) — correlations increase in bear markets; flight-to-quality reversal |
| `tailScore` | 0.20 | Count of days with SPY return < -2% in last 21 days / 4 | Cont (2001) — volatility clustering and tail dependence |

**Overrides:**
- Immediate `severe` when SPY drawdown < -15% AND SPY-TLT correlation > +0.30 (bypasses confirmation). This catches the acute phase of crises where waiting for confirmation costs days.

**VT fallback:** When VT data is unavailable (pre-2008), weights are renormalized across the 3 remaining signals. The academic papers predate VT (launched June 2008).

**Severity thresholds:** mild ≥ 0.25, moderate ≥ 0.50, severe ≥ 0.75

---

### 2. Volatile

**Thesis:** Volatility is persistent (Whaley 2009) and clusters in regimes. Current realized vol relative to its own history is a robust regime indicator — no need for VIX or implied vol.

**Signals:**

| Signal | Weight | Calculation | Rationale |
|--------|--------|-------------|-----------|
| `volPercentile` | 1.0 (sole signal) | Percentile rank of current 21-day annualized vol vs full rolling vol history | Giot (2005) — vol percentile predicts future returns better than vol level |

**Calculation detail:**
1. Compute 21-day realized vol (sample std dev × √252) from SPY returns
2. Compute full rolling 21-day vol history using `rollingVolatility(spyReturns, { rollingPeriod: 21, periodsPerYear: 252 })`
3. Rank current vol against that history

**Severity thresholds:** mild ≥ 60th percentile, moderate ≥ 75th, severe ≥ 90th

---

### 3. Choppy

**Thesis:** Markets alternate between trending and mean-reverting regimes. The variance ratio test (Lo & MacKinlay 1988) is the canonical statistical test for distinguishing random walk (trending-compatible) from mean-reversion (choppy).

**Signals:**

| Signal | Weight | Calculation | Rationale |
|--------|--------|-------------|-----------|
| `meanRevScore` | 0.35 | Variance ratio across q=2,5,10; normalized departure from VR=1 | Lo & MacKinlay (1988) — VR < 1 indicates mean-reversion at that holding period |
| `streakScore` | 0.35 | 1 - (avgStreakLength - 1) / 3 over last 63 days | Lo (1991) — anti-persistence manifests as short win/loss streaks |
| `smaFlatness` | 0.15 | 1 - |SMA50 slope| / 0.002 | Elder (1993) — flat moving average = no directional trend |
| `crossScore` | 0.15 | SMA50 crossover count in 42 days / 8 | Elder (1993) — frequent price-SMA crossings = whipsaw market |

**Variance ratio detail:**
- VR(q) = Var(q-period returns) / (q × Var(1-period returns))
- VR = 1 → random walk. VR < 1 → mean-reverting. VR > 1 → trending.
- We take the minimum VR across q ∈ {2, 5, 10} (Lo & MacKinlay tested weekly and biweekly)
- Normalize: VR=1.0 → score 0, VR=0.5 → score 1

**Severity thresholds:** mild ≥ 0.35, moderate ≥ 0.55, severe ≥ 0.75

---

### 4. Inflationary

**Thesis:** Inflationary regimes are identifiable through real asset outperformance, commodity momentum, and nominal bond weakness. TIPS vs nominal Treasuries directly measures breakeven inflation expectations.

**Signals:**

| Signal | Weight | Calculation | Rationale |
|--------|--------|-------------|-----------|
| `tipTltScore` | 0.35 | 63-day TIP/TLT ratio change, normalized by 5% | Direct breakeven inflation proxy — TIPS outperform when real rates rise |
| `dbcScore` | 0.25 | 63-day DBC compound return / 10% | Gorton & Rouwenhorst (2006) — commodities are a leading inflation indicator |
| `gldScore` | 0.20 | 63-day GLD compound return / 10% | Gold as inflation store of value / real-rate hedge |
| `tltWeakScore` | 0.20 | -1 × 63-day TLT compound return / 8% | Rising nominal rates = falling bond prices = inflationary pressure |

**Why 63 days:** Quarterly momentum captures structural inflation shifts while filtering daily noise. Gorton & Rouwenhorst found commodity-inflation relationship strongest at 1-3 month horizons.

**Severity thresholds:** mild ≥ 0.30, moderate ≥ 0.55, severe ≥ 0.75

---

### 5. QE / Risk-On

**Thesis:** Quantitative easing and accommodative monetary policy create a distinctive market fingerprint: steady equity gains, stable/rising bonds, low volatility, and negative stock-bond correlation (the "Goldilocks" environment).

**Signals:**

| Signal | Weight | Calculation | Rationale |
|--------|--------|-------------|-----------|
| `equityMomentum` | 0.30 | 63-day SPY compound return / 10% | Sustained broad equity uptrend |
| `bondStrength` | 0.25 | (63-day TLT return + 5%) / 10% | Ilmanen (2003) — accommodative policy supports both stocks and bonds |
| `decorrelation` | 0.25 | -1 × 21-day SPY-TLT rolling correlation, clamped [0,1] | Campbell et al. (2017) — negative stock-bond corr = normal risk-on environment |
| `meltUpScore` | 0.20 | (15% - current 21d vol) / 10%, only if SPY > SMA50 | Low vol + uptrend = classic melt-up signature |

**Note:** `meltUpScore` is zero if SPY is below its 50-day SMA (no melt-up without an uptrend).

**Severity thresholds:** mild ≥ 0.40, moderate ≥ 0.60, severe ≥ 0.80

---

### 6. News-Driven (stub)

Always returns `{ active: false, severity: "off", score: 0, signals: {} }`. Reserved for future NLP/FinGPT-based event detection (earnings surprises, geopolitical events, policy announcements).

---

## Confirmation Logic

Raw detector outputs are smoothed via a hysteresis state machine to prevent regime flapping. Each regime has independent activation and deactivation thresholds:

| Regime | Activate after N days | Deactivate after N days | Rationale |
|--------|----------------------|------------------------|-----------|
| Crisis | 1 | 10 | Fast entry (capital preservation), slow exit (avoid whipsaw in recovery) |
| Volatile | 2 | 5 | Vol clusters — 2 days confirms, 5 days of calm to exit |
| Choppy | 3 | 5 | Mean-reversion needs pattern establishment |
| QE | 5 | 5 | Symmetric — momentum takes time to confirm |
| Inflationary | 5 | 10 | Structural — slow to build, slow to dissipate |
| News-Driven | 3 | 5 | (Stub defaults) |

**Exception:** Crisis with SPY drawdown < -15% AND SPY-TLT correlation > +0.30 bypasses confirmation entirely (immediate severe activation). Rationale: at -15% drawdown with positive stock-bond correlation, the crisis is already well underway — waiting costs money.

**Within-active severity changes** (e.g. moderate → severe) are immediate — no confirmation needed.

## API Reference

### Detectors

```typescript
// Individual detectors
detectCrisis(data: BenchmarkData): RegimeResult
detectVolatile(data: BenchmarkData): RegimeResult
detectChoppy(data: BenchmarkData): RegimeResult
detectInflationary(data: BenchmarkData): RegimeResult
detectQE(data: BenchmarkData): RegimeResult
detectNewsDriven(data: BenchmarkData): RegimeResult  // stub, always off

// Run all detectors at once
detectAllRegimes(data: BenchmarkData): Record<RegimeType, RegimeResult>
```

### Classification

```typescript
// Full time-series with confirmation state machine
classifyRegimeSeries(input: BenchmarkDataWithDates): Array<Record<RegimeType, RegimeResult>>

// Segment strategy returns by active/inactive regime state
segmentReturnsByRegime(
  regimeSeries: Array<Record<RegimeType, RegimeResult>>,
  symphonyReturns: number[]
): Record<RegimeType, { onReturns: number[]; offReturns: number[] }>

// Confirmation transition logic (used internally, exported for testing)
shouldTransition(
  regimeType: RegimeType,
  currentSeverity: Severity,
  proposedSeverity: Severity,
  consecutiveDays: number
): boolean
```

### Data Fetcher (`market-regimes/fetch`)

```typescript
import { fetchBenchmarkData } from "market-regimes/fetch";

// Downloads daily adjusted close from Yahoo Finance for all 7 tickers,
// aligns to common trading dates, and computes returns.
fetchBenchmarkData(options?: {
  lookbackDays?: number;   // calendar days back from today (default: 756)
  startDate?: string;      // ISO date override (takes precedence over lookbackDays)
  endDate?: string;        // ISO date (default: today)
  rateLimitMs?: number;    // ms between Yahoo requests (default: 500)
}): Promise<BenchmarkDataWithDates>
```

### Helpers (exported for advanced usage)

```typescript
clamp(value: number, min: number, max: number): number
dailyReturns(prices: number[]): number[]
SMA(prices: number[], period: number): number[]
countCrossovers(prices: number[], sma: number[], window: number): number
percentileRank(value: number, distribution: number[]): number
averageStreakLength(returns: number[]): number
variance(arr: number[]): number
excessKurtosis(returns: number[]): number
rollingKurtosis(returns: number[], window: number): number[]
```

### Types

```typescript
type RegimeType = "volatile" | "choppy" | "inflationary" | "qe" | "crisis" | "newsDriven";
type Severity = "off" | "mild" | "moderate" | "severe";

interface RegimeResult {
  active: boolean;                    // whether the regime is currently active
  severity: Severity;                 // severity level
  score: number;                      // 0–1 composite score
  signals: Record<string, number>;    // decomposed signal values for diagnostics
}

interface BenchmarkData {
  spy: { prices: number[]; opens: number[]; returns: number[] };
  qqq: { prices: number[]; opens: number[]; returns: number[] };
  tlt: { prices: number[]; opens: number[]; returns: number[] };
  vt:  { prices: number[]; returns: number[] };
  tip: { prices: number[]; returns: number[] };
  gld: { prices: number[]; returns: number[] };
  dbc: { prices: number[]; returns: number[] };
}

interface BenchmarkDataWithDates extends BenchmarkData {
  dates: string[];  // ISO date strings, e.g. "2024-01-02"
}

const REGIME_TYPES: RegimeType[];
const CONFIRMATION_RULES: Record<RegimeType, { activateDays: number; deactivateDays: number }>;
const REGIME_DETECTOR_VERSION: number;  // bump when detector logic changes
```

## Data Requirements

| Ticker | Asset | Required fields | Purpose |
|--------|-------|-----------------|---------|
| SPY | S&P 500 ETF | prices, opens, returns | Primary equity signal for all detectors |
| QQQ | Nasdaq 100 ETF | prices, opens, returns | Growth/tech equity (future use) |
| TLT | 20+ Year Treasury ETF | prices, opens, returns | Bond signal for crisis correlation, inflation |
| VT | Total World Stock ETF | prices, returns | Global equity confirmation (crisis) |
| TIP | TIPS Bond ETF | prices, returns | Breakeven inflation (inflationary) |
| GLD | Gold ETF | prices, returns | Inflation hedge signal |
| DBC | Broad Commodities ETF | prices, returns | Commodity momentum (inflationary) |

**Minimum data by detector:**
- Crisis: 10 days (degrades gracefully without VT)
- Volatile: 21 days (more history = better percentile ranking)
- Choppy: 63 days
- QE: 63 days
- Inflationary: 64 days

**Recommended:** 252+ trading days for meaningful percentile calculations. The smoke test data spans 5644 trading days (2002-07-30 to 2024-12-30).

**NaN handling:** VT, TIP, GLD, and DBC may contain NaN for dates before their inception. Detectors gracefully skip unavailable data (e.g., crisis detector renormalizes weights when VT is missing pre-2008).

## Sense Check: Paper → Detector → Verification

The academic papers cited in this package provide **methodology only** — statistical tests, model parameters, stylized facts, and correlation structures. With two minor exceptions (Whaley 2009 identifies 2 VIX>34 windows; Campbell et al. 2014 identifies one decade-long structural regime), none of the papers provide specific date windows in our data range (2002–2024) that we could use as ground truth.

What we do instead: apply the paper's methodology to SPY/TLT/DBC/etc. price data, then sense-check that the detector output is plausible given what we know happened in markets. This section documents that reasoning for each detector.

### Crisis

**Paper methodology applied:**
- Pagan & Sossounov (2003): Bear market = 20%+ peak-to-trough decline lasting 4+ months. We normalize SPY drawdown from 252-day high by 20% → `ddScore`. Their data ends 1997 — we apply the same algorithm to modern SPY.
- Ang & Chen (2002): Stock-bond correlations increase during downturns. We compute 21-day rolling SPY-TLT correlation, normalize by 0.50 → `corrCrisis`. No date windows from the paper — just the empirical pattern.
- Cont (2001): Volatility clusters and tail dependence. We count days with SPY return < -2% in last 21 days → `tailScore`. Paper provides the statistical property (β ∈ [0.2, 0.4]), not dates.

**Sense check:**
- GFC (Oct 2007 – Mar 2009): Detector fires immediately. SPY drawdown hit -56%, SPY-TLT correlation turned positive (flight to quality broke down), extreme tail days clustered. All 4 sub-signals confirmed. Score exceeded 0.75 → severe.
- COVID (Feb – Mar 2020): Detector fires within 0 days. Fastest -34% drawdown in history. Tail days spiked (10+ days below -2% in a 21-day window). SPY-TLT correlation briefly positive in the liquidity panic.
- If the detector fired during calm uptrends with no drawdown, it would be broken. It doesn't — score stays near 0 when SPY is within 5% of highs.

### Volatile

**Paper methodology applied:**
- Whaley (2009): Documents VIX percentile distribution and identifies periods where VIX > 34.22 for 20+ consecutive days. Two overlap our data: Aug 28–Oct 31 2002 and Sep 26–Oct 31 2008. Our detector uses **realized vol percentile** (not VIX directly) — we rank 21-day realized vol against its own full history.
- Giot (2005): Shows VIX percentile thresholds (60th/75th/90th) predict future returns. No date windows. We adopt the same percentile breakpoints for severity.

**Sense check:**
- The 2 Whaley VIX>34 periods (2002, 2008): Our realized vol percentile exceeds 90th in both — correct, since extreme VIX and extreme realized vol co-occur.
- Feb 2018 Volmageddon (XIV blowup): Realized vol spiked to top decile. Detector fires. This event is NOT in any paper — it's from price history. The detector catches it because the methodology is sound.
- Calm periods (2013, 2017, 2019 pre-Aug): Vol percentile stays below 60th. Detector stays off. If it fired during these low-vol years, the percentile ranking would be broken.

### Choppy

**Paper methodology applied:**
- Lo & MacKinlay (1988): The variance ratio test VR(q) = Var(q-period returns) / (q × Var(1-period)). VR < 1 → mean-reverting (choppy). VR = 1 → random walk. We compute VR at q ∈ {2, 5, 10} over last 63 days and take the minimum. The paper IS the test — it provides the formula, not dates.
- Lo (1991): Short-range dependence only — long memory is a statistical artifact at scale. Constrains our lookback to 63 days (not 252+). No dates.
- Elder (1993): Flat SMA + frequent crossovers = directionless market. We count SMA50 crossovers in 42 days and measure SMA50 slope.

**Sense check:**
- 2011 H2 (SPY range-bound 1100–1290): VR drops well below 1.0 at q=5 and q=10 — the market was mean-reverting around 1200. SMA50 flat, crossover count high. Detector fires. This makes sense: multiple failed breakouts in both directions.
- 2015 Aug – 2016 Feb (China deval chop): Same pattern — SPY whipsawed between 2000–2100. VR < 1, streaks short. Detector fires.
- Strong trending periods (2013, 2017, 2021 H2): VR stays near or above 1.0. SMA50 has clear positive slope. Detector stays off. If it fired during a steady uptrend, the VR calculation would be wrong.

### Inflationary

**Paper methodology applied:**
- Gorton & Rouwenhorst (2006): Commodity futures correlate with inflation, and the correlation strengthens at longer horizons (monthly r=0.01, quarterly r=0.14, 5-year r=0.45). No date windows. We use 63-day (quarterly) DBC compound return as the commodity signal, capturing the horizon where the paper shows correlation becomes meaningful.
- Erb & Harvey (2006): Real assets behave differently during inflation. No date windows. Validates using TIP/TLT ratio as a breakeven inflation proxy.

**Sense check:**
- 2021 H1 (commodity supercycle): DBC up 30%+, TIP outperforming TLT (breakevens widening), gold rising, TLT falling. All 4 sub-signals fire simultaneously → score exceeds 0.55 (moderate to severe). This was the most broad-based inflationary signal in our dataset — CPI was accelerating from 1.4% to 5.4%.
- 2022 H1 (Russia/Ukraine commodity shock): DBC spiked again, CPI peaked at 9.1% in June 2022. Detector fires severe.
- 2013–2019 (low-inflation era): CPI averaged 1.5–2.0%. DBC was flat-to-negative, TIP/TLT ratio stable. Detector stays off. If it fired during this period, the commodity signal would be miscalibrated.

### QE / Risk-On

**Paper methodology applied:**
- Ilmanen (2003): Three negative stock-bond correlation episodes: 1929–32, 1956–65, 1998–2001 — all before our data. Finds monetary easing produces higher stock returns (1.52 vs 0.62 during tightening). We use decorrelation (negative SPY-TLT corr) as one signal. The paper motivates the signal — it doesn't tell us when QE happens post-2002.
- Campbell, Pflueger & Viceira (2014): Identifies 3 structural monetary regimes with breaks at 1977Q2 and 2001Q1. Regime 3 spans 2001Q1–2011Q4 — the entire decade as one block. Our detector is episodic (months, not decades), so this is a different granularity. Their finding that monetary policy drives stock-bond correlation validates our signal construction.
- Ang & Timmermann (2012): Two-state Markov model with low-vol regime σ ≈ 8.5% annualized. We use this to calibrate the `meltUpScore` threshold: score = 0.5 at vol = 8.5% (the regime boundary), = 0 at vol ≥ 12%, = 1.0 at vol ≤ 5%.
- FRED M2SL (not a paper — direct data): M2 money supply year-over-year growth. Normalized so 15%+ YoY = max score. Added because bond prices can fall during QE (taper tantrum), but M2 growth directly measures monetary expansion.

**Sense check:**
- Post-GFC 2009–2010 (QE1 risk-on): SPY rallying off March 2009 bottom, vol declining, SPY-TLT correlation negative (normal risk-on), M2 growing 6–9% YoY. Detector fires within 8 days of the window start. The signal is equity momentum + low vol + decorrelation — the classic QE fingerprint.
- 2020 Jul – 2021 Jun (post-COVID stimulus): M2 growth 14–28% YoY (unprecedented). SPY trending up, vol low. Detector fires. M2 is the dominant signal here — this was the largest monetary expansion since WWII.
- 2022 (rate hiking cycle): SPY falling, vol elevated, M2 growth decelerating then negative. Detector stays off. If it fired during the most aggressive tightening cycle in 40 years, the signal would be inverted.

### What "sense check" means — and what it doesn't

This is NOT academic validation. We have no ground truth to compare against. What we're checking:

1. **Does the detector fire when it should?** During events that every market participant agrees were crisis/volatile/choppy/inflationary/QE, the detector should activate.
2. **Does it stay quiet when it should?** During periods that are clearly NOT the regime, the detector should stay off. This catches miscalibrated thresholds and inverted signals.
3. **Are the sub-signals internally consistent?** During a known event, do the individual signal values make directional sense? (e.g., during GFC, ddScore should be high AND corrCrisis should be high AND tailScore should be high — if one is zero while the others are maxed, something is wrong.)

The smoke tests in the next section automate checks #1 and #2 against manually-defined event windows from price history.

## Smoke Tests (Known Market Events)

The test suite checks that detectors fire during well-known market events. These are **regression tests**, not academic validation. The event windows are manually defined from SPY/VIX price history and financial news — NOT from the academic papers. The papers provide methodology and parameters that inform detector design; these tests just check the detectors don't silently break.

### Protocol

For each regime, event windows are manually defined from price history (e.g., "GFC: 2007-10-09 to 2009-03-09 from SPY peak-to-trough"). The test verifies:

1. **Entry timing:** Detector activates within N trading days of the window anchor date
2. **Coverage (where applicable):** Detector remains active for ≥90% of trading days in the window

Entry-only regimes (choppy, QE) only check timing — their nature is episodic rather than sustained.

### Running smoke tests

```bash
npm test
# or specifically:
npx vitest run tests/convergence.test.ts
```

Tests are skipped automatically if `tests/testdata/benchmark-data-full.json` is not present.

### Current results

| Regime | Windows | Entry Lag | Coverage | Status |
|--------|---------|-----------|----------|--------|
| Crisis | 3/3 | 0d | 91–100% | PASS |
| Volatile | 5/5 | 0–2d | 95–100% | PASS |
| Inflationary | 2/2 | 0–3d | 95–97% | PASS |
| Choppy | 2/2 | 0d | — (entry-only) | PASS |
| QE / Risk-On | 3/3 | 0–8d | — (entry-only) | PASS |

### Event windows (manually defined from price history)

**Crisis** (anchor: date SPY crosses -15% drawdown from 252-day high)
| Window | Dates | Note |
|--------|-------|------|
| Dot-com bear bottom | 2002-08-01 to 2002-10-09 | Data begins mid-bear (2002-07-30) |
| Global Financial Crisis | 2007-10-09 to 2009-03-09 | Peak-to-trough |
| COVID crash | 2020-02-19 to 2020-03-23 | Peak-to-trough |

**Volatile** (anchor: window start date, max entry lag 10d, coverage ≥90%)
| Window | Dates |
|--------|-------|
| GFC peak volatility | 2008-09-15 to 2009-03-31 |
| COVID crash | 2020-02-20 to 2020-05-15 |
| Feb 2018 Volmageddon | 2018-02-01 to 2018-04-30 |
| US debt ceiling / EU crisis | 2011-08-01 to 2011-11-30 |
| China deval / Aug 2015 selloff | 2015-08-20 to 2015-10-15 |

**Inflationary** (anchor: window start, max entry lag 10d, coverage ≥90%)
| Window | Dates |
|--------|-------|
| Reflation trade H1 2021 | 2021-01-01 to 2021-07-31 |
| Russia/Ukraine commodity shock | 2022-02-01 to 2022-06-30 |

**Choppy** (anchor: window start, max entry lag 10d, entry-only)
| Window | Dates |
|--------|-------|
| US debt ceiling / EU crisis chop | 2011-08-01 to 2011-12-31 |
| China deval / oil crash chop | 2015-08-01 to 2016-02-29 |

**QE / Risk-On** (anchor: window start, max entry lag 10d, entry-only)
| Window | Dates |
|--------|-------|
| Post-GFC recovery (QE1 momentum) | 2009-07-20 to 2010-04-30 |
| 2019 Fed pivot + repo facility | 2019-08-01 to 2020-02-19 |
| Post-COVID stimulus risk-on | 2020-07-01 to 2021-06-30 |

### Test data

- `tests/testdata/benchmark-data-full.json` — 5644 trading days of SPY/QQQ/TLT/VT/TIP/GLD/DBC (2002-07-30 to 2024-12-30), ~2MB
- `tests/testdata/targets/*.json` — Event window definitions per regime (manually defined from price history)

## Academic References

These papers provide **methodology, parameters, and statistical properties** that inform detector design. They do NOT provide post-2002 date windows for validation (with minor exceptions noted). The smoke test event windows are separately defined from price history.

### What each paper provides (and what it does NOT)

**Crisis detection — methodology and thresholds:**
- Pagan & Sossounov (2003). "A Simple Framework for Analysing Bull and Bear Markets." — Provides bear market dating algorithm (peak-to-trough, 4-month min duration, -20% amplitude threshold). Their data ends 1997 — no post-2002 dates. We apply their methodology to modern SPY data ourselves.
- Ang & Chen (2002). "Asymmetric Correlations of Equity Portfolios." — Documents that correlations increase during downturns. No specific date windows. Validates our use of rolling correlation in the crisis detector.
- Cont (2001). "Empirical Properties of Asset Returns." — Stylized facts: volatility clustering (β ∈ [0.2, 0.4]), heavy tails (kurtosis ~16), leverage effect. No date windows. Justifies our deactivateDays and transition logic.

**Volatility regime — VIX statistics and percentile thresholds:**
- Whaley (2009). "Understanding the VIX." — Provides VIX percentile distribution and 4 periods where VIX > 34.22 for 20+ days. Two overlap our data: Aug 28-Oct 31 2002, Sep 26-Oct 31 2008. Note: our detector uses realized vol percentile, not VIX directly.
- Giot (2005). "Relationships Between Implied Volatility Indexes and Stock Index Returns." — VIX percentile thresholds (60/75/90) as return predictors. No date windows. Validates our percentile-based severity thresholds.

**Choppy / mean-reversion — the statistical test itself:**
- Lo & MacKinlay (1988). "Stock Market Prices Do Not Follow Random Walks." — Provides the variance ratio test VR(q) that IS our choppy detector. No date windows — the paper is the test methodology.
- Lo (1991). "Long-Term Memory in Stock Market Prices." — Shows dependence is short-range only. No date windows. Constrains our lookback to 63 days.

**Inflationary regime — commodity-inflation correlation:**
- Gorton & Rouwenhorst (2006). "Facts and Fantasies about Commodity Futures." — Commodity-inflation correlation strengthens at longer horizons (monthly 0.01, quarterly 0.14, 5-year 0.45). No date windows. Validates our 63-day lookback and commodity-based signal construction.
- Erb & Harvey (2006). "The Strategic and Tactical Value of Commodity Futures." — Real asset behavior during inflation. No date windows.

**QE / Risk-On — correlation regime theory:**
- Ilmanen (2003). "Stock-Bond Correlations." — Three negative correlation episodes: 1929-32, 1956-65, 1998-2001 (all before our data). Monetary easing stats (261 months 1952-2001). Postscript notes correlation -0.5 to -0.9 in 2002-2003. Provides easing/tightening return differentials. Does NOT provide post-2002 QE date windows.
- Campbell, Pflueger & Viceira (2014). "Monetary Policy Drivers of Bond and Equity Risks." — Three structural monetary policy regimes with breaks at 1977Q2 and 2001Q1. Regime 3 (2001Q1-2011Q4) overlaps our data but is the ENTIRE decade as one regime — different granularity from our episodic QE detector.

### Model parameters (no date windows):
- Ang & Timmermann (2012). "Regime Changes and Financial Markets." — Review paper. Two-state Markov model: p₀₀=0.95, p₁₁=0.98, low-vol σ≈8.5%. Calibrates our persistence and meltUp threshold parameters.
- Hamilton (1989). "A New Approach to the Economic Analysis of Nonstationary Time Series." — Foundational regime-switching framework. Our approach is rule-based, not HMM.

## Contributing

### Adding a new detector

1. Add the regime type string to `RegimeType` in `src/types.ts`
2. Add confirmation rules to `CONFIRMATION_RULES` in `src/types.ts`
3. Create the `detect<Name>` function in `src/detectors.ts`
4. Register it in the `DETECTORS` map
5. Export from `src/index.ts`
6. Create event windows at `tests/testdata/targets/<regime>-regime-dates.json`
7. Add smoke test config to `tests/convergence.test.ts`
8. Run `npm test` — all smoke tests must pass

### Event window file format

```json
{
  "regime": "crisis",
  "description": "Where these dates come from and why",
  "dateSource": "SPY price history via Yahoo Finance",
  "eventWindows": [
    {
      "start": "2008-09-15",
      "end": "2009-03-09",
      "label": "GFC",
      "severity": "severe",
      "note": "Optional context for maintainers"
    }
  ]
}
```

### Design principles

- **No ML/HMM.** Detectors use interpretable statistical tests with known theoretical properties. This makes signals auditable and debuggable.
- **Pure functions.** Detectors have no side effects, no state, no IO. Classification state is explicit and separate.
- **Compositional signals.** Each detector decomposes into named sub-signals with explicit weights. The `signals` field in `RegimeResult` exposes all intermediate values for debugging and visualization.
- **Conservative activation.** Confirmation rules prevent regime flapping. Better to miss the first day of a regime than to whipsaw in and out.

## License

MIT
