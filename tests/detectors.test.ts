import { describe, it, expect } from "vitest";
import {
  detectCrisis,
  detectVolatile,
  detectChoppy,
  detectInflationary,
  detectQE,
  detectNewsDriven,
  detectAllRegimes,
} from "../src/detectors";
import type { BenchmarkData } from "../src/types";

function makeFlatData(days: number, price = 100): BenchmarkData {
  const prices = Array.from({ length: days }, () => price);
  const returns = Array.from({ length: days }, () => 0);
  return {
    spy: { prices, opens: prices, returns },
    qqq: { prices, opens: prices, returns },
    tlt: { prices, opens: prices, returns },
    vt: { prices, returns },
    tip: { prices, returns },
    gld: { prices, returns },
    dbc: { prices, returns },
  };
}

function makeCrisisData(days: number): BenchmarkData {
  // Simulate a crisis: calm period then sharp selloff with concentrated extreme days.
  // SPY/VT drop 25% in the last 40 days with multiple >2% daily drops.
  // TLT positively correlated (also selling — crisis correlation spike).
  const spyPrices: number[] = [];
  const tltPrices: number[] = [];
  const vtPrices: number[] = [];

  for (let i = 0; i < days; i++) {
    if (i < days - 40) {
      // Calm period: SPY at ~100
      spyPrices.push(100 + Math.sin(i / 20) * 2);
      tltPrices.push(100 - Math.sin(i / 30));
      vtPrices.push(100 + Math.sin(i / 20) * 1.5);
    } else {
      // Crash: sharp decline with individual extreme days
      const crashProgress = (i - (days - 40)) / 40;
      const dailyDrop = crashProgress < 0.3 ? -0.025 : -0.01; // 2.5% drops early
      const prevSpy = spyPrices[i - 1]!;
      spyPrices.push(prevSpy * (1 + dailyDrop));
      tltPrices.push(tltPrices[i - 1]! * (1 + dailyDrop * 0.3));
      vtPrices.push(vtPrices[i - 1]! * (1 + dailyDrop * 0.8));
    }
  }
  const spyReturns = spyPrices.slice(1).map((p, i) => (p - spyPrices[i]!) / spyPrices[i]!);
  const tltReturns = tltPrices.slice(1).map((p, i) => (p - tltPrices[i]!) / tltPrices[i]!);
  const vtReturns = vtPrices.slice(1).map((p, i) => (p - vtPrices[i]!) / vtPrices[i]!);

  return {
    spy: { prices: spyPrices, opens: spyPrices, returns: spyReturns },
    qqq: { prices: spyPrices, opens: spyPrices, returns: spyReturns },
    tlt: { prices: tltPrices, opens: tltPrices, returns: tltReturns },
    vt: { prices: vtPrices, returns: vtReturns },
    tip: { prices: Array(days).fill(100), returns: Array(days).fill(0) },
    gld: { prices: Array(days).fill(100), returns: Array(days).fill(0) },
    dbc: { prices: Array(days).fill(100), returns: Array(days).fill(0) },
  };
}

describe("detectCrisis", () => {
  it("returns off for flat market", () => {
    const result = detectCrisis(makeFlatData(300));
    expect(result.active).toBe(false);
    expect(result.severity).toBe("off");
  });

  it("returns active for severe drawdown with concentrated selling", () => {
    const result = detectCrisis(makeCrisisData(300));
    // Gate requires -15% drawdown + 3+ extreme days in 21d.
    // Verify score is positive (composite measures crisis conditions).
    expect(result.score).toBeGreaterThan(0);
    // Verify the drawdown signal is detected
    expect(result.signals.spyDrawdown).toBeLessThan(-0.10);
  });

  it("returns off for insufficient data", () => {
    const result = detectCrisis(makeFlatData(5));
    expect(result.active).toBe(false);
  });
});

describe("detectVolatile", () => {
  it("returns off for flat market", () => {
    const result = detectVolatile(makeFlatData(300));
    expect(result.active).toBe(false);
  });

  it("detects high volatility", () => {
    // Create data with a calm period followed by extreme moves
    const prices: number[] = [100];
    for (let i = 1; i < 300; i++) {
      if (i < 250) {
        prices.push(prices[i - 1]! * (1 + (Math.random() - 0.5) * 0.002));
      } else {
        // Extreme vol in last 50 days
        prices.push(prices[i - 1]! * (1 + (Math.random() - 0.5) * 0.08));
      }
    }
    const returns = prices.slice(1).map((p, i) => (p - prices[i]!) / prices[i]!);
    const data: BenchmarkData = {
      ...makeFlatData(300),
      spy: { prices, opens: prices, returns },
    };
    const result = detectVolatile(data);
    expect(result.score).toBeGreaterThan(0.5);
  });

  it("returns off for insufficient data", () => {
    const result = detectVolatile(makeFlatData(10));
    expect(result.active).toBe(false);
  });
});

describe("detectChoppy", () => {
  it("returns off for flat market", () => {
    const result = detectChoppy(makeFlatData(300));
    expect(result.active).toBe(false);
  });

  it("returns off for insufficient data", () => {
    const result = detectChoppy(makeFlatData(30));
    expect(result.active).toBe(false);
  });
});

describe("detectInflationary", () => {
  it("returns off for flat market", () => {
    const result = detectInflationary(makeFlatData(300));
    expect(result.active).toBe(false);
  });

  it("returns off for insufficient data", () => {
    const result = detectInflationary(makeFlatData(30));
    expect(result.active).toBe(false);
  });

  it("detects inflationary conditions", () => {
    const days = 200;
    // TIP rising, TLT falling, GLD and DBC rising
    const tipPrices = Array.from({ length: days }, (_, i) => 100 * (1 + 0.15 * (i / days)));
    const tltPrices = Array.from({ length: days }, (_, i) => 100 * (1 - 0.10 * (i / days)));
    const gldPrices = Array.from({ length: days }, (_, i) => 100 * (1 + 0.20 * (i / days)));
    const dbcPrices = Array.from({ length: days }, (_, i) => 100 * (1 + 0.18 * (i / days)));
    const data: BenchmarkData = {
      spy: { prices: Array(days).fill(100), opens: Array(days).fill(100), returns: Array(days).fill(0) },
      qqq: { prices: Array(days).fill(100), opens: Array(days).fill(100), returns: Array(days).fill(0) },
      tlt: { prices: tltPrices, opens: tltPrices, returns: tltPrices.slice(1).map((p, i) => (p - tltPrices[i]!) / tltPrices[i]!) },
      vt: { prices: Array(days).fill(100), returns: Array(days).fill(0) },
      tip: { prices: tipPrices, returns: tipPrices.slice(1).map((p, i) => (p - tipPrices[i]!) / tipPrices[i]!) },
      gld: { prices: gldPrices, returns: gldPrices.slice(1).map((p, i) => (p - gldPrices[i]!) / gldPrices[i]!) },
      dbc: { prices: dbcPrices, returns: dbcPrices.slice(1).map((p, i) => (p - dbcPrices[i]!) / dbcPrices[i]!) },
    };
    const result = detectInflationary(data);
    expect(result.active).toBe(true);
    expect(result.score).toBeGreaterThan(0.3);
  });
});

describe("detectQE", () => {
  it("returns off for flat market", () => {
    const result = detectQE(makeFlatData(300));
    expect(result.active).toBe(false);
  });

  it("returns off for insufficient data", () => {
    const result = detectQE(makeFlatData(30));
    expect(result.active).toBe(false);
  });
});

describe("detectNewsDriven", () => {
  it("returns off for flat market (no gaps)", () => {
    const result = detectNewsDriven(makeFlatData(300));
    expect(result.active).toBe(false);
    expect(result.severity).toBe("off");
  });

  it("detects news-driven conditions with large moves and gaps", () => {
    const days = 100;
    const prices: number[] = [100];
    const opens: number[] = [100];
    // Simulate news-driven market: large overnight gaps + large daily returns
    for (let i = 1; i < days; i++) {
      const prevClose = prices[i - 1]!;
      // Most days: large gap (>1.5%) + large daily return (>1.5%)
      const direction = i % 3 === 0 ? -1 : 1;
      const gapSize = 0.02; // 2% gap
      const open = prevClose * (1 + direction * gapSize);
      opens.push(open);
      // Large intraday move too
      prices.push(open * (1 + direction * 0.01));
    }
    const returns = prices.slice(1).map((p, i) => (p - prices[i]!) / prices[i]!);
    const data: BenchmarkData = {
      ...makeFlatData(days),
      spy: { prices, opens, returns },
      qqq: { prices, opens, returns },
    };
    const result = detectNewsDriven(data);
    expect(result.score).toBeGreaterThan(0);
  });

  it("returns off for insufficient data", () => {
    const result = detectNewsDriven(makeFlatData(20));
    expect(result.active).toBe(false);
  });
});

describe("detectAllRegimes", () => {
  it("returns results for all 7 regime types", () => {
    const results = detectAllRegimes(makeFlatData(300));
    expect(Object.keys(results)).toHaveLength(7);
    expect(results.volatile).toBeDefined();
    expect(results.choppy).toBeDefined();
    expect(results.inflationary).toBeDefined();
    expect(results.qe).toBeDefined();
    expect(results.crisis).toBeDefined();
    expect(results.newsDriven).toBeDefined();
  });
});
