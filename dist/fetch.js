"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/fetch.ts
var fetch_exports = {};
__export(fetch_exports, {
  fetchBenchmarkData: () => fetchBenchmarkData
});
module.exports = __toCommonJS(fetch_exports);
var TICKERS = ["SPY", "QQQ", "TLT", "VT", "TIP", "GLD", "DBC"];
async function fetchFredM2(startDate, endDate, apiKey) {
  const lookbackStart = new Date(startDate);
  lookbackStart.setMonth(lookbackStart.getMonth() - 14);
  const fredStart = lookbackStart.toISOString().slice(0, 10);
  if (apiKey) {
    const url2 = `https://api.stlouisfed.org/fred/series/observations?series_id=M2SL&observation_start=${fredStart}&observation_end=${endDate}&api_key=${apiKey}&file_type=json`;
    const response2 = await fetch(url2);
    if (!response2.ok) throw new Error(`FRED API returned ${response2.status}`);
    const data = await response2.json();
    const monthly2 = /* @__PURE__ */ new Map();
    for (const obs of data.observations) {
      if (obs.value !== ".") monthly2.set(obs.date, parseFloat(obs.value));
    }
    return monthly2;
  }
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=M2SL&cosd=${fredStart}&coed=${endDate}`;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`FRED CSV returned ${response.status}`);
  const csv = await response.text();
  const monthly = /* @__PURE__ */ new Map();
  for (const line of csv.trim().split("\n").slice(1)) {
    const [date, value] = line.split(",");
    if (date && value && value !== ".") monthly.set(date, parseFloat(value));
  }
  return monthly;
}
function buildM2DailySeries(monthlyM2, tradingDates) {
  const monthlyDates = [...monthlyM2.keys()].sort();
  if (monthlyDates.length < 13) {
    return {
      values: Array(tradingDates.length).fill(NaN),
      yoyGrowth: Array(tradingDates.length).fill(NaN)
    };
  }
  const values = [];
  const yoyGrowth = [];
  for (const date of tradingDates) {
    let currentM2 = NaN;
    let priorYearM2 = NaN;
    for (let i = monthlyDates.length - 1; i >= 0; i--) {
      if (monthlyDates[i] <= date) {
        currentM2 = monthlyM2.get(monthlyDates[i]);
        const targetMonth = new Date(monthlyDates[i]);
        targetMonth.setMonth(targetMonth.getMonth() - 12);
        const targetStr = targetMonth.toISOString().slice(0, 10);
        for (let j = i; j >= 0; j--) {
          if (monthlyDates[j] <= targetStr) {
            priorYearM2 = monthlyM2.get(monthlyDates[j]);
            break;
          }
        }
        break;
      }
    }
    values.push(currentM2);
    if (!isNaN(currentM2) && !isNaN(priorYearM2) && priorYearM2 > 0) {
      yoyGrowth.push((currentM2 - priorYearM2) / priorYearM2);
    } else {
      yoyGrowth.push(NaN);
    }
  }
  return { values, yoyGrowth };
}
async function fetchTicker(ticker, period1, period2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${period1}&period2=${period2}&interval=1d&includeAdjustedClose=true`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (market-regimes)" }
  });
  if (!response.ok) {
    throw new Error(`Yahoo Finance returned ${response.status} for ${ticker}`);
  }
  const data = await response.json();
  if (data.chart.error) {
    throw new Error(`Yahoo Finance error for ${ticker}: ${JSON.stringify(data.chart.error)}`);
  }
  const result = data.chart.result[0];
  const timestamps = result.timestamp;
  const quote = result.indicators.quote[0];
  const adjClose = result.indicators.adjclose?.[0]?.adjclose ?? quote.close;
  const dates = [];
  const prices = [];
  const opens = [];
  for (let i = 0; i < timestamps.length; i++) {
    const price = adjClose[i];
    const open = quote.open[i];
    if (price == null || isNaN(price)) continue;
    const d = new Date(timestamps[i] * 1e3);
    dates.push(d.toISOString().slice(0, 10));
    prices.push(price);
    opens.push(open ?? price);
  }
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  return { dates, prices, opens, returns };
}
async function fetchBenchmarkData(options = {}) {
  const {
    lookbackDays = 756,
    rateLimitMs = 500,
    fredApiKey,
    fetchM2: shouldFetchM2 = true
  } = options;
  const endDate = options.endDate ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const startDate = options.startDate ?? new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1e3).toISOString().slice(0, 10);
  const period1 = Math.floor(new Date(startDate).getTime() / 1e3);
  const period2 = Math.floor(new Date(endDate).getTime() / 1e3);
  const tickerData = {};
  for (const ticker of TICKERS) {
    try {
      tickerData[ticker] = await fetchTicker(ticker, period1, period2);
    } catch {
      tickerData[ticker] = { dates: [], prices: [], opens: [], returns: [] };
    }
    if (rateLimitMs > 0) {
      await new Promise((r) => setTimeout(r, rateLimitMs));
    }
  }
  const spyDates = new Set(tickerData["SPY"].dates);
  const tltDates = new Set(tickerData["TLT"].dates);
  const commonDates = [...spyDates].filter((d) => tltDates.has(d)).sort();
  if (commonDates.length === 0) {
    throw new Error("No common trading dates between SPY and TLT \u2014 check date range or network");
  }
  const buildSeries = (ticker) => {
    const td = tickerData[ticker];
    if (td.dates.length === 0) {
      return {
        prices: Array(commonDates.length).fill(NaN),
        opens: Array(commonDates.length).fill(NaN),
        returns: Array(commonDates.length).fill(NaN)
      };
    }
    const dateIdx = new Map(td.dates.map((d, i) => [d, i]));
    const prices = [];
    const opens = [];
    let lastPrice = NaN;
    let lastOpen = NaN;
    for (const d of commonDates) {
      const idx = dateIdx.get(d);
      if (idx !== void 0) {
        lastPrice = td.prices[idx];
        lastOpen = td.opens[idx];
      }
      prices.push(lastPrice);
      opens.push(lastOpen);
    }
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      if (isNaN(prices[i]) || isNaN(prices[i - 1])) {
        returns.push(NaN);
      } else {
        returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
      }
    }
    return { prices, opens, returns };
  };
  let m2;
  if (shouldFetchM2) {
    try {
      const monthlyM2 = await fetchFredM2(startDate, endDate, fredApiKey);
      m2 = buildM2DailySeries(monthlyM2, commonDates);
    } catch {
      m2 = void 0;
    }
  }
  return {
    dates: commonDates,
    spy: buildSeries("SPY"),
    qqq: buildSeries("QQQ"),
    tlt: buildSeries("TLT"),
    vt: buildSeries("VT"),
    tip: buildSeries("TIP"),
    gld: buildSeries("GLD"),
    dbc: buildSeries("DBC"),
    ...m2 ? { m2 } : {}
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  fetchBenchmarkData
});
//# sourceMappingURL=fetch.js.map