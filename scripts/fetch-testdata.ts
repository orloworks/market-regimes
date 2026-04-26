/**
 * Fetch benchmark data from Yahoo Finance and save as test data.
 * Run with: bun run scripts/fetch-testdata.ts
 */
import { fetchBenchmarkData } from "../src/fetch";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("Fetching benchmark data from Yahoo Finance (1999-01-01 to 2026-04-25)...");

  const data = await fetchBenchmarkData({
    startDate: "1999-01-01",
    endDate: "2026-04-25",
    rateLimitMs: 600,
    fetchM2: true,
  });

  console.log(`Got ${data.dates.length} trading days: ${data.dates[0]} to ${data.dates[data.dates.length - 1]}`);

  const outPath = path.join(__dirname, "../tests/testdata/benchmark-data-full.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data));
  console.log(`Wrote ${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MB to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
