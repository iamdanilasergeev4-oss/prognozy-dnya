import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { europeanSeason, normalizeIdentity } from "./sports-discovery.mjs";
import { indexedOpenFootballUrl } from "./sports-openfootball.mjs";

export const DAY = 86_400_000;
const leagueMap = { eng1: "en.1", eng2: "en.2", eng3: "en.3", eng4: "en.4", esp2: "es.2", deu2: "de.2", deu3: "de.3" };

export function parseSeasonResults(data, { competition, season, url, observedAt }) {
  if (!Array.isArray(data.matches) || !data.name?.includes(season.replace("-", "/"))) throw new Error("Архив другого сезона или неизвестного формата");
  return data.matches.flatMap((match) => {
    const { date, team1, team2 } = match;
    const start = Date.parse(date);
    const score = Array.isArray(match.score) ? match.score : match.score?.ft;
    const home = normalizeIdentity(team1);
    const away = normalizeIdentity(team2);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !Number.isFinite(start) ||
        new Date(start).toISOString().slice(0, 10) !== date || europeanSeason(start) !== season || !home ||
        !away || home === away || !Array.isArray(score) || score.length !== 2 ||
        score.some((value) => !Number.isSafeInteger(value) || value < 0) || start + 2 * DAY > observedAt) return [];
    return [{ id: JSON.stringify(["openfootball", competition, season, date, home, away]), sport: "football", competition,
      season, home, away, start, date, dateOnly: true, observedAt, score, homeField: true,
      sources: [{ title: "openfootball", url, origin: "openfootball", id: JSON.stringify([date, home, away]) }] }];
  });
}

export async function loadSeasonArchives({ events, now, fetchData }) {
  const seasons = [europeanSeason(now), europeanSeason(now - 366 * DAY)];
  const leagues = [...new Set(events.filter((event) => event.sport === "football").map((event) => event.competition))]
    .filter((league) => Object.hasOwn(leagueMap, league));
  const indexes = new Map();
  const results = [];
  const requests = [];
  for (const competition of leagues) {
    for (const season of seasons) {
      const url = indexedOpenFootballUrl(leagueMap[competition], season);
      const index = new URL("./", url).href;
      try {
        if (!indexes.has(index)) indexes.set(index, fetchData(index, true).catch(() => null));
        const listing = await indexes.get(index);
        if (!listing?.includes("football.txt page")) throw new Error("Индекс источника недоступен");
        if (!listing.includes(new URL(url).pathname.split("/").at(-1))) {
          requests.push({ source: "openfootball", sport: "football", competition, season, url, status: "not_in_publisher_index" });
          continue;
        }
        const entries = parseSeasonResults(await fetchData(url), { competition, season, url, observedAt: now });
        results.push(...entries);
        requests.push({ source: "openfootball", sport: "football", competition, season, url, status: "ok", results: entries.length });
      } catch (error) {
        requests.push({ source: "openfootball", sport: "football", competition, season, url, status: "unavailable", error: error.message });
      }
    }
  }
  return { results, requests };
}

export async function saveResearchSnapshot(directory, snapshot) {
  await mkdir(directory, { recursive: true });
  const body = JSON.stringify(snapshot);
  const digest = createHash("sha256").update(body).digest("hex");
  await writeFile(join(directory, `${snapshot.at}-${digest}.json`), body, { flag: "wx" })
    .catch((error) => { if (error.code !== "EEXIST") throw error; });
}

export async function readResearchSnapshots(directory, asOf) {
  let files;
  try { files = await readdir(directory); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const batches = await Promise.all(files.filter((name) => /^\d+-[0-9a-f]{64}\.json$/.test(name) &&
    Number(name.split("-")[0]) <= asOf).map(async (name) => {
    const body = await readFile(join(directory, name), "utf8");
    const batch = JSON.parse(body);
    if (batch.at !== Number(name.split("-")[0]) || !name.includes(createHash("sha256").update(body).digest("hex"))) {
      throw new Error(`Повреждён снимок истории ${name}`);
    }
    return batch;
  }));
  return batches.sort((a, b) => a.at - b.at);
}
