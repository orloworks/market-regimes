type RegimeType = "volatile" | "trendDrawdown" | "choppy" | "inflationary" | "qe" | "crisis" | "newsDriven";
type Severity = "off" | "mild" | "moderate" | "severe";
interface RegimeResult {
    active: boolean;
    severity: Severity;
    score: number;
    signals: Record<string, number>;
}
interface BenchmarkData {
    spy: {
        prices: number[];
        opens: number[];
        returns: number[];
    };
    qqq: {
        prices: number[];
        opens: number[];
        returns: number[];
    };
    tlt: {
        prices: number[];
        opens: number[];
        returns: number[];
    };
    vt: {
        prices: number[];
        returns: number[];
    };
    tip: {
        prices: number[];
        returns: number[];
    };
    gld: {
        prices: number[];
        returns: number[];
    };
    dbc: {
        prices: number[];
        returns: number[];
    };
    /** M2 money supply from FRED (M2SL). Monthly, carried forward to daily. */
    m2?: {
        values: number[];
        yoyGrowth: number[];
    };
}
interface BenchmarkDataWithDates extends BenchmarkData {
    dates: string[];
}
declare const REGIME_TYPES: RegimeType[];
/** Current detector logic version — bump when detector logic changes */
declare const REGIME_DETECTOR_VERSION = 6;
declare const CONFIRMATION_RULES: Record<RegimeType, {
    activateDays: number;
    deactivateDays: number;
}>;

export { type BenchmarkDataWithDates as B, CONFIRMATION_RULES as C, type RegimeType as R, type Severity as S, type BenchmarkData as a, type RegimeResult as b, REGIME_DETECTOR_VERSION as c, REGIME_TYPES as d };
