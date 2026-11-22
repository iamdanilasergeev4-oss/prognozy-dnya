import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifiedResult } from "./sports-historical-inputs.mjs";

const key = (value) => (typeof value === "string" && value !== "0" || Number.isSafeInteger(value) && value > 0) &&
  /^[\w:.-]+$/.test(String(value)) ? String(value) : null;
const timestamp = (value) => typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) ?
  Date.parse(value) : NaN;
const day = (time) => new Date(time).toISOString().slice(0, 10);
const identifiers = (values) => Array.isArray(values) && values.length === 2 &&
  values.every(key) && key(values[0]) !== key(values[1]);

export function pandaSeries(row, sport) {
  const start = timestamp(row?.begin_at);
  const end = timestamp(row?.end_at);
  const teams = row?.opponents?.map?.(({ type, opponent }) => type === "Team" ? key(opponent?.id) : null);
  const results = row?.results;
  // PandaScore's Counter-Strike namespace covers both CS:GO and CS2.
  // Reject dates before the CS2-only window used by this importer.
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || !identifiers(teams) ||
      row.status !== "finished" || row.forfeit !== false || row.match_type !== "best_of" ||
      !Array.isArray(results) || results.length !== 2 || !key(row.tournament?.id ?? row.tournament_id) ||
      (sport === "cs2" ? row.videogame?.slug !== "cs-go" || start < Date.UTC(2024, 0, 1) :
        sport !== "dota2" || row.videogame?.slug !== "dota-2")) return null;
  const score = teams.map((team) => results.find(({ team_id }) => key(team_id) === team)?.score);
  if (score.some((value) => !Number.isSafeInteger(value))) return null;
  const winner = score[0] === score[1] ? null : teams[Number(score[1] > score[0])];
  if ((winner == null ? row.draw !== true || row.winner_id != null :
    row.draw === true || key(row.winner_id) !== winner)) return null;
  return { id: row.id, home: teams[0], away: teams[1], date: day(start), completedDate: day(end),
    startedAt: row.begin_at, endedAt: row.end_at, competition: row.tournament?.id ?? row.tournament_id,
    season: String(new Date(start).getUTCFullYear()), unit: "series", status: "completed", bestOf: row.number_of_games,
    score, patch: row.videogame_version?.name ?? undefined };
}

export function openDotaMap(row) {
  if (!row || !Number.isSafeInteger(row.start_time) || row.start_time <= 0 || row.start_time > 8_640_000_000_000 ||
      !Number.isSafeInteger(row.duration) || row.duration <= 0 || row.start_time + row.duration > 8_640_000_000_000 ||
      typeof row.radiant_win !== "boolean" || !key(row.match_id) || !key(row.leagueid) ||
      !identifiers([row.radiant_team_id, row.dire_team_id])) return null;
  const ids = [row.radiant_team_id, row.dire_team_id].map(key);
  const seriesId = Number.isSafeInteger(row.series_id) && row.series_id > 0 ? key(row.series_id) : null;
  const players = Array.isArray(row.players) ? row.players : [];
  const lineups = [false, true].map((dire) => players.filter(({ player_slot }) => Number.isInteger(player_slot) &&
    player_slot >= 0 && player_slot <= 255 && Boolean(player_slot & 128) === dire)
    .map(({ account_id }) => key(account_id)).sort());
  const rosters = lineups.every((team) => team.length === 5 && team.every(Boolean)) &&
    new Set(lineups.flat()).size === 10 ? Object.fromEntries(ids.map((team, index) => [team, lineups[index]])) : null;
  return { id: key(row.match_id), seriesId, competition: key(row.leagueid), teams: [...ids].sort(),
    winner: key(row.radiant_win ? row.radiant_team_id : row.dire_team_id),
    start: row.start_time * 1000, end: (row.start_time + row.duration) * 1000,
    reportedSeriesType: Number.isSafeInteger(row.series_type) ? row.series_type : null,
    patch: key(row.patch), rosters };
}

function normalizedMap(row) {
  const start = timestamp(row?.startedAt);
  const end = timestamp(row?.endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || row.status !== "completed" ||
      !key(row.id) || !key(row.competition) || !identifiers(row.teams) ||
      !row.teams.map(key).includes(key(row.winner))) return null;
  return { id: key(row.id), seriesId: key(row.seriesId), competition: key(row.competition),
    teams: row.teams.map(key).sort(), winner: key(row.winner), start, end };
}

function distinct(rows, identity) {
  const byId = Map.groupBy(rows.filter(Boolean), (row) => String(row.id));
  const conflicts = [];
  const accepted = [];
  for (const [id, group] of byId) {
    if (group.some((row) => identity(row) !== identity(group[0]))) conflicts.push(id);
    else accepted.push(group[0]);
  }
  return { accepted, conflicts };
}

export function linkSeries(rows, maps, links, sameOrigin, excludedMapSeries = new Set()) {
  const byId = new Map(rows.map((row) => [key(row.id), row]));
  const available = Map.groupBy(maps, (map) => map.seriesId);
  const declarations = distinct(links.filter((link) => key(link?.id)), (link) => JSON.stringify(link));
  const byExternal = Map.groupBy(declarations.accepted, (link) => key(link.mapSeriesId));
  const explicitMaps = declarations.accepted.flatMap((link) => Array.isArray(link.mapIds) ? link.mapIds.map(key) : []);
  const duplicatedExplicitMaps = new Set([...Map.groupBy(explicitMaps, (id) => id)]
    .filter(([, claims]) => claims.length > 1).map(([id]) => id));
  const mapsById = new Map(maps.map((map) => [map.id, map]));
  const wanted = sameOrigin ? rows.map((row) => ({
    id: row.id, mapSeriesId: row.id, competition: row.competition, teams: [row.home, row.away],
  })) : declarations.accepted;
  const result = wanted.flatMap((link) => {
    const row = byId.get(key(link.id));
    const mapSeries = key(link.mapSeriesId);
    const mapIds = Array.isArray(link.mapIds) ? link.mapIds.map(key) : [];
    if (!row || (!mapSeries && !mapIds.length) || !key(link.competition) || !identifiers(link.teams) ||
        mapIds.some((id) => !id || duplicatedExplicitMaps.has(id)) ||
        !sameOrigin && (mapSeries && byExternal.get(mapSeries).length !== 1 || !/^https:\/\//.test(link.evidence ?? ""))) return [];
    if (mapSeries && excludedMapSeries.has(mapSeries)) return [{ series: key(row.id), mapSeries, status: "conflict", maps: [] }];
    const explicit = mapIds.map((id) => mapsById.get(id)).filter(Boolean);
    const unique = new Map([...(mapSeries ? available.get(mapSeries) ?? [] : []), ...explicit].map((map) => [map.id, map]));
    const candidates = [...unique.values()].sort((a, b) => a.start - b.start);
    if (!candidates.length) return [];
    const expected = link.teams.map(key);
    const start = row.startedAt ? timestamp(row.startedAt) : Date.parse(row.date);
    const end = row.endedAt ? timestamp(row.endedAt) : Date.parse(row.completedDate) + 86_400_000 - 1;
    const score = [0, 0];
    const matches = candidates.every((map, index) => {
      const side = expected.indexOf(map.winner);
      if (map.competition !== key(link.competition) || map.start < start || map.end > end ||
          mapSeries && map.seriesId && map.seriesId !== mapSeries ||
          (index > 0 && candidates[index - 1].end > map.start) ||
          side < 0 || !map.teams.every((team) => expected.includes(team))) return false;
      score[side]++;
      return true;
    });
    const excess = score.some((value, side) => value > row.score[side]);
    const status = !matches || excess ? "conflict" : score.every((value, side) => value === row.score[side]) ?
      "complete" : "partial";
    return [{ series: key(row.id), mapSeries, status, maps: status === "conflict" ? [] : candidates.map((map) => map.id) }];
  });
  return { links: result, conflictingDeclarations: declarations.conflicts };
}

export async function importArchive(manifestFile) {
  const manifestBytes = await readFile(manifestFile);
  const manifest = JSON.parse(manifestBytes);
  const { sport, origin, url, rights, capturedAt, format, payload, mapPayload, mapFormat, mapCrosswalk = [] } = manifest;
  if (!["cs2", "dota2", "volleyball"].includes(sport) || !/^[a-z][a-z0-9-]+$/.test(origin) ||
      new URL(url).protocol !== "https:" || typeof rights !== "string" || !rights.trim() ||
      !Number.isFinite(timestamp(capturedAt)) || !["normalized", "pandascore"].includes(format) ||
      format === "pandascore" && (!["cs2", "dota2"].includes(sport) || manifest.game !== sport) || !Array.isArray(mapCrosswalk) ||
      mapPayload && !["normalized", "opendota"].includes(mapFormat) || mapFormat === "opendota" && sport !== "dota2") {
    throw new Error("Invalid source manifest");
  }
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const sources = [{ file: basename(manifestFile), sha256: digest(manifestBytes) }];
  const load = async (file) => {
    const bytes = await readFile(resolve(dirname(manifestFile), file));
    sources.push({ file: basename(file), sha256: digest(bytes) });
    const rows = JSON.parse(bytes);
    if (!Array.isArray(rows)) throw new Error("Expected a JSON array");
    return rows;
  };
  const raw = await load(payload);
  const capture = timestamp(capturedAt);
  const valid = raw.map((input) => {
    const fact = format === "pandascore" ? pandaSeries(input, sport) : input;
    const event = verifiedResult(fact, sport, origin);
    if (!event || fact.startedAt != null && !Number.isFinite(timestamp(fact.startedAt)) ||
        fact.endedAt != null && !Number.isFinite(timestamp(fact.endedAt)) ||
        (fact.endedAt ? event.end : event.end + 86_400_000) > capture) return null;
    return fact;
  });
  const signature = (row) => JSON.stringify(verifiedResult(row, sport, origin));
  const matches = distinct(valid, signature);
  const rawMaps = mapPayload ? await load(mapPayload) : [];
  const classifiedMaps = rawMaps.map(mapFormat === "opendota" ? openDotaMap : normalizedMap);
  const maps = distinct(classifiedMaps.filter((map) => map && map.end <= capture), JSON.stringify);
  const duplicateMaps = new Set(maps.conflicts);
  const excludedMapSeries = new Set(classifiedMaps.filter((map) => map && duplicateMaps.has(map.id))
    .map((map) => map.seriesId));
  const linkage = linkSeries(matches.accepted, maps.accepted, mapCrosswalk,
    mapFormat === "normalized" && !mapCrosswalk.length, excludedMapSeries);
  return { sport, origin, url, rights, capturedAt, sources, rows: matches.accepted, maps: maps.accepted, ...linkage,
    quality: { rejectedMatches: valid.filter((row) => !row).length, conflictingMatches: matches.conflicts,
      rejectedMaps: classifiedMaps.filter((map) => !map || map.end > capture).length, conflictingMaps: maps.conflicts } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await importArchive(process.argv[2]), null, 2));
}
