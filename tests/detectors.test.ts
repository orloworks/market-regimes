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
  // SPY declining 30% over the period, TLT positively correlated (also declining)
  const spyPrices: number[] = [];
  const tltPrices: number[] = [];
  const vtPrices: number[] = [];
  for (let i = 0; i < days; i++) {
    spyPrices.push(100 * (1 - 0.30 * (i / days)));
    tltPrices.push(100 * (1 - 0.10 * (i / days)));
    vtPrices.push(100 * (1 - 0.25 * (i / days)));
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

  it("returns active for severe drawdown", () => {
    const result = detectCrisis(makeCrisisData(300));
    expect(result.active).toBe(true);
    expect(result.score).toBeGreaterThan(0);
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
  it("always returns off (stub)", () => {
    const result = detectNewsDriven(makeFlatData(300));
    expect(result.active).toBe(false);
    expect(result.severity).toBe("off");
  });
});

describe("detectAllRegimes", () => {
  it("returns results for all 6 regime types", () => {
    const results = detectAllRegimes(makeFlatData(300));
    expect(Object.keys(results)).toHaveLength(6);
    expect(results.volatile).toBeDefined();
    expect(results.choppy).toBeDefined();
    expect(results.inflationary).toBeDefined();
    expect(results.qe).toBeDefined();
    expect(results.crisis).toBeDefined();
    expect(results.newsDriven).toBeDefined();
  });
});
