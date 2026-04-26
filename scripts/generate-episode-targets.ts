#!/usr/bin/env bun
/**
 * generate-episode-targets.ts
 *
 * Deterministically computes regime episode windows from primary source data
 * and writes them to tests/testdata/targets/*.json.
 *
 * DO NOT hand-edit those target files — re-run this script instead.
 *
 * Sources:
 *   volatile     → ^VIX daily close via Yahoo Finance. Criterion: VIX > 30
 *                  sustained for >= MIN_VIX_DAYS consecutive trading days.
 *   inflationary → FRED T10YIE (10-year breakeven inflation rate) via FRED
 *                  CSV endpoint. Criterion: T10YIE > 2.50%.
 *   crisis       → NBER recession dates (hardcoded — these are human committee
 *                  declarations, not computable from market data).
 *   qe           → FOMC LSAP program dates (hardcoded — human policy decisions
 *                  with market-response anchor computed from SPY trough).
 *   choppy       → No primary source with dated episodes; empty windows.
 *
 * Usage:
 *   bun run scripts/generate-episode-targets.ts
 */

import { writeFileSync } from "fs";
import { resolve } from "path";

const TARGETS_DIR = resolve(import.meta.dir, "../tests/testdata/targets");

// ─── Constants ──────────────────────────────────────────────────────────────

const VIX_THRESHOLD = 30;
const MIN_VIX_DAYS = 10; // sustained trading days above threshold
const T10YIE_THRESHOLD = 2.5;
// 65d minimum = 1 day beyond the 63-day lookback used by detectInflationary.
// Windows shorter than 65d can't be reliably detected because the detector needs
// the full 63-day window to compute TIP/TLT momentum and commodity confirmation.
const MIN_T10YIE_DAYS = 65;
const START_DATE = "2002-01-01";
const END_DATE = new Date().toISOString().slice(0, 10);

// ─── Fetchers ────────────────────────────────────────────────────────────────

async function fetchYahooSeries(
  ticker: string,
  startDate: string,
  endDate: string,
): Promise<Array<{ date: string; close: number }>> {
  const start = Math.floor(new Date(startDate).getTime() / 1000);
  const end = Math.floor(new Date(endDate).getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${start}&period2=${end}&interval=1d`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`Yahoo Finance ${ticker}: HTTP ${res.status}`);

  const json = (await res.json()) as {
    chart: {
      result: Array<{
        timestamp: number[];
        indicators: { adjclose?: Array<{ adjclose: number[] }>; quote: Array<{ close: number[] }> };
      }>;
    };
  };

  const result = json.chart.result?.[0];
  if (!result) throw new Error(`Yahoo Finance ${ticker}: no result`);

  const timestamps = result.timestamp;
  const closes =
    result.indicators.adjclose?.[0]?.adjclose ?? result.indicators.quote[0]?.close ?? [];

  return timestamps
    .map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      close: closes[i] ?? NaN,
    }))
    .filter((d) => !isNaN(d.close) && d.close > 0);
}

async function fetchFredSeries(
  seriesId: string,
  startDate: string,
  endDate: string,
): Promise<Array<{ date: string; value: number }>> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=${startDate}&coed=${endDate}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED ${seriesId}: HTTP ${res.status}`);

  const text = await res.text();
  return text
    .split("\n")
    .slice(1) // skip header
    .map((line) => {
      const [date, val] = line.trim().split(",");
      return { date: date ?? "", value: parseFloat(val ?? "") };
    })
    .filter((d) => d.date && !isNaN(d.value));
}

// ─── Episode computation ──────────────────────────────────────────────────────

interface EpisodeWindow {
  start: string;
  end: string;
  label: string;
  severity?: string;
  /**
   * "nber"        — NBER-declared recession. Strict pass criteria apply
   *                 (entry ≤10d from SPY -15% anchor, ≥40% coverage).
   * "nber-silent" — Significant market drawdown where NBER was silent.
   *                 NBER silence is informative: it means the drawdown
   *                 lacked the macro contraction signature that triggers
   *                 a committee declaration.  Pass criteria are relaxed:
   *                 entry-only check (detector fires at least once within
   *                 the window), no coverage floor, no severity expectation.
   *
   * Default (omitted) = "nber" for backwards compatibility.
   */
  tier?: "nber" | "nber-silent";
}

/**
 * Find contiguous runs where value > threshold for >= minDays trading days.
 * Returns start/end date of each sustained run.
 */
function findSustainedPeriods(
  series: Array<{ date: string; value: number }>,
  threshold: number,
  minDays: number,
): Array<{ start: string; end: string; peak: number; days: number }> {
  const results: Array<{ start: string; end: string; peak: number; days: number }> = [];
  let runStart: string | null = null;
  let runPeak = 0;
  let runDays = 0;

  for (let i = 0; i < series.length; i++) {
    const { date, value } = series[i]!;
    if (value > threshold) {
      if (!runStart) {
        runStart = date;
        runPeak = value;
        runDays = 1;
      } else {
        runPeak = Math.max(runPeak, value);
        runDays++;
      }
    } else {
      if (runStart && runDays >= minDays) {
        results.push({ start: runStart, end: series[i - 1]!.date, peak: runPeak, days: runDays });
      }
      runStart = null;
      runPeak = 0;
      runDays = 0;
    }
  }
  // Close final run if open
  if (runStart && runDays >= minDays) {
    results.push({
      start: runStart,
      end: series[series.length - 1]!.date,
      peak: runPeak,
      days: runDays,
    });
  }
  return results;
}

/**
 * Find the last date where value >= threshold (going back from the end of a run).
 * Used for the inflationary window end — last day T10YIE was above 2.5%.
 */
function findCrossings(
  series: Array<{ date: string; value: number }>,
  threshold: number,
): Array<{ type: "above" | "below"; date: string; value: number }> {
  const crossings: Array<{ type: "above" | "below"; date: string; value: number }> = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1]!;
    const curr = series[i]!;
    if (prev.value <= threshold && curr.value > threshold) {
      crossings.push({ type: "above", date: curr.date, value: curr.value });
    } else if (prev.value > threshold && curr.value <= threshold) {
      crossings.push({ type: "below", date: curr.date, value: curr.value });
    }
  }
  return crossings;
}

// ─── Target file writers ─────────────────────────────────────────────────────

function writeTarget(filename: string, data: object) {
  const path = resolve(TARGETS_DIR, filename);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  console.log(`  Wrote ${filename}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Generating regime episode targets (${START_DATE} → ${END_DATE}) ===\n`);

  // ── 1. Volatile: ^VIX > 30 sustained ≥ 10 trading days ──────────────────

  console.log(`Fetching ^VIX from Yahoo Finance...`);
  await new Promise((r) => setTimeout(r, 500));
  const vixRaw = await fetchYahooSeries("^VIX", START_DATE, END_DATE);
  console.log(`  ${vixRaw.length} VIX trading days (${vixRaw[0]?.date} → ${vixRaw[vixRaw.length - 1]?.date})`);
  // Map close → value for findSustainedPeriods
  const vix = vixRaw.map((d) => ({ date: d.date, value: d.close }));

  const vixPeriods = findSustainedPeriods(vix, VIX_THRESHOLD, MIN_VIX_DAYS);
  console.log(`  Found ${vixPeriods.length} periods with VIX > ${VIX_THRESHOLD} for ≥ ${MIN_VIX_DAYS} days:`);
  for (const p of vixPeriods) {
    console.log(`    ${p.start} → ${p.end} (${p.days}d, peak ${p.peak.toFixed(1)})`);
  }

  const vixWindows: EpisodeWindow[] = vixPeriods
    .filter((p) => {
      // Exclude windows that start within the first PERCENTILE_HISTORY_DAYS (504) trading
      // days of our data. The volatile detector uses a 504-day trailing window to compute
      // percentile severity. Before that, the distribution is too thin and coverage will be
      // underestimated — producing false failures. 504 trading days ≈ 2 calendar years.
      const dataStart = vix[504]?.date ?? vix[0]?.date ?? START_DATE;
      return p.start >= dataStart;
    })
    .map((p) => ({
      start: p.start,
      end: p.end,
      label: `VIX > ${VIX_THRESHOLD} sustained ${p.days} trading days. Peak: ${p.peak.toFixed(1)}. Computed from CBOE ^VIX daily closes via Yahoo Finance.`,
      severity: p.peak >= 50 ? "severe" : p.peak >= 35 ? "moderate" : "mild",
    }));

  writeTarget("volatile-regime-dates.json", {
    regime: "volatile",
    description: `Periods where CBOE VIX daily close exceeded ${VIX_THRESHOLD} for at least ${MIN_VIX_DAYS} consecutive trading days. VIX > 30 is the standard elevated-fear threshold in the volatility literature (Whaley 2009). Windows starting within the first 504 trading days (~2 years) of data are excluded: the volatile detector uses a 504-day trailing distribution to compute percentile severity, so scores before that point are based on too few samples to produce reliable coverage rates. GENERATED BY scripts/generate-episode-targets.ts — do not hand-edit.`,
    dateSource: `CBOE ^VIX daily closing prices via Yahoo Finance. Criterion: close > ${VIX_THRESHOLD} sustained >= ${MIN_VIX_DAYS} consecutive trading days. Generated: ${new Date().toISOString().slice(0, 10)}.`,
    generatedAt: new Date().toISOString(),
    thresholds: { vixAbove: VIX_THRESHOLD, minSustainedDays: MIN_VIX_DAYS },
    eventWindows: vixWindows,
    passCriterion: `Detector fires within 15 trading days of window start. Coverage >= 50% of window required. 15d entry lag because the 21-day realized-vol percentile signal builds over time.`,
  });

  // ── 2. Inflationary: FRED T10YIE > 2.5% ─────────────────────────────────

  console.log(`\nFetching FRED T10YIE (10-year breakeven inflation rate)...`);
  await new Promise((r) => setTimeout(r, 500));
  const t10yie = await fetchFredSeries("T10YIE", START_DATE, END_DATE);
  console.log(`  ${t10yie.length} observations (${t10yie[0]?.date} → ${t10yie[t10yie.length - 1]?.date})`);

  const t10yiePeriods = findSustainedPeriods(t10yie, T10YIE_THRESHOLD, MIN_T10YIE_DAYS);
  console.log(
    `  Found ${t10yiePeriods.length} periods with T10YIE > ${T10YIE_THRESHOLD}% for ≥ ${MIN_T10YIE_DAYS} days:`,
  );
  for (const p of t10yiePeriods) {
    console.log(`    ${p.start} → ${p.end} (${p.days}d, peak ${p.peak.toFixed(2)}%)`);
  }

  const t10yieWindows: EpisodeWindow[] = t10yiePeriods.map((p) => ({
    start: p.start,
    end: p.end,
    label: `T10YIE > ${T10YIE_THRESHOLD}%: ${p.start} → ${p.end} (${p.days} days, peak ${p.peak.toFixed(2)}%). Computed from FRED T10YIE.`,
    severity: "severe",
  }));

  writeTarget("inflationary-regime-dates.json", {
    regime: "inflationary",
    description: `Periods where the FRED 10-year breakeven inflation rate (T10YIE) exceeded ${T10YIE_THRESHOLD}% for at least ${MIN_T10YIE_DAYS} consecutive business days. The 65-day minimum is 1 day beyond the 63-day lookback used by detectInflationary (TIP/TLT momentum, commodity confirmation) — windows shorter than 65d cannot be reliably detected because the signal hasn't had time to accumulate within the window. T10YIE is the spread between 10-year nominal Treasury yield and 10-year TIPS yield — directly analogous to the TIP/TLT ratio our detector uses. Using market-based T10YIE rather than BLS CPI because our detector measures forward-looking bond-market inflation expectations, not backward-looking price indices. The 2008 oil shock (CPI > 4%) is naturally excluded: T10YIE never sustained above 2.5% for 65+ days because bond markets (TLT) were rallying as a flight-to-quality trade. GENERATED BY scripts/generate-episode-targets.ts — do not hand-edit.`,
    dateSource: `FRED series T10YIE (10-Year Breakeven Inflation Rate) via FRED CSV endpoint. Criterion: T10YIE > ${T10YIE_THRESHOLD}% sustained >= ${MIN_T10YIE_DAYS} consecutive business days (> 63-day detector lookback). Generated: ${new Date().toISOString().slice(0, 10)}.`,
    generatedAt: new Date().toISOString(),
    thresholds: { t10yieAbove: T10YIE_THRESHOLD },
    eventWindows: t10yieWindows,
    passCriterion: `Detector fires within 25 trading days of window start. Coverage >= 30% of window required. 30% (not higher) because our TIP/TLT-based signal leads T10YIE crossings and may deactivate before T10YIE falls back below ${T10YIE_THRESHOLD}%.`,
  });

  // ── 3. Crisis: NBER recession dates (hardcoded — human committee decisions) ─

  // These are authoritative declarations from the NBER Business Cycle Dating
  // Committee. They cannot be computed from market data — they are determined
  // by a committee vote after the fact. We hardcode them and document the source.
  // Verify at: https://www.nber.org/research/data/us-business-cycle-expansions-and-contractions
  const nberRecessions: EpisodeWindow[] = [
    {
      start: "2007-12-01",
      end: "2009-06-30",
      label: "NBER recession: peak Dec 2007 → trough Jun 2009 (GFC). Declared Nov 28 2008.",
      severity: "severe",
      tier: "nber",
    },
    {
      start: "2020-02-01",
      end: "2020-04-30",
      label: "NBER recession: peak Feb 2020 → trough Apr 2020 (COVID). Declared Jun 8 2020.",
      severity: "severe",
      tier: "nber",
    },
  ];

  // NBER-silent bear markets: significant SPY drawdowns where NBER never declared
  // a recession.  NBER silence is itself informative — it means the drawdown was
  // driven by valuation/monetary tightening rather than a broad macroeconomic
  // contraction.  The crisis detector is expected to fire (we don't silently ignore
  // a -25% market) but at mild or moderate severity, not severe.
  //
  // Pass criteria for nber-silent windows are relaxed: entry-only check
  // (detector fires within 30 trading days of SPY -15% anchor), no coverage
  // floor, no severity expectation.  The observed severity is logged.
  const nberSilentEpisodes: EpisodeWindow[] = [
    {
      start: "2022-01-03",
      end: "2022-10-13",
      label: "2022 rate-hike bear market — NBER silent. SPY -25.4% peak-to-trough (Jan 3 → Oct 13 2022). Fed raised 425bps across 7 hikes. NBER never declared a recession.",
      tier: "nber-silent",
    },
  ];

  writeTarget("crisis-regime-dates.json", {
    regime: "crisis",
    description: `Two-tier crisis episode list. Tier "nber": NBER Business Cycle Dating Committee recession dates — authoritative human declarations, hardcoded and verified against the NBER website. The crisis detector anchors on the first SPY -15% drawdown within the window (equity markets lead NBER declarations by 1-6 months). Tier "nber-silent": significant bear markets where NBER was silent — included to verify the detector does not silently ignore large drawdowns; pass criteria are relaxed (entry-only, no coverage floor, no severity expectation). GENERATED BY scripts/generate-episode-targets.ts — do not hand-edit.`,
    dateSource: `NBER tier: NBER Business Cycle Dating Committee. https://www.nber.org/research/data/us-business-cycle-expansions-and-contractions. NBER-silent tier: market-structure events hardcoded in script. Generated: ${new Date().toISOString().slice(0, 10)}.`,
    generatedAt: new Date().toISOString(),
    eventWindows: [...nberRecessions, ...nberSilentEpisodes],
    passCriterion: `nber tier: detector fires within 10 trading days of SPY -15% anchor; coverage >= 40% required. nber-silent tier: detector fires within 30 trading days of SPY -15% anchor; no coverage or severity requirement — observed severity is logged.`,
  });

  // ── 4. QE: FOMC LSAP program dates (hardcoded — policy decisions) ──────────

  // FOMC announcement dates and program end dates are human policy decisions.
  // The market-response window start is anchored to the SPY trough for QE1
  // (the equity-momentum signal cannot fire during an active crash) and to the
  // FOMC announcement date for subsequent programs (market was already in risk-on).
  // Verify FOMC dates at: https://www.federalreserve.gov/monetarypolicy/bst_openmarketops.htm
  const qePrograms = [
    {
      start: "2009-06-01",
      end: "2010-08-31",
      label: `QE1 market response window: Jun 1 2009 (≈63 trading days after Mar 9 2009 SPY trough, when 63-day momentum lookback is fully post-trough) → Aug 31 2010 (MBS + agency purchases concluded Aug 2010). FOMC announced Nov 25 2008. Verified from Fed open market operations page.`,
      severity: "moderate",
    },
    {
      start: "2010-11-03",
      end: "2011-06-30",
      label: `QE2: FOMC announced Nov 3 2010. $600B Treasuries at $75B/month. Purchases concluded Jun 30 2011. Verified from Fed open market operations page.`,
      severity: "mild",
    },
    {
      start: "2012-09-13",
      end: "2014-10-29",
      label: `QE3: FOMC announced Sep 13 2012. Open-ended ($85B/month). Taper began Dec 2013. Final purchase Oct 29 2014. Verified from Fed open market operations page.`,
      severity: "moderate",
    },
    {
      start: "2020-03-23",
      end: "2022-03-16",
      label: `Post-COVID QE: Unlimited LSAP announced Mar 23 2020 (emergency FOMC). Balance sheet peaked ~$9T Jun 2022. First rate hike Mar 16 2022 (effective end of expansion posture). Verified from Fed open market operations page.`,
      severity: "severe",
    },
  ];

  writeTarget("qe-regime-dates.json", {
    regime: "qe",
    description: `Federal Reserve LSAP (quantitative easing) program dates from FOMC press releases, verified against the Fed open market operations page. QE1 window starts at the SPY trough (Jun 2009) rather than the announcement date (Nov 2008) because our equity-momentum signal cannot fire while the market is in freefall. Subsequent program windows start at the FOMC announcement date since the market was already in risk-on mode. Operation Twist (Sep 2011 – Dec 2012) excluded (balance-sheet neutral). Reinvestment periods excluded (no net expansion). GENERATED BY scripts/generate-episode-targets.ts — do not hand-edit.`,
    dateSource: `Federal Reserve FOMC press releases and open market operations page. https://www.federalreserve.gov/monetarypolicy/bst_openmarketops.htm. Hardcoded in script — human policy decisions cannot be computed. Generated: ${new Date().toISOString().slice(0, 10)}.`,
    generatedAt: new Date().toISOString(),
    eventWindows: qePrograms,
    passCriterion: `Detector fires within 90 trading days of window start. No coverage requirement — the QE signal builds gradually as monetary stimulus flows into equity momentum and decorrelation signals.`,
  });

  // ── 5. Choppy: no primary source ─────────────────────────────────────────

  writeTarget("choppy-regime-dates.json", {
    regime: "choppy",
    description: `No primary source with dated 'choppy' regime episodes exists. Lo & MacKinlay (1988) provides the variance ratio test methodology but tests the full sample — it does not identify specific sub-periods. No convergence tests are generated for this regime. GENERATED BY scripts/generate-episode-targets.ts — do not hand-edit.`,
    dateSource: `None. No computable or authoritative primary source for dated choppy episodes.`,
    generatedAt: new Date().toISOString(),
    eventWindows: [],
    passCriterion: `No convergence test. Validated by calibration rate and by absence during well-defined trending regimes.`,
  });

  console.log(`\n=== Done. Re-run this script whenever source data or thresholds change. ===\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
