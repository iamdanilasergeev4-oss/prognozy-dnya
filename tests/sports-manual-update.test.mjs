import assert from "node:assert/strict";
import test from "node:test";
import { appendValidatedAnalysis, checkManualPacket, checkModelCandidate, digest, MANUAL_REVIEW_AGE, sealManualPacket, selectManualAnalysis }
  from "../scripts/sports-manual-update.mjs";

const now = Date.parse("2026-11-22T01:00:00Z");
const start = now + 3_600_000;
const source = { title: "ESPN", url: "https://www.espn.com/" };
const historySource = { title: "openfootball", url: "https://openfootball.github.io/" };
const makeArticle = () => ({ sport_id: "football", match: "North — South", tournament: "Premier League", text: "Расписание сверено.",
  start_iso: new Date(start).toISOString(), sources: [source] });
const makeForecast = () => ({
  id: "1", sport: "football", home: "north", away: "south", season: "2026-27", competition: "eng1", start,
  tournament: "Premier League", match: "North — South", sourceTier: "official", sources: [source], dataAsOf: new Date(now).toISOString(),
  candidates: [{ version: "shrunk-results-1", probabilities: { home: 0.52, draw: 0.24, away: 0.24 },
    evidence: ["north", "south"].flatMap((home) => Array.from({ length: 4 }, (_, index) => ({
      id: home + index, home, away: "other", sport: "football", competition: "eng1", season: "2026-27",
      start: now - 99_000 - index, observedAt: now - 9_000, sources: [historySource],
    }))) }],
});

test("model packet verifies evidence, history and freshness, and rejects private snapshot data", () => {
  const measure = { id: "total", range: { probability: 0.6 }, support: [[2, 0.4], [3, 0.6]] };
  const baseline = { "data/predictions.json": { sports: [{ id: "football" }] },
    "data/history/express.json": { expresses: [{ id: "existing", status: "won" }] } };
  const article = { ...makeArticle(), distributions: [measure],
    modelConclusion: { id: "distribution_total", probability: 0.6 }, bookmaker: { status: "access_required", lines: [] } };
  const candidate = { ...structuredClone(baseline), "data/predictions.json": {
    source: "model-preview", analysis: [article], express: [], dailySummary: [], expressHighlights: [],
    sports: [{ id: "football", forecasts: [article] }],
  } };
  const evaluation = { checkedAt: new Date(now).toISOString(),
    forecastEvidence: [{ event: { ...makeForecast(), status: "confirmed" }, targets: [], distributions: [measure] }],
    distributionChecks: [{ sport: "football", competition: "eng1", id: "total", approved: true, thresholds: { approved: true } }],
  };
  const quotes = { quotes: [] };
  const report = { kind: "model-preview", runMode: "live", checkedAt: evaluation.checkedAt,
    blockers: [], eligible: true, researchApplied: [{ start }],
    evidence: { evaluation: digest(evaluation), quotes: digest(quotes) } };
  const verify = (files = candidate, proof = evaluation, receipt = quotes, stamp = report, at = now) =>
    checkModelCandidate(baseline, files, stamp, proof, receipt, at);
  const packet = sealManualPacket(report, baseline, candidate);
  assert.doesNotThrow(() => checkManualPacket(packet, packet.approvalId, report, baseline, candidate, now));
  assert.doesNotThrow(() => verify());
  assert.throws(() => verify(candidate, { ...evaluation, changed: true }), /Журнал/);
  assert.throws(() => verify({ ...candidate, "data/history/express.json": { expresses: [] } }), /архив/);
  assert.throws(() => verify(candidate, evaluation, quotes, report, start - 9 * 60_000), /скоро начнётся/);
  const archive = { quotes: [{ privateSnapshot: true }] };
  assert.throws(() => verify(candidate, evaluation, archive,
    { ...report, evidence: { ...report.evidence, quotes: digest(archive) } }), /Частный архив/);

  const offer = { selection: "over", price: 1.9, point: 2.5 };
  const market = { type: "total", scope: "regulation", bookmaker: "Test", source: "Test",
    sourceUrl: "https://example.com/odds", rulesUrl: "https://example.com/rules",
    receivedAt: new Date(now).toISOString(), updatedAt: new Date(now - 119 * 60_000).toISOString() };
  const recorded = { quotes: [{ ...market, sport: "football", match: article.match, start: article.start_iso, outcomes: [offer] }] };
  const priced = structuredClone(candidate);
  const pricedArticle = priced["data/predictions.json"].analysis[0];
  pricedArticle.bookmaker = { status: "current", lines: [{ ...market,
    expiresAt: new Date(now + 60_000).toISOString(), outcomes: [{ ...offer, model: { win: 0.6, method: "distribution" } }] }] };
  const pricedReport = { ...report, evidence: { ...report.evidence, quotes: digest(recorded) } };
  assert.doesNotThrow(() => verify(priced, evaluation, recorded, pricedReport));
  assert.throws(() => verify(priced, evaluation, recorded, pricedReport, now + 2 * 60_000), /Котировка устарела/);
  pricedArticle.bookmaker.lines[0].outcomes[0].model.win = 0.8;
  assert.throws(() => verify(priced, evaluation, recorded, pricedReport), /отличается от журнала или не соответствует/);
});

test("tested model enriches the existing analysis without adding a pick or rewriting other sections", () => {
  const next = { analysis: [makeArticle()], sports: [{ id: "football", picks: [] }], express: [] };
  const snapshot = structuredClone(next);
  const result = appendValidatedAnalysis(next, { forecastEvidence: [makeForecast()] }, now);
  assert.equal(result.length, 1);
  assert.match(next.analysis[0].text, /52%/);
  assert.equal(next.analysis[0].verdict, "Наибольшая оценка модели — победа «North» (52%). Даже этот исход может не состояться.");
  assert.match(next.analysis[0].text, /победы, ничьи и поражения.*частота ничьих/u);
  assert.match(next.analysis[0].text, /Поправка на домашнее поле не применялась/u);
  assert.match(next.analysis[0].text, /составы и травмы в расчёт не входят/u);
  assert.equal(result[0].homeAdjustment, false);
  assert.deepEqual(next.analysis[0].sources, [source, historySource]);
  assert.deepEqual(next.sports, snapshot.sports);
  assert.deepEqual(next.express, snapshot.express);
});

test("model verdict reports a close result from the same rounded values displayed in the article", () => {
  const forecast = makeForecast();
  forecast.candidates[0].probabilities = { home: 0.37, draw: 0.27, away: 0.36 };
  const article = { ...makeArticle(), verdict: "Подтверждённых данных недостаточно." };
  appendValidatedAnalysis({ analysis: [article] }, { forecastEvidence: [forecast] }, now);
  assert.match(article.text, /37%, ничья 27%, победа второй команды 36%/u);
  assert.equal(article.verdict, "Две наибольшие оценки модели близки. Явного преимущества нет.");
});

test("unvalidated leagues, small samples, future data and swapped competitors stay in research", () => {
  for (const adjust of [
    (item) => { item.competition = "unvalidated"; },
    (item) => { item.match = "South — North"; },
    (item) => { item.tournament = "Cup"; },
    (item) => { item.sourceTier = "secondary"; },
    (item) => { item.candidates[0].evidence.pop(); },
    (item) => { item.candidates[0].evidence[0].observedAt = now + 1; },
    (item) => { item.candidates[0].probabilities.draw = 0.88; },
  ]) {
    const fixture = makeForecast();
    const next = { analysis: [makeArticle()] };
    adjust(fixture);
    assert.deepEqual(appendValidatedAnalysis(next, { forecastEvidence: [fixture] }, now), []);
    assert.deepEqual(next.analysis, [makeArticle()]);
  }
});

test("a separately verified calendar can supply a missing analysis within the football limit", () => {
  const fixture = makeForecast();
  fixture.status = "confirmed";
  fixture.sources = [source, { title: "365Scores", url: "https://www.365scores.com/" }]
    .map((item) => ({ ...item, reportedStatus: "scheduled", reportedStart: start }));
  const next = { analysis: [] };
  assert.equal(appendValidatedAnalysis(next, { forecastEvidence: [fixture] }, now).length, 1);
  assert.equal(next.analysis[0].match, fixture.match);
  const full = { analysis: Array.from({ length: 6 }, (_, i) => ({ ...makeArticle(), match: `Other ${i} — team` })) };
  assert.deepEqual(appendValidatedAnalysis(full, { forecastEvidence: [fixture] }, now), []);
  fixture.sources[1].reportedStart += 6 * 60_000;
  assert.deepEqual(appendValidatedAnalysis({ analysis: [] }, { forecastEvidence: [fixture] }, now), []);
});

test("manual analysis evaluates the whole confirmed calendar and leaves thin or stale samples in the calendar", () => {
  const rich = makeArticle();
  const thin = { ...makeArticle(), match: "East — West" };
  const stale = { ...makeArticle(), match: "Old — Long" };
  const event = ({ match, start_iso }) => ({ match, start_iso, sources: [source] });
  const next = { analysis: [thin, stale], sports: [{ id: "football", events: [event(thin), event(stale)] }] };
  const form = (length, days) => ({ longer: Array.from({ length }, (_, i) => ({
    id: String(i), start: now - 86_400_000 * (days + i), scores: [2, 1], sources: [historySource],
  })) });
  const evidence = [{ source: source.title, url: source.url }];
  const contexts = new Map([
    [thin, { forms: [form(2, 2), form(5, 2)], evidence }],
    [stale, { forms: [form(8, 35), form(8, 35)], evidence }],
    [rich, { forms: [form(4, 2), form(6, 2)], evidence }],
  ]);
  const research = { history: [], diagnostics: { assessed: [], forecastEvidence: [makeForecast()] } };
  const out = selectManualAnalysis(next, contexts, research, now);
  assert.deepEqual(next.analysis.map((article) => article.match), [rich.match]);
  assert.deepEqual(new Set(next.sports[0].events.map((item) => item.match)), new Set([rich.match, thin.match, stale.match]));
  assert.deepEqual(out.articles[0].history, [4, 6]);
  assert.equal(out.evaluated.find((item) => item.match === stale.match).freshResults, false);
  assert.equal(out.researchApplied.length, 1);
});

test("same-source event and participant IDs resolve label differences without reversing probabilities", () => {
  const fixture = makeForecast();
  const claim = { ...source, id: "x", reportedStatus: "scheduled", reportedStart: start, participantIds: ["A", "B"], sourceCompetitionId: "league" };
  fixture.sources = [claim];
  const run = (ids, sourceCompetitionId = "league", article = { ...makeArticle(), tournament: "League Long Name", match: "North FC — South FC" }) => {
    const contexts = new Map([[article, { evidence: [{ source: source.title, id: "x", start, participantIds: ids, sourceCompetitionId }] }]]);
    return appendValidatedAnalysis({ analysis: [article] }, { forecastEvidence: [fixture] }, now, { existingOnly: true, contexts });
  };
  assert.equal(run(["A", "B"]).length, 1);
  assert.equal(run(["B", "A"]).length, 0);
  assert.equal(run(["reserve", "B"], "league", makeArticle()).length, 0);
  assert.equal(run(["A", "B"], "different competition", makeArticle()).length, 0);
});

test("review packet refuses changed production, tampered output, expired review and blockers", () => {
  const report = { eligible: true, blockers: [], checkedAt: new Date(now).toISOString(), researchApplied: [] };
  const baseline = { "data/predictions.json": { version: 1 } };
  const candidate = { "data/predictions.json": { version: 2 } };
  const packet = sealManualPacket(report, baseline, candidate);
  const check = (args = {}) => checkManualPacket(args.packet ?? packet, args.id ?? packet.approvalId, args.report ?? report,
    args.baseline ?? baseline, args.candidate ?? candidate, args.now ?? now);
  assert.doesNotThrow(() => check());
  assert.throws(() => check({ baseline: candidate }), /изменились/);
  assert.throws(() => check({ candidate: baseline }), /изменились/);
  assert.throws(() => check({ id: "not-approved" }), /изменились/);
  assert.throws(() => check({ now: now + MANUAL_REVIEW_AGE + 1 }), /устарела/);
  const blocked = { ...report, eligible: false, blockers: ["unavailable"] };
  const blockedPacket = sealManualPacket(blocked, baseline, candidate);
  assert.throws(() => check({ packet: blockedPacket, id: blockedPacket.approvalId, report: blocked }), /заблокирована/);
});
