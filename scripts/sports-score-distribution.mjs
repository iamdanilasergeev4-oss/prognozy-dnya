import { pairedWeekInterval } from "./sports-model-comparison.mjs";

export const scoreMeasures = {
  total: { title: "Общий счёт", actual: ([home, away]) => home + away },
  home: { title: "Счёт первой команды", actual: ([home]) => home },
  away: { title: "Счёт второй команды", actual: ([, away]) => away },
  margin: { title: "Разница счёта", actual: ([home, away]) => home - away },
};
const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function histogram(cells, weight) {
  const bins = [...cells].sort(([a], [b]) => a - b);
  const support = bins.map(([score, mass]) => [score, mass / weight]);
  let cdf = 0;
  return { support, mean: support.reduce((sum, [score, p]) => sum + score * p, 0),
    cumulative: support.map(([, p]) => cdf += p) };
}

export function scoreDistributions(scoreRows) {
  const measures = Object.entries(scoreMeasures).map(([id, measure]) => [id, measure.actual, new Map()]);
  let weight = 0;
  for (const [home, away, p] of scoreRows) {
    weight += p;
    for (const [, actual, cells] of measures) {
      const score = actual([home, away]);
      cells.set(score, (cells.get(score) || 0) + p);
    }
  }
  if (!(weight > 0)) throw new Error("В распределении отсутствует вес");
  return Object.fromEntries(measures.map(([id, , cells]) => [id, histogram(cells, weight)]));
}

export function probabilityAtLeast(distribution, threshold) {
  const index = distribution.support.findIndex(([value]) => value >= threshold);
  return index < 0 ? 0 : index === 0 ? 1 : Math.max(0, 1 - distribution.cumulative[index - 1]);
}

function quantile(distribution, probability) {
  const i = distribution.cumulative.findIndex((mass) => mass >= probability - 1e-12);
  return (distribution.support[i] ?? distribution.support.at(-1))[0];
}

export function centralRange(distribution) {
  const low = quantile(distribution, 0.2);
  const high = quantile(distribution, 0.8);
  const lower = 1 - probabilityAtLeast(distribution, low);
  const upper = probabilityAtLeast(distribution, high + 1);
  return { low, high, probability: 1 - lower - upper, lower, upper };
}

export function adaptiveThresholds(distribution) {
  const options = distribution.support.slice(1).map(([value], i) => ({
    value, probability: 1 - distribution.cumulative[i],
  })).filter(({ probability }) => probability >= 0.2 && probability <= 0.8);
  if (!options.length) return [];
  const preferred = [0.65, 0.35].map((reference) => ({
    ...options.reduce((best, row) =>
      Math.abs(row.probability - reference) < Math.abs(best.probability - reference) ? row : best),
    reference,
  }));
  const [first, second] = preferred;
  if (first.value !== second.value) return preferred;
  return [Math.abs(first.probability - first.reference) <= Math.abs(second.probability - second.reference) ? first : second];
}

export function distributionMass(distribution, low, high) {
  return probabilityAtLeast(distribution, low) - probabilityAtLeast(distribution, high + 1);
}

export function scoreCrps(distribution, actual) {
  const grid = [...new Set([...distribution.support.map(([x]) => x), actual])].sort((a, b) => a - b);
  let i = 0, error = 0;
  for (let j = 0; j + 1 < grid.length; j++) {
    const left = grid[j];
    while (i < distribution.support.length && distribution.support[i][0] <= left) i++;
    const cdf = i ? distribution.cumulative[i - 1] : 0;
    error += (grid[j + 1] - left) * (cdf - Number(actual <= left)) ** 2;
  }
  return error;
}

export function discretePitBins(distribution, actual) {
  const left = 1 - probabilityAtLeast(distribution, actual);
  const right = 1 - probabilityAtLeast(distribution, actual + 1);
  return Array.from({ length: 10 }, (_, i) => {
    if (right <= left) return Number(i === Math.min(9, Math.floor(left * 10)));
    return Math.max(0, Math.min(right, (i + 1) / 10) - Math.max(left, i / 10)) / (right - left);
  });
}

export function scoreForecastTest(distributions, actual, start) {
  const range = centralRange(distributions.model);
  const baselineRange = centralRange(distributions.baseline);
  return { start, actual,
    model: scoreCrps(distributions.model, actual), baseline: scoreCrps(distributions.baseline, actual),
    recent: scoreCrps(distributions.recent, actual),
    meanMae: Math.abs(distributions.model.mean - actual), baselineMeanMae: Math.abs(distributions.baseline.mean - actual),
    coverage: Number(range.low <= actual && actual <= range.high), mass: range.probability, width: range.high - range.low,
    pit: discretePitBins(distributions.model, actual),
    lowerObserved: Number(actual < range.low), lowerExpected: range.lower,
    upperObserved: Number(actual > range.high), upperExpected: range.upper,
    baselineCoverage: Number(baselineRange.low <= actual && actual <= baselineRange.high), baselineMass: baselineRange.probability,
    thresholds: adaptiveThresholds(distributions.model).map(({ value, probability }) => ({
      start, actual: Number(actual >= value), model: probability, baseline: probabilityAtLeast(distributions.baseline, value),
      recent: probabilityAtLeast(distributions.recent, value),
    })) };
}

const errorBrier = (actual, p) => (p - actual) ** 2;
function summarizeThresholds(rows) {
  if (!rows.length) return { n: 0 };
  const summary = Object.fromEntries(["model", "baseline", "recent"].map((key) => [key,
    average(rows.map((row) => errorBrier(row.actual, row[key])))]));
  const bins = [...Map.groupBy(rows, (row) => Math.min(9, Math.floor(row.model * 10))).values()]
    .map((group) => ({ n: group.length, probability: average(group.map((row) => row.model)), actual: average(group.map((row) => row.actual)) }));
  return { n: rows.length, ...summary, bins,
    bias: average(rows.map((row) => row.model - row.actual)) };
}

export function evaluateScoreDistribution(rows, secondPeriod, scope) {
  const summarize = (group) => {
    if (!group.length) return { n: 0 };
    const pitBins = group[0].pit.map((_, i) => average(group.map((row) => row.pit[i])));
    return { n: group.length, pitBins,
      pitMaxDeviation: Math.max(...pitBins.map((mass) => Math.abs(mass - 0.1))),
      coverageInterval: pairedWeekInterval(group, "coverage", (_, observed) => observed, "mass"),
    ...Object.fromEntries(["model", "baseline", "recent", "meanMae", "baselineMeanMae", "coverage", "mass", "width", "baselineCoverage", "baselineMass",
      "lowerObserved", "lowerExpected", "upperObserved", "upperExpected"]
      .map((key) => [key, average(group.map((row) => row[key]))])) };
  };
  const groups = [rows.filter((row) => row.start < secondPeriod), rows.filter((row) => row.start >= secondPeriod)];
  const periods = groups.map(summarize);
  const overall = summarize(rows);
  const interval = pairedWeekInterval(rows, "model", (_, error) => error, "baseline");
  const approved = scope && rows.length >= 150 && interval.high != null && interval.high < 0 &&
    periods.every((p) => p.n >= 40 && p.model <= p.baseline && p.model <= p.recent &&
      p.pitMaxDeviation <= 0.08 &&
      Math.abs(p.coverage - p.mass) <= 0.075 && Math.abs(p.lowerObserved - p.lowerExpected) <= 0.075 &&
      Math.abs(p.upperObserved - p.upperExpected) <= 0.075);
  const thresholdRows = rows.flatMap((row) => row.thresholds);
  const thresholdOverall = summarizeThresholds(thresholdRows);
  const thresholdPeriods = groups.map((group) => summarizeThresholds(group.flatMap((row) => row.thresholds)));
  const thresholdInterval = pairedWeekInterval(thresholdRows, "model", errorBrier, "baseline");
  const thresholdsApproved = approved && rows.filter((row) => row.thresholds.length > 0).length >= 150 &&
    thresholdInterval.high != null && thresholdInterval.high < 0 && thresholdPeriods.every((p) =>
      p.n >= 40 && p.model <= p.baseline && p.model <= p.recent && Math.abs(p.bias) <= 0.075);
  return { ...overall, periods, interval, approved, thresholds: { ...thresholdOverall, periods: thresholdPeriods,
    interval: thresholdInterval, approved: thresholdsApproved } };
}
