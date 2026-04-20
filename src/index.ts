// Types
export type { RegimeType, Severity, RegimeResult, BenchmarkData, BenchmarkDataWithDates } from "./types";
export { REGIME_TYPES, CONFIRMATION_RULES, REGIME_DETECTOR_VERSION } from "./types";

// Detectors
export {
  detectCrisis,
  detectVolatile,
  detectChoppy,
  detectInflationary,
  detectQE,
  detectNewsDriven,
  detectAllRegimes,
} from "./detectors";

// Classification
export { classifyRegimeSeries, segmentReturnsByRegime, shouldTransition } from "./classify";

// Helpers (exported for advanced usage / testing)
export {
  clamp,
  dailyReturns,
  SMA,
  countCrossovers,
  percentileRank,
  averageStreakLength,
  variance,
  excessKurtosis,
  rollingKurtosis,
} from "./helpers";
