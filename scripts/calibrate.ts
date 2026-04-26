/**
 * Calibration script — measure activation rates and spot-check known events.
 * Run with: bun run scripts/calibrate.ts
 */
import * as fs from "fs";
import * as path from "path";
import { classifyRegimeSeries } from "../src/classify";
import type { BenchmarkDataWithDates, RegimeType } from "../src/types";
import { REGIME_TYPES } from "../src/types";

const TESTDATA_PATH = path.join(__dirname, "../tests/testdata/benchmark-data-full.json");

function main() {
  const data: BenchmarkDataWithDates = JSON.parse(fs.readFileSync(TESTDATA_PATH, "utf-8"));
  console.log(`Dataset: ${data.dates.length} days, ${data.dates[0]} to ${data.dates[data.dates.length - 1]}`);

  console.log("\nRunning classifyRegimeSeries...");
  const series = classifyRegimeSeries(data);

  // ── Activation rates ──
  console.log("\n=== Activation Rates ===");
  const rates: Record<string, number> = {};
  for (const rt of REGIME_TYPES) {
    const activeDays = series.filter((d) => d[rt].active).length;
    const rate = activeDays / series.length;
    rates[rt] = rate;
    const severityCounts = { mild: 0, moderate: 0, severe: 0 };
    for (const d of series) {
      if (d[rt].severity === "mild") severityCounts.mild++;
      if (d[rt].severity === "moderate") severityCounts.moderate++;
      if (d[rt].severity === "severe") severityCounts.severe++;
    }
    console.log(
      `  ${rt.padEnd(16)} ${(rate * 100).toFixed(1)}% active ` +
      `(${activeDays}/${series.length}) ` +
      `[mild=${severityCounts.mild}, mod=${severityCounts.moderate}, sev=${severityCounts.severe}]`
    );
  }

  // ── Spot-check known events ──
  console.log("\n=== Spot-Check: Known Events ===");

  const checkEvent = (label: string, dateRange: [string, string], expectedRegimes: RegimeType[]) => {
    const startIdx = data.dates.indexOf(dateRange[0]) >= 0 ? data.dates.indexOf(dateRange[0]) : data.dates.findIndex(d => d >= dateRange[0]);
    const endIdx = data.dates.findIndex(d => d > dateRange[1]) - 1;
    if (startIdx < 0 || endIdx < 0) {
      console.log(`  ${label}: dates not in dataset`);
      return;
    }
    const days = endIdx - startIdx + 1;
    console.log(`  ${label} (${dateRange[0]} to ${dateRange[1]}, ${days} days):`);
    for (const rt of expectedRegimes) {
      let count = 0;
      for (let i = startIdx; i <= endIdx; i++) {
        if (series[i]![rt].active) count++;
      }
      const pct = days > 0 ? ((count / days) * 100).toFixed(0) : "0";
      console.log(`    ${rt.padEnd(16)} ${pct}% (${count}/${days})`);
    }
  };

  // Pre-2010 events
  checkEvent("Dot-com bear bottom (2002)", ["2002-08-01", "2002-10-31"], ["trendDrawdown", "volatile", "crisis"]);
  checkEvent("GFC (2008 Sep-Mar 2009)", ["2008-09-15", "2009-03-09"], ["crisis", "volatile", "trendDrawdown"]);
  checkEvent("Post-GFC QE (2009-2010)", ["2009-06-01", "2010-06-30"], ["qe"]);
  checkEvent("2011 US Debt Ceiling", ["2011-07-25", "2011-10-15"], ["volatile", "trendDrawdown"]);
  checkEvent("2015 China Deval", ["2015-08-18", "2015-09-30"], ["volatile", "newsDriven"]);
  checkEvent("Q4 2018 Selloff", ["2018-10-01", "2018-12-24"], ["volatile", "trendDrawdown"]);
  checkEvent("2019 Fed Pivot Bull", ["2019-06-01", "2019-12-31"], ["qe"]);

  // 2020+
  checkEvent("COVID crash", ["2020-02-20", "2020-04-01"], ["crisis", "volatile", "trendDrawdown"]);
  checkEvent("2020 Recovery/QE", ["2020-06-01", "2020-12-31"], ["qe"]);
  checkEvent("2021 H1 Inflation", ["2021-01-01", "2021-06-30"], ["inflationary"]);
  checkEvent("2022 H1 Rate Hiking", ["2022-01-01", "2022-06-30"], ["trendDrawdown", "inflationary"]);
  checkEvent("2022 Bear Market", ["2022-06-01", "2022-10-31"], ["trendDrawdown", "volatile", "crisis"]);
  checkEvent("2023 Bull Run", ["2023-06-01", "2023-12-31"], ["qe"]);
  checkEvent("2024 Bull Run", ["2024-06-01", "2024-12-31"], ["qe"]);
  checkEvent("Liberation Day (Apr 2025)", ["2025-04-02", "2025-04-15"], ["crisis", "volatile", "trendDrawdown"]);

  // ── Raw score distributions ──
  console.log("\n=== Raw Score Distributions (last 500 days) ===");
  const last500Start = Math.max(0, series.length - 500);
  for (const rt of REGIME_TYPES) {
    const scores = series.slice(last500Start).map(d => d[rt].score).filter(s => !isNaN(s));
    if (scores.length === 0) { console.log(`  ${rt}: no scores`); continue; }
    scores.sort((a, b) => a - b);
    const p25 = scores[Math.floor(scores.length * 0.25)]!;
    const p50 = scores[Math.floor(scores.length * 0.50)]!;
    const p75 = scores[Math.floor(scores.length * 0.75)]!;
    const p90 = scores[Math.floor(scores.length * 0.90)]!;
    console.log(
      `  ${rt.padEnd(16)} p25=${p25.toFixed(3)} p50=${p50.toFixed(3)} p75=${p75.toFixed(3)} p90=${p90.toFixed(3)}`
    );
  }
}

main();
