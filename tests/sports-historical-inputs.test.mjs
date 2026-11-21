import assert from "node:assert/strict";
import test from "node:test";
import { archiveBacktest } from "../scripts/backtest-archive-sport.mjs";
import { tennisSingles, verifiedResult } from "../scripts/sports-historical-inputs.mjs";

const series = {
  id: "45", date: "2024-01-01", completedDate: "2024-01-02", competition: "event-1",
  season: "2024", status: "completed", home: "org2", away: "org1", patch: "p1",
  unit: "series", bestOf: 3, score: [2, 1],
};

test("esports accepts explicit completed series and keeps roster IDs with the proper side", () => {
  const rosters = [["1", "2", "3", "4", "5"], ["6", "7", "8", "9", "10"]];
  const parsed = verifiedResult({ ...series, rosters }, "cs2", "source");
  assert.deepEqual(parsed.score, [1, 2]);
  assert.equal(parsed.home, "source:org1");
  assert.deepEqual(parsed.rosters[0], ["10", "6", "7", "8", "9"]);
  assert.equal(parsed.available, Date.parse("2024-01-04"));
  assert.equal(verifiedResult({ ...series, unit: "map", bestOf: 1, score: [1, 0] }, "cs2", "source"), null);
  assert.equal(verifiedResult({ ...series, patch: undefined }, "cs2", "source").patch, null);
  const draw = { ...series, bestOf: 2, score: [1, 1] };
  assert.ok(verifiedResult(draw, "dota2", "source"));
  assert.equal(verifiedResult(draw, "cs2", "source"), null);
});

test("volleyball reconciles set scores and excludes impossible sets or wrong seasons", () => {
  const match = { ...series, unit: "match", season: "2023-2024", score: [3, 1],
    sets: [[25, 20], [25, 21], [25, 27], [28, 26]] };
  assert.ok(verifiedResult(match, "volleyball", "league"));
  assert.equal(verifiedResult({ ...match, score: [3, 0] }, "volleyball", "league"), null);
  assert.equal(verifiedResult({ ...match, season: "2025-2026" }, "volleyball", "league"), null);
  assert.equal(verifiedResult({ ...match, sets: [[25, 24], ...match.sets.slice(1)] }, "volleyball", "league"), null);
});

test("tennis separates tours and surfaces, drops retirements and rejects doubles headers", () => {
  const header = "tourney_id,tourney_date,tourney_level,surface,match_num,winner_id,loser_id,best_of,score";
  const row = "2024-001,20240101,G,Hard,7,20,10,3,7-6(4) 6-3";
  const [match, incomplete] = tennisSingles(`${header}\n${row}\n${row} RET`, "ATP");
  assert.equal(match.rules, "singles:hard:BO3");
  assert.equal(match.available, Date.parse("2024-01-31"));
  assert.deepEqual(match.score, [0, 2]);
  assert.equal(incomplete, null);
  assert.notEqual(tennisSingles(`${header}\n${row}`, "WTA")[0].id, match.id);
  assert.throws(() => tennisSingles(`${header},winner_1_id\n${row},22`, "ATP"), /singles/);
});

test("backtest cannot use results available at or after the held-out match begins", () => {
  const target = verifiedResult({ ...series, date: "2024-02-01", completedDate: "2024-02-01" }, "cs2", "source");
  const past = Array.from({ length: 4 }, (_, i) => ({
    ...target, id: "past-" + i, start: Date.parse("2024-01-01") + i,
    available: target.start + i,
  }));
  assert.equal(archiveBacktest([...past, target], target.start).coverage.candidate, 0);
  past.forEach((record, i) => { record.available = Date.parse("2024-01-04") + i; });
  const report = archiveBacktest([...past, target], target.start);
  assert.equal(report.comparisons.baseline.matches, 1);
  assert.equal(report.comparisons.baseline.control.brier, report.comparisons.baseline.candidate.brier);
});
