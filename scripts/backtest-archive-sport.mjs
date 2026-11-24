import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateProbabilities } from "./sports-evaluation.mjs";
import { createOutcomeModel } from "./sports-models.mjs";
import { createSparseModel } from "./sports-sparse-model.mjs";
import { tennisSingles, verifiedResult } from "./sports-historical-inputs.mjs";
import { readResearchSnapshots } from "./sports-research-history.mjs";
import { pairedWeekInterval } from "./sports-model-comparison.mjs";

const esports = new Set(["cs2", "dota2"]);
const sports = ["cs2", "dota2", "tennis", "volleyball"];
const metric = (rows, key) => evaluateProbabilities(rows.map((row) => ({
  actual: row.actual, probabilities: row[key],
})));

function candidateCohort(event) {
  return { ...event, season: "longitudinal",
    competition: event.sport === "tennis" ? event.tour : event.competition };
}

export function archiveBacktest(events, cutoff) {
  const baseline = createOutcomeModel();
  const shortForm = createSparseModel();
  const candidate = createOutcomeModel();
  // Results without a known version count toward archive coverage. Matching
  // model cohorts and the original patch-dependent control require a version.
  const usable = events.filter((event) => !esports.has(event.sport) || event.patch);
  const observations = [...usable].sort((a, b) => a.available - b.available || a.id.localeCompare(b.id));
  const tests = usable.filter((event) => event.start >= cutoff).sort((a, b) => a.start - b.start);
  let cursor = 0;
  const rows = tests.map((event) => {
    while (cursor < observations.length && observations[cursor].available < event.start) {
      const past = observations[cursor++];
      const observed = { ...past, start: past.available };
      baseline.observe(observed);
      shortForm.observe(past);
      candidate.observe(candidateCohort(observed));
    }
    const [a, b] = event.score;
    const draw = event.sport === "dota2" && event.rules === "BO2";
    return { competition: event.competition, season: event.season, level: event.level, rules: event.rules,
      tour: event.tour, actual: a > b ? "home" : a < b ? "away" : "draw",
      baseline: baseline.predict(event)?.probabilities,
      shortForm: shortForm.predict(event)?.probabilities,
      candidate: candidate.predict(candidateCohort(event))?.probabilities,
      uniform: draw ? { home: 1 / 3, draw: 1 / 3, away: 1 / 3 } : { home: 0.5, away: 0.5 } };
  });
  const summarize = (sample) => {
    const coverage = Object.fromEntries(["baseline", "shortForm", "candidate"].map((key) =>
      [key, sample.filter((row) => row[key]).length]));
    const comparisons = Object.fromEntries(["baseline", "shortForm", "uniform"].map((key) => {
      const common = sample.filter((row) => row.candidate && row[key]);
      return [key, { matches: common.length, candidate: metric(common, "candidate"), control: metric(common, key) }];
    }));
    return { matches: sample.length, coverage, comparisons };
  };
  return { ...summarize(rows), byGroup: Object.fromEntries(
    [...Map.groupBy(rows, (row) => JSON.stringify([row.tour || row.competition, row.rules, row.level ?? null]))]
      .map(([key, sample]) => [key, summarize(sample)])) };
}

// Research comparison for complete BO3 results even when the patch is absent.
// Actual named maps are not inferred from series scores.
export function replayBestOfThree(events, cutoff, { until = Infinity, auditCoverage = false } = {}) {
  const day = 86_400_000;
  const sorted = events.filter(({ sport, rules }) => esports.has(sport) && rules === "BO3")
    .sort((a, b) => a.start - b.start);
  const short = createSparseModel();
  const predictions = [];
  const observed = [...sorted].sort((a, b) => a.available - b.available);
  const maps = new Map();
  const key = (event, team) => JSON.stringify([event.sport, event.competition, team]);
  let cursor = 0;
  for (const event of sorted.filter(({ start }) => start >= cutoff && start < until)) {
    while (cursor < observed.length && observed[cursor].available < event.start) {
      const prior = observed[cursor++];
      const teamIds = [prior.home, prior.away];
      for (const [side, team] of teamIds.entries()) {
        const id = key(prior, team);
        const rows = maps.get(id) ?? [];
        maps.set(id, [...rows.slice(-31), { at: prior.available, won: prior.score[side], lost: prior.score[1 - side] }]);
      }
      short.observe(prior);
    }
    const window = event.sport === "cs2" ? 90 : 45;
    const history = [event.home, event.away].map((team) =>
      (maps.get(key(event, team)) ?? []).filter(({ at }) => event.start - at <= window * day));
    const rates = history.map((rows) => {
      if (rows.length < 4) return null;
      let won = 4;
      let lost = 4;
      for (const row of rows) {
        const weight = Math.exp(-(event.start - row.at) / (window * day));
        won += row.won * weight;
        lost += row.lost * weight;
      }
      return won / lost;
    });
    const p = rates.every((value) => value !== null) ? rates[0] / (rates[0] + rates[1]) : null;
    const home = p === null ? null : p * p * (3 - 2 * p);
    predictions.push({ start: event.start, actual: event.score[0] > event.score[1] ? "home" : "away",
      counts: history.map((rows) => rows.length),
      candidate: home === null ? null : { home, away: 1 - home },
      short: short.predict(event)?.probabilities, uniform: { home: 0.5, away: 0.5 } });
  }
  const comparisons = Object.fromEntries(["short", "uniform"].map((control) => {
    const paired = predictions.filter((row) => row.candidate && row[control]);
    const brier = (actual, p) => 2 * (p.home - Number(actual === "home")) ** 2;
    return [control, { paired: paired.length, candidate: metric(paired, "candidate"), control: metric(paired, control),
      interval: pairedWeekInterval(paired, "candidate", brier, control) }];
  }));
  return { archiveSeries: sorted.length, testSeries: predictions.length,
    predictions: predictions.filter(({ candidate }) => candidate).length, comparisons,
    ...(auditCoverage ? { history: {
      neitherHasHistory: predictions.filter(({ counts }) => counts.every((n) => !n)).length,
      onlyOneHasHistory: predictions.filter(({ counts }) => counts.filter(Boolean).length === 1).length,
      bothHaveHistoryButUnderThreshold: predictions.filter(({ candidate, counts }) => !candidate && counts.every(Boolean)).length,
      coverageOfSimpleForm: predictions.filter(({ short: prediction }) => prediction).length,
    } } : {}) };
}

export async function runArchiveBacktest(sport, cutoffDate, paths, mapDirectory, asObserved = false) {
  const cutoff = Date.parse(cutoffDate);
  if (!sports.includes(sport) || !/^\d{4}-\d\d-\d\d$/.test(cutoffDate) || !Number.isFinite(cutoff) ||
      new Date(cutoff).toISOString().slice(0, 10) !== cutoffDate ||
      (!paths.length && !(sport === "dota2" && mapDirectory)) || (mapDirectory && sport !== "dota2") ||
      (asObserved && sport === "tennis")) {
    throw new Error("Usage: backtest-archive-sport.mjs <cs2|dota2|tennis|volleyball> <YYYY-MM-DD> [--as-observed] [--dota-maps=<snapshot directory>] <files...>");
  }
  const sources = [];
  const events = new Map();
  const conflicts = new Set();
  let rejected = 0;
  for (const path of paths) {
    const body = await readFile(path);
    const hash = createHash("sha256").update(body).digest("hex");
    const text = body.toString("utf8");
    let parsed;
    if (sport === "tennis") {
      const file = basename(path).match(/^(atp|wta)_matches_\d{4}\.csv$/);
      if (!file) throw new Error("Expected ATP or WTA singles season CSV");
      sources.push({ file: basename(path), sha256: hash, origin: "Jeff Sackmann", licence: "CC BY-NC-SA 4.0" });
      parsed = tennisSingles(text, file[1].toUpperCase());
    } else {
      const { origin, url, rights, rows, capturedAt } = JSON.parse(text);
      const captured = Date.parse(capturedAt);
      if (!/^[a-z][a-z0-9-]+$/.test(origin) || typeof rights !== "string" || !rights.trim() ||
          new URL(url).protocol !== "https:" || !Array.isArray(rows) ||
          (asObserved && !Number.isFinite(captured))) throw new Error("Missing archive provenance");
      sources.push({ file: basename(path), sha256: hash, origin, url, rights, capturedAt: capturedAt ?? null });
      parsed = rows.map((row) => verifiedResult(row, sport, origin));
    }
    for (const event of parsed) {
      if (!event) {
        rejected++;
        continue;
      }
      const previous = events.get(event.id);
      if (previous && JSON.stringify(previous.event) !== JSON.stringify(event)) conflicts.add(event.id);
      const captured = Date.parse(sources.at(-1).capturedAt);
      events.set(event.id, { event, captured: Math.min(previous?.captured ?? Infinity,
        Number.isFinite(captured) ? captured : Infinity) });
    }
  }
  for (const conflict of conflicts) events.delete(conflict);
  const accepted = [...events.values()].map(({ event, captured }) => asObserved ?
    { ...event, available: Math.max(event.available, captured) } : event);
  const circuits = Map.groupBy(accepted, (event) => event.competition);
  let mapInventory;
  if (mapDirectory) {
    const snapshots = await readResearchSnapshots(mapDirectory, Infinity);
    if (!snapshots.length) throw new Error("No dated Dota map snapshots found");
    const maps = new Map(snapshots.flatMap((snapshot) => (snapshot.maps || []).map((map) => [map.id, map])));
    mapInventory = { source: "OpenDota", maps: maps.size,
      tournaments: Object.fromEntries([...Map.groupBy(maps.values(), (map) => map.tournament || "unknown")]
        .map(([key, group]) => [key, group.length])) };
  }
  return { sport, cutoff: cutoffDate, availability: asObserved ? "captured" : "historical-delay", sources,
    data: { rejected, conflicts: conflicts.size, eligible: accepted.length,
      competitions: Object.fromEntries([...circuits].map(([name, rows]) => [name, rows.length])),
      ...(esports.has(sport) ? { unit: "series", withRosters: accepted.filter((event) => event.rosters).length,
        withPatch: accepted.filter((event) => event.patch).length } : {}),
      ...(mapInventory ? { mapInventory } : {}) },
    evaluation: archiveBacktest(accepted, cutoff) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [sport, cutoff, ...args] = process.argv.slice(2);
  const option = "--dota-maps=";
  const maps = args.find((arg) => arg.startsWith(option))?.slice(option.length);
  console.log(JSON.stringify(await runArchiveBacktest(sport, cutoff,
    args.filter((arg) => !arg.startsWith(option) && arg !== "--as-observed"), maps, args.includes("--as-observed")), null, 2));
}
