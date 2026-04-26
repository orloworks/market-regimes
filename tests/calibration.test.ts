/**
 * Calibration tests — verify activation rates fall within expected bands
 * and spot-check known market events.
 *
 * Requires testdata/benchmark-data-full.json (1500+ days of market data).
 * If the file is missing, tests are skipped with an informative message.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { classifyRegimeSeries } from "../src/classify";
import type { BenchmarkDataWithDates, RegimeType, RegimeResult } from "../src/types";
import { REGIME_TYPES } from "../src/types";

const TESTDATA_PATH = path.join(__dirname, "testdata/benchmark-data-full.json");
const hasTestData = fs.existsSync(TESTDATA_PATH);

describe.skipIf(!hasTestData)("calibration: activation rates within target bands", () => {
  let benchmarkData: BenchmarkDataWithDates;
  let regimeSeries: Array<Record<RegimeType, RegimeResult>>;

  beforeAll(() => {
    benchmarkData = JSON.parse(fs.readFileSync(TESTDATA_PATH, "utf-8"));
    regimeSeries = classifyRegimeSeries(benchmarkData);
  });

  function activationRate(regime: RegimeType): number {
    const active = regimeSeries.filter((d) => d[regime].active).length;
    return active / regimeSeries.length;
  }

  function coverageDuring(regime: RegimeType, startDate: string, endDate: string): number {
    const startIdx = benchmarkData.dates.findIndex((d) => d >= startDate);
    const endIdx = benchmarkData.dates.findIndex((d) => d > endDate) - 1;
    if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) return 0;
    const total = endIdx - startIdx + 1;
    let active = 0;
    for (let i = startIdx; i <= endIdx; i++) {
      if (regimeSeries[i]![regime].active) active++;
    }
    return active / total;
  }

  // ── Activation rate bands ──

  const TARGET_BANDS: Record<RegimeType, { min: number; max: number }> = {
    volatile: { min: 0.15, max: 0.35 },
    trendDrawdown: { min: 0.08, max: 0.25 },
    choppy: { min: 0.25, max: 0.45 },
    inflationary: { min: 0.10, max: 0.30 },
    qe: { min: 0.10, max: 0.30 },
    crisis: { min: 0.02, max: 0.12 },
    newsDriven: { min: 0.08, max: 0.25 },
  };

  for (const rt of REGIME_TYPES) {
    const band = TARGET_BANDS[rt];
    it(`${rt}: activation rate between ${(band.min * 100).toFixed(0)}% and ${(band.max * 100).toFixed(0)}%`, () => {
      const rate = activationRate(rt);
      expect(rate, `${rt} rate ${(rate * 100).toFixed(1)}% below ${(band.min * 100).toFixed(0)}%`).toBeGreaterThanOrEqual(band.min);
      expect(rate, `${rt} rate ${(rate * 100).toFixed(1)}% above ${(band.max * 100).toFixed(0)}%`).toBeLessThanOrEqual(band.max);
    });
  }

  // ── Known event spot-checks ──

  // ── Pre-2020 events ──

  it("GFC (Sep 2008 - Mar 2009): crisis, volatile, and trendDrawdown should dominate", () => {
    const crisisCov = coverageDuring("crisis", "2008-09-15", "2009-03-09");
    const volCov = coverageDuring("volatile", "2008-09-15", "2009-03-09");
    const tdCov = coverageDuring("trendDrawdown", "2008-09-15", "2009-03-09");
    expect(crisisCov, "Crisis should cover ≥80% of GFC").toBeGreaterThanOrEqual(0.80);
    expect(volCov, "Volatile should cover ≥80% of GFC").toBeGreaterThanOrEqual(0.80);
    expect(tdCov, "TrendDrawdown should cover ≥80% of GFC").toBeGreaterThanOrEqual(0.80);
  });

  it("2011 Debt Ceiling: volatile should activate", () => {
    const volCov = coverageDuring("volatile", "2011-07-25", "2011-10-15");
    expect(volCov, "Volatile should cover ≥60% of 2011 debt ceiling").toBeGreaterThanOrEqual(0.60);
  });

  it("2015 China Devaluation: volatile and newsDriven should activate", () => {
    const volCov = coverageDuring("volatile", "2015-08-18", "2015-09-30");
    expect(volCov, "Volatile should cover ≥60% of China deval").toBeGreaterThanOrEqual(0.60);
  });

  // ── Post-2020 events ──

  it("COVID crash (Feb-Apr 2020): crisis and volatile should activate", () => {
    const crisisCov = coverageDuring("crisis", "2020-02-20", "2020-04-01");
    const volCov = coverageDuring("volatile", "2020-02-20", "2020-04-01");
    expect(crisisCov, "Crisis should cover ≥40% of COVID crash").toBeGreaterThanOrEqual(0.40);
    expect(volCov, "Volatile should cover ≥60% of COVID crash").toBeGreaterThanOrEqual(0.60);
  });

  it("2020 Recovery (Jun-Dec 2020): QE should activate", () => {
    const qeCov = coverageDuring("qe", "2020-06-01", "2020-12-31");
    expect(qeCov, "QE should cover ≥30% of 2020 recovery").toBeGreaterThanOrEqual(0.30);
  });

  it("2021 H1 Inflation: inflationary should dominate", () => {
    const inflCov = coverageDuring("inflationary", "2021-01-01", "2021-06-30");
    expect(inflCov, "Inflationary should cover ≥60% of 2021 H1").toBeGreaterThanOrEqual(0.60);
  });

  it("2022 Bear Market (Jun-Oct 2022): trendDrawdown should dominate", () => {
    const tdCov = coverageDuring("trendDrawdown", "2022-06-01", "2022-10-31");
    const volCov = coverageDuring("volatile", "2022-06-01", "2022-10-31");
    expect(tdCov, "TrendDrawdown should cover ≥80% of 2022 bear").toBeGreaterThanOrEqual(0.80);
    expect(volCov, "Volatile should cover ≥60% of 2022 bear").toBeGreaterThanOrEqual(0.60);
  });

  it("Liberation Day (Apr 2025): volatile and trendDrawdown should activate", () => {
    const volCov = coverageDuring("volatile", "2025-04-02", "2025-04-15");
    const tdCov = coverageDuring("trendDrawdown", "2025-04-02", "2025-04-15");
    expect(volCov, "Volatile should cover ≥80% of Liberation Day").toBeGreaterThanOrEqual(0.80);
    expect(tdCov, "TrendDrawdown should cover ≥50% of Liberation Day").toBeGreaterThanOrEqual(0.50);
  });

  it("2024 Bull Run (Jun-Dec 2024): crisis should NOT be active", () => {
    const crisisCov = coverageDuring("crisis", "2024-06-01", "2024-12-31");
    expect(crisisCov, "Crisis should be <5% during 2024 bull").toBeLessThan(0.05);
  });
});
