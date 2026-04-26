/**
 * Convergence tests — verify detectors fire during primary-source-dated episodes.
 *
 * Each target file in testdata/targets/ lists episodes dated from a primary
 * academic or government source:
 *   - crisis:       Two-tier list:
 *                     "nber" — NBER Business Cycle Dating Committee recession dates
 *                     "nber-silent" — significant bear markets where NBER was silent
 *                       (2022 rate-hike bear). Relaxed pass criteria: entry-only,
 *                       no coverage floor, observed severity logged.
 *   - volatile:     CBOE VIX daily close > 30 sustained >= 10 trading days
 *   - inflationary: FRED T10YIE (10-year breakeven) > 2.5% sustained >= 65 days
 *   - qe:           Federal Reserve FOMC LSAP program announcement/end dates (WALCL)
 *   - choppy:       No primary source with dated episodes exists — empty eventWindows,
 *                   so no convergence tests are generated for that regime.
 *
 * Requires testdata/benchmark-data-full.json (5644+ days of market data).
 * If the file is missing, tests are skipped with an informative message.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { classifyRegimeSeries } from "../src/classify";
import type { BenchmarkDataWithDates, RegimeType } from "../src/types";

const TESTDATA_PATH = path.join(__dirname, "testdata/benchmark-data-full.json");
const TARGETS_DIR = path.join(__dirname, "testdata/targets");

interface EventWindow {
  start: string;
  end: string;
  label: string;
  severity?: string;
  /** "nber" (default) = strict; "nber-silent" = entry-only, no coverage */
  tier?: "nber" | "nber-silent";
}

interface TargetFile {
  regime: string;
  eventWindows: EventWindow[];
}

interface DetectedWindow {
  start: string;
  end: string;
  severity: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function countTradingDays(from: string, to: string): number {
  const d1 = new Date(from + "T00:00:00Z");
  const d2 = new Date(to + "T00:00:00Z");
  if (d2 <= d1) return 0;
  let count = 0;
  const d = new Date(d1);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d <= d2) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

function tradingDatesInRange(start: string, end: string): string[] {
  const result: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  const endD = new Date(end + "T00:00:00Z");
  while (d <= endD) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) {
      result.push(d.toISOString().slice(0, 10));
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return result;
}

function findMinus15Date(
  dates: string[],
  spyPrices: number[],
  windowStart: string,
  windowEnd: string
): string | null {
  for (let i = 0; i < dates.length; i++) {
    if (dates[i]! < windowStart) continue;
    if (dates[i]! > windowEnd) break;
    const lookbackStart = Math.max(0, i - 251);
    let high252 = -Infinity;
    for (let j = lookbackStart; j <= i; j++) {
      if (spyPrices[j]! > high252) high252 = spyPrices[j]!;
    }
    const drawdown = (spyPrices[i]! - high252) / high252;
    if (drawdown <= -0.15) return dates[i]!;
  }
  return null;
}

function buildDetectedWindows(
  dates: string[],
  regimeSeries: Array<Record<RegimeType, { active: boolean; severity: string }>>,
  regime: RegimeType
): DetectedWindow[] {
  const windows: DetectedWindow[] = [];
  let current: { start: string; severity: string } | null = null;

  for (let i = 0; i < dates.length; i++) {
    const result = regimeSeries[i]![regime];
    if (result.active) {
      if (!current) {
        current = { start: dates[i]!, severity: result.severity };
      } else if (result.severity !== current.severity) {
        windows.push({ start: current.start, end: dates[i - 1]!, severity: current.severity });
        current = { start: dates[i]!, severity: result.severity };
      }
    } else {
      if (current) {
        windows.push({ start: current.start, end: dates[i - 1]!, severity: current.severity });
        current = null;
      }
    }
  }
  if (current) {
    windows.push({ start: current.start, end: dates[dates.length - 1]!, severity: current.severity });
  }
  return windows;
}

function buildDetectedDateSet(windows: DetectedWindow[]): Set<string> {
  const set = new Set<string>();
  for (const w of windows) {
    const d = new Date(w.start + "T00:00:00Z");
    const end = new Date(w.end + "T00:00:00Z");
    while (d <= end) {
      set.add(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }
  return set;
}

function findFirstDetectionOnOrAfter(windows: DetectedWindow[], targetDate: string): string | null {
  const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start));
  for (const w of sorted) {
    if (w.end < targetDate) continue;
    return w.start >= targetDate ? w.start : targetDate;
  }
  return null;
}

// ─── Test suite ─────────────────────────────────────────────────────────

const hasTestData = fs.existsSync(TESTDATA_PATH);
const hasTargets = fs.existsSync(TARGETS_DIR);

describe.skipIf(!hasTestData || !hasTargets)("smoke: detectors fire during known market events", () => {
  let benchmarkData: BenchmarkDataWithDates;
  let regimeSeries: Array<Record<RegimeType, { active: boolean; severity: string; score: number; signals: Record<string, number> }>>;

  beforeAll(() => {
    benchmarkData = JSON.parse(fs.readFileSync(TESTDATA_PATH, "utf-8"));
    regimeSeries = classifyRegimeSeries(benchmarkData);
  });

  const REGIME_CONFIGS: Array<{
    regime: RegimeType;
    maxEntryLag: number;
    requireCoverage: boolean;
    minCoverage: number;
  }> = [
    // Crisis: tighter activation gates mean lower coverage for sustained bears.
    // Acute events (GFC, COVID) still get high coverage; grinding bears get less.
    { regime: "crisis", maxEntryLag: 10, requireCoverage: true, minCoverage: 0.40 },
    // Volatile: requires vol ≥ 20% annualized gate, so calm tails of windows won't activate.
    // 15d entry lag because confirmation hysteresis can delay initial activation.
    { regime: "volatile", maxEntryLag: 15, requireCoverage: true, minCoverage: 0.50 },
    // Inflationary: requires TIP/TLT + bonds weak + commodity confirmation.
    // 25d entry lag because inflation signals build gradually (63d lookback).
    // 30% coverage (not 50%): market signals (TIP/TLT, commodities) are forward-looking
    // and deactivate months before CPI falls back below 4%. The BLS-dated window is
    // longer than the window our market signals stay elevated. See target file.
    { regime: "inflationary", maxEntryLag: 25, requireCoverage: true, minCoverage: 0.30 },
    { regime: "choppy", maxEntryLag: 15, requireCoverage: false, minCoverage: 0 },
    // QE: 90d entry lag because monetary policy effects take time to manifest
    // in equity momentum + decorrelation signals.
    { regime: "qe", maxEntryLag: 90, requireCoverage: false, minCoverage: 0 },
  ];

  for (const config of REGIME_CONFIGS) {
    const targetPath = path.join(TARGETS_DIR, `${config.regime}-regime-dates.json`);
    if (!fs.existsSync(targetPath)) continue;

    const target: TargetFile = JSON.parse(fs.readFileSync(targetPath, "utf-8"));
    if (target.eventWindows.length === 0) continue; // no episodes to test (e.g. choppy)

    describe(config.regime, () => {
      for (const gt of target.eventWindows) {
        const tier = gt.tier ?? "nber";
        const isSilent = tier === "nber-silent";

        // nber-silent: 3x entry lag, no coverage, observed severity logged
        const effectiveMaxLag = isSilent ? config.maxEntryLag * 3 : config.maxEntryLag;
        const effectiveRequireCoverage = config.requireCoverage && !isSilent;

        const tierTag = isSilent ? " [NBER-silent — entry-only]" : "";
        const coverageTag = effectiveRequireCoverage
          ? ` + ${(config.minCoverage * 100).toFixed(0)}% coverage`
          : "";

        it(`${gt.label}: entry within ${effectiveMaxLag} trading days${coverageTag}${tierTag}`, () => {
          // Determine anchor date
          let anchorDate: string;
          if (config.regime === "crisis") {
            const minus15 = findMinus15Date(benchmarkData.dates, benchmarkData.spy.prices, gt.start, gt.end);
            anchorDate = minus15 ?? gt.start;
          } else {
            anchorDate = gt.start;
          }

          const detectedWindows = buildDetectedWindows(benchmarkData.dates, regimeSeries, config.regime);
          const detectedDates = buildDetectedDateSet(detectedWindows);

          // Entry check (required for both tiers)
          const entryDate = findFirstDetectionOnOrAfter(detectedWindows, anchorDate);
          expect(entryDate, `No detection found for ${gt.label}`).not.toBeNull();
          expect(entryDate! <= gt.end, `Detection after window end`).toBe(true);

          const lag = countTradingDays(anchorDate, entryDate!);
          expect(lag, `Entry lag ${lag}d exceeds ${effectiveMaxLag}d`).toBeLessThanOrEqual(effectiveMaxLag);

          // nber-silent: log observed severity instead of asserting it
          if (isSilent) {
            const detectedInWindow = detectedWindows.filter(
              (w) => w.end >= anchorDate && w.start <= gt.end,
            );
            const severities = [...new Set(detectedInWindow.map((w) => w.severity))].join(", ");
            console.log(
              `[NBER-silent] ${gt.label.split("—")[0].trim()}: ` +
              `detected at ${entryDate} (${lag}d lag), severities observed: [${severities}]`,
            );
            return;
          }

          // Coverage check (nber tier only)
          if (effectiveRequireCoverage) {
            const tradingDays = tradingDatesInRange(anchorDate, gt.end);
            const covered = tradingDays.filter((d) => detectedDates.has(d)).length;
            const coveragePct = tradingDays.length > 0 ? covered / tradingDays.length : 0;
            expect(
              coveragePct,
              `Coverage ${(coveragePct * 100).toFixed(0)}% < ${(config.minCoverage * 100).toFixed(0)}%`,
            ).toBeGreaterThanOrEqual(config.minCoverage);
          }
        });
      }
    });
  }
});
