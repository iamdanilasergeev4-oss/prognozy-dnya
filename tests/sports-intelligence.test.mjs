import test from "node:test";
import assert from "node:assert/strict";
import { calendarJobs, discover } from "../scripts/sports-discovery.mjs";
import { createOutcomeModel } from "../scripts/sports-models.mjs";
import { evaluateProbabilities, parseEnglishSeason, walkForward } from "../scripts/sports-evaluation.mjs";
import { buildShadowReport } from "../scripts/sports-shadow.mjs";
import { compareFootballModels } from "../scripts/sports-model-comparison.mjs";
import { parseOpenLiga, parseProMaps } from "../scripts/sports-research-sources.mjs";

const DAY = 86_400_000;
const now = Date.parse("2026-11-22T00:30:00+03:00");
const until = Date.parse("2026-11-24T00:00:00+03:00");
const starts = now + 3_600_000;
const row = (patch = {}) => ({ source: "First", id: "1", sport: "football", tournament: "EFL League Two",
  home: "City FC", away: "Rovers", start: starts, status: "scheduled", url: "https://one.example/", ...patch });

test("discovery reconciles scoped competitions and Moscow date without merging academy squads", () => {
  const result = discover([row(), row({ source: "Second", id: "2", tournament: "English League Two" }),
    row({ source: "Second", id: "3", home: "City FC U21" }),
    row({ source: "Third", id: "4", tournament: "Regional League", start: starts + 1000 })], { now, until });
  assert.equal(result.events.length, 3);
  const [confirmed] = result.events.filter((event) => event.status === "confirmed");
  assert.equal(confirmed.date, "2026-11-22");
  assert.equal(confirmed.competition, "eng4");
  assert.equal(confirmed.tier, "lower_division");
  assert.equal(confirmed.sources.length, 2);
});

test("duplicate source IDs and conflicting statuses or formats do not confirm a fixture", () => {
  const independent = { source: "Second", id: "2" };
  for (const other of [row({ ...independent, status: "postponed" }), row({ ...independent, format: "BO3" }),
    row({ ...independent, start: starts + 18 * 60_000 })]) {
    assert(!discover([row({ format: "BO5" }), other], { now, until }).events.some((event) => event.status === "confirmed"));
  }
  const duplicate = discover([row(), row({ id: "9" }), row(independent)], { now, until });
  assert.equal(duplicate.events[0].status, "conflict");
});

test("only settled and corroborated results beyond the availability gap train models", () => {
  const settled = { start: now - 2 * DAY, status: "finished", score: [2, 1] };
  const first = row(settled);
  const second = row({ ...settled, source: "Second", id: "2", home: "Rovers", away: "City FC", score: [1, 2] });
  assert.deepEqual(discover([first, second], { now, until }).results[0].score, [2, 1]);
  assert.equal(discover([first, { ...second, score: [0, 2] }], { now, until }).results.length, 0);
  assert.equal(discover([first, second], { now: now - DAY, until }).results.length, 0);
});

test("date-only calendar claims stay separate from verified time and reject an invalid feed", () => {
  const job = calendarJobs(now).find((item) => item.competition === "eng4");
  assert.equal(job.parse({ matches: [{ date: "2026-11-22", team1: "City FC", team2: "Rovers" }] })[0].start, null);
  assert.throws(() => job.parse({ matches: null }), /формат/);
});

test("all seven profiles produce valid outcomes when enough comparable results exist", () => {
  for (const sport of ["football", "basketball", "tennis", "volleyball", "hockey", "cs2", "dota2"]) {
    const model = createOutcomeModel();
    const rules = ["cs2", "dota2"].includes(sport) ? "BO3" : null;
    const event = { sport, rules, patch: rules && "verified", competition: "division", season: "s1", home: "a", away: "b" };
    assert.equal(model.predict({ ...event, start: now }), null);
    for (let i = 0; i < 4; i++) {
      const match = { ...event, id: String(i), score: sport === "volleyball" ? [3, 1] : [2, 1], start: now - (5 - i) * DAY };
      assert(model.observe(match));
      assert(!model.observe(match));
    }
    const { probabilities } = model.predict({ ...event, start: now });
    assert(probabilities.home > probabilities.away);
    assert(Math.abs(Object.values(probabilities).reduce((a, b) => a + b, 0) - 1) < 1e-12);
    assert.equal(model.predict({ ...event, season: "s2", start: now }), null);
    assert.equal(model.predict({ ...event, start: now - 3 * DAY }), null);
    if (rules) assert.equal(model.predict({ ...event, patch: "changed", start: now }), null);
  }
});

test("walk-forward excludes same-day outcomes and missing market prices", () => {
  const date = Date.parse("2024-08-07");
  const common = { sport: "football", competition: "E3", season: "2425", level: "lower_division", home: "a", away: "b" };
  const older = Array.from({ length: 3 }, (_, i) => ({ ...common, id: String(i), start: date - (5 - i) * DAY, score: [1, 0] }));
  const onDay = [{ ...common, id: "4", start: date, score: [2, 0] }, { ...common, id: "5", start: date, score: [2, 0] }];
  const later = { ...common, id: "6", start: date + 2 * DAY, score: [2, 0] };
  const evalRows = walkForward([...older, ...onDay, later], date);
  assert.deepEqual(evalRows.map((match) => Boolean(match.model)), [false, false, true]);
  assert(evalRows.every((match) => match.market === null));
});

test("probability metrics and reliability bins are computed on predictions, not arbitrary grades", () => {
  const metrics = evaluateProbabilities([{ probabilities: { home: 0.75, away: 0.25 }, actual: "home" }]);
  assert.equal(metrics.brier, 0.125);
  assert.equal(metrics.logLoss, -Math.log(0.75));
  assert.equal(metrics.reliability.at(-1).actual, 1);
  assert.throws(() => evaluateProbabilities([{ probabilities: { home: 0.75, away: 0.15 }, actual: "home" }]));
});

test("historical CSV validates exact dates and keeps odds separate from model inputs", () => {
  const header = "Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR,AvgH,AvgD,AvgA\n";
  const { events } = parseEnglishSeason(header + 'E3,08/08/2024,"United, FC",Rovers,1,1,D,2,3,4', "E3", "2425");
  assert.equal(events[0].home, "United, FC");
  assert.equal(events[0].market.home, 6 / 13);
  assert.throws(() => parseEnglishSeason(header + "E3,31/02/2025,City,Rovers,1,1,D,2,3,4", "E3", "2425"));
});

test("shadow separates schedule status, model readiness and inaccessible sources", async () => {
  const report = await buildShadowReport({ rows: [row(), row({ source: "Second", id: "2", tournament: "League Two", country: "GB" })],
    now, until, checkedAt: new Date(now).toISOString(), legacyReport: { football: {} }, requestErrors: [],
    fetchData: async (url) => {
      if (url.includes("4-league2")) throw new Error("HTTP 503");
      return { matches: [] };
    } });
  assert.equal(report.coverage.confirmedSchedule, 1);
  assert.equal(report.sports.football.forecast, 0);
  assert.equal(report.assessed[0].analysisStatus, "insufficient_results");
  assert.equal(report.requests.find((request) => request.competition === "eng4").status, "temporarily_unavailable");
});

test("esports resolves a known short name only with a unique expanded edition", () => {
  const first = row({ sport: "cs2", tournament: "CCT EU", source: "Ensigame" });
  const second = row({ sport: "cs2", tournament: "2026 CCT Europe Series #15", source: "Strafe" });
  assert.equal(discover([first, second], { now, until }).events.some((event) => event.status === "confirmed"), false);
  assert.equal(discover([first, second], { now, until, improved: true }).events[0].status, "confirmed");
  const clash = row({ ...second, source: "GosuGamers", tournament: "CCT Europe Series #16" });
  assert.equal(discover([first, second, clash], { now, until, improved: true }).events.some((event) => event.status === "confirmed"), false);
});

test("reasons separate competition names, timing and lack of a second source", () => {
  const second = row({ source: "Second", id: "2" });
  assert.equal(discover([row(), { ...second, tournament: "National Cup" }], { now, until }).events[0].verificationReason,
    "competition_mismatch");
  assert.equal(discover([row(), { ...second, start: starts + 1_800_000 }], { now, until }).events[0].verificationReason,
    "time_conflict");
  assert.equal(discover([row()], { now, until }).events[0].verificationReason, "single_publisher");
});

test("a generic football name is matched only with the expected country", () => {
  const shorter = row({ source: "365Scores", tournament: "Super League", sourceCountry: "Greece" });
  const longer = row({ source: "ESPN", tournament: "Greek Super League" });
  assert.equal(discover([shorter, longer], { now, until, improved: true }).events[0].status, "confirmed");
  assert(!discover([{ ...shorter, sourceCountry: "Switzerland" }, longer], { now, until, improved: true })
    .events.some((event) => event.status === "confirmed"));
});

test("regional calendar checks UTC, tournament and 90-minute results", () => {
  const details = { shortcut: "regio-bayern", label: "Regionalliga Bayern", season: "2026", now, until, url: "https://example.com" };
  const raw = { matchID: 2, matchDateTimeUTC: new Date(starts).toISOString(), matchIsFinished: false, leagueSeason: 2026,
    leagueShortcut: "regio-bayern", team1: { teamId: 1, teamName: "A" }, team2: { teamId: 2, teamName: "B" } };
  assert.equal(parseOpenLiga([raw], details)[0].start, starts);
  assert.equal(parseOpenLiga([{ ...raw, matchDateTimeUTC: raw.matchDateTimeUTC.slice(0, -1) }], details).length, 0);
  assert.equal(parseOpenLiga([{ ...raw, leagueSeason: 2025 }], details).length, 0);
  assert.deepEqual(parseOpenLiga([{ ...raw, matchIsFinished: true, matchDateTimeUTC: new Date(now - DAY).toISOString(),
    matchResults: [{ resultTypeKind: "HalfTime", pointsTeam1: 9, pointsTeam2: 3 },
      { resultTypeKind: "After90Minutes", pointsTeam1: 2, pointsTeam2: 1 }] }], details)[0].score, [2, 1]);
});

test("OpenDota keeps maps separate, rejects unfinished maps and deduplicates", () => {
  const map = { match_id: 1000, start_time: (now - DAY) / 1000, duration: 1200, radiant_team_id: 1, dire_team_id: 2,
    radiant_name: "A", dire_name: "B", series_id: 3, radiant_win: true };
  const rows = parseProMaps([map, map, { ...map, match_id: 1001, start_time: now / 1000 }], now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].seriesId, "3");
  assert.equal(rows[0].patch, undefined);
});

test("model comparison calibrates before the holdout and uses strictly paired matches", () => {
  const distribution = { home: 0.5, draw: 0.25, away: 0.25 };
  const make = (i, actual) => ({ id: String(i), start: now + i * 7 * DAY, actual, model: distribution, scoreModel: distribution,
    sport: "football", competition: "E3" });
  const sample = Array.from({ length: 12 }, (_, i) => make(i, "home"));
  sample.push({ ...make(13, "draw"), scoreModel: null });
  const holdout = now + 3 * 7 * DAY;
  const report = compareFootballModels(sample, holdout);
  const changedHoldout = sample.map((event) => event.start < holdout ? event : { ...event, actual: "away" });
  assert.equal(report.temperature, compareFootballModels(changedHoldout, holdout).temperature);
  assert.equal(report.calibrationMatches, 3);
  assert.equal(report.holdoutMatches, 9);
  assert.equal(report.metrics.goals.matches, report.metrics.elo.matches);
  assert.deepEqual(report.differencesVersusElo.goals.logLoss, { weeks: 9, low: 0, high: 0 });
});

test("two identifiers for the same name in one competition block model use", async () => {
  const secondSource = { source: "Second", tournament: "English League Two" };
  const past = { start: now - 2 * DAY, status: "finished", score: [2, 1] };
  const report = await buildShadowReport({
    rows: [row({ participantIds: ["a1", "b"] }), row({ ...secondSource, id: "2", participantIds: ["x", "y"] }),
      row({ ...past, id: "3", participantIds: ["a2", "b"] }),
      row({ ...secondSource, ...past, id: "4", participantIds: ["x", "y"] })],
    now, until, checkedAt: new Date(now).toISOString(), legacyReport: { football: {} }, requestErrors: [],
    fetchData: async () => ({ matches: [] }),
  });
  assert.equal(report.assessed[0].analysisStatus, "identity_needs_verification");
  assert.equal(report.trainingResults, 0);
});
