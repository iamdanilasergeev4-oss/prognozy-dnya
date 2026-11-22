import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { DAY, parseSeasonResults, readResearchSnapshots, saveResearchSnapshot } from "../scripts/sports-research-history.mjs";
import { evidenceTier, tournamentContext, validSeries } from "../scripts/sports-evidence.mjs";
import { mergeHistory, compareHistory } from "../scripts/sports-history-analysis.mjs";
import { createSparseModel } from "../scripts/sports-sparse-model.mjs";

const now = Date.parse("2026-11-22T00:00:00Z");
const finished = {
  id: "1", sport: "football", competition: "eng1", season: "2026-27", home: "home", away: "away", score: [2, 0],
  start: now - 3 * DAY, observedAt: now, sources: [{ title: "openfootball", url: "https://openfootball.github.io/england/file.json" }],
};

test("history imports date-precision results from the named season and excludes future and fresh dates", () => {
  const results = parseSeasonResults({ name: "Premier League 2026/27", matches: [
    { date: "2026-11-11", team1: "Home", team2: "Away", score: [1, 0] },
    { date: "2026-11-21", team1: "Home", team2: "Away", score: [2, 0] },
    { date: "2026-11-22", team1: "Home", team2: "Away", score: [3, 0] },
  ] }, { competition: "eng1", season: "2026-27", observedAt: now, url: finished.sources[0].url });
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].score, [1, 0]);
  assert.equal(results[0].observedAt, now);
  assert.throws(() => parseSeasonResults({ name: "2025/26", matches: [] },
    { competition: "eng1", season: "2026-27" }), /другого сезона/);
});

test("append-only snapshots are idempotent and hidden in a replay before the observation date", async () => {
  const temp = await mkdtemp(join(tmpdir(), "sports-research-"));
  try {
    const item = { at: now, results: [finished], maps: [] };
    await saveResearchSnapshot(temp, item);
    await saveResearchSnapshot(temp, item);
    assert.deepEqual(await readResearchSnapshots(temp, now - 1), []);
    assert.deepEqual(await readResearchSnapshots(temp, now), [item]);
  } finally {
    await rm(temp, { recursive: true });
  }
});

test("a future revision is invisible and conflicting final scores are quarantined", () => {
  const reverse = { ...finished, home: finished.away, away: finished.home, score: [0, 2], id: "2" };
  const conflict = { ...finished, score: [4, 1], observedAt: now + DAY, id: "3" };
  assert.equal(mergeHistory([finished, reverse, conflict], now).history.length, 1);
  assert.equal(mergeHistory([finished, reverse, conflict], now + DAY).history.length, 0);
  assert.equal(mergeHistory([finished, reverse, conflict], now + DAY).conflicts.length, 1);
});

test("Championship club suffixes merge without merging a reserve side", () => {
  const fixture = { ...finished, competition: "eng2", home: "bristol city", away: "wrexham" };
  const archived = { ...fixture, id: "archived", home: "bristol city fc", away: "wrexham afc" };
  const reserve = { ...fixture, id: "reserve", home: "bristol city u21" };
  const result = mergeHistory([fixture, archived, reserve], now);
  assert.deepEqual(result.history.map(({ home }) => home), ["bristol city", "bristol city u21"]);
  assert.deepEqual(result.conflicts, []);
});

test("official status is scoped and mirror credit does not establish independence", () => {
  const match = { sport: "hockey", competition: "nhl", status: "unconfirmed",
    sources: [{ title: "NHL", url: "https://www.nhl.com/gamecenter/example" }] };
  assert.equal(evidenceTier(match), "official");
  assert.equal(evidenceTier({ ...match, competition: "ahl" }), "secondary");
  const source = { title: "one", url: "https://one.test/", origin: "one-feed" };
  const mirror = { title: "two", url: "https://two.test/", origin: "one-feed" };
  assert.equal(evidenceTier(match, [source, mirror]), "secondary");
  assert.equal(evidenceTier(match, [source, { ...mirror, origin: null }]), "corroborated_unknown_origin");
  assert.equal(evidenceTier(match, [source, { ...mirror, origin: "different" }]), "independent");
  assert.equal(evidenceTier({ ...match, verificationReason: "time_conflict" }), "conflicting");
});

test("named volleyball season and esports format can be resolved independently of patch", () => {
  const volleyball = { sport: "volleyball", competition: "superlega", start: now, sources: [] };
  assert.deepEqual(tournamentContext(volleyball), { season: "2026-27", rules: "BO5" });
  assert.equal(tournamentContext({ ...volleyball, season: "2025" }).season, null);
  const series = { sport: "dota2", start: now, sources: [{ title: "a", format: "BO2" }, { title: "b" }] };
  assert.equal(tournamentContext(series).rules, "BO2");
  assert.equal(tournamentContext({ ...series, sources: [...series.sources, { title: "c", format: "BO3" }] }).rules, null);
  assert.equal(validSeries([1, 1], "BO2", "dota2"), true);
  assert.equal(validSeries([1, 1], "BO3", "dota2"), false);
});

test("short-history model requires enough distinct matches and omits later observations", () => {
  const model = createSparseModel();
  const match = { ...finished, start: now + DAY };
  for (const side of ["home", "away"]) {
    for (let i = 0; i < 3; i++) {
      model.observe({ ...finished, id: `${side}-${i}`, home: side, away: `opponent-${i}`,
        observedAt: side === "away" && i === 2 ? now + 2000 : now });
    }
  }
  assert.equal(model.predict(match, now), null);
  const ready = model.predict(match, now + 2000);
  assert.deepEqual(ready.matches, [3, 3]);
  assert.equal(ready.reliability, "unvalidated");
});

test("per-match diagnostics identify sides with no data separately from the source tier", () => {
  const fixture = { ...finished, start: now + DAY, status: "confirmed", dataQuality: {},
    sources: [finished.sources[0], { title: "ESPN", url: "https://www.espn.com/" }] };
  const baseline = { assessed: [fixture], forecastEvidence: [], requests: [],
    sports: { football: { detected: 1, confirmed: 1, forecast: 0, historyAvailable: 0 } } };
  const report = compareHistory(baseline, [{ at: now, results: [finished], maps: [] }], now);
  assert.deepEqual(report.assessed[0].historyMatches, [1, 1]);
  assert.equal(report.assessed[0].sourceTier, "corroborated_unknown_origin");
  assert(report.assessed[0].missing.includes("history_sample"));
  assert.equal(report.sports.football.historyAvailable, 1);
  assert.equal(report.sports.football.forecast, 0);
});
