import { createHash } from "node:crypto";
import { normalizeIdentity } from "./sports-discovery.mjs";
import { researchConfirmed } from "./sports-evidence.mjs";
import { SPARSE_MODEL_VERSION } from "./sports-sparse-model.mjs";
import { describeEvidence } from "./sports-article-evidence.mjs";
import { priceProbability } from "./sports-bookmaker-lines.mjs";
import "../js/history-core.js";

const testedLeagues = new Set(["eng1", "eng2", "eng3", "eng4", "deu2", "deu3", "esp2", "deu4b", "deu4n", "deu4e"]);
const outcomes = ["home", "draw", "away"];
const mins = 60_000;
export const MANUAL_REVIEW_AGE = 60 * mins;
const sourceKey = (source) => `${source.title}|${source.url}`;
const sameMatch = (a, b) => normalizeIdentity(a) === normalizeIdentity(b);
const publicModelLabel = "Оценка модели исхода";
const maxFootballArticles = 6;

function findArticle(next, fixture, contexts) {
  function sameFixture(article) {
    const comparable = (contexts?.get(article)?.evidence ?? []).flatMap((row) => fixture.sources
      .filter((claim) => claim.title === row.source && claim.id != null && row.id != null &&
        row.participantIds?.length === 2 && row.participantIds.every((id) => id != null) &&
        claim.participantIds?.length === 2 && claim.participantIds.every((id) => id != null))
      .map((claim) => ({ row, claim })));
    if (!comparable.length) return sameMatch(article.match, fixture.match) && sameMatch(article.tournament, fixture.tournament);
    return comparable.every(({ row, claim }) => String(claim.id) === String(row.id) &&
      claim.reportedStatus === "scheduled" && Math.abs(row.start - claim.reportedStart) <= 5 * mins &&
      row.participantIds.every((id, i) => String(id) === String(claim.participantIds[i])) &&
      (row.sourceCompetitionId == null || claim.sourceCompetitionId == null ||
        String(row.sourceCompetitionId) === String(claim.sourceCompetitionId)));
  }
  const matches = next.analysis.filter((article) => article.sport_id === fixture.sport &&
    Math.abs(Date.parse(article.start_iso) - fixture.start) <= 5 * mins && sameFixture(article));
  return matches.length === 1 ? matches[0] : null;
}

function readyModel(result, now) {
  if (result.sport !== "football" || !testedLeagues.has(result.competition) || !researchConfirmed(result.sourceTier) ||
      result.dataQuality?.identityConflict || result.start <= now + 10 * mins || !(Date.parse(result.dataAsOf) <= now)) return null;
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

export function appendValidatedAnalysis(next, research, now, { existingOnly = false, decisions = [], contexts } = {}) {
  const applied = [];
  const eligible = research.forecastEvidence.flatMap((event) => {
    const model = readyModel(event, now);
    if (!model) decisions.push({ match: event.match, sport: event.sport,
      reason: event.sport !== "football" || !testedLeagues.has(event.competition) ? "unvalidated_scope" : "evidence_gate" });
    return model ? [{ event, model }] : [];
  }).sort((a, b) => Math.min(...b.model.sample) - Math.min(...a.model.sample) || a.event.start - b.event.start);
  for (const { event, model } of eligible) {
    let article = findArticle(next, event, contexts);
    if (article) {
      if (!article.sources.some((source) => event.sources.some((claim) => sourceKey(claim) === sourceKey(source)))) {
        decisions.push({ match: event.match, sport: event.sport, reason: "schedule_source_mismatch" });
        continue;
      }
    } else {
      if (existingOnly) {
        decisions.push({ match: event.match, sport: event.sport, reason: "not_matched_to_confirmed_calendar" });
        continue;
      }
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
    const [first, second] = article.match.split(/\s+[—–]\s+/);
    const labels = [first && `победа «${first}»`, "ничья", second && `победа «${second}»`];
    const [top, runnerUp] = percentages.map((value, i) => ({ value, label: labels[i] })).sort((a, b) => b.value - a.value);
    article.verdict = top.value - runnerUp.value <= 5 || !top.label
      ? "Две наибольшие оценки модели близки. Явного преимущества нет."
      : `Наибольшая оценка модели — ${top.label} (${top.value}%). Даже этот исход может не состояться.`;
    const homeAdjustment = event.homeField === true;
    const inputs = `В расчёте вероятностей — победы, ничьи и поражения обеих команд, давность игр и частота ничьих в лиге. Игры прошлого сезона получают меньший вес. В текущем сезоне использовано ${model.sample.join(" и ")} матчей соответственно.`;
    const exclusions = homeAdjustment
      ? "Применена фиксированная поправка на домашнее поле. Раздельная домашняя и выездная форма, сила соперников, составы и травмы в расчёт не входят."
      : "Поправка на домашнее поле не применялась. Домашняя и выездная форма, сила соперников, составы и травмы в расчёт не входят.";
    article.text += `\n${summary}\n${inputs}\n${exclusions}`;
    const evidenceSources = model.evidence.flatMap((entry) => entry.sources ?? []);
    article.sources = [...new Map([...article.sources, ...evidenceSources.filter((source) => source.title && URL.parse(source.url)?.protocol === "https:")]
      .map((source) => [sourceKey(source), { title: source.title, url: source.url }])).values()];
    applied.push({ id: event.id, match: article.match, start: Date.parse(article.start_iso), version: model.version, sample: model.sample, homeAdjustment });
  }
  return applied;
}

export function selectManualAnalysis(next, contexts, research, now, editorial) {
  const modelDecisions = [];
  const drafts = [...contexts.keys()].filter((article) => Date.parse(article.start_iso) > now);
  const draftSite = { analysis: drafts };
  const applied = appendValidatedAnalysis(draftSite, research.diagnostics, now, { existingOnly: true, decisions: modelDecisions, contexts });
  const evaluated = drafts.map((article) => ({
    article, context: contexts.get(article), evidence: describeEvidence(article, contexts.get(article), research, now, editorial),
  })).filter(({ evidence }) => evidence);
  const rank = (a, b) => Number(b.evidence.model) - Number(a.evidence.model) ||
    Math.min(...b.evidence.history) - Math.min(...a.evidence.history) ||
    Number(b.evidence.opponentComparison) - Number(a.evidence.opponentComparison) ||
    b.evidence.splits - a.evidence.splits || Date.parse(a.article.start_iso) - Date.parse(b.article.start_iso);
  const qualified = evaluated.filter(({ evidence }) => evidence.quality).sort(rank);
  const selected = [];
  const same = (event, article) => event.match === article.match && event.start_iso === article.start_iso;
  for (const sport of next.sports) {
    const limit = sport.id === "football" ? maxFootballArticles : sport.id === "cs2" ? 5 : Infinity;
    const articles = qualified.filter(({ article }) => article.sport_id === sport.id).slice(0, limit);
    selected.push(...articles);
    const calendar = articles.map(({ article, context }) => sport.events.find((event) => same(event, article)) ?? {
      match: article.match, tournament: article.tournament, start: article.start, start_iso: article.start_iso,
      format: article.format, sources: context.evidence.map(({ source, url }) => ({ title: source, url })),
      schedule_evidence: context.basis, has_pick: false,
    });
    const necessary = sport.events.filter((event) => event.has_pick && !calendar.some((entry) => same(event, entry)));
    const remaining = sport.events.filter((event) => !event.has_pick && !calendar.some((entry) => same(event, entry)));
    sport.events = [...calendar, ...necessary, ...remaining.slice(0, Math.max(0, limit - calendar.length - necessary.length))]
      .sort((a, b) => Date.parse(a.start_iso) - Date.parse(b.start_iso));
  }
  next.analysis = selected.sort(rank).map(({ article }) => article);
  const visibleModels = applied.filter((item) => next.analysis.some((article) => article.match === item.match &&
    Date.parse(article.start_iso) === item.start));
  for (const item of applied.filter((item) => !visibleModels.includes(item))) {
    modelDecisions.push({ match: item.match, sport: "football", reason: "editorial_quality_or_limit" });
  }
  return { researchApplied: visibleModels, articles: selected.map(({ evidence }) => evidence),
    evaluated: evaluated.map(({ evidence }) => evidence), modelDecisions };
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

export const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
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

export function checkModelCandidate(baseline, candidate, report, evaluation, quotes, now) {
  const requireValid = (condition, message) => { if (!condition) throw new Error(message); };
  requireValid(report.kind === "model-preview" && report.runMode === "live" && evaluation.checkedAt === report.checkedAt &&
    report.evidence?.evaluation === digest(evaluation) && report.evidence?.quotes === digest(quotes),
  "Журнал моделей или котировок отличается от проверенного пакета");
  const predictionFile = "data/predictions.json";
  const current = candidate[predictionFile];
  const history = (files) => Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith("data/history/")));
  requireValid(digest(fileHashes(history(baseline))) === digest(fileHashes(history(candidate))),
    "Модельный пакет изменил действующий архив");
  requireValid(current.source === "model-preview" && current.analysis.length && current.express.length === 0 &&
    current.sports.map(({ id }) => id).join("|") === baseline[predictionFile].sports.map(({ id }) => id).join("|"),
  "Модельный пакет не сохранил структуру сайта");
  requireValid(!quotes.quotes.some((market) => market.privateSnapshot),
    "Частный архив котировок доступен только в локальном превью");

  const fixtureKey = (sport, match, start) => JSON.stringify([sport, match, start]);
  const articleKey = (article) => fixtureKey(article.sport_id, article.match, Date.parse(article.start_iso));
  const forecasts = new Map(evaluation.forecastEvidence.map((forecast) =>
    [fixtureKey(forecast.event.sport, forecast.event.match, forecast.event.start), forecast]));
  const articles = new Map(current.analysis.map((article) => [articleKey(article), article]));
  const cards = current.sports.flatMap((sport) => sport.forecasts.map((card) => {
    requireValid(card.sport_id === sport.id, "Модельная карточка помещена в неверную категорию");
    return card;
  }));
  requireValid(articles.size === current.analysis.length && cards.length === articles.size &&
    forecasts.size === articles.size && evaluation.forecastEvidence.length === forecasts.size &&
    new Set(cards.map(articleKey)).size === articles.size && cards.every((card) =>
      articles.has(articleKey(card)) && digest(articles.get(articleKey(card))) === digest(card)),
  "Карточки, разборы и журнал модели не совпадают");
  requireValid([...current.dailySummary, ...current.expressHighlights].every((item) => {
    const article = articles.get(articleKey(item));
    return article && digest(item.modelConclusion) === digest(article.modelConclusion);
  }), "Сводка или сценарии не совпадают с утверждаемыми разборами");
  for (const [key, article] of articles) {
    const forecast = forecasts.get(key);
    requireValid(forecast && forecast.event.start > now + 10 * mins && forecast.event.sources.some(({ url }) =>
      URL.parse(url)?.protocol === "https:") &&
      ["confirmed", "official"].includes(forecast.event.status) &&
      !forecast.event.verificationReason && !forecast.event.dataQuality?.identityConflict,
    "Матч из модельного пакета не подтверждён, скоро начнётся или отсутствует в журнале");
    requireValid(digest(article.distributions) === digest(forecast.distributions),
      "Распределение карточки отличается от журнала модели");
    const conclusion = article.modelConclusion;
    const measure = conclusion.id.startsWith("distribution_") ?
      forecast.distributions.find(({ id }) => `distribution_${id}` === conclusion.id) : null;
    const outcome = forecast.targets.find(({ id }) => id === conclusion.id);
    requireValid(measure ? conclusion.probability === measure.range.probability &&
      evaluation.distributionChecks.some((check) => check.id === measure.id && check.approved &&
        check.sport === forecast.event.sport && check.competition === forecast.event.competition) :
      outcome && (conclusion.close ? conclusion.probability === null :
        conclusion.probability === outcome.probabilities[conclusion.outcome]),
    "Итог карточки отличается от проверенной оценки");
    requireValid((article.bookmaker.lines.length > 0) === (article.bookmaker.status === "current"),
      "Статус котировок не совпадает с содержимым карточки");
    for (const market of article.bookmaker.lines) {
      const received = Date.parse(market.receivedAt), updated = Date.parse(market.updatedAt);
      const expiry = Date.parse(market.expiresAt);
      const recorded = quotes.quotes.some((row) =>
        fixtureKey(row.sport, row.match, Date.parse(row.start)) === key &&
        ["type", "team", "scope", "bookmaker", "source", "sourceUrl", "rulesUrl", "receivedAt", "updatedAt"]
          .every((field) => row[field] === market[field]) &&
        digest(row.outcomes) === digest(market.outcomes.map(({ selection, price, point }) => ({ selection, price, point }))));
      requireValid(article.bookmaker.status === "current" && !market.privateSnapshot && recorded &&
        expiry === Math.min(forecast.event.start, updated + 2 * 60 * mins) && expiry > now &&
        updated <= received && received <= now && market.outcomes.every((offer) =>
          digest(offer.model) === digest(priceProbability(market, offer, forecast, evaluation.distributionChecks))),
      "Котировка устарела, отличается от журнала или не соответствует модели");
    }
  }
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
  if (report.evaluatedArticles) {
    lines.push("", "## Отбор для «Разбора дня»", "",
      "Берём матчи с минимум четырьмя сопоставимыми результатами у каждой стороны и хотя бы одним результатом за последние 28 дней у каждой стороны. Для киберспорта нужен подтверждённый формат серии.",
      "", "| Спорт | Подтверждено для сайта | Достаточно истории | В «Разборе дня» | Только в календаре |",
      "| --- | ---: | ---: | ---: | ---: |");
    for (const [sport, label] of Object.entries(names)) {
      const row = report.sports[sport];
      lines.push(`| ${label} | ${row.confirmed} | ${row.qualifiedAnalysis} | ${row.articles} | ${row.calendarOnly} |`);
    }
    lines.push("", "### Разборы в локальном превью", "",
      ...report.articles.map((item) => `- ${item.match} — ${item.history.join(" / ")} результатов. ${item.historySources.join(", ")}.${item.model ? " Добавлена проверенная модель исхода." : ""}`));
  }
  if (report.rawRequests) {
    const replay = report.runMode === "replay";
    const { ok = 0, cached = 0, error = 0, restricted = 0, backoff = 0 } = report.rawRequests;
    const responses = replay ? `из сохранённого снимка ${ok + cached}` : `по сети ${ok}, из архива ${cached}`;
    lines.push("", `Ответы источников — ${responses}, ошибок ${error}, ограничений доступа ${restricted}, отложенных запросов ${backoff}.`,
      replay ? "Редакционный повтор выполнен без сетевых запросов." :
        "Основные календари запрашивались заново. Сохранённые исторические ответы учитываются отдельно в журнале.");
  }
  if (report.scheduleJobs) {
    lines.push("", "## Проверка расписаний", "",
      "| Спорт | Прежние правила на этих ответах | Подтверждено | Только официальный источник | В подборке |",
      "| --- | ---: | ---: | ---: | ---: |");
    for (const [sport, label] of Object.entries(names)) {
      const row = report.sports[sport];
      lines.push(`| ${label} | ${row.legacyConfirmedOnSameRows} | ${row.confirmed} | ${row.officialOnly} | ${row.selected} |`);
    }
    const skipped = Map.groupBy(report.scheduleExclusions ?? [], (row) => row.reason);
    const lack = new Set(["single_secondary", "shared_origin"]);
    lines.push("", `Пропущено из-за недостатка подтверждений — ${[...skipped].filter(([reason]) => lack.has(reason)).reduce((sum, [, rows]) => sum + rows.length, 0)}.`,
      `Пропущено из-за расхождений в расписании — ${[...skipped].filter(([reason]) => !lack.has(reason)).reduce((sum, [, rows]) => sum + rows.length, 0)}.`,
      "Сетевые попытки и результаты разбора ответов записаны в network.json. Причины пропуска матчей записаны в scheduleExclusions в manual-report.json.");
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
