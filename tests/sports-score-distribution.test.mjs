import test from "node:test";
import assert from "node:assert/strict";
import { adaptiveThresholds, centralRange, discretePitBins, probabilityAtLeast, scoreCrps, scoreDistributions, scoreForecastTest }
  from "../scripts/sports-score-distribution.mjs";
import { describeScoreDistribution } from "../scripts/sports-model-materials.mjs";

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10);
const scores = [[99, 96, 1], [110, 105, 3], [115, 112, 4], [125, 116, 2]];

test("score marginals preserve expected total and signed difference and show inclusive discrete ranges", () => {
  const { home, away, total, margin } = scoreDistributions(scores);
  near(total.mean, home.mean + away.mean);
  near(margin.mean, home.mean - away.mean);
  const range = centralRange(total);
  assert.deepEqual([range.low, range.high], [215, 227]);
  near(range.probability, 0.7);
  near(range.lower, 0.1);
  near(range.upper, 0.2);
  near(probabilityAtLeast(total, 227), 0.6);
  assert.equal(scoreCrps(scoreDistributions([[6, 4, 1]]).total, 14), 4);
});

test("adaptive thresholds move with the modeled fixture and exclude nearly certain thresholds", () => {
  const distribution = scoreDistributions(scores).total;
  const shifted = scoreDistributions(scores.map(([a, b, w]) => [a + 10, b, w])).total;
  const controls = adaptiveThresholds(distribution);
  assert.ok(controls.length);
  assert.deepEqual(adaptiveThresholds(shifted).map(({ value }) => value),
    controls.map(({ value }) => value + 10));
  assert.ok(controls.every(({ probability }) => probability >= 0.2 && probability <= 0.8));
  const measured = scoreForecastTest({ model: distribution, baseline: shifted, recent: shifted }, 220, 1);
  assert.equal(measured.coverage, 1);
  near(measured.thresholds[0].baseline, probabilityAtLeast(shifted, controls[0].value));
});

test("the primary conclusion uses the verified game total and keeps alternative thresholds in details", () => {
  const { total, margin } = scoreDistributions(scores);
  const measurements = [["margin", margin], ["total", total]].map(([id, forecast]) => ({
    id, mean: forecast.mean, range: centralRange(forecast), thresholds: adaptiveThresholds(forecast), support: forecast.support,
  }));
  const checks = measurements.map(({ id }) => ({ id, n: 200, model: 4, baseline: 5,
    coverage: 0.67, mass: 0.65, interval: { high: -0.2 } }));
  const display = describeScoreDistribution(measurements, checks, { match: "A — B", sport: "basketball" },
    "Проверенная статистика", "Результативность", "Составы не учтены.");
  assert.equal(display.conclusion.id, "distribution_total");
  assert.match(display.conclusion.scenario, /от 215 до 227, вероятность 70%/u);
  assert.deepEqual(display.sections.map(({ title }) => title),
    ["Ожидаемый результат", "Диапазон результатов и сценарии", "Справочные пороги"]);
  const [, ...references] = display.sections.at(-1).lines;
  assert.ok(references.every((line) => line.includes("справочному ориентиру") && line.includes("Для границы")));
  assert.doesNotMatch(display.conclusion.scenario, /или больше/);
});

test("discrete PIT is uniform under the forecast and flags outcomes outside the support", () => {
  const distribution = scoreDistributions(scores).total;
  const masses = Array(10).fill(0);
  for (const [actual, probability] of distribution.support) {
    discretePitBins(distribution, actual).forEach((mass, i) => masses[i] += probability * mass);
  }
  masses.forEach((mass) => near(mass, 0.1));
  assert.equal(discretePitBins(distribution, 140)[0], 1);
  assert.equal(discretePitBins(distribution, 250)[9], 1);
});
