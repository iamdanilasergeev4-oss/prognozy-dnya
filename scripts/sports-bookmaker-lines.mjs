import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { normalizeIdentity } from "./sports-discovery.mjs";
import { parseCsvRow } from "./sports-evaluation.mjs";

const maxAge = 2 * 60 * 60_000;
const footballFixtureUrl = "https://football-data.co.uk/fixtures.csv";
const apiDocs = "https://the-odds-api.com/liveapi/guides/v4/";
const fonbetDocs = "https://arbplay.app/api/fonbet-odds-api";
const fonbetUrl = "https://api.arbplay.app/v1/data/site_livepre_fonbet.json";
const marketTypes = { h2h: "outcome", totals: "total", spreads: "handicap", team_totals: "team_total" };
const marketTitles = { outcome: "Исход матча", total: "Общий тотал", handicap: "Фора", team_total: "Индивидуальный тотал" };
export const bookmakerMarketName = (type, sport) => type === "handicap" && sport === "football" ? "Азиатская фора" : marketTitles[type];
const fonbetLeague = {
  "england premier league": "eng1", "england championship": "eng2",
  "england league one": "eng3", "england league two": "eng4",
  "greece superleague 1": "grc1",
};
const feeds = {
  eng1: ["soccer_epl", "h2h,totals", "football", "regulation"],
  eng2: ["soccer_efl_champ", "h2h,totals", "football", "regulation"],
  nba: ["basketball_nba", "h2h,totals,spreads", "basketball", "overtime"],
  nhl: ["icehockey_nhl", "h2h", "hockey", "overtime_shootout"],
};
const rules = {
  regulation: "https://sportsbook.draftkings.com/help/sport-rules/soccer",
  overtime: "https://massgaming.com/wp-content/uploads/Meeting-Materials-8.14.25-OPEN.pdf",
  overtime_shootout: "https://sportsbook.draftkings.com/help/general-betting-rules",
};
const footballRules = "https://help.bet365.com/s/en-gb/sportsrules/soccer/result-event-half-time";
const london = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const finitePrice = (price) => typeof price === "number" && Number.isFinite(price) && price > 1;
const iso = (value) => new Date(value).toISOString();
const quote = (selection, price, point = null) => ({ selection, price, point });
const scoreSport = { football: "голов", basketball: "очков", hockey: "шайб" };

function fixtureKey({ sport, competition, home, away, start }) {
  return JSON.stringify([sport, competition, normalizeIdentity(home), normalizeIdentity(away), start]);
}

function londonKey(start, home, away, competition) {
  return JSON.stringify([competition, normalizeIdentity(home), normalizeIdentity(away), london.format(start)]);
}

function csvKey({ Div, HomeTeam, AwayTeam, Date: date, Time: time }) {
  const competition = { E0: "eng1", E1: "eng2" }[Div];
  if (!competition || !/^\d\d\/\d\d\/\d{4}$/.test(date) || !/^\d\d:\d\d$/.test(time)) return null;
  return JSON.stringify([competition, normalizeIdentity(HomeTeam), normalizeIdentity(AwayTeam), `${date}, ${time}`]);
}

export function importFootballSnapshot(csv, receipt, events) {
  const received = Date.parse(receipt.receivedAt);
  const published = Date.parse(receipt.lastModified);
  if (receipt.url !== footballFixtureUrl || receipt.status !== 200 || !Number.isFinite(published) ||
      !Number.isFinite(received) || published > received) throw new Error("Некорректная квитанция Football-Data");
  const [header, ...lines] = csv.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const fields = parseCsvRow(header);
  const rows = lines.map((line) => Object.fromEntries(parseCsvRow(line).map((cell, i) => [fields[i], cell])));
  const byFixture = Map.groupBy(rows, csvKey);
  const sha256 = createHash("sha256").update(csv).digest("hex");
  return events.filter(({ sport, start }) => sport === "football" && received < start).flatMap((event) => {
    const matches = byFixture.get(londonKey(event.start, event.home, event.away, event.competition));
    if (matches?.length !== 1) return [];
    const row = matches[0];
    const handicap = row.AHh?.trim() ? Number(row.AHh) : NaN;
    const markets = [
      ["outcome", [quote("home", Number(row.B365H)), quote("draw", Number(row.B365D)), quote("away", Number(row.B365A))]],
      ["total", [quote("over", Number(row["B365>2.5"]), 2.5), quote("under", Number(row["B365<2.5"]), 2.5)]],
      ["handicap", [quote("home", Number(row.B365AHH), handicap), quote("away", Number(row.B365AHA), -handicap)]],
    ];
    return markets.filter(([type, values]) => values.every(({ price, point }) =>
      finitePrice(price) && (type === "outcome" || Number.isInteger(point * 4))))
      .map(([type, outcomes]) => ({ type, outcomes, event, bookmaker: "Bet365", source: "Football-Data.co.uk",
        sourceUrl: footballFixtureUrl, referenceUrl: "https://football-data.co.uk/matches.php",
        rulesUrl: type === "handicap" ? "https://help.bet365.com/s/en-gb/sportsrules/soccer/asian-handicap" : footballRules,
        scope: "regulation", receivedAt: iso(received), publishedAt: iso(published), updatedAt: null,
        privateSnapshot: true, sha256 }));
  });
}

export function importOddsApi(rows, competition, received, events, requestedMarket = null) {
  const [sportKey, , sport, scope] = feeds[competition];
  if (!Array.isArray(rows) || !Number.isFinite(received)) throw new Error("Некорректный ответ The Odds API");
  const candidates = rows.filter((row) => row?.sport_key === sportKey && typeof row.id === "string" &&
    typeof row.home_team === "string" && typeof row.away_team === "string");
  const byFixture = Map.groupBy(candidates, (row) => fixtureKey({
    sport, competition, home: row.home_team, away: row.away_team, start: Date.parse(row.commence_time),
  }));
  return events.filter((event) => event.competition === competition && event.sport === sport && event.start > received).flatMap((event) => {
    const matches = byFixture.get(fixtureKey(event));
    if (matches?.length !== 1) return [];
    const [match] = matches;
    const bookmakers = (match.bookmakers ?? []).filter(({ key }) => key === "draftkings");
    if (bookmakers.length !== 1) return [];
    const [book] = bookmakers;
    const requested = requestedMarket ?? feeds[competition][1];
    return (book.markets ?? []).filter((market, _, all) => requested.split(",").includes(market.key) &&
      all.filter(({ key }) => key === market.key).length === 1).flatMap((market) => {
      const updated = Date.parse(market.last_update ?? book.last_update);
      if (!Number.isFinite(updated) || updated > received || !Array.isArray(market.outcomes)) return [];
      const type = marketTypes[market.key];
      const base = { type, event, bookmaker: "DraftKings", source: "The Odds API", sourceUrl: apiDocs,
        rulesUrl: rules[scope], scope, receivedAt: iso(received), updatedAt: iso(updated), publishedAt: null,
        providerMarket: market.key, providerEventId: match.id, privateSnapshot: false };
      if (type === "team_total") {
        return [["home", match.home_team], ["away", match.away_team]].flatMap(([team, name]) => {
          const rows = market.outcomes.filter(({ description }) => normalizeIdentity(description) === normalizeIdentity(name));
          const over = rows.find(({ name }) => name === "Over");
          const under = rows.find(({ name }) => name === "Under");
          if (rows.length !== 2 || !over || !under || !finitePrice(over.price) || !finitePrice(under.price) ||
              typeof over.point !== "number" || over.point <= 0 || !Number.isInteger(over.point * 2) ||
              over.point !== under.point) return [];
          return [{ ...base, team, outcomes: [quote("over", over.price, over.point), quote("under", under.price, under.point)] }];
        });
      }
      const selections = type === "total" ? ["over", "under"] :
        type === "outcome" && sport === "football" ? ["home", "draw", "away"] : ["home", "away"];
      const names = { over: "over", under: "under", draw: "draw",
        home: normalizeIdentity(match.home_team), away: normalizeIdentity(match.away_team) };
      const outcomes = selections.map((selection) => {
        const entries = market.outcomes.filter(({ name }) => normalizeIdentity(name) === names[selection]);
        const [entry] = entries;
        if (entries.length !== 1 || !finitePrice(entry.price) ||
            type !== "outcome" && (typeof entry.point !== "number" || !Number.isInteger(entry.point * 2))) return null;
        return quote(selection, entry.price, type === "outcome" ? null : entry.point);
      });
      if (outcomes.includes(null) || outcomes.length !== market.outcomes.length ||
          type === "total" && (outcomes[0].point <= 0 || outcomes[0].point !== outcomes[1].point) ||
          type === "handicap" && outcomes[0].point !== -outcomes[1].point) return [];
      return [{ ...base, outcomes }];
    });
  });
}

export function importFonbet(payload, received, events) {
  const updated = Date.parse(payload.updated_at);
  const { data } = payload;
  if (payload.company !== "fonbet" || payload.file !== "site_livepre_fonbet.json" ||
      !Number.isFinite(updated) || updated > received || !Array.isArray(data?.sports) ||
      !Array.isArray(data.events) || !Array.isArray(data.customFactors) || !Array.isArray(data.eventBlocks)) {
    throw new Error("Некорректный ответ ArbPlay Fonbet");
  }
  const football = new Set(data.sports.filter((row) => row.kind === "sport" && row.alias === "football").map(({ id }) => id));
  const competitions = new Map(data.sports.filter((row) => row.kind === "segment" && football.has(row.parentId))
    .map(({ id, name }) => [id, fonbetLeague[normalizeIdentity(name)]]));
  // A partial block does not specify the affected factors. Exclude the entire market.
  const blocked = new Set(data.eventBlocks.map(({ eventId }) => eventId));
  const byMatch = Map.groupBy(data.events.filter((row) => row.place === "line" && row.level === 1 &&
    Number.isSafeInteger(row.id) && !row.parentId && !blocked.has(row.id) && competitions.get(row.sportId) &&
    typeof row.team1 === "string" && typeof row.team2 === "string" && Number.isSafeInteger(row.startTime)),
  (row) => fixtureKey({ sport: "football", competition: competitions.get(row.sportId),
    home: row.team1, away: row.team2, start: row.startTime * 1000 }));
  const factors = Map.groupBy(data.customFactors, ({ e }) => e);
  return events.filter(({ sport, start }) => sport === "football" && start > received).flatMap((event) => {
    const rows = byMatch.get(fixtureKey(event));
    if (rows?.length !== 1) return [];
    const [match] = rows;
    const prices = factors.get(match.id);
    if (prices?.length !== 1 || !Array.isArray(prices[0].factors)) return [];
    const selections = [[921, "home"], [922, "draw"], [923, "away"]];
    const outcomes = selections.map(([id, selection]) => {
      const values = prices[0].factors.filter(({ f }) => f === id);
      return values.length === 1 && finitePrice(values[0].v) && values[0].pt == null
        ? quote(selection, values[0].v) : null;
    });
    if (outcomes.includes(null)) return [];
    return [{ type: "outcome", outcomes, event, bookmaker: "Fonbet (Греция)", source: "ArbPlay", sourceUrl: fonbetDocs,
      rulesUrl: "https://fonbet.gr/rules", scope: "regulation", receivedAt: iso(received), updatedAt: iso(updated),
      publishedAt: null, providerMarket: "921/922/923", providerEventId: String(match.id), privateSnapshot: false }];
  });
}

async function getMarkets(url, apiKey, fetchSource, parse) {
  const attempts = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchSource(url, { headers: { "x-api-key": apiKey },
        redirect: "error", signal: AbortSignal.timeout(8000) });
      attempts.push(response.status);
      if (response.ok) {
        const payload = await response.json();
        return { attempts, markets: parse(payload, Date.now()) };
      }
      if (![502, 503, 504].includes(response.status)) break;
    } catch {
      attempts.push("network_or_invalid_response");
    }
    if (!attempt) await new Promise((done) => setTimeout(done, 1000));
  }
  return { attempts, markets: [] };
}

export async function collectBookmakerLines(events, { apiKey, fonbetKey, teamTotals = false, privateDir, fetchSource = fetch } = {}) {
  const requests = new Map();
  const markets = [];
  if (privateDir) {
    const [csv, receipt] = await Promise.all([readFile(join(privateDir, "fixtures.csv"), "utf8"),
      readFile(join(privateDir, "receipt.json"), "utf8")]);
    markets.push(...importFootballSnapshot(csv, JSON.parse(receipt.replace(/^\uFEFF/, "")), events));
  }
  if (apiKey) {
    const groups = Map.groupBy(events.filter(({ competition }) => Object.hasOwn(feeds, competition)), (event) => event.competition);
    for (const [competition, group] of groups) {
      const [sportKey, types] = feeds[competition];
      const url = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds`);
      const starts = group.map(({ start }) => start);
      // The documented query bounds accept seconds, without milliseconds.
      const seconds = (time) => iso(time).replace(".000Z", "Z");
      url.search = new URLSearchParams({ regions: "us", bookmakers: "draftkings", markets: types,
        oddsFormat: "decimal", dateFormat: "iso", commenceTimeFrom: seconds(Math.floor(Math.min(...starts) / 1000) * 1000),
        commenceTimeTo: seconds(Math.ceil(Math.max(...starts) / 1000) * 1000 + 1000) });
      const result = await getMarkets(url, apiKey, fetchSource, (rows, time) => importOddsApi(rows, competition, time, group));
      markets.push(...result.markets);
      requests.set(competition, result.attempts);
      if (teamTotals && competition === "nba") {
        const verified = new Map(result.markets.map(({ providerEventId, event }) => [providerEventId, event]));
        for (const [id, event] of verified) {
          const exactUrl = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/events/${encodeURIComponent(id)}/odds`);
          exactUrl.search = new URLSearchParams({ regions: "us", bookmakers: "draftkings",
            markets: "team_totals", oddsFormat: "decimal", dateFormat: "iso" });
          const individual = await getMarkets(exactUrl, apiKey, fetchSource, (row, time) =>
            importOddsApi([row], competition, time, [event], "team_totals"));
          markets.push(...individual.markets);
          requests.set(`nba:team_totals:${id}`, individual.attempts);
        }
      }
    }
  }
  const canUseFonbet = events.some(({ competition }) => Object.values(fonbetLeague).includes(competition));
  if (fonbetKey && canUseFonbet) {
    const result = await getMarkets(new URL(fonbetUrl), fonbetKey, fetchSource, (payload, time) => importFonbet(payload, time, events));
    markets.push(...result.markets);
    requests.set("fonbet", result.attempts);
  }
  return { markets: Map.groupBy(markets, (row) => fixtureKey(row.event)), requests, configured: Boolean(apiKey),
    fonbetConfigured: Boolean(fonbetKey) };
}

export function priceProbability(market, offer, forecast, benchmark) {
  const { event, targets, distributions } = forecast;
  const expectedScope = event.sport === "football" ? "regulation" : feeds[event.competition]?.[3];
  if (!expectedScope || market.scope !== expectedScope) return null;
  if (market.type === "outcome") {
    const win = targets.find(({ id }) => id === "outcome")?.probabilities[offer.selection];
    return Number.isFinite(win) ? { win, method: "outcome" } : null;
  }
  // Quarter Asian lines split into two settlements. A single win estimate would be misleading.
  if (!Number.isInteger(offer.point * 2)) return null;
  const id = { total: "total", handicap: "margin", team_total: market.team }[market.type];
  if (!id || !Number.isFinite(offer.point)) return null;
  const { support } = distributions.find((measure) => measure.id === id) ?? {};
  if (!support || !benchmark.some((row) => row.id === id && row.sport === event.sport &&
    row.competition === event.competition && row.approved && row.thresholds.approved)) return null;
  let win = 0, push = 0;
  for (const [score, mass] of support) {
    const difference = market.type !== "handicap" ? (offer.selection === "over" ? 1 : -1) * (score - offer.point)
      : (offer.selection === "home" ? score : -score) + offer.point;
    if (difference > 0) win += mass;
    if (difference === 0) push += mass;
  }
  // The validation of score cutoffs covers central probabilities only.
  if (win < 0.2 || win > 0.8) return null;
  return { win, ...(Number.isInteger(offer.point) ? { push } : {}), method: "distribution" };
}

export function bookmakerCard(coverage, forecast, benchmark, now) {
  const { event } = forecast;
  const scoped = coverage.markets.get(fixtureKey(event)) ?? [];
  const fresh = scoped.filter((market) => !market.privateSnapshot && Date.parse(market.updatedAt) <= now &&
    now - Date.parse(market.updatedAt) <= maxAge && Date.parse(market.receivedAt) <= now && now < event.start);
  const snapshot = scoped.filter((market) => market.privateSnapshot && Date.parse(market.receivedAt) <= now);
  const attempts = [coverage.requests.get(event.competition),
    ...(Object.values(fonbetLeague).includes(event.competition) ? [coverage.requests.get("fonbet")] : [])].filter(Boolean);
  const status = fresh.length ? "current" : snapshot.length ? "snapshot" : scoped.length ? "stale" :
    attempts.length ? attempts.some((entry) => entry.at(-1) === 200) ? "missing" : "unavailable" :
      feeds[event.competition] || Object.values(fonbetLeague).includes(event.competition) ? "unconfigured" : "unsupported";
  const [home, away] = event.match.split(/\s+[—–]\s+/);
  const number = (x) => String(x).replace(".", ",");
  const lines = [...fresh, ...(fresh.length ? [] : snapshot)].map(({ event: _, ...market }) => ({
    ...market, marketName: bookmakerMarketName(market.type, event.sport),
    expiresAt: market.updatedAt ? iso(Math.min(event.start, Date.parse(market.updatedAt) + maxAge)) : null,
    outcomes: market.outcomes.map((offer) => {
      const team = offer.selection === "home" ? home : away;
      const condition = market.type === "outcome" ? offer.selection === "draw" ? "Ничья" : `Победа «${team}»` :
        market.type === "total" || market.type === "team_total" ?
          `${market.type === "team_total" ? `«${market.team === "home" ? home : away}» · ` : ""}${offer.selection === "over" ? "Больше" : "Меньше"} ${number(offer.point)} ${scoreSport[event.sport]}` :
          `«${team}» с форой ${offer.point > 0 ? "+" : ""}${number(offer.point)}`;
      return { ...offer, condition, model: priceProbability(market, offer, forecast, benchmark) };
    }),
  }));
  return { status, lines };
}
