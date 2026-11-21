import assert from "node:assert/strict";
import test from "node:test";
import { buildUpdate, eventIndex, resultFor, selectExpress, selectMixedExpress, SPORTS, upcomingEvidence,
  verifiedEsportsForm } from "../scripts/sports-update-core.mjs";
import { parseEnsi, parseEnsiForm, parseEnsiResult, parseScores, parseLega, parseGosu } from "../scripts/sports-sources.mjs";
import { assessMarkets, completedSeries } from "../scripts/sports-markets.mjs";

const now = Date.parse("2026-11-21T19:00:00+03:00");
const start = now + 2 * 3600_000;
const past = now - 5 * 3600_000;
const game = (source, extras = {}) => ({
  source, sport: "football", id: "1", home: "PSG", away: "Nice", tournament: "Ligue 1",
  start, status: "scheduled", url: `https://example.test/${source}`, ...extras,
});

test("a single publisher, a conflicting start and an already started fixture cannot become a card", () => {
  const a = game("a");
  for (const rows of [
    [a, { ...a }],
    [a, game("b", { start: start + 20 * 60_000 })],
    [a, game("b"), game("c", { status: "cancelled" })],
    [a, game("b"), game("b", { id: "ambiguous" })],
  ]) assert.equal(upcomingEvidence(eventIndex(rows), a, now, start + 3600_000).length, 0);
  const valid = eventIndex([a, game("b", { home: "Ницца", away: "Paris Saint-Germain" })]);
  assert.equal(upcomingEvidence(valid, a, now, start + 3600_000).length, 2);
  assert.equal(upcomingEvidence(valid, a, start, start + 3600_000).length, 0);
});

test("results follow the order of the archived competitors and disagreements require review", () => {
  const a = game("a", { start: past, status: "finished", score: [2, 1] });
  const b = game("b", { start: past, status: "finished", home: "Ницца", away: "ПСЖ", score: [1, 2] });
  const entry = { id: "entry", sport: "football", match: "ПСЖ — Ницца", start_iso: new Date(past).toISOString(), bet: "1Х" };
  assert.equal(resultFor(eventIndex([a]), entry), null);
  assert.equal(resultFor(eventIndex([a, b]), entry).status, "won");
  assert.equal(resultFor(eventIndex([a, { ...b, score: [3, 2] }]), entry).status, "review");
  assert.equal(resultFor(eventIndex([a, b]), { ...entry, bet: "ТБ 2.5 и обе забьют" }).score, undefined);
  assert.equal(resultFor(eventIndex([{ ...a, extra: true }, b]), entry), null);
});

test("hockey never settles a regulation prediction from two full-game scores", () => {
  const base = { sport: "hockey", home: "Boston Bruins", away: "Ottawa Senators", start: past, status: "finished", score: [3, 2] };
  const entry = { id: "hockey", sport: "hockey", match: "Бостон — Оттава", start_iso: new Date(past).toISOString(), bet: "П1" };
  const a = game("a", base);
  const b = game("b", base);
  assert.equal(resultFor(eventIndex([a, b]), entry), null);
  assert.equal(resultFor(eventIndex([a, b]), { ...entry, bet: "П1 (победа Бостона, с ОТ)" }).status, "won");
  const reg = { regulation: [2, 2] };
  assert.equal(resultFor(eventIndex([{ ...a, ...reg }, { ...b, ...reg }]), entry).status, "lost");
});

test("a league calendar time is parsed in Rome, and a wrong-date 365Scores payload fails", () => {
  const html = '<tr class="tab-gara"><td>1</td><td>22/11/2026<br>Ore 19:00</td><td>Modena</td><td>0-0</td><td>Cisterna</td></tr>';
  assert.equal(parseLega(html)[0].start, Date.parse("2026-11-22T18:00:00Z"));
  assert.throws(() => parseScores({ games: [{ startTime: "2026-11-21T19:00:00+00:00" }] }, "2026-11-22"), /другую дату/u);
  assert.throws(() => parseGosu("<html>Unexpected page</html>", "cs2", "counterstrike", "scheduled"), /расписания/u);
});

test("a missing category stays explicit and an unsupported fixture does not create bets or change settled history", () => {
  const at = "2026-11-21T16:00+03:00";
  const sports = SPORTS.map(([id, name]) => ({ id, name, picks: [] }));
  const current = { updated_at: at, model_version: "v4.1", sports, express: [] };
  const closed = { id: "closed", sport: "football", match: "PSG — Nice", event_date: "2026-11-20", published_at: at, status: "won" };
  const output = buildUpdate({
    current, indexFile: { months: ["2026-11"], updated_at: at },
    historyFiles: [{ predictions: [closed] }], express: { schema: 1, expresses: [] },
    rows: [game("a"), game("b"), game("c", { sport: "basketball" }),
      game("a", { sport: "hockey" }), game("b", { sport: "hockey" })],
    coverage: Object.fromEntries(SPORTS.map(([id]) => [id, id === "tennis" ? [] : ["a", "b"]])), now,
  });
  assert.equal(output.next.sports[0].events.length, 0);
  assert.equal(output.next.sports[0].availability, "insufficient_quality");
  assert.equal(output.next.sports[0].picks.length, 0);
  assert.equal(output.next.sports[1].availability, "unconfirmed");
  assert.equal(output.next.sports[2].availability, "unavailable");
  assert.equal(output.next.sports[3].availability, "empty");
  assert.match(output.next.analysis[0].verdict, /недостаточно/u);
  assert.deepEqual(output.months["2026-11"].predictions, [closed]);
});

test("Ensigame supplies an explicit time, status and CS2 match format", () => {
  const html = `<div class="hub-row" data-row-id="19" data-day-at="2026-11-22T08:00:00Z">
      <div class="w5-mc" data-state="upcoming"><a href="https://ensigame.com/matches/cs-2/19-example">
      <span class="w5-mc__format">bo3</span><span class="w5-mc__tournament">Cup</span>
      <span class="w5-mc__name" title="First">First</span><span class="w5-mc__name" title="Second">Second</span></a>`;
  const [event] = parseEnsi(html);
  assert.deepEqual([event.status, event.format, event.start], ["scheduled", "BO3", Date.parse("2026-11-22T08:00:00Z")]);
  const final = { ...event, start: event.start + 3600_000, status: "finished", score: [2, 1] };
  const detail = `<script type="application/ld+json">${JSON.stringify({ "@type": "SportsEvent", url: event.url,
    startDate: new Date(event.start).toISOString(), organizer: { name: "Cup" } })}</script>`;
  assert.equal(parseEnsiResult(detail, final).start, event.start);
  assert.throws(() => parseEnsiResult(detail, { ...final, url: "https://ensigame.com/matches/cs-2/20-example" }), /время начала/u);
});

test("two independently verified wins and losses produce a sourced football prediction and preserve the market history", () => {
  const fixture = (id, home, away, hours, score) => ["a", "b"].map((source) => game(source, {
    id, home, away, start: now + hours * 3600_000, status: score ? "finished" : "scheduled", score,
  }));
  const current = { updated_at: "2026-11-21T16:00+03:00", model_version: "v4.1",
    sports: SPORTS.map(([id, name]) => ({ id, name, picks: [] })), express: [] };
  const output = buildUpdate({
    current, indexFile: { months: [], models: [] }, historyFiles: [], express: { schema: 1, expresses: [] },
    now, coverage: Object.fromEntries(SPORTS.map(([id]) => [id, ["a", "b"]])),
    rows: [...fixture("next", "PSG", "Nice", 2), ...fixture("a1", "PSG", "Team C", -24, [2, 1]),
      ...fixture("a2", "PSG", "Team D", -48, [2, 0]), ...fixture("b1", "Nice", "Team E", -24, [0, 2]),
      ...fixture("b2", "Nice", "Team F", -48, [1, 2])],
  });
  const [forecast] = output.next.sports[0].picks;
  assert.match(forecast.bet, /^П1/u);
  assert.equal(forecast.odds, undefined);
  assert.ok(forecast.facts.length >= 3);
  assert.equal(output.months["2026-11"].predictions[0].model_version, "v5-form");
  assert.equal(output.report.history.newForecasts, 1);
});

test("CS2 form counts only unique recent series of the same format with an agreeing winner", () => {
  const html = `<a class="w5-mc__link" href="https://ensigame.com/matches/cs-2/1-cs">
    <span class="w5-mc__format">bo3</span><time datetime="2026-11-21T08:00:00Z">08:00</time>
    <span class="w5-mc__note">Ended</span>
    <span class="w5-mc__name" title="A">A<span class="w5-mc__sr">, Winner</span></span>
    <span class="w5-mc__score">2</span>
    <span class="w5-mc__name" title="C">C</span><span class="w5-mc__score">0</span></a>`;
  assert.equal(parseEnsiForm(html)[0].winner, "A");
  const match = { row: { home: "A", away: "B" }, strafe: game("Strafe", { format: "BO3" }) };
  const strafe = [[{ names: ["A", "C"], winner: "A" }, { names: ["D", "A"], winner: "D" }], []];
  const ensigame = [
    { url: "https://example.test/1", names: ["C", "A"], winner: "A", ended: past, format: "BO3" },
    { url: "https://example.test/2", names: ["D", "A"], winner: "A", ended: past, format: "BO3" },
  ];
  let [form] = verifiedEsportsForm(match, strafe, ensigame, now);
  assert.equal(form.length, 1);
  assert.ok(form[0].win);
  [form] = verifiedEsportsForm(match, strafe, [...ensigame, { ...ensigame[0], url: "https://example.test/3" }], now);
  assert.equal(form.length, 0);
});

test("expresses use two different events, preserve known prices and never repeat matches across combinations", () => {
  const leg = (match, odds) => ({ sport: "hockey", match, odds, start_iso: new Date(start).toISOString(), bet: "П1", basis: "season" });
  const a = leg("A — B", "1.5"), b = leg("C — D", "1.5"), c = leg("E — F", "1.6"), d = leg("G — H", "1.6");
  const inputs = [a, b, c, d, { ...a, bet: "П1 (победа A)" }];
  const result = selectExpress([], inputs);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((item) => item.total_odds), [2.25, 2.56]);
  assert.equal(new Set(result.flatMap((item) => item.legs.map((entry) => entry.match))).size, 4);
  assert.deepEqual(selectExpress(result, inputs).map((item) => item.id), result.map((item) => item.id));
});

test("mixed expresses combine different sports without calculated odds or fictitious profit", () => {
  const H = globalThis.HistoryCore;
  const start_iso = H.toMskIso(new Date(start));
  const legs = [
    ["football", "A — B"], ["basketball", "C — D"], ["cs2", "E — F"], ["basketball", "G — H"],
  ].map(([sport, match]) => ({ sport, match, start_iso, bet: "П1", odds: null }));
  const expresses = selectMixedExpress(legs);
  assert.equal(expresses.length, 2);
  assert.ok(expresses.every((entry) => entry.forecast_only && entry.total_odds === null &&
    new Set(entry.legs.map((leg) => leg.sport)).size === 2));
  const history = { predictions: legs.map((leg) => ({ id: H.makeId(leg.sport, H.mskDateOf(start_iso), leg.match, leg.bet), status: "won" })) };
  const { store } = H.syncExpress(null, history, { express: expresses }, H.toMskIso(new Date(now)));
  assert.ok(store.expresses.every((entry) => entry.status === "won" && entry.settled_odds === null));
  assert.equal(H.expressStats(store).profit, 0);
});

test("market settlement respects team orientation, pushes and incomplete series", () => {
  const H = globalThis.HistoryCore;
  assert.equal(H.evaluateMarket({ kind: "total", direction: "over", line: 230 }, "115:115"), "void");
  assert.equal(H.evaluateMarket({ kind: "handicap", side: "home", line: -3.5 }, "114:110"), "won");
  assert.equal(H.evaluateMarket({ kind: "handicap", side: "away", line: 3.5 }, "114:110"), "lost");
  assert.equal(H.evaluateMarket({ kind: "team-total", side: "home", direction: "over", line: 1.5 }, "2:0"), "won");
  assert.equal(H.evaluateMarket({ kind: "both-score", direction: "no" }, "2:0"), "won");
  assert.equal(H.evaluateMarket({ kind: "double-chance", side: "away" }, "1:1"), "won");
  assert.equal(H.evaluateMarket({ kind: "handicap", side: "away", line: 0.25 }, "1:1"), null);
  assert.equal(completedSeries("1:0", 3), false);
  assert.equal(completedSeries("2:1", 3), true);
});

test("structured markets use their stated settlement scope and require a complete series", () => {
  const pastStart = new Date(past).toISOString();
  const hockey = { sport: "hockey", home: "Boston Bruins", away: "Ottawa Senators", start: past,
    status: "finished", score: [3, 2], regulation: [2, 2] };
  const hockeyIndex = eventIndex([game("a", hockey), game("b", hockey)]);
  const entry = { id: "total", sport: "hockey", match: "Бостон — Оттава", start_iso: pastStart, bet: "ТБ 4,5 шайбы" };
  const market = { kind: "total", direction: "over", line: 4.5 };
  assert.equal(resultFor(hockeyIndex, { ...entry, market: { ...market, scope: "final" } }).status, "won");
  assert.equal(resultFor(hockeyIndex, { ...entry, market: { ...market, scope: "regulation" } }).status, "lost");
  const tennis = { sport: "tennis", start: past, status: "finished", score: [1, 0] };
  const tennisIndex = eventIndex([game("a", tennis), game("b", tennis)]);
  const retired = { id: "retired", sport: "tennis", match: "PSG — Nice", start_iso: pastStart, bet: "ТМ 2,5 сета",
    market: { kind: "total", direction: "under", line: 2.5, bestOf: 3, scope: "final" } };
  assert.equal(resultFor(tennisIndex, retired).status, "review");
});

test("market analysis accepts a published line only with enough different corroborated games", () => {
  const row = { sport: "basketball", home: "A", away: "B" };
  const book = { alignment: 1, markets: { total: 233.5, source: "DraftKings через ESPN", url: "https://example.test/line" } };
  const sample = (name, groups) => ({ name, results: groups.map(([id, scores]) => ({ id, scores, sources: [] })) });
  const a = sample("A", [["1", [110, 113]], ["2", [111, 110]], ["3", [114, 111]]]);
  const b = sample("B", [["4", [105, 115]], ["5", [108, 110]], ["6", [109, 110]]]);
  const selection = assessMarkets(row, [book], [a, b]);
  assert.equal(selection.market.direction, "under");
  assert.equal(selection.market.line, 233.5);
  assert.equal(selection.market.line_source.url, book.markets.url);
  assert.equal(assessMarkets(row, [book], [a, a]), null);
  assert.equal(assessMarkets(row, [], [a, b]), null);
  const mirrored = { ...book, alignment: -1, markets: { ...book.markets, total: null, handicap: [-8.5, 8.5] } };
  const spread = assessMarkets(row, [mirrored], [a, b]);
  assert.equal(spread.market.side, "home");
  assert.equal(spread.market.line, 8.5);
});
