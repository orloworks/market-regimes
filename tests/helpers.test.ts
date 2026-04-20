import { describe, it, expect } from "vitest";
import {
  clamp,
  dailyReturns,
  SMA,
  countCrossovers,
  percentileRank,
  averageStreakLength,
  variance,
} from "../src/helpers";

describe("clamp", () => {
  it("clamps below min", () => expect(clamp(-1, 0, 1)).toBe(0));
  it("clamps above max", () => expect(clamp(2, 0, 1)).toBe(1));
  it("passes through in range", () => expect(clamp(0.5, 0, 1)).toBe(0.5));
});

describe("dailyReturns", () => {
  it("computes simple returns", () => {
    const prices = [100, 110, 105];
    const returns = dailyReturns(prices);
    expect(returns).toHaveLength(2);
    expect(returns[0]).toBeCloseTo(0.10);
    expect(returns[1]).toBeCloseTo(-0.04545, 4);
  });

  it("returns empty for single price", () => {
    expect(dailyReturns([100])).toHaveLength(0);
  });
});

describe("SMA", () => {
  it("computes correct moving average", () => {
    const prices = [1, 2, 3, 4, 5];
    const sma3 = SMA(prices, 3);
    expect(sma3[0]).toBeNaN();
    expect(sma3[1]).toBeNaN();
    expect(sma3[2]).toBeCloseTo(2);
    expect(sma3[3]).toBeCloseTo(3);
    expect(sma3[4]).toBeCloseTo(4);
  });
});

describe("countCrossovers", () => {
  it("counts price/SMA crossings", () => {
    // Price oscillates above and below a flat SMA
    const prices = [10, 12, 8, 11, 7, 13];
    const sma = [10, 10, 10, 10, 10, 10];
    const crosses = countCrossovers(prices, sma, 6);
    expect(crosses).toBe(5); // crosses at indices 1, 2, 3, 4, 5
  });

  it("returns 0 for monotonic", () => {
    const prices = [11, 12, 13, 14, 15];
    const sma = [10, 10, 10, 10, 10];
    expect(countCrossovers(prices, sma, 5)).toBe(0);
  });
});

describe("percentileRank", () => {
  it("ranks value in distribution", () => {
    const dist = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentileRank(5, dist)).toBeCloseTo(0.4);
    expect(percentileRank(10, dist)).toBeCloseTo(0.9);
    expect(percentileRank(1, dist)).toBeCloseTo(0.0);
  });

  it("filters NaN values", () => {
    const dist = [1, NaN, 2, NaN, 3];
    expect(percentileRank(2, dist)).toBeCloseTo(1 / 3);
  });

  it("returns NaN for empty distribution", () => {
    expect(percentileRank(5, [])).toBeNaN();
  });
});

describe("averageStreakLength", () => {
  it("computes average streak for alternating returns", () => {
    // Alternating: each streak is 1 day
    const returns = [0.01, -0.01, 0.01, -0.01, 0.01, -0.01];
    expect(averageStreakLength(returns)).toBeCloseTo(1.0);
  });

  it("computes average streak for trending returns", () => {
    // All positive: one long streak
    const returns = [0.01, 0.02, 0.01, 0.03, 0.01];
    expect(averageStreakLength(returns)).toBe(5);
  });

  it("returns 0 for empty array", () => {
    expect(averageStreakLength([])).toBe(0);
  });
});

describe("variance", () => {
  it("computes population variance", () => {
    const arr = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(variance(arr)).toBeCloseTo(4.0);
  });
});
