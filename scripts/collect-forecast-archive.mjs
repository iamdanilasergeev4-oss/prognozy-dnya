import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseEspn, parseNhl } from "./sports-sources.mjs";

const DAY = 86_400_000;
const root = new URL("../.sports-update/forecast-archive/", import.meta.url);
await mkdir(root, { recursive: true });
const asOf = Date.now();
const seasons = [["2024-10-01", "2025-04-20"], ["2025-10-01", "2026-04-20"], ["2026-10-01", new Date(asOf).toISOString().slice(0, 10)]];
const data = new Map();
const requests = [];
for (const [first, last] of seasons) {
  for (let at = Date.parse(first); at < Date.parse(last); at += 7 * DAY) {
    const date = new Date(at).toISOString().slice(0, 10);
    const url = `https://api-web.nhle.com/v1/schedule/${date}`;
    const file = new URL(`nhl-${date}.json`, root);
    try {
      let record = await readFile(file, "utf8").then(JSON.parse, (error) => {
        if (error.code !== "ENOENT") throw error;
        return null;
      });
      const cached = record != null && at + 10 * DAY < record.receivedAt;
      if (!cached) {
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) {
          requests.push({ url, status: response.status });
          if ([401, 403, 429].includes(response.status)) break;
          continue;
        }
        record = { receivedAt: Date.now(), body: await response.json() };
        await writeFile(file, JSON.stringify(record));
        await new Promise((resolve) => setTimeout(resolve, 240));
      }
      const gameWeek = record.body.gameWeek.map((day) => ({ ...day,
        games: day.games.filter((game) => game.gameType === 2 && game.neutralSite !== true) }));
      const rows = parseNhl({ gameWeek }).filter((row) => row.status === "finished" && row.score && row.start + DAY < asOf &&
        row.score[0] !== row.score[1]);
      for (const row of rows) {
        const saved = { ...row, id: `nhl:${row.id}`, competition: "nhl", home: row.home.normalize("NFKC").toLowerCase(),
          away: row.away.normalize("NFKC").toLowerCase(), observedAt: record.receivedAt, homeField: true,
          sources: [{ id: row.id, title: "NHL", url: row.url }] };
        const previous = data.get(saved.id);
        if (previous && (previous.start !== saved.start || JSON.stringify(previous.score) !== JSON.stringify(saved.score))) {
          data.set(saved.id, { conflict: true });
        } else if (!previous) data.set(saved.id, saved);
      }
      requests.push({ url, status: cached ? "cached" : "ok", matches: rows.length });
    } catch (error) {
      requests.push({ url, status: "error", reason: error.message });
    }
  }
}
const results = [...data.values()].filter((event) => !event.conflict);
await writeFile(new URL("nhl-results.json", root), JSON.stringify({ asOf, results, requests }, null, 2));
console.log(JSON.stringify({ results: results.length, requests: Object.fromEntries([...Map.groupBy(requests, (row) => row.status)]
  .map(([status, rows]) => [status, rows.length])) }));

const nba = new Map();
const nbaRequests = [];
const months = ["202410", "202411", "202412", "202501", "202502", "202503", "202504",
  "202510", "202511", "202512", "202601", "202602", "202603", "202604", "202610", "202611"];
for (const month of months) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${month}&limit=1000`;
  const file = new URL(`nba-${month}.json`, root);
  try {
    const monthEnd = Date.UTC(Number(month.slice(0, 4)), Number(month.slice(4)), 1);
    let record = await readFile(file, "utf8").then(JSON.parse, (error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    const cached = record != null && monthEnd + 2 * DAY <= record.receivedAt;
    if (!cached) {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) {
        nbaRequests.push({ url, status: response.status });
        if ([401, 403, 429].includes(response.status)) break;
        continue;
      }
      record = { receivedAt: Date.now(), body: await response.json() };
      await writeFile(file, JSON.stringify(record));
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const events = record.body.events.filter((event) => event.season?.type === 2 &&
      event.competitions?.length === 1 && !event.competitions[0].neutralSite);
    const rows = parseEspn({ ...record.body, events }, "basketball", "basketball/nba", url)
      .filter((row) => row.status === "finished" && row.score && row.start + DAY < asOf && row.score[0] !== row.score[1]);
    for (const row of rows) {
      const saved = { ...row, id: `nba:${row.id}`, competition: "nba", observedAt: record.receivedAt, homeField: true,
        sources: [{ id: row.id, title: "ESPN", url: row.url }] };
      const previous = nba.get(saved.id);
      if (previous && (previous.start !== saved.start || JSON.stringify(previous.score) !== JSON.stringify(saved.score))) {
        nba.set(saved.id, { conflict: true });
      } else if (!previous) nba.set(saved.id, saved);
    }
    nbaRequests.push({ url, status: cached ? "cached" : "ok", matches: rows.length });
  } catch (error) {
    nbaRequests.push({ url, status: "error", reason: error.message });
  }
}
const nbaResults = [...nba.values()].filter((event) => !event.conflict);
await writeFile(new URL("nba-results.json", root), JSON.stringify({ asOf, results: nbaResults, requests: nbaRequests }, null, 2));
console.log(JSON.stringify({ competition: "nba", results: nbaResults.length, requests: Object.fromEntries(
  [...Map.groupBy(nbaRequests, (row) => row.status)].map(([status, rows]) => [status, rows.length])) }));
