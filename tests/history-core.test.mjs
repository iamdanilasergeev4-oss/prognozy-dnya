// Запуск: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import "../js/history-core.js";

const H = globalThis.HistoryCore;

const file = (picks, sport = "football", extra = {}) => ({
  updated_at: "2026-11-15T10:00+03:00",
  source: "claude",
  sports: [{ id: sport, name: "Футбол", picks }],
  ...extra,
});
const pick = (o = {}) => ({
  match: "Франция — Турция",
  tournament: "Лига наций",
  start: "15.11, 22:45 МСК",
  bet: "П1 (победа Франции)",
  odds: "1.14",
  confidence: 4,
  reason: "Франция сильнее по xG за последние 5 матчей.",
  facts: ["xG 2.1 против 0.9 за 5 матчей (FBref)", "Турция пропускала 2+ в 3 матчах подряд", "Франция 4-0-1 в последних 5"],
  against: ["У Франции травмирован основной вратарь"],
  uncertainty: "Ротация состава в последнем туре",
  data_quality: { level: "medium", note: "нет точных составов" },
  sources: [{ title: "FBref", url: "https://fbref.com/" }],
  ...o,
});

function fresh(p = pick(), at = "2026-11-15T10:00+03:00") {
  const h = H.emptyHistory();
  const rep = H.archive(h, file([p]), at);
  return { h, e: h.predictions[0], rep };
}

test("1. прогноз подтвердился", () => {
  const { h, e } = fresh();
  const r = H.applyResults(h, [{ id: e.id, score: "2:0", sources: [{ title: "UEFA", url: "https://uefa.com" }] }], "2026-11-16T01:00+03:00");
  assert.deepEqual(r.updated, [e.id]);
  assert.equal(e.status, "won");
  assert.equal(e.result.score, "2:0");
  const s = H.computeStats(h.predictions, { nowMs: Date.parse("2026-11-16T02:00+03:00") });
  assert.equal(s.won, 1);
  assert.equal(s.accuracy, 100);
});

test("2. прогноз оказался ошибочным", () => {
  const { h, e } = fresh();
  H.applyResults(h, [{ id: e.id, score: "1:1" }], "2026-11-16T01:00+03:00");
  assert.equal(e.status, "lost");
  const s = H.computeStats(h.predictions, { nowMs: Date.parse("2026-11-16T02:00+03:00") });
  assert.equal(s.lost, 1);
  assert.equal(s.accuracy, 0);
});

test("3. матч отменён — исключается из знаменателя, но учитывается отдельно", () => {
  const h = H.emptyHistory();
  H.archive(h, file([pick(), pick({ match: "Испания — Англия", bet: "П1" })]), "2026-11-15T10:00+03:00");
  const [a, b] = h.predictions;
  H.applyResults(h, [{ id: a.id, status: "cancelled", note: "отменён из-за погоды" }, { id: b.id, score: "3:1" }]);
  assert.equal(a.status, "cancelled");
  const s = H.computeStats(h.predictions, { nowMs: Date.parse("2026-11-16T02:00+03:00") });
  assert.equal(s.evaluated, 1);
  assert.equal(s.cancelled, 1);
  assert.equal(s.excluded, 1);
  assert.equal(s.accuracy, 100);
});

test("4. матч перенесён — не завершён и снова попадает в проверку", () => {
  const { h, e } = fresh();
  H.applyResults(h, [{ id: e.id, status: "postponed", note: "перенесён на 17.11" }]);
  assert.equal(e.status, "postponed");
  assert.ok(!H.FINAL.has(e.status));
  assert.equal(H.dueForCheck(h, Date.parse("2026-11-16T12:00+03:00")).length, 1);
  H.applyResults(h, [{ id: e.id, score: "1:0" }]);
  assert.equal(e.status, "won");
  assert.equal(e.status_log.map((x) => x.to).join(","), "postponed,won");
});

test("5. источник недоступен — без счёта событие не завершается", () => {
  const { h, e } = fresh();
  const r = H.applyResults(h, [{ id: e.id, note: "flashscore не открылся" }]);
  assert.deepEqual(r.skipped, [e.id]);
  assert.equal(e.status, "pending");
  assert.equal(e.result, null);
});

test("6. противоречивые результаты источников → требует проверки", () => {
  const { h, e } = fresh();
  H.applyResults(h, [{ id: e.id, source_scores: [{ source: "uefa.com", score: "2:1" }, { source: "flashscore", score: "2:2" }] }]);
  assert.equal(e.status, "review");
  assert.match(e.result.note, /расходятся/);
  const s = H.computeStats(h.predictions, { nowMs: Date.parse("2026-11-16T02:00+03:00") });
  assert.equal(s.evaluated, 0);
  assert.equal(s.review, 1);
  // согласные источники → обычная оценка
  H.applyResults(h, [{ id: e.id, source_scores: [{ source: "uefa.com", score: "2:1" }, { source: "flashscore", score: "2:1" }] }]);
  assert.equal(e.status, "won");
});

test("7. прогноз опубликован после начала события → late, не оценивается", () => {
  const { h, e, rep } = fresh(pick(), "2026-11-15T23:00+03:00");
  assert.deepEqual(rep.late, [e.id]);
  assert.equal(e.late, true);
  assert.equal(e.status, "void");
  const r = H.applyResults(h, [{ id: e.id, score: "2:0" }]);
  assert.deepEqual(r.skipped, [e.id]);
  assert.equal(e.status, "void");
});

test("7b. после начала события опубликованный прогноз нельзя изменить задним числом", () => {
  const { h, e } = fresh();
  const rep = H.archive(h, file([pick({ reason: "Новый текст", confidence: 5 })]), "2026-11-15T23:30+03:00");
  assert.deepEqual(rep.rejected, [e.id]);
  assert.equal(e.confidence, 4);
  assert.equal(e.reason, pick().reason);
  assert.equal(e.versions.length, 0);
  assert.equal(e.rejected_edits, 1);
});

test("7c. правка до начала сохраняет предыдущую версию, время и причину", () => {
  const { h, e } = fresh();
  H.archive(h, file([pick({ odds: "1.18", confidence: 3 })]), "2026-11-15T17:10+03:00", { reason: "вечернее обновление" });
  assert.equal(e.confidence, 3);
  assert.equal(e.versions.length, 1);
  assert.equal(e.versions[0].snapshot.confidence, 4);
  assert.equal(e.versions[0].at, "2026-11-15T10:00+03:00");
  assert.equal(e.versions[0].replaced_at, "2026-11-15T17:10+03:00");
  assert.equal(e.versions[0].reason, "вечернее обновление");
});

test("8. одно событие в разных написаниях → один id, без дубликатов", () => {
  const h = H.emptyHistory();
  H.archive(h, file([pick()]), "2026-11-15T09:00+03:00");
  H.archive(h, file([pick({ match: "франция - Турция ", bet: "П1" })]), "2026-11-15T10:00+03:00");
  H.archive(h, file([pick({ match: "Франция vs Турция", bet: "п1 (победа Франции)" })]), "2026-11-15T11:00+03:00");
  assert.equal(h.predictions.length, 1);
  // повторная архивация того же файла — без изменений
  const rep = H.archive(h, file([pick({ match: "Франция vs Турция", bet: "п1 (победа Франции)" })]), "2026-11-15T12:00+03:00");
  assert.equal(rep.added.length + rep.versioned.length, 0);
  // но другая ставка на тот же матч — отдельный прогноз
  H.archive(h, file([pick({ bet: "ТБ 2.5" })]), "2026-11-15T13:00+03:00");
  assert.equal(h.predictions.length, 2);
});

test("9. уточнение результата пересчитывает статистику и хранит прежний итог", () => {
  const { h, e } = fresh();
  H.applyResults(h, [{ id: e.id, score: "1:0" }], "2026-11-16T01:00+03:00");
  const nowMs = Date.parse("2026-11-16T05:00+03:00");
  assert.equal(H.computeStats(h.predictions, { nowMs }).accuracy, 100);
  H.applyResults(h, [{ id: e.id, score: "1:1", note: "гол отменён после проверки VAR" }], "2026-11-16T04:00+03:00");
  assert.equal(e.status, "lost");
  assert.equal(e.result_history.length, 1);
  assert.equal(e.result_history[0].score, "1:0");
  assert.equal(H.computeStats(h.predictions, { nowMs }).accuracy, 0);
});

test("10. мало данных — проверка качества выдаёт предупреждения", () => {
  const issues = H.qualityIssues({ match: "A — B", bet: "П1", reason: "Коэффициент на A ниже", sources: [] });
  assert.ok(issues.includes("меньше 3 фактов в поддержку вывода"));
  assert.ok(issues.includes("нет источников"));
  assert.ok(issues.includes("вывод опирается только на рынок"));
  assert.deepEqual(H.qualityIssues(pick()), []);
  const oddsOnly = H.qualityIssues(pick({ facts: ["кф 1.40 у букмекеров", "линия упала", "рынок за A"] }));
  assert.ok(oddsOnly.includes("все факты — про коэффициенты"));
});

test("снятие прогноза до начала и повторная публикация", () => {
  const h = H.emptyHistory();
  H.archive(h, file([pick(), pick({ match: "Испания — Англия" })]), "2026-11-15T07:00+03:00");
  const rep = H.archive(h, file([pick()]), "2026-11-15T13:00+03:00", { markWithdrawn: true });
  assert.equal(rep.withdrawn.length, 1);
  const w = h.predictions.find((x) => x.match === "Испания — Англия");
  assert.equal(w.status, "withdrawn");
  H.archive(h, file([pick(), pick({ match: "Испания — Англия" })]), "2026-11-15T17:00+03:00", { markWithdrawn: true });
  assert.equal(w.status, "pending");
  // начавшиеся матчи, выпавшие из файла, не снимаются
  const rep2 = H.archive(h, file([]), "2026-11-15T23:30+03:00", { markWithdrawn: true });
  assert.equal(rep2.withdrawn.length, 0);
});

test("нет утечки будущего: оценка видит только данные, опубликованные до начала", () => {
  const h = H.emptyHistory();
  H.archive(h, file([pick()]), "2026-11-15T10:00+03:00");
  const e = h.predictions[0];
  // «знание» после матча не может подменить прогноз
  H.archive(h, file([pick({ bet: "П1", reason: "Франция выиграла 2:0", confidence: 5 })]), "2026-11-16T00:30+03:00");
  assert.equal(e.confidence, 4);
  assert.notEqual(e.reason, "Франция выиграла 2:0");
  // статистика за период берёт события по дате начала, а не по дате проверки
  H.applyResults(h, [{ id: e.id, score: "2:0" }], "2026-11-20T10:00+03:00");
  const s = H.computeStats(h.predictions, { days: 7, nowMs: Date.parse("2026-11-20T12:00+03:00") });
  assert.equal(s.won, 1);
  const old = H.computeStats(h.predictions, { days: 7, nowMs: Date.parse("2026-11-30T12:00+03:00") });
  assert.equal(old.total, 0);
});

test("разбор времени начала, переход через Новый год", () => {
  assert.deepEqual(H.parseStart("15.11, 22:45 МСК", "2026-11-15T01:00+03:00"), { date: "2026-11-15", iso: "2026-11-15T22:45+03:00", approx: false });
  assert.equal(H.parseStart("15.11, не ранее 16:00 МСК", "2026-11-15T01:00+03:00").approx, true);
  assert.deepEqual(H.parseStart("14.11, вечер/ночь МСК", "2026-11-14T07:00+03:00"), { date: "2026-11-14", iso: null, approx: true });
  assert.equal(H.parseStart("02.01, 19:00", "2026-12-31T20:00+03:00").date, "2027-01-02");
  assert.equal(H.parseStart("31.12, 19:00", "2027-01-01T10:00+03:00").date, "2026-12-31");
});

test("оценка ставок разных типов", () => {
  const E = H.evaluateBet;
  assert.equal(E("П1 (победа Франции)", "2:0"), "won");
  assert.equal(E("П2 (победа Майами)", "110:104"), "lost");
  assert.equal(E("ТБ 2.5", "2:1"), "won");
  assert.equal(E("ТМ 2,5", "2:1"), "lost");
  assert.equal(E("ТБ 3", "2:1"), "void");
  assert.equal(E("Обе забьют — да", "1:1"), "won");
  assert.equal(E("Обе забьют — нет", "1:1"), "lost");
  assert.equal(E("1X", "0:0"), "won");
  assert.equal(E("Ф1 (-1.5)", "2:0"), "won");
  assert.equal(E("Ф2 (+1.5)", "2:1"), "won");
  assert.equal(E("Андреева выиграет сет", "2:0"), null);
  assert.equal(E("П1", "нет счёта"), null);
});

test("ставка неразбираемого типа: ручной статус принимается, без него — review", () => {
  const h = H.emptyHistory();
  H.archive(h, file([pick({ bet: "Индивидуальный тотал Франции больше 1.5" })]), "2026-11-15T10:00+03:00");
  const e = h.predictions[0];
  H.applyResults(h, [{ id: e.id, score: "2:0" }]);
  assert.equal(e.status, "review");
  H.applyResults(h, [{ id: e.id, score: "2:0", status: "won", note: "Франция забила 2" }]);
  assert.equal(e.status, "won");
  // ручной статус, противоречащий автоматической оценке, отправляет на проверку
  const { h: h2, e: e2 } = fresh();
  H.applyResults(h2, [{ id: e2.id, score: "0:1", status: "won" }]);
  assert.equal(e2.status, "review");
});

test("статистика: разбивка, калибровка по уверенности, Brier/LogLoss только при вероятностях", () => {
  const h = H.emptyHistory();
  const picks = [
    pick({ match: "A — B", confidence: 5, model_prob: { value: 0.7, source: "Opta" } }),
    pick({ match: "C — D", confidence: 5 }),
    pick({ match: "E — F", confidence: 2, model_prob: { value: 0.6, source: "Opta" } }),
  ];
  H.archive(h, file(picks), "2026-11-15T10:00+03:00");
  const [a, b, c] = h.predictions;
  H.applyResults(h, [{ id: a.id, score: "1:0" }, { id: b.id, score: "0:1" }, { id: c.id, score: "0:0" }]);
  const s = H.computeStats(h.predictions, { nowMs: Date.parse("2026-11-16T10:00+03:00") });
  assert.equal(s.evaluated, 3);
  assert.equal(s.accuracy, 33.3);
  assert.equal(s.byConfidence[4].n, 2);
  assert.equal(s.byConfidence[4].accuracy, 50);
  assert.equal(s.probability.n, 2);
  assert.equal(s.probability.brier, Math.round((((0.7 - 1) ** 2 + 0.6 ** 2) / 2) * 1000) / 1000);
  assert.equal(s.bySport[0].accuracy, 33.3);
  assert.equal(s.timeline.length, 1);
});

test("шардирование по месяцам и обратная сборка без дублей", () => {
  const h = H.emptyHistory();
  H.archive(h, file([pick(), pick({ start: "01.12, 20:00", match: "X — Y" })]), "2026-11-15T10:00+03:00");
  const parts = H.splitByMonth(h);
  assert.deepEqual(Object.keys(parts).sort(), ["2026-11", "2026-12"]);
  const back = H.mergeMonths([parts["2026-11"], parts["2026-12"], parts["2026-11"]]);
  assert.equal(back.predictions.length, 2);
});

test("статус на сайте: ожидается / идёт / ждёт проверки", () => {
  const { e } = fresh();
  assert.equal(H.displayStatus(e, Date.parse("2026-11-15T20:00+03:00")), "upcoming");
  assert.equal(H.displayStatus(e, Date.parse("2026-11-15T23:30+03:00")), "live");
  assert.equal(H.displayStatus(e, Date.parse("2026-11-16T03:00+03:00")), "awaiting");
});

test("сравнение с рынком, прибыльность и наша вероятность", () => {
  const h = H.emptyHistory();
  const picks = [
    pick({ match: "A — B", odds: "1.25", prob: { value: 0.85, method: "Elo + форма" }, data_as_of: "2026-11-15T09:30+03:00", estimates: ["Elo: 1650 против 1520"], assumptions: ["основной состав"] }),
    pick({ match: "C — D", odds: "2.00", prob: { value: 0.55, method: "Elo" } }),
    pick({ match: "E — F", odds: "1.60" }),
  ];
  H.archive(h, file(picks), "2026-11-15T10:00+03:00");
  const [a, b, c] = h.predictions;
  assert.equal(a.prob.value, 0.85);
  assert.equal(a.data_as_of, "2026-11-15T09:30+03:00");
  assert.deepEqual(a.estimates, ["Elo: 1650 против 1520"]);
  H.applyResults(h, [{ id: a.id, score: "1:0" }, { id: b.id, score: "1:0" }, { id: c.id, score: "0:1" }]);
  const s = H.computeStats(h.predictions, { nowMs: Date.parse("2026-11-16T10:00+03:00") });
  assert.equal(s.market.n, 3);
  assert.equal(s.market.won, 2);
  assert.equal(s.market.expected, Math.round((0.8 + 0.5 + 0.625) * 10) / 10);
  assert.equal(s.market.roi, Math.round(((0.25 + 1 - 1) / 3) * 1000) / 10);
  assert.equal(s.byOdds.length, 3);
  assert.equal(s.estimate.n, 2);
  assert.equal(s.estimate.brier, Math.round((((0.85 - 1) ** 2 + (0.55 - 1) ** 2) / 2) * 1000) / 1000);
  assert.equal(s.bySport[0].roi, s.market.roi);
});
