import test from "node:test";
import assert from "node:assert/strict";
import { assessUpcomingProjection, prepareProjectionHistory, projectionTargets, upcomingProjection } from "../scripts/sports-projections.mjs";

const day = 86_400_000;
const now = Date.parse("2026-11-22T10:00:00Z");
const event = { sport: "football", competition: "eng1", home: "Club A", away: "Club B", status: "confirmed", start: now + day };
const rows = Array.from({ length: 62 }, (_, i) => ({ ...event, id: String(i), start: now - (i + 4) * day,
  observedAt: now - day, score: [i % 4, i % 3] }));
const checks = [{ key: JSON.stringify(["football", "eng1", null]), id: "total", approved: true },
  { key: JSON.stringify(["football", "eng1", null]), id: "margin", approved: false }];

test("projection never uses later observations and exposes only historically approved targets", () => {
  const prior = prepareProjectionHistory(rows, [], now);
  const extra = prepareProjectionHistory([...rows, { ...rows[0], id: "unobserved", observedAt: now + 1, score: [20, 0] },
    { ...rows[0], id: "recent", start: now - day }], [], now);
  assert.deepEqual(extra, prior);
  const result = upcomingProjection(event, prior, checks, now);
  assert.deepEqual(result.targets.map((target) => target.id), ["total"]);
  assert.ok(Math.abs(Object.values(result.targets[0].probabilities).reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.equal(upcomingProjection({ ...event, verificationReason: "time_conflict" }, prior, checks, now), null);
  assert.equal(upcomingProjection(event, prior, [], now), null);
});

test("binary thresholds use full scores and map totals require an appropriate series format", () => {
  const total = projectionTargets({ sport: "basketball" }).find((target) => target.id === "total");
  const margin = projectionTargets({ sport: "basketball" }).find((target) => target.id === "margin");
  assert.equal(total.actual(100, 120), "yes");
  assert.equal(margin.actual(100, 90), "yes");
  assert.equal(margin.actual(100, 91), "no");
  assert.equal(projectionTargets({ sport: "dota2", rules: "BO2" }).some((target) => target.id === "total"), false);
});

test("expected total and signed difference come from the score distribution and need their own validation", () => {
  const history = prepareProjectionHistory(rows.map((row) => ({ ...row, score: [2, 2] })), [], now);
  const points = ["expected_total", "expected_margin"].map((id) => ({ key: checks[0].key, id, approved: true }));
  const result = upcomingProjection(event, history, checks, now, points);
  assert.deepEqual(result.points.map(({ value }) => value), [4, 0]);
  assert.ok(result.targets[0].probabilities.yes < 1);
  assert.deepEqual(upcomingProjection(event, history, checks, now, points.slice(0, 1)).points.map(({ id }) => id), ["expected_total"]);
});

test("the new preview does not fall back to previously approved fixed-score thresholds", () => {
  const history = prepareProjectionHistory(rows, [], now);
  assert.equal(assessUpcomingProjection(event, history, checks, now, [], []).reason, "no_verified_cohort_model");
  const approved = [{ key: checks[0].key, id: "total", approved: true, thresholds: { approved: false } }];
  const result = assessUpcomingProjection(event, history, checks, now, [], approved).projection;
  assert.deepEqual(result.targets, []);
  assert.equal(result.distributions[0].id, "total");
  assert.deepEqual(result.distributions[0].thresholds, []);
});
