export type RegimeType = "volatile" | "trendDrawdown" | "choppy" | "inflationary" | "qe" | "crisis" | "newsDriven";
export type Severity = "off" | "mild" | "moderate" | "severe";

export interface RegimeResult {
  active: boolean;
  severity: Severity;
  score: number;
  signals: Record<string, number>;
}

export interface BenchmarkData {
  spy: { prices: number[]; opens: number[]; returns: number[] };
  qqq: { prices: number[]; opens: number[]; returns: number[] };
  tlt: { prices: number[]; opens: number[]; returns: number[] };
  vt: { prices: number[]; returns: number[] };
  tip: { prices: number[]; returns: number[] };
  gld: { prices: number[]; returns: number[] };
  dbc: { prices: number[]; returns: number[] };
  /** M2 money supply from FRED (M2SL). Monthly, carried forward to daily. */
  m2?: { values: number[]; yoyGrowth: number[] };
}

export interface BenchmarkDataWithDates extends BenchmarkData {
  dates: string[];
}

export const REGIME_TYPES: RegimeType[] = ["volatile", "trendDrawdown", "choppy", "inflationary", "qe", "crisis", "newsDriven"];

/** Current detector logic version — bump when detector logic changes */
export const REGIME_DETECTOR_VERSION = 6;

export const CONFIRMATION_RULES: Record<RegimeType, { activateDays: number; deactivateDays: number }> = {
  volatile: { activateDays: 2, deactivateDays: 7 },
  trendDrawdown: { activateDays: 3, deactivateDays: 10 },
  choppy: { activateDays: 3, deactivateDays: 5 },
  inflationary: { activateDays: 5, deactivateDays: 10 },
  qe: { activateDays: 7, deactivateDays: 10 },
  crisis: { activateDays: 1, deactivateDays: 3 },
  newsDriven: { activateDays: 3, deactivateDays: 5 },
};
