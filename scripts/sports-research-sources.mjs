import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { europeanSeason, germanLeagues } from "./sports-discovery.mjs";

const DAY = 86_400_000;
const base = "https://api.openligadb.de";
const openDotaUrl = "https://api.opendota.com/api/proMatches";
const headers = { "user-agent": "PrognozyDnya-Research/2.1 (+https://github.com/iamdanilasergeev4-oss/prognozy-dnya/issues)" };

async function request(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers });
  if (response.ok) return response.json();
  const error = new Error(`HTTP ${response.status}`);
  error.status = response.status;
  const retry = response.headers.get("retry-after");
  error.retryMs = /^\d+$/.test(retry || "") ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now()) || 0;
  throw error;
}

function failure(error) {
  return [401, 403].includes(error.status) ? "restricted" : error.status === 404 ? "not_found" :
    error.status === 429 || error.status >= 500 || error instanceof TypeError || error.name === "TimeoutError"
      ? "temporarily_unavailable" : "invalid_response";
}

export function parseOpenLiga(data, { shortcut, season, label, url, now, until }) {
  if (!Array.isArray(data)) throw new Error("Неизвестный формат OpenLigaDB");
  return data.flatMap((match) => {
    const { team1, team2, matchDateTimeUTC } = match;
    const time = typeof matchDateTimeUTC === "string" && /Z$/.test(matchDateTimeUTC) ? Date.parse(matchDateTimeUTC) : NaN;
    if (!Number.isFinite(time) || !team1?.teamName || !team2?.teamName || !team1.teamId || !team2.teamId || !match.matchID ||
      typeof match.matchIsFinished !== "boolean" || String(match.leagueSeason) !== season || match.leagueShortcut !== shortcut ||
      time >= until || time < now - 40 * DAY) return [];
    if (!match.matchIsFinished && time <= now) return [];
    const result = match.matchResults?.find((row) => row.resultTypeKind === "After90Minutes");
    const scores = result && [result.pointsTeam1, result.pointsTeam2];
    const score = match.matchIsFinished && scores && scores.every((n) => Number.isSafeInteger(n) && n >= 0) ? scores : null;
    return [{ source: "OpenLigaDB", sport: "football", id: String(match.matchID), tournament: label, country: "DE",
      home: team1.teamName, away: team2.teamName, homeField: true, participantIds: [team1.teamId, team2.teamId],
      sourceCompetitionId: match.leagueId, season, start: time, url, status: match.matchIsFinished ? "finished" : "scheduled", score }];
  });
}

export function parseProMaps(raw, now) {
  if (!Array.isArray(raw)) throw new Error("Неизвестный формат профессиональных матчей OpenDota");
  const maps = new Map();
  for (const map of raw) {
    const started = map.start_time * 1000;
    if (!Number.isSafeInteger(map.match_id) || !map.radiant_team_id || !map.dire_team_id || !map.series_id ||
        !Number.isFinite(started) || started < now - 30 * DAY || !Number.isFinite(map.duration) || map.duration <= 0 ||
        started + map.duration * 1000 > now || typeof map.radiant_win !== "boolean") continue;
    maps.set(map.match_id, { id: String(map.match_id), seriesId: String(map.series_id), tournament: map.league_name,
      leagueId: map.leagueid, started, radiant: map.radiant_name, dire: map.dire_name, radiantWon: map.radiant_win,
      url: `https://www.opendota.com/matches/${map.match_id}` });
  }
  return [...maps.values()];
}

async function cachedJson(url, { cacheDir, key, refresh, now }) {
  const file = join(cacheDir, `${key}.json`);
  const save = async (value) => {
    const temporary = join(cacheDir, `${key}.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(value), { flag: "wx" });
    await rename(temporary, file);
  };
  let cache;
  try { cache = JSON.parse(await readFile(file, "utf8")); } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  if (Array.isArray(cache?.body) && now - cache.checkedAt < refresh) return { body: cache.body, status: "cached" };
  if (cache?.retryAfter > now) return { status: "temporarily_unavailable", error: "Source backoff in effect" };
  try {
    const body = await request(url);
    if (!Array.isArray(body)) throw new Error("Ожидался список событий");
    await save({ body, checkedAt: now });
    return { body, status: "ok" };
  } catch (error) {
    const status = failure(error);
    if (status === "temporarily_unavailable") {
      const wait = Math.max(error.retryMs || 0, Math.min(DAY, (cache?.wait || 30_000) * 2));
      await save({ ...cache, wait, retryAfter: now + wait });
    }
    return { status, error: error.message };
  }
}

export async function loadResearchSources({ cacheDir, now, until }) {
  await mkdir(cacheDir, { recursive: true });
  const season = europeanSeason(now).slice(0, 4);
  const requests = [];
  const rows = [];
  for (const [competition, shortcut, label] of germanLeagues) {
    const url = `${base}/getmatchdata/${shortcut}/${season}`;
    const result = await cachedJson(url, { cacheDir, key: `${shortcut}-${season}`, refresh: DAY / 4, now });
    let matches = [];
    try {
      if (result.body) matches = parseOpenLiga(result.body, { shortcut, season, label, url, now, until });
    } catch (error) {
      result.status = "invalid_response";
      result.error = error.message;
    }
    rows.push(...matches);
    requests.push({ source: "OpenLigaDB", sport: "football", competition, label, url, status: result.status,
      error: result.error, scheduled: result.error ? null : matches.filter((row) => row.status === "scheduled").length,
      results: result.error ? null : matches.filter((row) => row.score).length });
  }
  const result = await cachedJson(openDotaUrl, { cacheDir, key: "open-dota-pro", refresh: DAY / 4, now });
  let maps = [];
  try {
    if (result.body) maps = parseProMaps(result.body, now);
  } catch (error) {
    result.status = "invalid_response";
    result.error = error.message;
  }
  requests.push({ source: "OpenDota", sport: "dota2", competition: "professional maps", url: openDotaUrl, status: result.status,
    error: result.error, results: result.error ? null : maps.length });
  return { rows, requests, maps };
}
