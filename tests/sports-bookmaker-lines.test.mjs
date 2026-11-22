import test from "node:test";
import assert from "node:assert/strict";
import { bookmakerCard, collectBookmakerLines, importFonbet, importFootballSnapshot, importOddsApi, priceProbability }
  from "../scripts/sports-bookmaker-lines.mjs";

const received = Date.parse("2026-11-23T17:00:00Z");
const start = Date.parse("2026-11-23T20:00:00Z");
const event = { match: "Brentford — Everton", home: "brentford", away: "everton", sport: "football", competition: "eng1", start };
const receipt = { url: "https://football-data.co.uk/fixtures.csv", status: 200,
  receivedAt: new Date(received).toISOString(), lastModified: "Fri, 20 Nov 2026 10:23:08 GMT" };
const header = "Div,Date,Time,HomeTeam,AwayTeam,B365H,B365D,B365A,B365>2.5,B365<2.5,AHh,B365AHH,B365AHA";
const record = "E0,23/11/2026,20:00,Brentford,Everton,2.15,3.5,3.3,1.73,2.1,-0.25,1.88,1.98";
const csv = [header, record].join("\n");
const target = { id: "outcome", probabilities: { home: 0.46, draw: 0.27, away: 0.27 } };
const forecast = { event, targets: [target], distributions: [] };

test("private Football-Data quotes preserve prices, roles and source dates after an exact league, names and time match", () => {
  const markets = importFootballSnapshot(csv, receipt, [event,
    { ...event, competition: "eng2" }, { ...event, start: start + 60_000 },
    { ...event, home: "Brentford U21" }, { ...event, home: "Everton", away: "Brentford" }]);
  assert.equal(markets.length, 3);
  assert.deepEqual(markets[0].outcomes.map(({ price }) => price), [2.15, 3.5, 3.3]);
  assert.deepEqual(markets[2].outcomes.map(({ point }) => point), [-0.25, 0.25]);
  assert.ok(markets.every((market) => market.privateSnapshot && market.receivedAt === receipt.receivedAt &&
    market.updatedAt === null && market.publishedAt === "2026-11-20T10:23:08.000Z"));
  assert.deepEqual(importFootballSnapshot([header, record, record].join("\n"), receipt, [event]), []);
});

const apiRow = () => ({
  id: "fixture", sport_key: "soccer_epl", home_team: "Brentford", away_team: "Everton",
  commence_time: new Date(start).toISOString(),
  bookmakers: [{ key: "draftkings", last_update: "2026-11-23T16:59:00Z", markets: [
    { key: "h2h", outcomes: [{ name: "Everton", price: 3.3 }, { name: "Draw", price: 3.5 }, { name: "Brentford", price: 2.15 }] },
  ] }],
});

test("licensed feed rejects duplicate fixtures, orientation changes and an incomplete 1X2", () => {
  const row = apiRow();
  assert.equal(importOddsApi([row], "eng1", received, [event]).length, 1);
  assert.deepEqual(importOddsApi([row, row], "eng1", received, [event]), []);
  assert.deepEqual(importOddsApi([{ ...row, home_team: "Everton", away_team: "Brentford" }], "eng1", received, [event]), []);
  row.bookmakers[0].markets[0].outcomes.pop();
  assert.deepEqual(importOddsApi([row], "eng1", received, [event]), []);
});

test("live adapter passes the key only in a header and uses market, bookmaker and receive times separately", async () => {
  const apiKey = "test-key";
  const row = apiRow();
  const current = Date.now();
  const future = current + 3 * 3600_000;
  row.commence_time = new Date(future).toISOString();
  row.bookmakers[0].last_update = new Date(current - 120_000).toISOString();
  row.bookmakers[0].markets[0].last_update = new Date(current - 60_000).toISOString();
  const next = { ...forecast, event: { ...event, start: future } };
  const coverage = await collectBookmakerLines([next.event], { apiKey, fetchSource: (url, options) => {
    assert.equal(url.hostname, "api.the-odds-api.com");
    assert.equal(url.searchParams.get("apiKey"), null);
    assert.equal(options.headers["x-api-key"], apiKey);
    assert.equal(options.redirect, "error");
    return new Response(JSON.stringify([row]));
  } });
  const fresh = bookmakerCard(coverage, next, [], Date.now());
  assert.equal(fresh.status, "current");
  assert.equal(fresh.lines[0].updatedAt, row.bookmakers[0].markets[0].last_update);
  assert.equal(fresh.lines[0].outcomes[0].model.win, 0.46);
  const stale = bookmakerCard(coverage, next, [], current + 2 * 3600_000);
  assert.deepEqual(stale, { status: "stale", lines: [] });
});

test("market calculations handle strict sides, refunds, and matching regulation or overtime", () => {
  const basketball = { ...event, sport: "basketball", competition: "nba" };
  const benchmark = [{ id: "total", sport: "basketball", competition: "nba", approved: true, thresholds: { approved: true } }];
  const total = { event: basketball, targets: [],
    distributions: [{ id: "total", support: [[219, 0.25], [220, 0.25], [221, 0.5]] }] };
  const market = { scope: "overtime", type: "total" };
  assert.deepEqual(priceProbability(market, { selection: "over", point: 220 }, total, benchmark),
    { win: 0.5, push: 0.25, method: "distribution" });
  assert.deepEqual(priceProbability(market, { selection: "under", point: 220.5 }, total, benchmark),
    { win: 0.5, method: "distribution" });
  assert.equal(priceProbability({ ...market, scope: "regulation" }, { selection: "over", point: 220 }, total, benchmark), null);
  assert.equal(priceProbability(market, { selection: "over", point: 220.25 }, total, benchmark), null);
  assert.equal(priceProbability(market, { selection: "over", point: 220 }, total, []), null);
});

test("individual totals use the named side's score distribution, independently of handicap and full-game totals", () => {
  const nba = { ...event, competition: "nba", sport: "basketball", home: "Home Team", away: "Away Team" };
  const row = { ...apiRow(), sport_key: "basketball_nba", home_team: nba.home, away_team: nba.away };
  row.bookmakers[0].markets = [{ key: "team_totals", outcomes: [
    { name: "Over", description: nba.home, price: 1.95, point: 113.5 },
    { name: "Under", description: nba.home, price: 1.85, point: 113.5 },
    { name: "Under", description: nba.away, price: 1.95, point: 119.5 },
    { name: "Over", description: nba.away, price: 1.85, point: 119.5 },
  ] }];
  const [home, away] = importOddsApi([row], "nba", received, [nba], "team_totals");
  const projection = { event: nba, targets: [], distributions: [
    { id: "home", support: [[113, 0.4], [114, 0.6]] }, { id: "away", support: [[119, 0.7], [120, 0.3]] },
  ] };
  const checks = ["home", "away"].map((id) => ({
    id, sport: "basketball", competition: "nba", approved: true, thresholds: { approved: true },
  }));
  assert.equal(home.outcomes[0].point, 113.5);
  assert.equal(away.outcomes[0].point, 119.5);
  assert.equal(priceProbability(home, home.outcomes[0], projection, checks).win, 0.6);
  assert.equal(priceProbability(away, away.outcomes[0], projection, checks).win, 0.3);
  assert.equal(priceProbability(away, away.outcomes[0], projection, checks.slice(0, 1)), null);
  row.bookmakers[0].markets[0].outcomes[1].point = 115.5;
  assert.deepEqual(importOddsApi([row], "nba", received, [nba], "team_totals").map(({ team }) => team), ["away"]);
});

test("Fonbet imports only open, pre-match top-level football markets with an unambiguous league, sides and time", () => {
  const match = { id: 10, sportId: 2, level: 1, place: "line", team1: "Brentford", team2: "Everton", startTime: start / 1000 };
  const payload = { company: "fonbet", file: "site_livepre_fonbet.json", updated_at: "2026-11-23T16:59:00Z", data: {
    sports: [{ id: 1, kind: "sport", alias: "football" },
      { id: 2, parentId: 1, kind: "segment", name: "England. Premier League" }],
    events: [match], customFactors: [{ e: 10, factors: [{ f: 922, v: 3.5 }, { f: 921, v: 2.15 }, { f: 923, v: 3.3 }] }],
    eventBlocks: [],
  } };
  const [market] = importFonbet(payload, received, [event]);
  assert.equal(market.bookmaker, "Fonbet (Греция)");
  assert.deepEqual(market.outcomes.map(({ price }) => price), [2.15, 3.5, 3.3]);
  assert.equal(priceProbability(market, market.outcomes[0], forecast, []).win, 0.46);
  assert.deepEqual(importFonbet(payload, received, [{ ...event, start: start + 60_000 }]), []);
  match.place = "live";
  assert.deepEqual(importFonbet(payload, received, [event]), []);
  match.place = "line";
  payload.data.eventBlocks.push({ eventId: match.id, state: "partial" });
  assert.deepEqual(importFonbet(payload, received, [event]), []);
});
