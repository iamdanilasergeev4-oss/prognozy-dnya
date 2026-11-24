import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { copyResearchStore, MIN_SETTLED_MATCHES, readResearchRuns, researchReport, storeResearchObject,
  verifyResearchStore } from "../scripts/sports-research-ledger.mjs";
import { datasource, decideResearchSlot, seasonCacheAge } from "../scripts/collect-sports-research.mjs";
import { withResearchLock } from "../scripts/sports-research-lock.mjs";
import { discover } from "../scripts/sports-discovery.mjs";
import { evidenceTier } from "../scripts/sports-evidence.mjs";

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
  assert.equal(cs.all.models.elo.brier, undefined);
  assert.equal(cs.all.models.elo.status, "insufficient_observations");
  assert.equal(cs.all.forecastReconciliation.verifiedResults, 1);
  assert.equal(report.records[0].models.elo.home, 0.8);
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

test("verified backup and restore are additive and ignore an interrupted temporary write", async () => {
  const root = await mkdtemp(join(tmpdir(), "sports-recovery-"));
  try {
    const live = join(root, "live");
    const backup = join(root, "backup");
    const restored = join(root, "restored");
    const featuresHash = await storeResearchObject(live, "features", []);
    const normalizedHash = await storeResearchObject(live, "normalized", { results: [] });
    const rawHash = await storeResearchObject(live, "raw", Buffer.from("[]"));
    await mkdir(join(live, "runs"), { recursive: true });
    await writeFile(join(live, "runs", "interrupted.tmp"), '{"incomplete":');
    const item = { ...run(start), featuresHash, normalizedHash, requests: [{ rawHash }] };
    await storeResearchObject(live, "runs", item);
    assert.equal((await copyResearchStore(live, backup)).runs, 1);
    assert.deepEqual(await copyResearchStore(live, backup), await verifyResearchStore(backup));
    assert.equal((await copyResearchStore(backup, restored)).objects.length, 4);
    assert.deepEqual(await readResearchRuns(restored), [item]);
    await writeFile(join(restored, "raw", rawHash + ".json"), "corrupt");
    await assert.rejects(verifyResearchStore(restored), /Повреждён/);
    await assert.rejects(copyResearchStore(backup, restored), /Повреждён/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a saved network backoff prevents repeat requests and allows recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "sports-source-"));
  try {
    let clock = start;
    let attempts = 0;
    const url = "https://example.org/fixtures";
    const options = { source: "test", sport: "football" };
    const first = [];
    const fetcher = async () => ++attempts === 1 ? new Response("", { status: 503 }) : new Response("[]");
    await assert.rejects(datasource(root, [], first, () => clock, fetcher)(url, options), /503/);
    const second = [];
    await assert.rejects(datasource(root, [{ requests: first }], second, () => clock, fetcher)(url, options), /backoff/);
    assert.equal(attempts, 1);
    clock = first[0].nextAttemptAt + 1;
    assert.deepEqual(await datasource(root, [{ requests: second }], [], () => clock, fetcher)(url, options), []);
    assert.equal(attempts, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a manual calendar retries timeouts and verifies the schedule on the network", async () => {
  const root = await mkdtemp(join(tmpdir(), "sports-live-source-"));
  try {
    const url = "https://example.org/calendar";
    const options = { source: "test", sport: "football" };
    const initial = [];
    const modified = new Date(Date.now() - 86_400_000).toUTCString();
    await datasource(root, [], initial, Date.now, async () =>
      new Response('["old"]', { headers: { "Last-Modified": modified } }))(url, options);
    const failed = { ...initial[0], status: "error", kind: "timeout", nextAttemptAt: Date.now() + 3600_000 };
    const requests = [];
    let calls = 0;
    const get = datasource(root, [{ at: 2, requests: [failed] }, { at: 1, requests: initial }], requests, Date.now, async () => {
      if (++calls === 1) throw new DOMException("request timed out", "TimeoutError");
      return new Response('["fresh"]', { headers: { Date: new Date().toUTCString() } });
    }, true);
    assert.deepEqual(await get(url, options), ["old"]);
    assert.equal(calls, 0);
    assert.equal(requests[0].receivedAt, initial[0].receivedAt);
    assert.equal(requests[0].freshness, "archive");
    assert.equal(requests[0].snapshotAt, Date.parse(modified));
    assert.equal(requests[0].snapshotDateSource, "last-modified");
    assert.deepEqual(await get(url, { ...options, schedule: true }), ["fresh"]);
    assert.equal(requests[1].attempts[0].kind, "timeout");
    assert.equal(requests[1].attempts[1].status, "ok");
    assert.equal(requests[1].freshness, "live_response");
    assert.equal(requests[1].snapshotAt, null);
    assert.equal(calls, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("DFB authority is league scoped and reversed football sides cannot confirm by unordered names", () => {
  const source = { source: "DFB Datencenter", id: "dfb", start, status: "scheduled", sport: "football",
    tournament: "3. Liga", country: "DE", home: "VfB Stuttgart II", away: "FC Ingolstadt 04",
    url: "https://datencenter.dfb.de/competitions/4/seasons/2026-2027" };
  const assess = (rows) => discover(rows, { now: start - day, until: start + day, improved: true }).events[0];
  assert.equal(evidenceTier(assess([source])), "official");
  assert.equal(evidenceTier(assess([{ ...source, tournament: "2. Bundesliga" }])), "secondary");
  const mirror = { ...source, source: "OpenLigaDB", id: "ol", home: source.away, away: source.home,
    url: "https://api.openligadb.de/fixtures" };
  assert.equal(assess([source, mirror]).verificationReason, "home_away_conflict");
  assert.equal(evidenceTier(assess([source, mirror])), "conflicting");
  const moved = { ...mirror, home: source.home, away: source.away, start: start + day / 2 };
  assert.equal(assess([{ ...source, season: "2024-25" }, { ...moved, season: "2024-25" }]).verificationReason, "time_conflict");
  const corroborated = assess([{ ...source, season: "2024/2025" }, { ...moved, start, season: "2024" }]);
  assert.equal(corroborated.status, "confirmed");
  assert.equal(evidenceTier(corroborated), "official");
  assert.equal(assess([{ ...source, season: "2024/2025" }, { ...moved, start, season: "2023" }]).verificationReason, "context_conflict");
});

test("repeated observations of the same result count once", () => {
  const report = researchReport([run(start - day, [event], [pick("elo")]),
    run(start + 2 * day, [], [], [result(start + 2 * day, [2, 0])]),
    run(start + 3 * day, [], [], [result(start + 3 * day, [2, 0])])], start + 3 * day);
  assert.equal(report.bySport.cs2.all.scoredEvents, 1);
});

test("unattended retries preserve the slot journal; a missed day does not create backdated observations", () => {
  const slot = "utc-2025-01-09-12";
  const failed = { at: start, slot, runKey: slot + "-1", retryAt: start + 1 };
  assert.deepEqual(decideResearchSlot([failed], slot, start), { collect: false, retry: true });
  assert.deepEqual(decideResearchSlot([failed], slot, start + 1), { collect: true, key: slot + "-2" });
  const success = { at: start + 1, slot, runKey: slot + "-2", retryAt: null };
  assert.deepEqual(decideResearchSlot([failed, success], slot, start + 2), { collect: false, retry: false });
  assert.deepEqual(decideResearchSlot([failed, success], "utc-2025-01-11-12", start + 2 * day),
    { collect: true, key: "utc-2025-01-11-12-1" });
  const prior = [{ ...success, requests: [{ source: "OpenLigaDB", status: "cached", url: "https://api.openligadb.de/getmatchdata/bl2/2025" }] }];
  assert.equal(seasonCacheAge(prior, start + day / 2), 7 * day);
  assert.equal(seasonCacheAge(prior, start + 2 * day), 0);
});

test("metric calculation opens only after the observation threshold", () => {
  const events = Array.from({ length: MIN_SETTLED_MATCHES }, (_, index) => ({
    ...event, home: "team-" + index, sources: [{ title: "publisher", id: String(index) }],
  }));
  const forecasts = events.map((item) => ({ ...pick("elo"), ...item }));
  const results = events.map((item) => ({ ...item, ...result(start + day, [2, 0]), home: item.home, sources: item.sources }));
  const snapshot = run(start - day, events, forecasts);
  const assess = (rows) => researchReport([snapshot, run(start + day, [], [], rows)], start + day).bySport.cs2.all;
  assert.equal(assess(results.slice(1)).models.elo.brier, undefined);
  assert.ok(Math.abs(assess(results).models.elo.brier - 0.08) < 1e-8);
});

test("a verified result attached to a conflicting provider identity quarantines the first prediction", () => {
  const first = run(start - day, [event], [pick("elo")]);
  const wrongTeam = { ...result(start + 2 * day, [2, 0]), away: "other" };
  const report = researchReport([first, run(start + 2 * day, [], [], [wrongTeam])], start + 2 * day);
  assert.equal(report.bySport.cs2.all.forecastReconciliation.matchingErrors, 1);
  assert.equal(report.bySport.cs2.all.scoredEvents, 0);
});

test("the OS lock excludes another collector and releases after a process is killed", { timeout: 10_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "sports-process-"));
  const module = new URL("../scripts/sports-research-lock.mjs", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e",
    `import {withResearchLock} from ${JSON.stringify(module)};
     await withResearchLock(process.argv[1], () => { console.log('locked'); return new Promise(() => {}); });`, root],
  { stdio: ["ignore", "pipe", "pipe"] });
  const closed = once(child, "close");
  try {
    await Promise.race([once(child.stdout, "data"), closed.then(([code]) => { throw new Error("Child exited " + code); })]);
    await assert.rejects(withResearchLock(root, () => {}), /уже выполняется/);
    child.kill("SIGKILL");
    await closed;
    await writeFile(join(root, "collect.lock"), JSON.stringify({ pid: child.pid }));
    assert.equal(await withResearchLock(root, () => "recovered"), "recovered");
    await writeFile(join(root, "collect.lock"), JSON.stringify({ pid: process.pid }));
    await assert.rejects(withResearchLock(root, () => {}), /ещё работает/);
  } finally {
    child.kill("SIGKILL");
    await closed;
    await rm(root, { recursive: true, force: true });
  }
});
