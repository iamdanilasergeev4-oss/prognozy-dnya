import assert from "node:assert/strict";
import test from "node:test";
import { describeEvidence } from "../scripts/sports-article-evidence.mjs";

const now = Date.parse("2026-11-22T10:00:00Z");
const day = 86_400_000;
const source = { title: "Calendar", url: "https://example.test/scores" };

test("the extended article uses full comparable season results and excludes future observations", () => {
  const start = now + 3_600_000;
  const article = { sport_id: "football", match: "A — B", text: "Время проверено.", start_iso: new Date(start).toISOString(), sources: [source] };
  const fixture = { sport: "football", competition: "deu3", season: "2026-27", rules: null,
    match: article.match, home: "a", away: "b", status: "confirmed", start };
  const result = (side, id, fields = {}) => ({
    sport: "football", competition: "deu3", season: "2026-27", home: side === "a" ? "a" : "opponent",
    away: side === "b" ? "b" : "opponent", id, start: now - day * id, observedAt: now - 1, homeField: true,
    sources: [source], score: [1, 0], ...fields,
  });
  const history = [1, 2, 3, 4, 5].flatMap((id) => [result("a", id), result("b", id + 5)]);
  history.push(result("a", 11, { observedAt: now + 1 }), result("b", 12, { season: "2025-26" }));
  const info = describeEvidence(article, null, { diagnostics: { assessed: [fixture] }, history }, now);
  assert.deepEqual(info.history, [5, 5]);
  assert.equal(info.splits, 2);
  assert.match(article.text, /дома — побед 5 из 5/u);
  assert.match(article.text, /на выезде — побед 0 из 5/u);
  assert.match(article.text, /средний общий счёт 1 \(голов за матч\), средняя разница \+1\./u);
  assert.match(article.text, /матчи с 3\+ голами — 0 из 5/u);
  assert.doesNotMatch(article.text, /2025-26|%/u);
  assert.match(article.text, /Вероятности исходов не рассчитаны\.[\s\S]+Контекст матча и статистика для сравнения/u);
});

test("map totals stay out of CS2 articles based on verified series winners alone", () => {
  const article = { sport_id: "cs2", match: "A — B", format: "BO3", text: "Расписание проверено.",
    start_iso: new Date(now + day).toISOString(), sources: [source] };
  const results = Array.from({ length: 5 }, (_, i) => ({ id: String(i), win: i < 3, start: now - (i + 1) * day, sources: [source] }));
  const info = describeEvidence(article, { forms: [{ editorial: results }, { editorial: results }] },
    { diagnostics: { assessed: [] }, history: [] }, now);
  assert.equal(info.quality, true);
  assert.equal(info.scoringContext, false);
  assert.match(article.text, /Сверенных счётов по картам недостаточно/u);
  assert.doesNotMatch(article.text, /средний общий счёт/u);
});
