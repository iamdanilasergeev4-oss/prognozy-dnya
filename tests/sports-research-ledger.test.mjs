import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readResearchRuns, researchReport, storeResearchObject } from "../scripts/sports-research-ledger.mjs";

const day = 86_400_000;
const start = Date.UTC(2025, 0, 9, 18);
const event = {
  sport: "cs2", competition: "event", tier: "regional", home: "a", away: "b", start,
  rules: "BO3", sourceTier: "independent", sources: [{ title: "publisher", id: "1" }],
  historyAvailable: true,
};
const pick = (version, home = 0.8) => ({ ...event, version, probabilities: { home, away: 1 - home } });
const run = (at, events = [], forecasts = [], results = []) => ({ schema: 1, at, events, forecasts, results });
const result = (observedAt, score, tier = "official") => ({ ...event, observedAt, score, tier });

test("a settled match scores only its first pre-match forecast per model", () => {
  const before = start - day;
  const after = start + 2 * day;
  const runs = [run(before, [event], [pick("elo"), pick("form", 0.6)]),
    run(start - day / 2, [event], [pick("elo", 0.1)]),
    run(after, [], [], [result(after, [2, 0])])];
  assert.equal(researchReport(runs, start).bySport.cs2.all.settledEvents, 0);
  const report = researchReport(runs, after);
  const cs = report.bySport.cs2;
  assert.equal(Object.keys(report.bySport).length, 7);
  assert.equal(cs.all.predicted, 1);
  assert.equal(cs.all.paired[0].matches, 1);
  assert.ok(Math.abs(cs.all.models.elo.brier - 0.08) < 1e-8);
  assert.equal(cs.all.byLevel.regional.scoredEvents, 1);
  assert.equal(cs.days7.settledEvents, 1);
  assert.equal(cs.days7.completeWindow, false);
  assert.equal(report.records[0].modelObservedAt.elo, before);
});

test("unsupported, late and contradictory observations do not silently settle a series", () => {
  const before = start - day;
  const after = start + 2 * day;
  const base = run(before, [event], [pick("elo")]);
  const lateEvent = { ...event, sources: [{ title: "publisher", id: "2" }], home: "c" };
  const late = run(start - 60_000, [lateEvent], [{ ...pick("late"), ...lateEvent }]);
  const weak = run(after, [], [], [result(after, [2, 0], "corroborated_unknown_origin")]);
  assert.equal(researchReport([base, late, weak], after).bySport.cs2.all.settledEvents, 0);
  assert.equal(researchReport([base, late, weak], after).bySport.cs2.all.predicted, 1);
  const verified = run(after, [], [], [result(after, [2, 0])]);
  const contradicted = run(after + day, [], [], [result(after + day, [0, 2])]);
  const report = researchReport([base, verified, contradicted], after + day);
  assert.equal(report.records[0].status, "conflict");
  assert.equal(report.records[0].models.elo.home, 0.8);
  assert.equal(report.bySport.cs2.all.settledEvents, 0);
});

test("a stable provider ID detects rescheduling and leaves the old estimate untouched", () => {
  const first = run(start - 2 * day, [event], [pick("elo")]);
  const moved = { ...event, start: start + day };
  const next = run(start - day, [moved], [{ ...pick("elo", 0.3), ...moved }]);
  const report = researchReport([first, next], start);
  assert.equal(report.records.length, 1);
  assert.equal(report.records[0].id, researchReport([first], start).records[0].id);
  assert.equal(report.records[0].status, "conflict");
  assert.equal(report.records[0].models.elo.home, 0.8);
});

test("content addressed snapshots are idempotent and checked on read", async () => {
  const root = await mkdtemp(join(tmpdir(), "sports-ledger-"));
  try {
    const item = run(start);
    const hashes = await Promise.all([storeResearchObject(root, "runs", item), storeResearchObject(root, "runs", item)]);
    assert.equal(hashes[0], hashes[1]);
    assert.deepEqual(await readResearchRuns(root), [item]);
    await writeFile(join(root, "runs", hashes[0] + ".json"), "{}");
    await assert.rejects(readResearchRuns(root), /Повреждён/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
