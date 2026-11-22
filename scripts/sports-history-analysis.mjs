import { discover, normalizeIdentity } from "./sports-discovery.mjs";
import { evidenceTier, researchConfirmed, tournamentContext, validSeries } from "./sports-evidence.mjs";
import { createSparseModel, comparisonGroup } from "./sports-sparse-model.mjs";
import { DAY } from "./sports-research-history.mjs";

const esports = new Set(["cs2", "dota2"]);
const footballAliases = {
  eng1: { "man utd": "manchester united", "brentford fc": "brentford", "everton fc": "everton", "liverpool fc": "liverpool" },
  eng2: { "burnley fc": "burnley", "blackburn rovers fc": "blackburn rovers", "bristol city fc": "bristol city",
    "portsmouth fc": "portsmouth", "wrexham afc": "wrexham", "west ham united fc": "west ham united" },
};
const team = (event, name) => footballAliases[event.competition]?.[name] || name;
const adapt = (event) => ({ ...event, ...tournamentContext(event), home: team(event, event.home), away: team(event, event.away) });
const historyKey = (event) => JSON.stringify([event.sport, event.competition, event.season, [event.home, event.away].sort(),
  event.sport === "football" ? event.date || new Date(event.start).toISOString().slice(0, 10) : event.start]);

function supportedResults(events, observedAt) {
  return events.flatMap((row) => {
    const event = adapt(row);
    const sources = row.sources.filter((source) => source.reportedScore);
    const tier = evidenceTier(row, sources);
    if (!researchConfirmed(tier) || !event.season || !sources.length ||
        esports.has(event.sport) && !validSeries(event.score, event.rules, event.sport) ||
        event.sport === "tennis" && (!event.rules || event.match.includes("/")) ||
        event.sport === "volleyball" && (Math.max(...event.score) !== 3 || event.score[0] === event.score[1])) return [];
    return [{ ...event, sources, tier, observedAt }];
  });
}

export function mergeHistory(rows, asOf) {
  const available = rows.filter((row) => row.observedAt <= asOf && row.start + (row.dateOnly ? 2 : 1) * DAY <= asOf)
    .map((row) => ({ ...row, home: team(row, row.home), away: team(row, row.away) }));
  const grouped = Map.groupBy(available, historyKey);
  const names = new Map();
  const keysOf = (row) => row.sources.flatMap((source) => [row.home, row.away].flatMap((name, i) => {
    const id = source.participantIds?.[i];
    return id == null ? [] : [{ key: JSON.stringify([row.sport, row.competition, row.season, source.title, name]), id }];
  }));
  for (const row of available) {
    for (const { key, id } of keysOf(row)) {
      if (!names.has(key)) names.set(key, new Set());
      names.get(key).add(String(id));
    }
  }
  const history = [];
  const conflicts = [];
  for (const group of grouped.values()) {
    const first = group[0];
    const score = (row) => (row.home === first.home ? row.score : [...row.score].reverse()).join(":");
    if (group.some((row) => score(row) !== score(first) || keysOf(row).some(({ key }) => names.get(key).size > 1))) {
      conflicts.push(first.id);
      continue;
    }
    const preciseTimes = group.filter((row) => !row.dateOnly).map((row) => row.start);
    if (preciseTimes.length && Math.max(...preciseTimes) - Math.min(...preciseTimes) > 15 * 60_000) {
      conflicts.push(first.id);
      continue;
    }
    const preferred = group.find((row) => row.tier === "official" || row.tier === "independent") ||
      group.find((row) => row.tier === "corroborated_unknown_origin") || first;
    const sources = [...new Map(group.flatMap((row) => row.sources.map((source) => ({
      ...source, participantIds: row.home === preferred.home ? source.participantIds : source.participantIds?.slice().reverse(),
    }))).map((source) => [`${source.title}|${source.id}`, source])).values()];
    history.push({ ...preferred, sources });
  }
  return { history, conflicts };
}

const potentialSources = {
  football: ["Сезонные архивы openfootball", "OpenLigaDB", "Протоколы турнира", "365Scores / ESPN"],
  basketball: ["Протоколы NBA или конкретной лиги", "ESPN / 365Scores"],
  hockey: ["NHL Gamecenter", "Протоколы лиги"],
  tennis: ["Лицензированная история ATP / WTA с датами и покрытиями", "Результаты ESPN / 365Scores"],
  volleyball: ["Сезонные результаты Lega Pallavolo", "Volleyball World", "Протоколы федераций"],
  cs2: ["Протоколы организатора с форматом серии", "Strafe / Ensigame / GosuGamers"],
  dota2: ["Протоколы организатора с форматом серии", "Strafe / GosuGamers", "OpenDota для отдельных карт"],
};

export function makeHistorySnapshot({ rows, supplemental, archives, archiveRequests = [], now, until, observedAt }) {
  const current = discover([...rows, ...supplemental.rows, ...supplemental.historicalRows], { now, until, improved: true });
  const officialResults = supportedResults(current.researchResults, observedAt);
  const imported = archives.map((row) => ({ ...row, home: team(row, row.home), away: team(row, row.away),
    tier: "secondary_archive", observedAt }));
  const leagueResults = supplemental.historicalRows.filter((row) => row.score).map((row) => {
    const competition = supplemental.requests.find((request) => request.url === row.url)?.competition;
    return { ...row, id: JSON.stringify([row.source, row.id]), competition, observedAt,
      season: `${row.season}-${String(Number(row.season) + 1).slice(-2)}`,
      home: normalizeIdentity(row.home), away: normalizeIdentity(row.away),
      tier: "secondary_archive", sources: [{ title: row.source, id: row.id, url: row.url, origin: "OpenLigaDB", participantIds: row.participantIds }],
      date: new Date(row.start + 3 * 3_600_000).toISOString().slice(0, 10) };
  }).filter((row) => row.competition);
  return { at: observedAt, results: [...officialResults, ...imported, ...leagueResults], maps: supplemental.maps, requests: archiveRequests };
}

export function compareHistory(baseline, snapshots, cutoff) {
  const availableSnapshots = snapshots.filter((snapshot) => snapshot.at <= cutoff);
  const { history, conflicts } = mergeHistory(availableSnapshots.flatMap((snapshot) => snapshot.results), cutoff);
  const model = createSparseModel();
  history.forEach(model.observe);
  const old = new Map(baseline.forecastEvidence.map((event) => [event.id, event]));
  const forecasts = [];
  const maps = [...new Map(availableSnapshots.flatMap((snapshot) => snapshot.maps).map((map) => [map.id, map])).values()];
  const requestsByUrl = new Map([...baseline.requests, ...availableSnapshots.flatMap((batch) => batch.requests || [])]
    .map((request) => [JSON.stringify([request.source, request.url, request.competition]), request]));
  const requests = [...requestsByUrl.values()];
  const assessed = baseline.assessed.map((row) => {
    const event = adapt(row);
    const tier = evidenceTier(row);
    const results = model.history(event, cutoff).results;
    const matches = results.map((group) => group.length);
    const alternate = history.filter((past) => past.sport === event.sport && comparisonGroup(past) === comparisonGroup(event) &&
      (past.home === event.home || past.away === event.home || past.home === event.away || past.away === event.away)).length;
    const historyAvailable = matches.every(Boolean);
    const missing = [];
    if (!researchConfirmed(tier)) missing.push(tier === "conflicting" ? "source_conflict" : "only_secondary_schedule");
    if (row.dataQuality.identityConflict) missing.push("identity_conflict");
    if (!event.season) missing.push("season");
    if (!event.rules && (esports.has(event.sport) || event.sport === "tennis")) missing.push(esports.has(event.sport) ? "series_format" : "surface");
    if (event.sport === "tennis" && event.match.includes("/")) missing.push("doubles_model");
    if (matches.some((count) => count < 3)) missing.push(alternate && !historyAvailable ? "history_context_or_identity" : "history_sample");
    if (event.start <= cutoff + 10 * 60_000) missing.push("too_close_to_start");
    const existing = researchConfirmed(tier) && !row.dataQuality.identityConflict && event.start > cutoff + 10 * 60_000 && old.get(row.id);
    const sparse = !missing.length ? model.predict(event, cutoff) : null;
    const prediction = existing || sparse;
    if (prediction) forecasts.push({ ...event, ...prediction, dataAsOf: new Date(cutoff).toISOString(), sourceTier: tier,
      candidates: [existing, sparse].filter(Boolean).map(({ probabilities, version, matches, evidence }) =>
        ({ probabilities, version, matches, evidence })) });
    const sourceAttempts = requests.filter((request) => request.sport === event.sport &&
      (request.competition === event.competition || event.sport !== "football"));
    return { ...event, sourceTier: tier, historyAvailable, historyMatches: matches, alternateHistoryRows: alternate, missing: prediction ? [] : missing,
      predicted: Boolean(prediction), previousStatus: row.analysisStatus, historySources: [...new Set(
        results.flat().flatMap(({ event: previous }) => previous.sources.map(({ title }) => title)))],
      potentialSources: potentialSources[event.sport], sourceAttempts,
      mapHistoryMatches: event.sport === "dota2" ? [event.home, event.away].map((name) =>
        maps.filter((map) => [map.radiant, map.dire].some((side) => normalizeIdentity(side) === name)).length) : null,
      technicalIssues: [!row.season && event.season && "season_inferred_from_competition",
        !row.rules && event.rules && "context_from_named_source",
        esports.has(event.sport) && !event.patch && "patch_unknown_not_a_series_gate"].filter(Boolean) };
  });
  const count = (rows, predicate) => rows.filter(predicate).length;
  const sports = Object.fromEntries(Object.entries(baseline.sports).map(([sport, original]) => {
    const rows = assessed.filter((event) => event.sport === sport);
    return [sport, { ...original, checkpoint: { detected: original.detected, confirmed: original.confirmed,
      forecast: original.forecast, historyAvailable: original.historyAvailable },
      confirmed: count(rows, (row) => researchConfirmed(row.sourceTier)), historyAvailable: count(rows, (row) => row.historyAvailable && researchConfirmed(row.sourceTier)),
      forecast: count(rows, (row) => row.predicted), sourceTiers: Object.fromEntries(
        [...Map.groupBy(rows, (row) => row.sourceTier)].map(([key, group]) => [key, group.length])),
      reasons: Object.fromEntries([...Map.groupBy(rows.flatMap((row) => row.missing), (key) => key)].map(([key, group]) => [key, group.length])) }];
  }));
  return { ...baseline, modelVersion: "elo-outcomes-1 + shrunk-results-1", requests, sports, assessed, forecastEvidence: forecasts,
    forecastCount: forecasts.length, savedHistory: { rows: history.length, conflicts: conflicts.length, snapshots: availableSnapshots.length, maps: maps.length } };
}
