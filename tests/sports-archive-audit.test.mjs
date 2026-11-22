import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { rankBefore, rankingIndex, tennisAudit } from "../scripts/backtest-tennis-audit.mjs";
import { importArchive, linkSeries, openDotaMap, pandaSeries } from "../scripts/import-sports-archive.mjs";

test("ranking timestamps are strict and unreconciled rank conflicts are excluded", () => {
  const rankings = rankingIndex("ranking_date,ranking,player_id,ranking_points\n" +
    "20240101,7,14,40\n20240108,5,14,50\n20240108,6,14,50\n20240115,2,14,70");
  assert.equal(rankBefore(rankings, "14", Date.parse("2024-01-08")), 7);
  assert.equal(rankBefore(rankings, "14", Date.parse("2024-01-15")), null);
  assert.equal(rankBefore(rankings, "14", Date.parse("2024-01-16")), 2);
  assert.equal(rankBefore(rankings, "14", Date.parse("2024-03-01")), null);
});

test("tennis audit excludes observations on the decision date and later", () => {
  const day = 86_400_000;
  const start = Date.parse("2024-04-01");
  const cutoff = start - 7 * day;
  const match = { id: "target", tour: "ATP", sport: "tennis", start, available: start + 30 * day,
    season: "2024", home: "1", away: "2", rules: "singles:clay:BO3", surface: "clay", score: [2, 0] };
  const fixtures = Array.from({ length: 4 }, (_, index) =>
    ({ ...match, id: String(index), start: start - 40 * day, available: cutoff + index }));
  const run = () => tennisAudit([match, ...fixtures], new Map([["ATP", new Map()]]), start, start + day)[0];
  assert.equal(run().candidate, undefined);
  for (const fixture of fixtures) fixture.available = cutoff - day;
  assert.ok(run().candidate);
});

const panda = { id: 345, begin_at: "2024-01-01T12:00:00Z", end_at: "2024-01-01T15:00:00Z",
  opponents: [{ type: "Team", opponent: { id: 11 } }, { type: "Team", opponent: { id: 22 } }],
  results: [{ team_id: 22, score: 1 }, { team_id: 11, score: 2 }],
  tournament_id: 13, videogame: { slug: "cs-go" }, status: "finished", match_type: "best_of",
  forfeit: false, draw: false, winner_id: 11, number_of_games: 3 };

test("PandaScore import aligns results by team ID and accepts a series without metadata", async () => {
  assert.deepEqual(pandaSeries(panda, "cs2").score, [2, 1]);
  assert.equal(pandaSeries({ ...panda, winner_id: 99 }, "cs2"), null);
  const dir = await mkdtemp(join(tmpdir(), "sports-archive-"));
  try {
    const manifest = join(dir, "manifest.json");
    const source = join(dir, "export.json");
    await writeFile(manifest, JSON.stringify({ sport: "cs2", game: "cs2", origin: "pandascore",
      url: "https://api.pandascore.co/csgo/matches/past", rights: "test fixture",
      format: "pandascore", payload: "export.json", capturedAt: "2024-01-02T00:00:00Z" }));
    await writeFile(source, JSON.stringify([panda, panda, { ...panda, id: 346, status: "running" }]));
    const imported = await importArchive(manifest);
    assert.equal(imported.rows.length, 1);
    assert.equal(imported.quality.rejectedMatches, 1);
    assert.equal(imported.sources.length, 2);
    await writeFile(source, JSON.stringify([panda, { ...panda, number_of_games: 5,
      results: [{ team_id: 22, score: 1 }, { team_id: 11, score: 3 }] }]));
    assert.deepEqual((await importArchive(manifest)).quality.conflictingMatches, ["345"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("OpenDota links maps only by an explicit crosswalk and preserves incomplete status", () => {
  const series = pandaSeries(panda, "cs2");
  const raw = { match_id: 400, series_id: 42, leagueid: 54, radiant_team_id: 7, dire_team_id: 8,
    start_time: Date.parse("2024-01-01T12:01:00Z") / 1000, duration: 600, radiant_win: true, version: 22 };
  const map = openDotaMap(raw);
  const link = { id: "345", mapSeriesId: "42", competition: "54", teams: ["7", "8"], evidence: "https://example.org/series" };
  assert.equal(map.patch, null);
  assert.deepEqual(linkSeries([series], [map], [], false).links, []);
  assert.equal(linkSeries([series], [map], [link], false).links[0].status, "partial");
  assert.equal(linkSeries([series], [map], [{ ...link, competition: "12" }], false).links[0].status, "conflict");
  assert.equal(linkSeries([series], [map], [link], false, new Set(["42"])).links[0].status, "conflict");
});
