import { evaluateProbabilities } from "./sports-evaluation.mjs";

const week = 7 * 86_400_000;
const keys = ["home", "draw", "away"];
const blend = (a, b) => Object.fromEntries(keys.map((key) => [key, 0.5 * (a[key] + b[key])]));
const logLoss = (actual, p) => -Math.log(Math.max(1e-15, p[actual]));
const brier = (actual, p) => keys.reduce((total, key) => total + (p[key] - Number(actual === key)) ** 2, 0);
const withTemperature = (distribution, temperature) => {
  const weights = keys.map((key) => distribution[key] ** (1 / temperature));
  const sum = weights.reduce((a, b) => a + b);
  return Object.fromEntries(keys.map((key, i) => [key, weights[i] / sum]));
};

// Resample whole calendar weeks, preserving dependence between matches played
// on the same weekend. Use paired differences and a fixed seed for replay.
export function pairedWeekInterval(rows, candidate, metric, control = "elo") {
  const blocks = [...Map.groupBy(rows, (row) => Math.floor(row.start / week)).values()]
    .map((block) => ({ count: block.length, sum: block.reduce((total, row) =>
      total + metric(row.actual, row[candidate]) - metric(row.actual, row[control]), 0) }));
  if (blocks.length < 8) return { weeks: blocks.length, low: null, high: null };
  let state = 20261122;
  const samples = Array.from({ length: 2000 }, () => {
    let sum = 0;
    let size = 0;
    for (let i = 0; i < blocks.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const block = blocks[Math.floor(state / 2 ** 32 * blocks.length)];
      sum += block.sum;
      size += block.count;
    }
    return sum / size;
  }).sort((a, b) => a - b);
  return { weeks: blocks.length, low: samples[50], high: samples[1949] };
}

export function compareFootballModels(rows, holdoutFrom) {
  const paired = rows.filter((row) => row.sport === "football" && row.model && row.scoreModel)
    .map((row) => ({ ...row, elo: row.model, goals: row.scoreModel, ensemble: blend(row.model, row.scoreModel) }));
  const ids = new Set(paired.map((row) => row.id));
  if (ids.size !== paired.length) throw new Error("Дубли в сравнительной выборке моделей");
  const calibration = paired.filter((row) => row.start < holdoutFrom);
  const holdout = paired.filter((row) => row.start >= holdoutFrom);
  const temperatures = [1, 0.75, 0.85, 0.95, 1.05, 1.15, 1.25, 1.5];
  const loss = (temperature) => calibration.reduce((value, row) =>
    value + logLoss(row.actual, withTemperature(row.ensemble, temperature)), 0);
  const temperature = temperatures.map((value) => ({ value, loss: loss(value) })).sort((a, b) => a.loss - b.loss)[0].value;
  const evaluated = holdout.map((row) => ({ ...row, calibrated: withTemperature(row.ensemble, temperature) }));
  const metrics = (sample, key) => evaluateProbabilities(sample.map((row) => ({ actual: row.actual, probabilities: row[key] })));
  const variants = ["elo", "goals", "ensemble", "calibrated"];
  const marketRows = evaluated.filter((row) => row.market);
  return { calibrationMatches: calibration.length, holdoutMatches: evaluated.length, temperature,
    holdoutFrom: new Date(holdoutFrom).toISOString(),
    metrics: Object.fromEntries(variants.map((key) => [key, metrics(evaluated, key)])),
    differencesVersusElo: Object.fromEntries(variants.slice(1).map((key) => [key, {
      brier: pairedWeekInterval(evaluated, key, brier), logLoss: pairedWeekInterval(evaluated, key, logLoss),
    }])),
    byDivision: Object.fromEntries([...Map.groupBy(evaluated, (row) => row.competition)]
      .map(([division, sample]) => [division, Object.fromEntries(variants.map((key) => [key, metrics(sample, key)]))])),
    market: marketRows.length ? { count: marketRows.length, ...Object.fromEntries([...variants, "market"]
      .map((key) => [key, metrics(marketRows, key)])) } : null,
  };
}

export function compareSparseModel(rows, holdoutFrom) {
  const eligible = rows.filter((row) => row.start >= holdoutFrom);
  const paired = eligible.filter((row) => row.model && row.sparseModel)
    .map((row) => ({ ...row, elo: row.model, sparse: row.sparseModel }));
  const extra = eligible.filter((row) => !row.model && row.sparseModel);
  if (new Set(paired.map((row) => row.id)).size !== paired.length) throw new Error("Дубли в выборке базовой модели");
  const metrics = (key) => evaluateProbabilities(paired.map((row) => ({ actual: row.actual, probabilities: row[key] })));
  return { eligible: eligible.length, paired: paired.length,
    onlySparse: extra.length,
    onlySparseMetrics: evaluateProbabilities(extra.map((row) => ({ actual: row.actual, probabilities: row.sparseModel }))),
    onlyElo: eligible.filter((row) => row.model && !row.sparseModel).length,
    metrics: { elo: metrics("elo"), sparse: metrics("sparse") },
    differencesVersusElo: { brier: pairedWeekInterval(paired, "sparse", brier), logLoss: pairedWeekInterval(paired, "sparse", logLoss) } };
}
