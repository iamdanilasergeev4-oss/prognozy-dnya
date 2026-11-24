import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeIdentity } from "./sports-discovery.mjs";
import { mergeHistory } from "./sports-history-analysis.mjs";
import { readResearchRuns, verifyResearchObject } from "./sports-research-ledger.mjs";
import { assessUpcomingProjection, evaluateProjections, prepareProjectionHistory } from "./sports-projections.mjs";
import { dailyModelSummary, describeScoreDistribution, modelConclusion, modelScenarioLine, modelScenarios } from "./sports-model-materials.mjs";
import { recordForecastPreview } from "./sports-forecast-journal.mjs";
import { scoreMeasures } from "./sports-score-distribution.mjs";
import { bookmakerCard, bookmakerMarketName, collectBookmakerLines } from "./sports-bookmaker-lines.mjs";
import { checkModelCandidate, digest, sealManualPacket } from "./sports-manual-update.mjs";
import { auditCs2Archive } from "./sports-cs2-research.mjs";
import { integrateSite, isUpcoming, siteFixtureKey } from "./sports-site-integration.mjs";
import "../js/history-core.js";

const root = fileURLToPath(new URL("../.sports-update/", import.meta.url));
const [run, liveBase, ...options] = process.argv.slice(2);
const cs2Option = "--cs2-archive=";
const cs2MetadataOption = "--cs2-metadata-dir=";
const cs2File = (prefix) => {
  const args = options.filter((option) => option.startsWith(prefix));
  const path = args[0]?.slice(prefix.length);
  if (args.length > 1 || args.length && !path) throw new Error("Некорректный параметр " + prefix);
  return path && resolve(path);
};
const cs2Archive = cs2File(cs2Option);
const cs2Metadata = cs2File(cs2MetadataOption);
if (cs2Metadata && !cs2Archive) throw new Error("Укажите --cs2-archive вместе с --cs2-metadata-dir");
if (!/^run-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/.test(run || "") || !liveBase ||
    options.some((option) => !["--private-football-data", "--private-odds-gap"].includes(option) &&
      ![cs2Option, cs2MetadataOption].some((prefix) => option.startsWith(prefix)))) {
  throw new Error("Укажите имя свежего ручного прогона и локальную копию опубликованного сайта");
}
const privatePreview = options.length > 0;
const now = Date.now();
const input = join(root, run);
const store = join(root, "manual-research");
const read = async (dir, path) => JSON.parse(await readFile(join(dir, path), "utf8"));
const [report, diagnostics, network, directory, liveData, scheduledData, calendarPacket] = await Promise.all([
  read(input, "manual-report.json"), read(input, "diagnostic.json"), read(input, "network.json"),
  read(resolve(liveBase), "data/history/index.json"), read(resolve(liveBase), "data/predictions.json"),
  read(input, "data/predictions.json"), read(input, "manual-packet.json"),
]);
const age = now - Date.parse(report.checkedAt);
if (report.runMode !== "live" || !Number.isFinite(age) || age < 0 || age > 60 * 60_000) {
  throw new Error("Для превью нужен свежий сетевой прогон календаря");
}
if (network.mode !== "live" || digest(network) !== report.networkDigest || digest(report) !== calendarPacket.report ||
    digest(scheduledData) !== calendarPacket.candidate["data/predictions.json"]) {
  throw new Error("Календарь или журнал источников отличается от сохранённого ручного прогона");
}
if (!directory.months?.every((month) => /^\d{4}-\d{2}$/.test(month))) throw new Error("Некорректный индекс истории");

const archivePaths = ["nhl-results.json", "nba-results.json"];
const archives = await Promise.all(archivePaths.map((path) => read(join(root, "forecast-archive"), path)
  .catch((error) => { if (error.code === "ENOENT") return { results: [], requests: [] }; throw error; })));
const ledger = await readResearchRuns(store);
const history = mergeHistory(ledger.flatMap((entry) => entry.normalized?.results || []), now).history;
const sameSides = (a, b) => normalizeIdentity(a.home) === normalizeIdentity(b.home) && normalizeIdentity(a.away) === normalizeIdentity(b.away);
const archiveChecks = archives.map(({ results, requests }, i) => {
  let compared = 0;
  const conflicts = new Set();
  for (const archive of results) {
    const matched = history.filter((row) => row.sport === archive.sport && row.competition === archive.competition &&
      Math.abs(row.start - archive.start) <= 15 * 60_000 && sameSides(row, archive));
    if (!matched.length) continue;
    compared++;
    if (matched.some((row) => row.score[0] !== archive.score[0] || row.score[1] !== archive.score[1])) conflicts.add(archive.id);
  }
  return { file: archivePaths[i], count: results.length, compared, conflicts: [...conflicts], requests };
});
const projectionHistory = prepareProjectionHistory(history, archives.flatMap(({ results }, i) =>
  results.filter((row) => !archiveChecks[i].conflicts.includes(row.id))), now);

const completeNhlSchedule = new Set();
const completeNbaSchedule = new Set();
for (const request of network.requests) {
  if (request.status !== "ok" || !request.schedule || !request.rawHash) continue;
  const nhl = /^https:\/\/api-web\.nhle\.com\/v1\/schedule\//.test(request.url);
  const nba = /^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/basketball\/nba\/scoreboard\?/.test(request.url);
  if (!nhl && !nba) continue;
  const body = JSON.parse((await verifyResearchObject(store, "raw", request.rawHash)).toString("utf8"));
  for (const week of body.gameWeek ?? []) for (const game of week.games ?? []) {
    if (game.gameType === 2 && game.gameState === "FUT" && game.neutralSite !== true &&
        !["PPD", "CNCL"].includes(game.gameScheduleState)) completeNhlSchedule.add(String(game.id));
  }
  for (const event of body.events ?? []) for (const game of event.competitions ?? []) {
    if (event.season?.type === 2 && !game.neutralSite && game.status?.type?.name === "STATUS_SCHEDULED") {
      completeNbaSchedule.add(String(game.id));
    }
  }
}

const pointChecks = [];
const distributionChecks = [];
const checks = evaluateProjections(projectionHistory, pointChecks, distributionChecks);
if (Date.now() - Date.parse(report.checkedAt) > 60 * 60_000) throw new Error("Сетевой прогон устарел");
const key = (sport, match, start) => JSON.stringify([sport, normalizeIdentity(match), start]);
const confirmed = new Set(report.evaluatedArticles.map((item) => key(item.sport, item.match, Date.parse(item.start))));
const calendarKeys = new Set(scheduledData.sports.flatMap((sport) =>
  sport.events.filter((event) => isUpcoming(event, now)).map((event) => siteFixtureKey(sport.id, event))));
const matching = diagnostics.assessed.filter((event) => !event.verificationReason &&
  (event.status === "confirmed" || event.sourceTier === "official") && !event.dataQuality?.identityConflict &&
  event.start > now && calendarKeys.has(siteFixtureKey(event.sport, { match: event.match, start_iso: new Date(event.start).toISOString() })) &&
  confirmed.has(key(event.sport, event.match, event.start)) &&
  (event.sport !== "hockey" || event.sources.some((source) => source.title === "NHL" && completeNhlSchedule.has(String(source.id)))) &&
  (event.sport !== "basketball" || event.sources.some((source) => source.title === "ESPN" && completeNbaSchedule.has(String(source.id)))));
const linked = Map.groupBy(matching, (event) => key(event.sport, event.match, event.start));
const fixtures = [...linked.values()]
  .filter((group) => group.length === 1).map(([event]) => event);
const assessments = fixtures.map((event) => ({
  event, ...assessUpcomingProjection(event, projectionHistory, checks, now, pointChecks, distributionChecks),
}));
const forecasts = assessments.flatMap(({ event, projection }) => projection ? [{ event, ...projection }] : []);
const bookmakerCoverage = await collectBookmakerLines(forecasts.map(({ event }) => event), {
  apiKey: process.env.ODDS_API_KEY,
  fonbetKey: process.env.ARBPLAY_FONBET_API_KEY,
  teamTotals: process.env.ODDS_API_TEAM_TOTALS === "1",
  privateDir: options.includes("--private-football-data") ? join(root, "bookmaker-private") : undefined,
  oddsGapDir: options.includes("--private-odds-gap") ? join(root, "bookmaker-private") : undefined,
});
const oddsCheckedAt = Date.now();
const cs2Check = cs2Archive ? await auditCs2Archive(cs2Archive, { metadataDir: cs2Metadata }) : null;
const excluded = [
  ...report.evaluatedArticles.filter((item) => !fixtures.some((event) =>
    key(item.sport, item.match, Date.parse(item.start)) === key(event.sport, event.match, event.start)))
    .map(({ sport, match, start }) => ({ sport, match, start, reason: "unlinked_calendar" })),
  ...assessments.filter((row) => !row.projection).map(({ event, reason, available, cohortResults }) => ({
    sport: event.sport, match: event.match, competition: event.competition, start: new Date(event.start).toISOString(),
    reason, available, cohortResults,
  })),
];
const names = Object.fromEntries(liveData.sports.map(({ id, name }) => [id, name]));
const num = (x) => Intl.NumberFormat("ru", { maximumFractionDigits: 3 }).format(x);
const intervalNum = (x) => Intl.NumberFormat("ru", { maximumFractionDigits: 5 }).format(x);
const shortNumber = (x) => Intl.NumberFormat("ru", { maximumFractionDigits: 1 }).format(x);
const prepare = (forecast) => {
  const { event, targets, distributions, samples, scores, sources, form, context } = forecast;
  const start = globalThis.HistoryCore.toMskIso(new Date(event.start));
  const unique = [...new Map([...event.sources, ...sources].filter((item) => URL.parse(item.url)?.protocol === "https:")
    .map(({ title, url }) => [`${title}|${url}`, { title, url }])).values()];
  const test = checks.filter((row) => row.sport === event.sport && row.competition === event.competition && row.rules === (event.rules ?? null) &&
    targets.some((target) => target.id === row.id));
  const scenarios = modelScenarios(targets, test, event);
  const sides = event.match.split(/\s+[—–]\s+/);
  const units = { football: "голов", hockey: "шайб", basketball: "очков" }[event.sport];
  const stats = form.map((side, i) => `${sides[i]} в выборке — ${side.wins} побед из ${samples[i]}${event.sport === "football" ?
    `, ничьих ${side.draws}` : ""}. В среднем за матч ${units} — ${shortNumber(side.scored)} набрано и ${shortNumber(side.allowed)} пропущено.`);
  const inputs = "В расчёте — набранные и пропущенные очки, голы или шайбы обеих сторон относительно распределения счёта в лиге.";
  const limitations = {
    football: "Составы, травмы, раздельная форма дома и на выезде и отдельная поправка на силу соперников в расчёт не входят.",
    basketball: "Составы, травмы, темп и нагрузка игроков в расчёт не входят. Данные о них в этой подборке не проверены.",
    hockey: "Стартовые вратари, составы спецбригад и игра в большинстве и меньшинстве в расчёт не входят. Эти сведения в подборке не проверены.",
  }[event.sport];
  const distributionTests = distributionChecks.filter((row) => row.sport === event.sport &&
    row.competition === event.competition && row.approved);
  const scoreDisplay = describeScoreDistribution(distributions, distributionTests, event, stats.join(" "), inputs, limitations, false);
  const byOutcome = scenarios.map(modelScenarioLine);
  const lines = [...scoreDisplay.headlines, ...byOutcome];
  const conclusion = scoreDisplay.conclusion || modelConclusion(scenarios, stats.join(" "), inputs, limitations);
  const missing = Object.entries(scoreMeasures).filter(([id]) => !distributions.some((row) => row.id === id))
    .map(([, { title }]) => title.toLowerCase());
  return { sport_id: event.sport, sport: names[event.sport], tournament: event.tournament, match: event.match,
    start: `${start.slice(8, 10)}.${start.slice(5, 7)}, ${start.slice(11, 16)} МСК`, start_iso: start,
    sources: unique, lines, scenarios, scenarioLines: byOutcome, distributions, scoreSections: scoreDisplay.sections,
    modelConclusion: conclusion, automated: true,
    bookmaker: bookmakerCard(bookmakerCoverage, forecast, distributionChecks, oddsCheckedAt),
    text: ["Расписание подтверждено. Вероятности рассчитаны до начала матча.", ...byOutcome,
      ...(missing.length ? [`Без распределения после исторической проверки — ${missing.join(", ")}.`] : []),
      "Статистика предыдущих матчей", ...stats, ...(context?.length ? ["Дополнительный контекст", ...context] : []),
      `В расчёте использовано ${scores} итоговых счётов лиги. ${inputs}`,
      ...(event.sport === "hockey" ? ["Для НХЛ считаются итоговые счета с овертаймом и буллитами."] :
        event.sport === "football" ? ["Для футбола считается основное время."] : ["Для НБА считаются итоговые счета с овертаймом."]),
      limitations,
      ...test.map((row) => `${row.title}. Историческая проверка на ${row.paired} матчах. Ошибка Брайера ${num(row.model.brier)} против ${num(row.baseline.brier)} у базового подхода.`)].join("\n"),
    key_factors: [] };
};
const modelArticles = forecasts.sort((a, b) => b.distributions.length - a.distributions.length ||
  b.targets.length - a.targets.length || a.event.start - b.event.start).map(prepare);
const modelVersion = "score-distribution-2";
const journal = await recordForecastPreview(join(root, "model-journal"), forecasts, [...history, ...projectionHistory], now, modelVersion);
const moscowDate = globalThis.HistoryCore.toMskIso(new Date(now)).slice(0, 10);
const next = integrateSite(liveData, scheduledData, { updated_at: new Date(now).toISOString(),
  analysis: modelArticles,
  dailySummary: dailyModelSummary(modelArticles, moscowDate),
  modelJournal: { entries: journal.entries, settled: journal.settled, pending: journal.pending, awaiting: journal.awaiting,
    metrics: journal.metrics },
});
const output = join(root, `forecast-preview-${new Date(now).toISOString().replace(/[:.]/g, "-")}`);
await mkdir(join(output, "data/history"), { recursive: true });
await writeFile(join(output, "data/predictions.json"), JSON.stringify(next, null, 2) + "\n");
const bookmakerAudit = {
  checkedAt: new Date(oddsCheckedAt).toISOString(),
  requests: Object.fromEntries(bookmakerCoverage.requests),
  providersConfigured: { oddsApi: bookmakerCoverage.configured, arbPlayFonbet: bookmakerCoverage.fonbetConfigured },
  quotes: [...bookmakerCoverage.markets.values()].flat().map(({ event, ...quote }) => ({
    ...quote, marketName: bookmakerMarketName(quote.type, event.sport), sport: event.sport, competition: event.competition, match: event.match,
    start: new Date(event.start).toISOString(), home: event.home, away: event.away,
  })),
};
await writeFile(join(output, "bookmaker-lines.json"), JSON.stringify(bookmakerAudit, null, 2) + "\n");
if (cs2Check) await writeFile(join(output, "cs2-evaluation.json"), JSON.stringify(cs2Check, null, 2) + "\n");
const historyFiles = ["index.json", "express.json", ...directory.months.map((month) => `${month}.json`)];
for (const file of historyFiles) {
  await copyFile(join(resolve(liveBase), "data/history", file), join(output, "data/history", file));
}
const payload = { "data/predictions.json": next };
for (const file of historyFiles) payload[`data/history/${file}`] = await read(output, `data/history/${file}`);
const embedded = JSON.stringify(payload).replace(/</g, "\\u003c");
const shell = await readFile(new URL("../index.html", import.meta.url), "utf8");
const previewRuntime = `<base href="../../">
<script>
(() => {
  const snapshot = ${embedded};
  Date.now = () => ${now};
  window.fetch = async (path) => {
    const key = String(path).split("?")[0];
    return Object.hasOwn(snapshot, key)
      ? new Response(JSON.stringify(snapshot[key]), {headers: {"Content-Type": "application/json"}})
      : new Response(null, {status: 403});
  };
  const replace = history.replaceState.bind(history);
  history.replaceState = (state, title, url) => {
    if (typeof url !== "string" || !url.startsWith("#")) return replace(state, title, url);
    const current = new URL(window.location.href);
    current.hash = url;
    return replace(state, title, current);
  };
  document.addEventListener("click", (event) => {
    const anchor = event.target.closest("a[href^='#']");
    if (!anchor || event.defaultPrevented) return;
    event.preventDefault();
    window.location.hash = anchor.getAttribute("href");
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  });
  document.addEventListener("submit", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener("DOMContentLoaded", () => { document.getElementById("send").disabled = true; });
})();
</script>`;
await writeFile(join(output, "preview-site.html"), shell.replace("<head>", () => "<head>\n" + previewRuntime)
  .replace(/<title>[^<]+<\/title>/, "<title>Локальное превью · Проверенные прогнозы</title>"));
const inventory = next.sports.map(({ id, forecasts: list }) => ({ sport: id, confirmed: report.sports[id]?.confirmed ?? 0,
  comparable: fixtures.filter((event) => event.sport === id).length, history: projectionHistory.filter((event) => event.sport === id).length,
  materials: list.length, estimates: list.reduce((total, item) => total + item.lines.length, 0),
  targets: [...new Set(list.flatMap((item) => [...item.scenarios.map(({ title }) => title),
    ...item.distributions.map(({ id }) => scoreMeasures[id].title)]))] }));
const sourceResearch = {
  tennis: { comparableResults: inventory.find(({ sport }) => sport === "tennis").history,
    context: "Официальная сетка WTA за 2025 год содержит счёт по сетам и ссылки на профили игроков. Для модели нужны датированные результаты по тем же игрокам на сопоставимом грунте и нескольких турнирах.",
    sources: ["https://www.wtatennis.com/tournaments/2052/buenos-aires-125/2025/draws",
      "https://www.wtatennis.com/tournaments/2052/ieb-argentina-open-buenos-aires-arg/2026/player-list/"] },
  volleyball: { comparableResults: inventory.find(({ sport }) => sport === "volleyball").history,
    context: "Lega Pallavolo публикует результаты прошлых туров и командную статистику. Для проверки нужен связанный по датам архив нескольких сезонов нужной лиги.",
    sources: ["https://www.legavolley.it/calendario/?lang=en", "https://ww2.legavolley.it/NewsLeggif.asp?id=80255",
      "https://ww2.legavolley.it/Rendimento.asp?Classifica=1.1&Tipo=1"] },
  cs2: { comparableResults: inventory.find(({ sport }) => sport === "cs2").history,
    context: "Расписание сверяется по Strafe, GosuGamers и Ensigame. Архив PandaScore документирован, для API требуется токен. История через него в прогоне не загружалась.",
    sources: ["https://www.strafe.com/calendar/csgo/", "https://ensigame.com/matches/cs-2/results",
      "https://developers.pandascore.co/docs/plan-reference"] },
  dota2: { comparableResults: inventory.find(({ sport }) => sport === "dota2").history, maps: diagnostics.savedHistory?.maps ?? 0,
    context: "Карты OpenDota сохраняются отдельно. Для модели серии нужно сверить её полный результат и формат. У PandaScore документирован список завершённых матчей Dota 2, доступ требует токен.",
    sources: ["https://api.opendota.com/api/proMatches", "https://www.gosugamers.net/dota2/matches/results",
      "https://developers.pandascore.co/docs/plan-reference"] },
};
const audit = { checkedAt: report.checkedAt, earliestTest: "2025-10-01", secondTest: "2026-02-01", archivedThrough: new Date(now).toISOString(),
  inventory, archiveChecks, sourceResearch, checks, pointChecks, distributionChecks, journal, excluded, calendarAnalysis: scheduledData.analysis, forecastEvidence: forecasts,
  ...(cs2Check ? { cs2Check } : {}) };
await writeFile(join(output, "evaluation.json"), JSON.stringify(audit, null, 2) + "\n");
const baselineFiles = { "data/predictions.json": liveData };
for (const file of historyFiles) baselineFiles[`data/history/${file}`] = await read(resolve(liveBase), `data/history/${file}`);
const manualReport = {
  kind: "model-preview",
  runMode: report.runMode,
  sourceRun: run,
  checkedAt: report.checkedAt,
  researchApplied: forecasts.map(({ event }) => ({ sport: event.sport, match: event.match, start: event.start })),
  evidence: { evaluation: digest(audit), quotes: digest(bookmakerAudit) },
  blockers: [...report.blockers],
};
if (options.some((option) => option.startsWith("--private-"))) manualReport.blockers.push("Частный архив котировок разрешён только в локальном превью");
if (cs2Check) manualReport.blockers.push("Исследование архива CS2 доступно в локальном превью");
if (!privatePreview) {
  try {
    checkModelCandidate(baselineFiles, payload, manualReport, audit, bookmakerAudit, Date.now());
  } catch (error) {
    manualReport.blockers.push(error.message);
  }
}
manualReport.eligible = report.eligible === true && manualReport.blockers.length === 0;
const packet = sealManualPacket(manualReport, baselineFiles, payload);
await Promise.all([
  writeFile(join(output, "manual-report.json"), JSON.stringify(manualReport, null, 2) + "\n", { flag: "wx" }),
  writeFile(join(output, "manual-packet.json"), JSON.stringify(packet, null, 2) + "\n", { flag: "wx" }),
]);
const lines = [
  "# Локальная проверка вероятностных прогнозов", "",
  `Идентификатор пакета — ${packet.approvalId}.`,
  manualReport.eligible ? "Пакет готов к ручной проверке перед отдельным подтверждением." :
    `Пакет доступен для просмотра. Применение заблокировано. ${manualReport.blockers.join(" · ")}`, "",
  "| Спорт | Подтверждено | Исторических результатов | Материалов | Численных оценок |",
  "| --- | ---: | ---: | ---: | ---: |",
  ...inventory.map((row) => `| ${names[row.sport]} | ${row.confirmed} | ${row.history} | ${row.materials} | ${row.estimates} |`),
  ...(cs2Check ? ["", `[Проверка модели CS2](cs2-evaluation.json). В архиве ${cs2Check.archiveSeries} BO3, в сравнении ${cs2Check.predictions} серий. Допуск модели закрыт.`] : []),
  "", "## Букмекерские линии", "",
  ...[...Map.groupBy(modelArticles, ({ bookmaker }) => bookmaker.status)].map(([status, articles]) =>
    `- ${({ current: "Доступны актуальные котировки", snapshot: "Доступны только архивные коэффициенты", stale: "Линия устарела",
      access_required: "Нет доступа к источнику", unauthorized: "Ошибка авторизации", quota_exhausted: "Исчерпана квота",
      unavailable: "Источник временно недоступен", unsupported: "Турнир не поддерживается",
      unmatched: "Матч не удалось сопоставить", missing: "Линия не найдена" })[status]} — ${articles.length}.`),
  `- Условие линии не соответствует доступной проверенной модели — ${modelArticles.flatMap((article) =>
    article.bookmaker.lines.flatMap(({ outcomes }) => outcomes)).filter((offer) => offer.comparisonStatus === "condition_mismatch").length}.`,
  "", "Коэффициенты и их метки времени записаны в [журнал линий](bookmaker-lines.json). Вероятности модели рассчитываются отдельно. Для непротестированных показателей или несовпадающих правил показывается только коэффициент.",
  "", "## Проверка распределений счёта", "",
  "Центральный диапазон ограничен 20-м и 80-м процентилями. Для целочисленного счёта его вероятность может превышать 60%. Синтетические границы используются только в историческом тесте калибровки. В карточке граница берётся из реальной линии. Допуск по историческому тесту относится к распределению и его центральным границам. Отдельная историческая проверка на архиве котировок для этих рынков не проводилась.",
  "", "| Лига / показатель | Матчей | CRPS модель / база / последние 60 | Фактический / ожидаемый охват | Берём диапазон | Brier порогов модель / база | Берём пороги |",
  "| --- | ---: | --- | --- | --- | --- | --- |",
  ...distributionChecks.filter((row) => row.n >= 40).map((row) =>
    `| ${row.competition} · ${row.title} | ${row.n} | ${num(row.model)} / ${num(row.baseline)} / ${num(row.recent)} | ${num(row.coverage * 100)}% / ${num(row.mass * 100)}% | ${row.approved ? "да" : "нет"} | ${row.thresholds.n ? num(row.thresholds.model) + " / " + num(row.thresholds.baseline) : "—"} | ${row.thresholds.approved ? "да" : "нет"} |`),
  "", "## Калибровка и устойчивость по двум периодам", "",
  "CRPS оценивает ошибку всего распределения. Ниже лучше. Для проверки калибровки PIT сравнивает, где среди предсказанных результатов лежат реальные счета. Для целочисленных результатов вес распределяется по шагу функции накопленной вероятности. При хорошей калибровке в каждой из десяти групп ожидается около 10% веса. Допуск для максимального отклонения — 8 п. п. на каждом периоде. Интервал разницы охвата построен по неделям.",
  "", "| Лига / показатель | Период | Матчей | CRPS модель / сезонная база / последние 60 | Разница охвата (факт минус модель) и 95% интервал, п. п. | Макс. отклонение PIT, п. п. |",
  "| --- | ---: | ---: | --- | --- | ---: |",
  ...distributionChecks.filter((row) => row.n >= 40).flatMap((row) => row.periods.flatMap((p, i) => p.n ?
    [`| ${row.competition} · ${row.title} | ${i + 1} | ${p.n} | ${num(p.model)} / ${num(p.baseline)} / ${num(p.recent)} | ${num((p.coverage - p.mass) * 100)} [${p.coverageInterval.low == null ? "—" : num(p.coverageInterval.low * 100)}; ${p.coverageInterval.high == null ? "—" : num(p.coverageInterval.high * 100)}] | ${num(p.pitMaxDeviation * 100)} |`] : [])),
  "", "## Сравнение прежних фиксированных показателей", "",
  "Один период с 1 октября 2025 по 31 января 2026 года, второй с 1 февраля 2026 года до даты сбора. Предыдущие результаты доступны модели только через два дня после начала матча. Архивная имитация времени доступности не измеряет, когда издатель в действительности впервые отдал счёт.",
  "", "| Лига / показатель | Общая выборка | По периодам | Брайер модели / базы / последние 60 | Log loss модели / базы | Ошибка калибровки | 95% интервал разницы Брайера |",
  "| --- | ---: | --- | --- | --- | --- | --- |",
  ...checks.filter((row) => row.approved).map((row) => `| ${row.competition} · ${row.title} | ${row.paired} из ${row.available} | ${row.periods.map((p) => p.n).join(" / ")} | ${num(row.model.brier)} / ${num(row.baseline.brier)} / ${num(row.recent.brier)} | ${num(row.model.logLoss)} / ${num(row.baseline.logLoss)} | ${num(row.model.ece)} | ${intervalNum(row.interval.low)}…${intervalNum(row.interval.high)} |`),
  "", "## Проверка ожидаемого счёта и разницы", "",
  ...pointChecks.filter((row) => row.approved).map((row) => `- ${row.competition} · ${row.title}. ${row.n} матчей. Средняя абсолютная ошибка ${num(row.model)} против ${num(row.baseline)} у базового подхода. Интервал разницы ${intervalNum(row.interval.low)}…${intervalNum(row.interval.high)}.`),
  "", "## Сводка дня", "", ...next.dailySummary.map((row) => `- ${row.match}. ${row.modelConclusion.scenario} ${row.modelConclusion.caution}`),
  "", "## Материалы", "", ...modelArticles.map((row) => `- ${row.match}. ${row.lines.join(" ")}`), "",
  `Журнал локальных проб — ${journal.entries} записей, ${journal.settled} результатов сверено, ${journal.pending} ожидают завершения, ${journal.awaiting} ожидают подтверждения.`, "",
  "## Источники для категорий без модельных прогнозов", "",
  ...Object.entries(sourceResearch).map(([sport, source]) => `- ${names[sport]}. ${source.context} ${source.maps == null ? "" :
    `Архив отдельных карт — ${source.maps}. `}${source.sources.map((url) => `[Источник](${url})`).join(" · ")}`),
  "", "## Почему футбольные матчи не получили разбор", "",
  ...[...Map.groupBy(excluded.filter((row) => row.sport === "football"), (row) => row.reason)].map(([key, rows]) =>
    `- ${({ unlinked_calendar: "Не удалось однозначно связать календарь с исследовательской записью",
      no_verified_cohort_model: "Нет прошедшей проверку модели для этой лиги", insufficient_current_sample: "Мало сопоставимых результатов команд",
      start_buffer: "До начала оставалось меньше времени, чем разрешено для расчёта", identity_or_schedule: "Есть сомнение в идентификации или времени" })[key]} — ${rows.length}.`),
  "", "## Что обновляется вручную", "",
  "- «Разбор дня» и спортивные категории получают новые проверенные прогнозы. «Сводка дня» выделяет один сценарий на вид спорта. Информационная подборка «Экспрессов дня» обновляется отдельно.",
  "- История экспрессов и прежние прогнозы перенесены из опубликованной копии без изменений. Новый журнал хранит пробные оценки и отмечает только подтверждённые результаты. Метрики по новым наблюдениям появятся после достаточного числа проверок.",
  "",
  "Полные результаты по каждому показателю, таблицы калибровки, источники и случаи отказа находятся в evaluation.json.",
];
await writeFile(join(output, "review.md"), lines.join("\n") + "\n");
console.log(JSON.stringify({ output, approvalId: packet.approvalId, eligible: manualReport.eligible,
  blockers: manualReport.blockers, inventory, approved: checks.filter((row) => row.approved).map((row) => [row.competition, row.id, row.paired]) }));
