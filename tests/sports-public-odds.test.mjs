import test from "node:test";
import assert from "node:assert/strict";
import { importEspnScoreboardLines } from "../scripts/sports-espn-lines.mjs";
import { importReviewedPublicLine } from "../scripts/sports-public-odds.mjs";
import { bookmakerCard, collectBookmakerLines } from "../scripts/sports-bookmaker-lines.mjs";

const receivedAt = "2026-11-23T10:00:00Z";
const start = "2026-11-24T00:00:00Z";
const event = { id: "known", sport: "basketball", competition: "nba", start: Date.parse(start),
  match: "First — Second", home: "First", away: "Second",
  sources: [{ title: "ESPN", id: "10", reportedStatus: "scheduled", reportedStart: Date.parse(start) }] };
const receipt = { competition: "nba", url: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261123",
  status: 200, receivedAt };
const body = () => ({
  leagues: [{ slug: "nba" }],
  events: [{ id: "10", date: start, competitions: [{ id: "10", date: start, status: { type: { name: "STATUS_SCHEDULED" } },
    competitors: [{ homeAway: "home", team: { displayName: "First" } }, { homeAway: "away", team: { displayName: "Second" } }],
    odds: [{ provider: { id: "100", name: "DraftKings" },
      moneyline: { home: { close: { odds: "+135" } }, away: { close: { odds: "-160" } } },
      total: { over: { close: { odds: "-115", line: "o215.5" } }, under: { close: { odds: "-105", line: "u215.5" } } },
    }] }] }],
});

test("ESPN quotes use the exact pregame fixture and remain observations without a vendor timestamp", async () => {
  const markets = importEspnScoreboardLines(body(), receipt, [event]);
  assert.equal(markets.length, 2);
  assert.deepEqual(markets[1].outcomes.map(({ point, americanPrice }) => [point, americanPrice]), [[215.5, -115], [215.5, -105]]);
  const coverage = await collectBookmakerLines([event], { publicQuotes: { markets, requests: [] } });
  const card = bookmakerCard(coverage, { event, targets: [{ id: "outcome", probabilities: { home: 0.40, away: 0.60 } }] },
    [], Date.parse(receivedAt) + 60_000);
  assert.equal(card.status, "observed");
  assert.equal(card.lines[0].outcomes[0].model.win, 0.40);
  assert.equal(card.lines[0].updatedAt, null);
  assert.equal(bookmakerCard(coverage, { event }, [], Date.parse(receivedAt) + 7_200_001).status, "stale");
});

test("a wrong ID, mirrored sides, started game or split total cannot pass an ESPN quote", () => {
  const p = body();
  assert.equal(importEspnScoreboardLines(p, receipt, [{ ...event, home: "Second", away: "First" }]).length, 0);
  assert.equal(importEspnScoreboardLines(p, receipt, [{ ...event, sources: [] }]).length, 0);
  p.events[0].competitions[0].odds[0].total.under.close.line = "u216.5";
  assert.equal(importEspnScoreboardLines(p, receipt, [event]).length, 1);
  p.events[0].competitions[0].status.type.name = "STATUS_IN_PROGRESS";
  assert.equal(importEspnScoreboardLines(p, receipt, [event]).length, 0);
});

test("a public esports quote requires the same series format and does not infer bookmaker rules", () => {
  const fixture = { ...event, sport: "cs2", tournament: "Tournament", rules: "BO3" };
  const row = { sport: "cs2", tournament: fixture.tournament, home: fixture.home, away: fixture.away, start, receivedAt,
    url: "https://gamblino.com/esports/match/example", bookmaker: "Book", markets: [{ type: "outcome", prices: [1.5, 2.5] }] };
  const line = importReviewedPublicLine(row, [fixture], Date.parse(receivedAt))[0];
  assert.equal(line.observationOnly, true);
  assert.equal(line.modelComparable, false);
  assert.equal(importReviewedPublicLine(row, [{ ...fixture, rules: "BO5" }], Date.parse(receivedAt)).length, 0);
});
