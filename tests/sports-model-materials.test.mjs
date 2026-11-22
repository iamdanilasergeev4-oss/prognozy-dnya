import test from "node:test";
import assert from "node:assert/strict";
import { dailyModelSummary, expressHighlights, modelConclusion, modelScenarios } from "../scripts/sports-model-materials.mjs";
import { recordForecastPreview, verifiedForecastResult } from "../scripts/sports-forecast-journal.mjs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const start = Date.parse("2026-11-23T15:00:00Z");
const day = 86_400_000;
const fixture = { sport: "football", match: "Brentford — Everton", start, competition: "eng1", season: "2026-27",
  home: "brentford", away: "everton", sources: [{ title: "ESPN", id: "42", url: "https://www.espn.com/soccer/" }] };
const testRow = (id, brier, high) => ({ id, paired: 200, interval: { high }, model: { brier, ece: 0.02 },
  baseline: { brier: 0.5 }, periods: Array.from({ length: 2 }, () => ({ n: 100, baseline: { brier: 0.5 }, model: { brier } })) });

test("the conclusion selects validation strength before probability and flags a close result", () => {
  const scenarios = modelScenarios([
    { id: "total", title: "Общий счёт", probabilities: { yes: 0.9, no: 0.1 } },
    { id: "margin", title: "Разница счёта", probabilities: { yes: 0.51, no: 0.49 } },
  ], [testRow("total", 0.49, -0.001), testRow("margin", 0.45, -0.02)], fixture);
  const decision = modelConclusion(scenarios, "Форма", "Голы", "Составы");
  assert.equal(decision.id, "margin");
  assert.equal(decision.probability, null);
  assert.match(decision.scenario, /Явного преимущества нет.*51%/u);
  const article = { sport_id: "football", sport: "Футбол", start_iso: "2026-11-23T18:00+03:00", match: fixture.match,
    modelConclusion: decision };
  assert.equal(dailyModelSummary([article, article], "2026-11-23").length, 1);
  assert.deepEqual(dailyModelSummary([article], "2026-11-24"), []);
});

test("the forecast journal preserves the original snapshot and admits an identified corroborated result", async () => {
  const path = await mkdtemp(join(tmpdir(), "sports-forecast-"));
  try {
    const forecast = { event: fixture, trainingIds: ["one"], sources: fixture.sources, points: [],
      targets: [{ id: "total", probabilities: { yes: 0.6, no: 0.4 } }] };
    const result = { ...fixture, id: "result", score: [2, 1], observedAt: start + day, tier: "corroborated_unknown_origin" };
    const now = start + 2 * day;
    assert.equal(verifiedForecastResult({ ...fixture, rules: null, schedule: fixture.sources },
      [{ ...result, sources: [{ ...fixture.sources[0], id: "different" }] }], now), null);
    assert.equal((await recordForecastPreview(path, [forecast], [], start - day, "test")).pending, 1);
    const [file] = await readdir(join(path, "forecast"));
    const before = await readFile(join(path, "forecast", file), "utf8");
    const updated = await recordForecastPreview(path, [], [result], now, "test");
    assert.equal(updated.settled, 1);
    assert.equal(updated.results[0].result.status, "verified");
    assert.equal(updated.metrics["test/football/eng1/total"].metrics, null);
    assert.equal(await readFile(join(path, "forecast", file), "utf8"), before);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

test("the informational express rotates sports, excludes repeated teams, and keeps separate probabilities", () => {
  const row = (sport_id, match, time, quality) => ({
    sport_id, sport: sport_id, match, start_iso: `2026-11-23T${time}:00+03:00`,
    modelConclusion: { quality, close: false, probability: 0.6 },
  });
  const a = row("football", "A — B", "12:00", 0.08);
  const b = row("football", "C — A", "15:00", 0.04);
  const c = row("basketball", "D — E", "17:00", 0.03);
  const d = row("football", "F — G", "18:00", 0.02);
  const picks = expressHighlights([a, b, c, d], "2026-11-23");
  assert.deepEqual(picks.map(({ match }) => match), [a.match, c.match, d.match]);
  assert.ok(picks.every((item) => item.modelConclusion.probability === 0.6 && !Object.hasOwn(item, "odds")));
});
