import { mean, kurtosis } from "nanuquant-ts";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function dailyReturns(prices: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    r.push((prices[i]! - prices[i - 1]!) / prices[i - 1]!);
  }
  return r;
}

export function SMA(prices: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += prices[j]!;
      result.push(sum / period);
    }
  }
  return result;
}

export function countCrossovers(prices: number[], sma: number[], window: number): number {
  let crossCount = 0;
  const start = Math.max(0, prices.length - window);
  for (let i = start + 1; i < prices.length; i++) {
    if (isNaN(sma[i]!) || isNaN(sma[i - 1]!)) continue;
    const prevAbove = prices[i - 1]! > sma[i - 1]!;
    const currAbove = prices[i]! > sma[i]!;
    if (prevAbove !== currAbove) crossCount++;
  }
  return crossCount;
}

export function percentileRank(value: number, distribution: number[]): number {
  const valid = distribution.filter((x) => !isNaN(x));
  if (valid.length === 0) return NaN;
  const below = valid.filter((x) => x < value).length;
  return below / valid.length;
}

export function averageStreakLength(returns: number[]): number {
  if (returns.length === 0) return 0;
  const streaks: number[] = [];
  let currentLen = 1;
  for (let i = 1; i < returns.length; i++) {
    if ((returns[i]! >= 0) === (returns[i - 1]! >= 0)) {
      currentLen++;
    } else {
      streaks.push(currentLen);
      currentLen = 1;
    }
  }
  streaks.push(currentLen);
  return streaks.length > 0 ? streaks.reduce((a, b) => a + b, 0) / streaks.length : 0;
}

export function variance(arr: number[]): number {
  const m = mean(arr);
  return mean(arr.map((x) => (x - m) ** 2));
}

export function excessKurtosis(returns: number[]): number {
  return kurtosis(returns);
}

export function rollingKurtosis(returns: number[], window: number): number[] {
  const result: number[] = [];
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
