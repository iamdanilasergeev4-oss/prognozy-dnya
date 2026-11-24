import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { normalizeIdentity } from "./sports-discovery.mjs";
import { importEspnScoreboardLines } from "./sports-espn-lines.mjs";

const sources = {
  "https://fonbet.com": "Fonbet",
  "https://betmonitor.com": "Betmonitor",
  "https://gamblino.com": "Gamblino",
  "https://en.tennistemple.com": "TennisTemple",
  "https://www.esportsportal.net": "eSports Portal",
  "https://www.marathonbet.dk": "Marathonbet",
};
const scopes = { tennis: "tennis_match", volleyball: "match_bo5", cs2: "series_bo3", dota2: "series_bo3" };

export function importReviewedPublicLine(row, events, now) {
  const url = URL.parse(row.url);
  const start = Date.parse(row.start);
  const received = Date.parse(row.receivedAt);
  const publisher = url && sources[url.origin];
  if (!publisher || url.username || url.password || !Number.isFinite(received) || received > now || received >= start ||
      !Object.hasOwn(scopes, row.sport) || !row.bookmaker || row.rulesUrl && URL.parse(row.rulesUrl)?.protocol !== "https:") {
    throw new Error("Некорректная квитанция публичной линии");
  }
  const fixtures = events.filter((event) => event.sport === row.sport && event.start === start &&
    normalizeIdentity(event.tournament) === normalizeIdentity(row.tournament) &&
    ["home", "away"].every((side) => normalizeIdentity(row[side]) === normalizeIdentity(event[side])));
  if (fixtures.length !== 1) return [];
  const [event] = fixtures;
  if (["cs2", "dota2"].includes(row.sport) && event.rules !== "BO3" ||
      row.sport === "volleyball" && event.rules !== "BO5") return [];
  return row.markets.map(({ type, prices, point }) => {
    if (!(type === "outcome" && point == null || type === "total" && row.sport === "dota2" && point === 2.5) ||
        prices.length !== 2 || !prices.every((price) => Number.isFinite(price) && price > 1)) {
      throw new Error("Неполное условие публичной линии");
    }
    const sides = type === "outcome" ? ["home", "away"] : ["over", "under"];
    return { type, event, bookmaker: row.bookmaker, source: publisher, sourceUrl: url.href, rulesUrl: row.rulesUrl ?? null,
      modelComparable: Boolean(row.rulesUrl),
      scope: scopes[row.sport], receivedAt: new Date(received).toISOString(), publishedAt: null, updatedAt: null,
      observationOnly: true, outcomes: prices.map((price, i) => ({ price, point: point ?? null, selection: sides[i] })) };
  });
}

export async function readPublicOdds(path, events, now) {
  if (!path) return { markets: [], requests: [], evidence: [] };
  const index = JSON.parse(await readFile(path, "utf8"));
  const markets = [];
  const requests = new Map();
  const evidence = [];
  for (const { file, receipt } of index.scoreboards) {
    const body = await readFile(resolve(dirname(path), file));
    const captured = Date.parse(receipt.receivedAt);
    if (!Number.isFinite(captured) || captured > now) throw new Error("Время снимка ESPN не подтверждено");
    const quotes = importEspnScoreboardLines(JSON.parse(body.toString("utf8")), receipt, events);
    const key = `public:${receipt.competition}`;
    requests.set(key, { status: "ok", attempts: [receipt.status] });
    markets.push(...quotes);
    evidence.push({ ...receipt, sha256: createHash("sha256").update(body).digest("hex"), markets: quotes.length });
  }
  for (const row of index.reviewed) {
    const quotes = importReviewedPublicLine(row, events, now);
    markets.push(...quotes);
    evidence.push({ url: row.url, receivedAt: row.receivedAt, bookmaker: row.bookmaker,
      status: quotes.length ? "matched" : "unmatched", markets: quotes.length });
  }
  const latest = new Map();
  for (const line of markets.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))) {
    const key = JSON.stringify([line.event.id, line.event.sport, line.event.match, line.event.start,
      line.bookmaker, line.source, line.type, line.outcomes.map(({ point }) => point)]);
    latest.set(key, line);
  }
  return { markets: [...latest.values()], requests, evidence };
}
