import assert from "node:assert/strict";
import { test } from "node:test";
import { DAY } from "../scripts/sports-research-history.mjs";
import { importCs2Maps, replayCs2 } from "../scripts/sports-cs2-research.mjs";

function sweep(id, day, team1 = "Team A", team2 = "Team B") {
  return ["de_ancient", "de_mirage"].map((map_name, index) => ({
    match_id: id, match_date: `2026-04-${day}T15:00:00.000Z`, map_name, map_index: index + 1,
    match_url: `https://www.hltv.org/matches/${id}/test`, event: "PGL Bucharest 2026",
    team1, team2, format: "bo3", score1: 2, score2: 0, winner: "team1", rounds_played: 28,
  }));
}

test("imports one BO3 per complete set of maps and retains source and level", () => {
  const { events, rejected } = importCs2Maps(sweep(1, "04").reverse());
  assert.deepEqual(rejected, {});
  assert.equal(events.length, 1);
  assert.equal(events[0].level, "tier_1");
  assert.equal(events[0].available, Date.parse("2026-04-06"));
  assert.match(events[0].url, /\/matches\/1\//);
  assert.deepEqual(events[0].maps, [{ name: "de_ancient", rounds: 28 }, { name: "de_mirage", rounds: 28 }]);
});

test("drops partial, conflicting and potentially duplicated BO3 results", () => {
  const incomplete = sweep(1, "04").slice(0, 1);
  const conflicting = sweep(2, "05");
  conflicting[1].score2 = 1;
  const overlap = [...sweep(3, "06"), ...sweep(4, "06", "team b", "team a")];
  const result = importCs2Maps([...incomplete, ...conflicting, ...overlap]);
  assert.equal(result.events.length, 0);
  assert.deepEqual(result.rejected, { incomplete_or_invalid_maps: 1, conflicting_series_metadata: 1,
    ambiguous_same_day_pair: 2 });
});

test("allows a verified series score with partial maps and deduplicates the same publisher's two exports", () => {
  const complete = sweep(1, "04");
  const partial = sweep(2, "05").slice(0, 1);
  const conflictingDates = sweep(3, "06");
  conflictingDates[1].match_date = "2026-04-07T00:00:00Z";
  const result = importCs2Maps([...complete, ...complete, ...partial, ...conflictingDates], { seriesOnly: true });
  assert.equal(result.events.length, 2);
  assert.equal(result.repeatedMapRows, 2);
  assert.deepEqual(result.rejected, { conflicting_dates: 1 });
  assert.deepEqual(result.mapIssues, { incomplete_map_list: 1 });
  assert.deepEqual(result.events.map((row) => row.maps.length), [2, 0]);
});

test("restores two corroborated same-day series without using their precise times", () => {
  const { events } = importCs2Maps([...sweep(2393406, "20"), ...sweep(2393408, "20")], { seriesOnly: true });
  assert.equal(events.length, 2);
  assert.ok(events.every((event) => event.rematchSource.startsWith("https://ensigame.com/")));
  assert.equal(events[0].available, events[1].available);
});

test("requires four prior results per side and excludes results at the cutoff", () => {
  const rows = ["01", "02", "03", "04"].flatMap((day, i) => sweep(i + 1, day));
  const events = importCs2Maps([...rows, ...sweep(5, "06"), ...sweep(6, "07"), ...sweep(7, "08")]).events;
  const results = replayCs2(events, Date.parse("2026-04-06"));
  assert.equal(results[0].mapElo, null);
  assert.equal(results[0].missing, "awaiting_availability");
  assert.equal(results[0].seriesElo, null);
  assert.ok(results[1].mapElo.home > 0.5);
  assert.equal(results[1].mapElo.home + results[1].mapElo.away, 1);
  const withoutFuture = events.filter(({ start }) => start <= Date.parse("2026-04-07"));
  assert.deepEqual(replayCs2(withoutFuture, Date.parse("2026-04-06")), results.slice(0, 2));
  assert.ok(events.slice(0, 4).every(({ start, available }) => available - start === 2 * DAY));
});

test("distinguishes missing and outdated history without admitting future results", () => {
  const rows = ["01", "02", "03", "04"].flatMap((day, i) => sweep(i + 1, day));
  const { events } = importCs2Maps([...rows, ...sweep(5, "06", "A", "B"), ...sweep(6, "07")]);
  const [missing, stale] = events.slice(-2).map((event) => ({ ...event,
    start: event.start + 61 * DAY, available: event.available + 61 * DAY }));
  const results = replayCs2([...events.slice(0, 4), missing, stale], missing.start);
  assert.deepEqual(results.map((row) => [row.missing, row.noEarlierSeries]),
    [["too_few_prior_results", true], ["outside_recent_window", false]]);
});

test("updates ratings from the same prior state for matches on one day", () => {
  const rows = ["01", "02", "03", "04"].flatMap((day, i) => [
    ...sweep(i + 1, day, "A", "C"), ...sweep(i + 5, day, "D", "B"),
  ]);
  const { events } = importCs2Maps([...rows, ...sweep(9, "04", "B", "A"), ...sweep(10, "09", "A", "B")]);
  const cutoff = Date.parse("2026-04-09");
  assert.deepEqual(replayCs2(events, cutoff), replayCs2([...events].reverse(), cutoff));
});
