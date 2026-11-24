import assert from "node:assert/strict";
import test from "node:test";
import { replayBestOfThree } from "../scripts/backtest-archive-sport.mjs";
import { recoverDotaBo3 } from "../scripts/backtest-dota-bo3.mjs";
import { DAY } from "../scripts/sports-research-history.mjs";

const start = Date.parse("2026-11-20T10:00:00Z");
const map = (match_id, overrides = {}) => ({
  match_id, start_time: start / 1000 + match_id * 4000, duration: 1800, leagueid: 20208,
  radiant_team_id: 100, dire_team_id: 200, radiant_win: true, series_id: 10, series_type: 1, ...overrides,
});

test("Dota BO3 recovery keeps team identity through side swaps and waits for the last captured map", () => {
  const first = map(1);
  const second = map(2, { radiant_team_id: 200, dire_team_id: 100, radiant_win: false });
  const { series, invalidMapObservations } = recoverDotaBo3([
    { rows: [first, second], captured: start + 4000 * 1000 + 2000 * 1000 },
    { rows: [first, second], captured: start + 5 * DAY },
  ]);
  assert.equal(invalidMapObservations, 1);
  assert.equal(series.length, 1);
  assert.deepEqual(series[0].score, [2, 0]);
  assert.deepEqual(series[0].mapIds, ["1", "2"]);
  assert.equal(series[0].observedAvailable, start + 5 * DAY);
  assert.equal(series[0].available, series[0].end + 2 * DAY);
  assert.equal(series[0].patch, null);
});

test("Dota BO3 recovery excludes conflicting maps, missing terminal wins and other formats", () => {
  const { series, conflictedMaps, rejected } = recoverDotaBo3([{ captured: start + DAY, rows: [
    map(1), map(1, { radiant_win: false }), map(2),
    map(3, { series_id: 11 }), map(4, { series_id: 11, radiant_win: false }),
    map(5, { series_id: 12, series_type: 2 }),
  ] }]);
  assert.equal(series.length, 0);
  assert.equal(conflictedMaps, 1);
  assert.deepEqual(rejected, { conflictingMapsOrTeams: 1, incompleteOrImpossibleBo3: 1, formatOrTournamentOutsideScope: 1 });
});

test("Dota BO3 replay keeps the four-series gate and verifies a strictly prior cutoff", () => {
  const target = { id: "target", start, available: start + 2 * DAY, sport: "dota2", rules: "BO3",
    season: "2026", competition: "BLAST", home: "100", away: "200", score: [2, 0] };
  const observations = Array.from({ length: 4 }, (_, i) => ({
    ...target, id: String(i), start: start - (6 - i) * DAY, available: i === 3 ? start : start - DAY,
  }));
  const evaluate = () => replayBestOfThree([...observations, target], start, { until: start + DAY, auditCoverage: true });
  assert.equal(evaluate().predictions, 0);
  assert.equal(evaluate().history.bothHaveHistoryButUnderThreshold, 1);
  observations[3].available--;
  assert.equal(evaluate().predictions, 1);
  assert.equal(evaluate().comparisons.uniform.paired, 1);
});
