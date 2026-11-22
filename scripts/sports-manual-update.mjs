import { createHash } from "node:crypto";
import { normalizeIdentity } from "./sports-discovery.mjs";
import { researchConfirmed } from "./sports-evidence.mjs";
import { SPARSE_MODEL_VERSION } from "./sports-sparse-model.mjs";
import "../js/history-core.js";

const testedLeagues = new Set(["eng1", "eng2", "eng3", "eng4", "deu2", "deu3", "esp2", "deu4b", "deu4n", "deu4e"]);
const outcomes = ["home", "draw", "away"];
const mins = 60_000;
export const MANUAL_REVIEW_AGE = 60 * mins;
const sourceKey = (source) => `${source.title}|${source.url}`;
const sameMatch = (a, b) => normalizeIdentity(a) === normalizeIdentity(b);
const publicModelLabel = "Оценка модели исхода";
const maxFootballArticles = 6;

function findArticle(next, fixture) {
  const matches = next.analysis.filter((article) => article.sport_id === fixture.sport &&
    sameMatch(article.match, fixture.match) && Math.abs(Date.parse(article.start_iso) - fixture.start) <= 5 * mins &&
    sameMatch(article.tournament, fixture.tournament));
  return matches.length === 1 ? matches[0] : null;
}

function readyModel(result, now) {
  if (result.sport !== "football" || !testedLeagues.has(result.competition) || !researchConfirmed(result.sourceTier) ||
      result.start <= now + 10 * mins || !(Date.parse(result.dataAsOf) <= now)) return null;
  const model = result.candidates?.find((item) => item.version === SPARSE_MODEL_VERSION);
  const probabilities = model?.probabilities;
  if (!probabilities || Object.keys(probabilities).length !== outcomes.length ||
      outcomes.some((key) => !Number.isFinite(probabilities[key]) || probabilities[key] < 0 || probabilities[key] > 1) ||
      Math.abs(outcomes.reduce((sum, key) => sum + probabilities[key], 0) - 1) > 1e-8) return null;
  const asOf = Date.parse(result.dataAsOf);
  const evidence = model.evidence ?? [];
  if (!evidence.length || evidence.some((entry) => entry.sport !== result.sport || entry.competition !== result.competition ||
    !Number.isFinite(entry.observedAt) || !(entry.start < entry.observedAt && entry.observedAt <= asOf))) return null;
  const sample = [result.home, result.away].map((side) => new Set(evidence.filter((entry) => entry.season === result.season &&
    [entry.home, entry.away].includes(side)).map((entry) => entry.id)).size);
  return sample.every((count) => count >= 4) ? { ...model, sample } : null;
}

export function appendValidatedAnalysis(next, research, now) {
  const applied = [];
  const eligible = research.forecastEvidence.flatMap((event) => {
    const model = readyModel(event, now);
    return model ? [{ event, model }] : [];
  }).sort((a, b) => Math.min(...b.model.sample) - Math.min(...a.model.sample) || a.event.start - b.event.start);
  for (const { event, model } of eligible) {
    let article = findArticle(next, event);
    if (article) {
      if (!article.sources.some((source) => event.sources.some((claim) => sourceKey(claim) === sourceKey(source)))) continue;
    } else {
      const claims = event.sources.filter((claim) => claim.title && URL.parse(claim.url)?.protocol === "https:" &&
        claim.reportedStatus === "scheduled" && Math.abs(claim.reportedStart - event.start) <= 5 * mins);
      const duplicate = next.analysis.some((item) => item.sport_id === event.sport && sameMatch(item.match, event.match) &&
        Math.abs(Date.parse(item.start_iso) - event.start) <= 15 * mins);
      if (event.status !== "confirmed" || event.verificationReason || duplicate ||
          next.analysis.filter((item) => item.sport_id === "football").length >= maxFootballArticles ||
          new Set(claims.map((claim) => claim.title)).size < 2) continue;
      const start = globalThis.HistoryCore.toMskIso(new Date(event.start));
      article = { sport_id: event.sport, sport: "Футбол", match: event.match, tournament: event.tournament,
        start_iso: start, start: `${start.slice(8, 10)}.${start.slice(5, 7)}, ${start.slice(11, 16)} МСК`,
        text: "Участники и время начала совпали в расписаниях источников.", automated: true,
        sources: claims.map(({ title, url }) => ({ title, url })) };
      next.analysis.push(article);
    }
    const percentages = outcomes.map((key) => Math.round(model.probabilities[key] * 100));
    const summary = `${publicModelLabel} за основное время (округлено) — победа первой команды ${percentages[0]}%, ничья ${percentages[1]}%, победа второй команды ${percentages[2]}%.`;
    article.text += `\n${summary}\nМодель учитывает результаты обеих команд. В текущем сезоне использовано ${model.sample.join(" и ")} матчей соответственно. Оценка основана на проверке исторических данных по этой группе лиг.`;
    const evidenceSources = model.evidence.flatMap((entry) => entry.sources ?? []);
    article.sources = [...new Map([...article.sources, ...evidenceSources.filter((source) => source.title && URL.parse(source.url)?.protocol === "https:")]
      .map((source) => [sourceKey(source), { title: source.title, url: source.url }])).values()];
    applied.push({ id: event.id, match: article.match, start: Date.parse(article.start_iso), version: model.version, sample: model.sample });
  }
  return applied;
}

export function siteData(input, output) {
  return {
    "data/predictions.json": output?.next ?? input.current,
    "data/history/index.json": output?.nextIndex ?? input.indexFile,
    "data/history/express.json": output?.express ?? input.express,
    ...Object.fromEntries((output ? Object.values(output.months) : input.historyFiles)
      .map((row) => [`data/history/${row.month}.json`, row])),
  };
}

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fileHashes = (files) => Object.fromEntries(Object.keys(files).sort().map((name) => [name, digest(files[name])]));

export function sealManualPacket(report, baseline, candidate) {
  const packet = { baseline: fileHashes(baseline), candidate: fileHashes(candidate), report: digest(report) };
  return { ...packet, approvalId: digest(packet) };
}

export function checkManualPacket(packet, approvalId, report, baseline, candidate, now) {
  const expected = sealManualPacket(report, baseline, candidate);
  if (approvalId !== expected.approvalId || digest(packet) !== digest(expected)) throw new Error("Файлы пакета или базовая версия сайта изменились");
  const age = now - Date.parse(report.checkedAt);
  if (!report.eligible || report.blockers.length || !Number.isFinite(age) || age < 0 || age > MANUAL_REVIEW_AGE) {
    throw new Error("Подборка заблокирована или устарела. Нужен новый пробный запуск");
  }
  if (report.researchApplied.some(({ start }) => start <= now + 10 * mins)) throw new Error("Матч из нового разбора скоро начнётся");
}

export function manualSummary(report, research, requests, snapshot) {
  const names = { football: "Футбол", basketball: "Баскетбол", tennis: "Теннис", volleyball: "Волейбол",
    hockey: "Хоккей", cs2: "CS2", dota2: "Dota 2" };
  const lines = ["# Ручное обновление аналитики", "", `Проверено ${report.checkedAt}.`,
    report.eligible ? "Пробная версия прошла проверки. Для публикации нужно отдельное подтверждение." :
      "Пробная версия заблокирована. Не использовать её для публикации.", "",
    "| Спорт | Найдено | Подтверждено в исследовании | С историей у обеих сторон | Исследовательские расчёты | Сверено для сайта | В пробной копии |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"];
  for (const [sport, label] of Object.entries(names)) {
    const group = research.sports[sport] ?? {};
    lines.push(`| ${label} | ${group.detected ?? "—"} | ${group.confirmed ?? "—"} | ${group.historyAvailable ?? "—"} | ${group.forecast ?? "—"} | ${report.sports[sport].confirmed} | ${report.sports[sport].selected} |`);
  }
  lines.push("", "Проверка для сайта пользуется действующими правилами сопоставления. Исследовательская проверка отдельно сверяет турнир, контекст и происхождение источников.",
    `Разборов с оценкой модели — ${report.researchApplied.length}. Остальные модельные расчёты остаются в локальной диагностике.`,
    `Снимок исходных данных — ${snapshot || "недоступен"}.`, "", "## Ошибки и ограничения", "",
    ...report.blockers.map((error) => `- ${error}`),
    ...report.errors.map(({ publisher, url, error }) => `- ${publisher || "Источник"}, ${url || "без ссылки"} — ${error}`),
    ...requests.filter((row) => !["ok", "cached"].includes(row.status)).map((row) =>
      `- ${row.source}, ${row.url || "без ссылки"} — ${row.error || row.status}`),
    "", "## События и данные", "",
    "Ниже подтверждённые события. Числа показывают количество найденных сопоставимых результатов по каждому участнику.", "");
  for (const [sport, label] of Object.entries(names)) {
    const events = research.assessed.filter((event) => event.sport === sport && researchConfirmed(event.sourceTier));
    lines.push(`### ${label}`, "");
    for (const event of events) {
      const at = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" }).format(event.start);
      const publishers = [...new Set(event.sources.map((source) => source.title))].join(", ");
      const model = report.researchApplied.some((item) => item.id === event.id);
      const finding = model ? "оценка добавлена в разбор" : event.predicted ? "расчёт доступен в исследовательском отчёте" :
        "недостаточно данных для расчёта";
      lines.push(`- ${event.match}, ${at} МСК. История ${event.historyMatches.join(" / ")}. ${finding}. Источники — ${publishers}.`);
    }
    if (!events.length) lines.push("Подтверждённых событий нет.");
    const unconfirmed = research.assessed.filter((event) => event.sport === sport && !researchConfirmed(event.sourceTier)).length;
    lines.push(`Событий без подтверждения — ${unconfirmed}.`, "");
  }
  const missing = research.assessed.filter((event) => researchConfirmed(event.sourceTier) && !event.predicted);
  lines.push("## Подтверждённые события без расчёта", "",
    ...missing.map((event) => `- ${names[event.sport]} · ${event.match}. История ${event.historyMatches.join(" / ")}.`), "");
  lines.push("Полный список событий, ссылки на источники, пробные вероятности и причины пропусков доступны в diagnostic.json.");
  return lines.join("\n") + "\n";
}
