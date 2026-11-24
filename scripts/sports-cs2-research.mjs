import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateProbabilities } from "./sports-evaluation.mjs";
import { pairedWeekInterval } from "./sports-model-comparison.mjs";
import { DAY } from "./sports-research-history.mjs";
import { createSparseModel } from "./sports-sparse-model.mjs";

const revision = "a8ae320211f8f6a731362f43cd6e69ff1f0d326f";
const dataset = "https://huggingface.co/datasets/blanchon/opencs2_dataset_wds";
export const cs2Source = {
  title: "OpenCS2 (Julien Blanchon)",
  url: dataset,
  file: `${dataset}/resolve/${revision}/index/matches.parquet`,
  license: "https://creativecommons.org/licenses/by/4.0/",
  sha256: "b4d83ba3413d35a7f5da6d04f8d5c41597caddb4fb29b4a3a865f5446945a685",
};

export const cs2DemoSource = {
  title: "OpenCS2 Demos (Julien Blanchon)",
  url: "https://huggingface.co/datasets/blanchon/opencs2_dataset_demo",
  revision: "c9aa55e4e8f9bd5e784f0d66d8bf4e40f9b7a8f5",
  license: cs2Source.license,
  files: 137,
  bytes: 13071350,
  manifestSha256: "9fa8af1be03fdbe1a635fb2900fb6ce6d456de755a1c04e067c62d60f5b7afc2",
};

const matchFields = ["team1", "team2", "event", "format", "score1", "score2", "winner", "match_url"];
const verifiedRematches = [
  { ids: [2391946, 2391949], source: "https://ensigame.com/matches/cs-2/1777254-johnny-speeds-js-vs-fc-famalicao-esports-famalicao-rog-24-03-26" },
  { ids: [2393406, 2393408], source: "https://ensigame.com/tournaments/cs-2/2026-parken-challenger-championship-5-pcc/substage/119996" },
];
const tierSources = {
  tier_1: "https://www.pglesports.com/cs2/pgl-bucharest-2026/",
  challenger: "https://pro.eslgaming.com/tour/pt/2025/11/esl-challenger-league-season-51-additional-information/",
};
const tournamentLevel = (event) => event === "PGL Bucharest 2026" ? "tier_1" :
  /^ESL Challenger League Season 51 (Europe|Oceania|Asia-Pacific|South America|North America) Cup [23]$/.test(event)
    ? "challenger" : "unknown";
const identity = (name) => typeof name === "string" ? name.normalize("NFC").trim().toLowerCase() : "";
const timestamp = (value) => value instanceof Date ? value.getTime() :
  typeof value === "string" ? Date.parse(value) : NaN;
const validRounds = (total) => Number.isSafeInteger(total) &&
  (total >= 13 && total <= 24 || total >= 28 && (total - 28) % 6 <= 2);
const validScore = (score) => score.every(Number.isSafeInteger) &&
  Math.max(...score) === 2 && Math.min(...score) >= 0 && Math.min(...score) < 2;
const hash = (body) => createHash("sha256").update(body).digest("hex");
const readParquet = (body, reader, options = {}) =>
  reader({ file: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength), ...options });

export function importCs2Maps(rows, { seriesOnly = false } = {}) {
  const rejected = {};
  const mapIssues = {};
  const reject = (reason) => { rejected[reason] = (rejected[reason] ?? 0) + 1; };
  let repeatedMapRows = 0;
  const events = [];
  for (const [sourceId, group] of Map.groupBy(rows, (row) => row.match_id)) {
    const first = group[0];
    const time = timestamp(first.match_date);
    const start = Math.floor(time / DAY) * DAY;
    const home = identity(first.team1);
    const away = identity(first.team2);
    const score = [first.score1, first.score2];
    if (!Number.isFinite(start)) {
      reject("invalid_date");
      continue;
    }
    if (!Number.isSafeInteger(sourceId) || sourceId <= 0 || !home || !away || home === away ||
        !identity(first.event) || typeof first.match_url !== "string" ||
        !first.match_url.startsWith(`https://www.hltv.org/matches/${sourceId}/`)) {
      reject("invalid_identity");
      continue;
    }
    if (group.some((row) => timestamp(row.match_date) !== time)) {
      reject("conflicting_dates");
      continue;
    }
    if (group.some((row) => matchFields.some((field) => row[field] !== first[field]))) {
      reject("conflicting_series_metadata");
      continue;
    }
    if (first.format !== "bo3" || !validScore(score) || first.winner !== (score[0] === 2 ? "team1" : "team2")) {
      reject("invalid_bo3");
      continue;
    }
    const distinct = seriesOnly ? [...new Map(group.map((row) =>
      [JSON.stringify([row.map_index, row.map_name, row.rounds_played]), row])).values()] : group;
    repeatedMapRows += group.length - distinct.length;
    const maps = [...distinct].sort((a, b) => a.map_index - b.map_index);
    let issue = null;
    if (new Set(maps.map((row) => row.map_index)).size < maps.length) issue = "conflicting_maps";
    else if (maps.some((row) => !/^de_[a-z0-9_]+$/.test(row.map_name) || !validRounds(row.rounds_played))) issue = "invalid_map_stats";
    else if (maps.length !== score[0] + score[1] || new Set(maps.map((row) => row.map_name)).size !== maps.length ||
        maps.some((row, index) => row.map_index !== index + 1)) issue = "incomplete_map_list";
    if (issue) {
      mapIssues[issue] = (mapIssues[issue] ?? 0) + 1;
      if (!seriesOnly) {
        reject("incomplete_or_invalid_maps");
        continue;
      }
    }
    events.push({ id: `opencs2:${sourceId}`, sourceId, sport: "cs2", home, away, score, start, available: start + 2 * DAY,
      rules: "BO3", season: String(new Date(start).getUTCFullYear()), competition: first.event,
      level: tournamentLevel(first.event), url: first.match_url,
      maps: issue ? [] : maps.map((row) => ({ name: row.map_name, rounds: row.rounds_played })), mapIssue: issue });
  }
  // Different IDs for the same unordered pair and UTC day may be rematches.
  // Exclude ambiguous groups rather than treating either instance as verified.
  const groups = Map.groupBy(events, ({ start, home, away }) => JSON.stringify([start, ...[home, away].sort()]));
  const unique = [...groups.values()].flatMap((group) => {
    if (group.length === 1) return group;
    const confirmed = seriesOnly && verifiedRematches.find(({ ids }) =>
      ids.length === group.length && group.every(({ sourceId }) => ids.includes(sourceId)));
    if (confirmed) return group.map((row) => ({ ...row, rematchSource: confirmed.source }));
    group.forEach(() => reject("ambiguous_same_day_pair"));
    return [];
  });
  return { events: unique, rejected, mapIssues, repeatedMapRows,
    inputMaps: rows.length, inputSeries: new Set(rows.map((row) => row.match_id)).size };
}

const probabilities = (home) => ({ home, away: 1 - home });
const logistic = (rating) => 1 / (1 + 10 ** (-rating / 400));
const toBo3 = (p) => p * p * (3 - 2 * p);
const brier = (actual, p) => 2 * (p.home - Number(actual === "home")) ** 2;
const minimumHistory = 4;
const recentWindow = 60 * DAY;

export function replayCs2(events, testFrom, minMatches = minimumHistory) {
  const sorted = [...events].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const updates = [...Map.groupBy(sorted, (event) => event.available)]
    .sort(([a], [b]) => a - b);
  const state = new Map();
  const empty = { series: 0, maps: 0, dates: [] };
  const rating = (team) => state.get(team) ?? empty;
  const short = createSparseModel();
  const pooled = (event) => ({ ...event, competition: "OpenCS2 BO3" });
  const prior = new Map();
  let pastCursor = 0;
  let cursor = 0;
  return sorted.filter((event) => event.start >= testFrom).map((event) => {
    while (pastCursor < sorted.length && sorted[pastCursor].start < event.start) {
      const past = sorted[pastCursor++];
      for (const team of [past.home, past.away]) {
        if (!prior.has(team)) prior.set(team, []);
        prior.get(team).push(past.start);
      }
    }
    while (cursor < updates.length && updates[cursor][0] < event.start) {
      const [, batch] = updates[cursor++];
      const changes = new Map();
      for (const past of batch) {
        const home = rating(past.home);
        const away = rating(past.away);
        const played = past.score[0] + past.score[1];
        const series = 24 * (Number(past.score[0] === 2) - logistic(home.series - away.series));
        const maps = 12 * (past.score[0] - played * logistic(home.maps - away.maps));
        for (const [side, team] of [past.home, past.away].entries()) {
          if (!changes.has(team)) changes.set(team, { series: 0, maps: 0, dates: [] });
          const delta = changes.get(team);
          const direction = side === 0 ? 1 : -1;
          delta.series += direction * series;
          delta.maps += direction * maps;
          delta.dates.push(past.start);
        }
        short.observe(pooled(past));
      }
      for (const [team, delta] of changes) {
        const previous = rating(team);
        state.set(team, { series: previous.series + delta.series, maps: previous.maps + delta.maps,
          dates: [...previous.dates, ...delta.dates] });
      }
    }
    const home = rating(event.home);
    const away = rating(event.away);
    const enoughRecent = (dates) => dates.filter((date) => event.start - date <= recentWindow).length >= minMatches;
    const ready = [home, away].every(({ dates }) => enoughRecent(dates));
    const earlier = [event.home, event.away].map((team) => prior.get(team) ?? []);
    const missing = ready ? null : earlier.some((dates) => dates.length < minMatches) ? "too_few_prior_results" :
      earlier.every(enoughRecent) ? "awaiting_availability" : "outside_recent_window";
    return { id: event.id, start: event.start, level: event.level, missing, noEarlierSeries: earlier.some((dates) => !dates.length),
      actual: event.score[0] === 2 ? "home" : "away",
      mapElo: ready ? probabilities(toBo3(logistic(home.maps - away.maps))) : null,
      seriesElo: ready ? probabilities(logistic(home.series - away.series)) : null,
      short: short.predict(pooled(event))?.probabilities ?? null, uniform: probabilities(0.5) };
  });
}

function summarize(rows) {
  const metric = (sample, key) => evaluateProbabilities(sample.map((row) => ({
    actual: row.actual, probabilities: row[key],
  })));
  return { testSeries: rows.length, predictions: rows.filter((row) => row.mapElo).length,
    excluded: Object.fromEntries([...Map.groupBy(rows.filter((row) => row.missing), (row) => row.missing)]
      .map(([reason, group]) => [reason, group.length])),
    noEarlierSeries: rows.filter((row) => row.noEarlierSeries).length,
    comparisons: Object.fromEntries(["seriesElo", "short", "uniform"].map((key) => {
      const paired = rows.filter((row) => row.mapElo && row[key]);
      return [key, { paired: paired.length, candidate: metric(paired, "mapElo"), control: metric(paired, key),
        interval: pairedWeekInterval(paired, "mapElo", brier, key) }];
    })) };
}

async function readDemoMetadata(dir, reader) {
  const manifest = [];
  const rows = [];
  // Read the pinned publisher export in file order, restricting the projection
  // to series metadata; player identity and telemetry columns are unused.
  for (let i = 0; i < cs2DemoSource.files; i++) {
    const name = `${String(i).padStart(4, "0")}.parquet`;
    const body = await readFile(join(dir, name));
    manifest.push([name, body.length, hash(body)]);
    const columns = ["match_id", "match_date", "map_index", "map_name", "rounds_played", ...matchFields];
    const maps = await readParquet(body, reader, { columns });
    rows.push(...maps.map((row) => ({ ...row, match_id: Number(row.match_id) })));
  }
  if (hash(JSON.stringify(manifest)) !== cs2DemoSource.manifestSha256) {
    throw new Error("Контрольная сумма архива метаданных OpenCS2 не совпала");
  }
  return rows;
}

function comparePublisherIds(main, additional) {
  const index = (rows) => new Map(rows.map((row) => [row.match_id, row]));
  const existing = index(main);
  const common = [...index(additional)].filter(([id]) => existing.has(id));
  const nameConflicts = common.filter(([id, row]) => ["team1", "team2"]
    .some((key) => row[key] !== existing.get(id)[key])).map(([id]) => id);
  return { commonSeriesIds: common.length, nameConflicts };
}

function auditNovember(events, april, review) {
  if (review.cs2?.competition !== "NODWIN Clutch Series 14" ||
      review.cs2.source !== "https://www.hltv.org/results?event=9469" || !Array.isArray(review.cs2.rows)) {
    throw new Error("Ожидается сохранённая сверка NODWIN Clutch Series 14");
  }
  const formatsSource = "https://www.hltv.org/events/9469/nodwin-clutch-series-14";
  const observedAt = Date.parse(review.capturedAt);
  if (!Number.isFinite(observedAt)) throw new Error("У сверки NODWIN нет даты получения");
  const parsed = review.cs2.rows.flatMap((row) => {
    const start = Date.parse(row.date);
    const home = identity(row.home);
    const away = identity(row.away);
    const available = start + 2 * DAY;
    if (!(start >= Date.parse("2026-11-10") && start <= Date.parse("2026-11-23")) ||
        new Date(start).toISOString().slice(0, 10) !== row.date || start >= observedAt ||
        !home || !away || home === away || !Array.isArray(row.score) || row.score.length !== 2 || !validScore(row.score)) return [];
    return [{ id: JSON.stringify([row.date, ...[home, away].sort()]), sport: "cs2", home, away, score: row.score,
      start, available, season: "2026", rules: "BO3", competition: review.cs2.competition, level: "unknown" }];
  });
  const checked = [...Map.groupBy(parsed, (e) => e.id).values()].filter((group) => group.length === 1).flat();
  const teams = (sample) => new Set(sample.flatMap(({ home, away }) => [home, away]));
  const novTeams = teams(checked);
  const spring = teams(events);
  const previousTeams = teams(april);
  return { source: review.cs2.source, formatsSource, observedAt: review.capturedAt, rawSeries: review.cs2.rows.length,
    archiveSeries: checked.length, availableAtCapture: checked.filter((row) => row.available < observedAt).length,
    teams: novTeams.size, snapshotSha256: hash(JSON.stringify([review.capturedAt, review.cs2])),
    sameNamesInPreviousArchive: [...novTeams].filter((team) => previousTeams.has(team)).length,
    sameNamesInExpandedArchive: [...novTeams].filter((team) => spring.has(team)).length,
    springSeriesInSixtyDayWindow: events.filter((row) => row.start >= Math.min(...checked.map((e) => e.start)) - recentWindow).length,
    checkedIdentity: {
      match: "INFINITE / Infinite Gaming",
      hltvId: 10823,
      enSiProfile: "https://ensigame.com/teams/cs-2/infinite-gaming-infinite",
      aprilBracket: verifiedRematches[1].source,
      novemberBracket: "https://ensigame.com/tournaments/cs-2/2026-nodwin-clutch-series-14-nodwin",
    },
    ...summarize(replayCs2(checked, Date.parse("2026-11-10"))) };
}

export async function auditCs2Archive(path, { metadataDir, seriesReview } = {}) {
  const file = resolve(path);
  const body = await readFile(file);
  const sha256 = hash(body);
  if (sha256 !== cs2Source.sha256) throw new Error("Контрольная сумма индекса OpenCS2 не совпала");
  const modules = join(dirname(file), "tools", "node_modules");
  const { parquetReadObjects } = await import(pathToFileURL(join(modules, "hyparquet/src/node.js")).href);
  const { compressors } = await import(pathToFileURL(join(modules, "hyparquet-compressors/src/index.js")).href);
  const reader = (options) => parquetReadObjects({ ...options, compressors });
  const rows = await readParquet(body, reader);
  const additional = metadataDir ? await readDemoMetadata(resolve(metadataDir), reader) : [];
  const previous = importCs2Maps(rows);
  const recovered = importCs2Maps(rows, { seriesOnly: true });
  const { events, ...coverage } = metadataDir ? importCs2Maps([...rows, ...additional], { seriesOnly: true }) : recovered;
  const testFrom = Date.parse("2026-04-01");
  const secondFrom = Date.parse("2026-04-11");
  const priorReplay = replayCs2(previous.events, testFrom);
  const priorTests = new Set(priorReplay.map(({ id }) => id));
  const priorPairs = new Set(priorReplay.filter((row) => row.mapElo && row.short).map(({ id }) => id));
  const replay = replayCs2(events, testFrom);
  const periods = [testFrom, secondFrom].map((from, i) => ({
    from: new Date(from).toISOString().slice(0, 10),
    ...summarize(replay.filter((row) => row.start >= from && (i === 1 || row.start < secondFrom))),
  }));
  const dates = events.map(({ start }) => start);
  const overall = summarize(replay);
  return { schema: 2, source: cs2Source, tierSources, model: "cs2-bo3-map-elo-1", ...coverage,
    ...(metadataDir ? { additionalSource: cs2DemoSource, identity: comparePublisherIds(rows, additional) } : {}),
    ...(seriesReview ? { november: auditNovember(events, previous.events, JSON.parse(await readFile(seriesReview, "utf8"))) } : {}),
    archiveSeries: events.length, maps: events.reduce((sum, row) => sum + row.maps.length, 0),
    seriesWithoutCompleteMaps: events.filter((row) => row.mapIssue).length,
    restoredRematches: events.filter((row) => row.rematchSource).map(({ id, rematchSource }) => ({ id, source: rematchSource })),
    tournaments: new Set(events.map(({ competition }) => competition)).size,
    firstDay: new Date(Math.min(...dates)).toISOString().slice(0, 10),
    lastDay: new Date(Math.max(...dates)).toISOString().slice(0, 10),
    byLevel: Object.fromEntries([...Map.groupBy(events, ({ level }) => level)].map(([level, group]) =>
      [level, { archiveSeries: group.length, ...summarize(replay.filter((row) => row.level === level)) }])),
    retrospective: true, publicationTimeVerified: false, matchRosters: 0,
    training: { minimumHistory, recentDays: recentWindow / DAY, availability: "utc_day_plus_two_days_strict" },
    previous: { archiveSeries: previous.events.length, inputRejections: previous.rejected, mapIssues: previous.mapIssues,
      ...summarize(priorReplay) },
    existingSeriesOnly: { archiveSeries: recovered.events.length, ...summarize(replayCs2(recovered.events, testFrom)) },
    onPreviousTests: summarize(replay.filter(({ id }) => priorTests.has(id))),
    onPreviousPairs: summarize(replay.filter(({ id }) => priorPairs.has(id))),
    periods, ...overall,
    approved: false };
}
