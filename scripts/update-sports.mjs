import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildUpdate, DAY, esportsFormLinks, esportsResultLinks, FOOTBALL_FORM_DAYS, FORM_DAYS, PUBLISH_BUFFER, SPORTS,
  tennisPreviewLinks, verifiedEsportsForm, officialFixtureSource } from "./sports-update-core.mjs";
import { parseAtpHeadToHead, parseEnsiForm, parseEnsiResult, parseStrafeForm, sourceJobs } from "./sports-sources.mjs";
import { buildShadowReport } from "./sports-shadow.mjs";
import { loadResearchSources } from "./sports-research-sources.mjs";
import { loadSeasonArchives, readResearchSnapshots, saveResearchSnapshot } from "./sports-research-history.mjs";
import { compareHistory, makeHistorySnapshot, mergeHistory } from "./sports-history-analysis.mjs";
import { captureManualResearch } from "./collect-sports-research.mjs";
import { checkManualPacket, manualSummary, sealManualPacket, selectManualAnalysis, siteData } from "./sports-manual-update.mjs";
import { readResearchRuns, verifyResearchObject } from "./sports-research-ledger.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const H = globalThis.HistoryCore;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const RUN = /^run-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;
const MANUAL_EDITORIAL_DAYS = 28;
const required = {
  football: ["365Scores", "ESPN"],
  basketball: ["365Scores", "ESPN"],
  tennis: ["365Scores", "ESPN"],
  hockey: ["365Scores", "NHL"],
  volleyball: ["365Scores"],
  cs2: ["Strafe"],
  dota2: ["GosuGamers", "Strafe"],
};
const dateKey = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const read = async (base, file) => JSON.parse(await readFile(join(base, file), "utf8"));

function log(level, message, details = {}) {
  const record = { time: new Date().toISOString(), level, message, ...details };
  (level === "error" ? console.error : console.log)(JSON.stringify(record));
  return record;
}

async function fetchData(url, html = false) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let error;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(13_000) });
      if (response.ok) return html ? await response.text() : await response.json();
      error = new Error(`HTTP ${response.status}`);
      if (![429, 500, 502, 503, 504].includes(response.status)) throw error;
    } catch (e) {
      error = e;
      if (e.message.startsWith("HTTP ") && !/^HTTP (429|50[0234])$/.test(e.message)) throw e;
    }
    if (attempt === 1) throw error;
    await new Promise((resolve) => setTimeout(resolve, error?.message === "HTTP 429" ? 5000 : 1000));
  }
}

async function collect(jobs, scheduleDays, now, includeTennisPreviews = true, get = fetchData, currentScheduleOnly = false) {
  const errors = [];
  const outcomes = new Array(jobs.length);
  const isCalendar = (job) => !job.standings && !job.resultIndex && !job.historicalOnly &&
    (job.day === null || scheduleDays.includes(job.day));
  const jobReport = [];
  async function runBatch(indices) {
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(8, indices.length) }, async () => {
      while (cursor < indices.length) {
        const index = indices[cursor++];
        const job = jobs[index];
        const calendar = isCalendar(job);
        let received = false;
        try {
          const body = await get(job.url, job.html, job.source, job.sports[0], job.day, calendar);
          received = true;
          const rows = job.parse(body);
          outcomes[index] = { job, rows };
          jobReport.push({ url: job.url, source: job.source, day: job.day, calendar, status: "parsed", rows: rows.length });
        } catch (error) {
          jobReport.push({ url: job.url, source: job.source, day: job.day, calendar,
            status: received ? "parser_error" : "fetch_error", kind: error.kind, error: error.message });
          errors.push(log("error", "Ошибка источника", {
            publisher: job.source, sports: job.sports, date: job.day, url: job.url, error: error.message,
          }));
        }
      }
    }));
  }
  const indices = jobs.map((_, i) => i);
  if (currentScheduleOnly) {
    await runBatch(indices.filter((i) => isCalendar(jobs[i])));
    await runBatch(indices.filter((i) => !isCalendar(jobs[i])));
  } else await runBatch(indices);
  const received = outcomes.filter(Boolean);
  const coverage = Object.fromEntries(SPORTS.map(([sport]) => {
    const available = received.filter(({ job }) => !job.standings && !job.resultIndex &&
      (!currentScheduleOnly || !job.historicalOnly) && job.sports.includes(sport));
    const publishers = [...new Set(available.map(({ job }) => job.source))].filter((source) => {
      const feeds = available.filter(({ job }) => job.source === source);
      return feeds.some(({ job }) => job.day === null) || scheduleDays.every((day) => feeds.some(({ job }) => job.day === day));
    }).sort();
    return [sport, publishers];
  }));
  const rows = received.filter(({ job }) => !job.standings && !job.resultIndex)
    .flatMap(({ job, rows }) => rows.filter((row) =>
      (row.source !== "Ensigame" || row.status !== "finished") &&
      (!currentScheduleOnly || isCalendar(job) || row.status !== "scheduled")));
  const links = esportsResultLinks(received.filter(({ job }) => job.resultIndex).flatMap(({ rows }) => rows), rows);
  const results = await Promise.all(links.map(async (row) => {
    try {
      return parseEnsiResult(await get(row.url, true, row.source, row.sport), row);
    } catch (error) {
      errors.push(log("error", "Ошибка проверки результата серии", { publisher: row.source, url: row.url, error: error.message }));
      return null;
    }
  }));
  const fixtures = esportsFormLinks(rows, now);
  const forms = new Array(fixtures.length);
  const editorialForms = new Array(fixtures.length);
  let nextFixture = 0;
  await Promise.all(Array.from({ length: Math.min(3, fixtures.length) }, async () => {
    while (nextFixture < fixtures.length) {
      const i = nextFixture++;
      const fixture = fixtures[i];
      const { strafe, ensi, row } = fixture;
      try {
        const [first, second] = await Promise.all([get(strafe.url, true, strafe.source, row.sport), get(ensi.url, true, ensi.source, row.sport)]);
        const strafeResults = parseStrafeForm(first);
        const ensiResults = parseEnsiForm(second);
        forms[i] = [row.url, verifiedEsportsForm(fixture, strafeResults, ensiResults, now)];
        if (currentScheduleOnly) editorialForms[i] = [row.url, verifiedEsportsForm(fixture, strafeResults, ensiResults, now, 28, 12)];
      } catch (error) {
        errors.push(log("error", "Ошибка сверки формы команд", { sport: row.sport, match: `${row.home} — ${row.away}`, error: error.message }));
      }
    }
  }));
  let previewsTried = 0;
  let previewsReceived = 0;
  const previewLinks = includeTennisPreviews ? tennisPreviewLinks(rows, now) : [];
  const tennisPreviews = await Promise.all(previewLinks.map(async ({ row, urls }) => {
    for (const url of urls) {
      previewsTried++;
      try {
        const html = await get(url, true, "ATP Finals", row.sport);
        previewsReceived++;
        const data = parseAtpHeadToHead(html, row, url);
        if (data) return [row.url, data];
      } catch (error) {
        errors.push(log("error", "Не найден разбор Итогового турнира ATP", { url, error: error.message }));
      }
    }
    return null;
  }));
  return {
    rows: [...rows, ...results.filter(Boolean)],
    standings: received.filter(({ job }) => job.standings).flatMap(({ rows }) => rows),
    esportsForm: new Map(forms.filter(Boolean)),
    esportsEditorialForm: new Map(editorialForms.filter(Boolean)),
    tennisPreviews: new Map(tennisPreviews.filter(Boolean)),
    coverage, errors, jobReport, requests: { total: jobs.length + links.length + 2 * fixtures.length + previewsTried,
      success: received.length + results.filter(Boolean).length + 2 * forms.filter(Boolean).length + previewsReceived },
  };
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

async function loadInputs(base) {
  const current = await read(base, "data/predictions.json");
  const indexFile = await read(base, "data/history/index.json");
  ensure(Array.isArray(indexFile.months) && indexFile.months.every((month) => MONTH.test(month)) &&
    new Set(indexFile.months).size === indexFile.months.length, "Повреждён индекс истории");
  const historyFiles = await Promise.all(indexFile.months.map((month) => read(base, `data/history/${month}.json`)));
  const express = await read(base, "data/history/express.json");
  ensure(current.sports?.length === SPORTS.length && SPORTS.every(([id]) => current.sports.some((s) => s.id === id && Array.isArray(s.picks))) &&
    Number.isFinite(Date.parse(current.updated_at)), "Некорректный файл действующих прогнозов");
  ensure(historyFiles.every((part, i) => part.month === indexFile.months[i] && Array.isArray(part.predictions)) &&
    Array.isArray(express.expresses), "Повреждён архив");
  const ids = historyFiles.flatMap((part) => part.predictions.map((p) => p.id));
  ensure(ids.every(Boolean) && new Set(ids).size === ids.length, "Пустые или повторяющиеся идентификаторы в архиве");
  return { current, indexFile, historyFiles, express };
}

function validate(input, output, now, manual = false) {
  const previous = input.historyFiles.flatMap((h) => h.predictions);
  const next = Object.values(output.months).flatMap((h) => h.predictions);
  const ids = new Map(next.map((e) => [e.id, e]));
  ensure(next.length === ids.size && previous.every((e) => ids.has(e.id)), "Нарушена целостность истории");
  ensure(previous.every((old) => !H.FINAL.has(old.status) || json(old) === json(ids.get(old.id))),
    "Обновление изменило ранее оценённый прогноз");
  ensure(input.express.expresses.every((old) => old.status === "pending" ||
    json(old) === json(output.express.expresses.find((e) => e.id === old.id))), "Изменён рассчитанный экспресс");
  for (const sport of output.next.sports) {
    ensure(new Set(sport.events.map((e) => `${e.match}|${e.start_iso}`)).size === sport.events.length,
      `Дубли матчей в категории ${sport.id}`);
    ensure(sport.events.every((e) => Date.parse(e.start_iso) > now &&
      (new Set(e.sources.map((s) => s.title)).size >= 2 ||
        manual && e.sources.some((source) => officialFixtureSource({ sport: sport.id, tournament: e.tournament }, source)))), `Некорректное расписание в категории ${sport.id}`);
    ensure(sport.picks.every((p) => Date.parse(p.start_iso) > now), "Найден уже начавшийся прогноз");
    const previousPicks = input.current.sports.find((previous) => previous.id === sport.id).picks;
    for (const pick of sport.picks.filter((p) => p.generated)) {
      const existing = previousPicks.some((old) => old.generated === pick.generated && old.match === pick.match &&
        old.bet === pick.bet && old.start_iso === pick.start_iso);
      ensure(!pick.odds && pick.facts?.length >= 3 && new Set((pick.sources || []).map((source) => source.title)).size >= 2 &&
        (existing || Date.parse(pick.start_iso) > now + PUBLISH_BUFFER),
      "Новый прогноз не прошёл проверку данных или до начала осталось меньше десяти минут");
      if (pick.market) {
        const { scope, line_source: lineSource } = pick.market;
        ensure(scope === (sport.id === "football" ? "regulation" : "final") && H.evaluateMarket(pick.market, "1:1") &&
          (!lineSource || pick.sources.some((source) => source.url === lineSource.url && source.title === lineSource.title)),
        "Невалидное условие расчёта или отсутствует источник линии");
      }
    }
  }
  const currentLegs = output.next.sports.flatMap((sport) => sport.picks.map((pick) => [sport.id, pick]));
  const usedMatches = new Set();
  for (const item of output.next.express || []) {
    const valid = item.forecast_only ? item.total_odds === null && new Set(item.legs.map((leg) => leg.sport)).size === 2 &&
      item.legs.every((leg) => leg.odds === null) : item.total_odds >= 2 && item.total_odds <= 3.5;
    ensure(item.legs.length === 2 && valid, "Экспресс не прошёл проверку");
    for (const leg of item.legs) {
      const key = JSON.stringify([leg.sport, leg.match, leg.start_iso]);
      ensure(!usedMatches.has(key) && currentLegs.some(([sport, pick]) => sport === leg.sport && pick.match === leg.match &&
        pick.bet === leg.bet && pick.start_iso === leg.start_iso && (item.forecast_only ? pick.generated && !pick.odds :
          Number(String(pick.odds).replace(",", ".")) === Number(leg.odds))),
      "Экспресс содержит повторяющийся матч или прогноз вне сводки");
      usedMatches.add(key);
    }
  }
}

function blockers(output, now, lastUpdated, manual = false) {
  const issues = SPORTS.flatMap(([sport]) => {
    const info = output.report.sports[sport];
    if (manual && info.selected) return [];
    const missing = required[sport].filter((name) => !info.publishers.includes(name) &&
      !(manual && sport === "dota2" && name === "GosuGamers" && info.publishers.includes("Ensigame")));
    if (sport === "cs2" && !["GosuGamers", "Ensigame"].some((name) => info.publishers.includes(name))) missing.push("GosuGamers или Ensigame");
    if (sport === "volleyball" && !["Lega Pallavolo", "TheSportsDB", "ESPN"].some((name) => info.publishers.includes(name))) {
      missing.push("Lega Pallavolo, TheSportsDB или ESPN");
    }
    return missing.length ? [`${sport}: недоступны ${missing.join(", ")}`] : [];
  });
  if (lastUpdated > now) issues.push("Исходные прогнозы датированы будущим временем");
  if (!output.next.sports.some((s) => s.events.length)) issues.push("Нет подтверждённых предстоящих событий");
  return issues;
}

async function saveCandidate(base, update) {
  const files = { ...siteData(null, update), "report.json": update.report };
  await mkdir(dirname(base), { recursive: true });
  await mkdir(base);
  await mkdir(join(base, "data/history"), { recursive: true });
  for (const [file, content] of Object.entries(files)) await writeFile(join(base, file), json(content), { flag: "wx" });
}

async function preview(mode = "preview", editorialFile, replay) {
  const shadow = mode === "shadow";
  const manual = mode === "manual" || Boolean(replay);
  const editorial = editorialFile ? JSON.parse(await readFile(resolve(editorialFile), "utf8")) : [];
  ensure(Array.isArray(editorial), "Редакционные сверки должны быть списком");
  const wallClock = Date.now();
  const now = replay ? replay.startedAt : wallClock;
  const input = await loadInputs(root);
  const scheduleDays = [...new Set([dateKey(now), dateKey(now + DAY), H.mskDateOf(new Date(now + DAY).toISOString())])];
  const recentDays = replay ? replay.editorialDays : manual ? MANUAL_EDITORIAL_DAYS : FORM_DAYS;
  const recent = Array.from({ length: recentDays + 1 }, (_, i) => dateKey(now - (recentDays - i) * DAY));
  // Also request older exact dates for unresolved predictions, with a fixed
  // bound on extra requests. Older unmatched entries remain in the archive.
  const due = H.dueForCheck(H.mergeMonths(input.historyFiles), now);
  const older = [...new Set(due.filter((e) => e.start_iso && !e.start_approx && !e.late)
    .map((e) => dateKey(Date.parse(e.start_iso))))].sort().slice(-7);
  const days = [...new Set([...recent, ...older, ...scheduleDays])].sort();
  const footballDays = Array.from({ length: Math.max(0, FOOTBALL_FORM_DAYS - recentDays) }, (_, i) =>
    dateKey(now - (FOOTBALL_FORM_DAYS - i) * DAY));
  const jobs = sourceJobs(days, scheduleDays, footballDays);
  log("info", "Начата проверка источников", { dates: days, requests: jobs.length });
  const store = join(root, ".sports-update", "manual-research");
  let research;
  if (replay) {
    const record = JSON.parse((await verifyResearchObject(store, "runs", replay.snapshot)).toString("utf8"));
    ensure(record.at >= now && record.at <= wallClock, "Снимок исследования не соответствует дате прогона");
    const prior = (await readResearchRuns(store)).filter((run) => run.at <= record.at && run.normalized);
    const raw = new Map(record.requests.filter((request) => request.rawHash && ["ok", "cached"].includes(request.status))
      .map((item) => [item.url, item.rawHash]));
    const site = await collect(jobs, scheduleDays, now, false, async (url, html) => {
      const hash = raw.get(url);
      if (!hash) throw new Error("Ответ отсутствует в сохранённом снимке");
      const body = (await verifyResearchObject(store, "raw", hash)).toString("utf8");
      return html ? body : JSON.parse(body);
    }, true);
    research = { site, diagnostics: await read(join(root, ".sports-update", replay.run), "diagnostic.json"),
      history: mergeHistory(prior.flatMap((run) => run.normalized.results), record.at).history,
      requests: record.requests, snapshot: replay.snapshot };
  } else if (manual) {
    research = await captureManualResearch(store, now, (get) =>
      collect(jobs, scheduleDays, now, false, (url, text, source, sport, day, schedule) =>
        get(url, { text, source, sport, schedule, minAge: day && day < dateKey(now - DAY) ? 7 * DAY : 0 }), true));
  }
  const data = research ? research.site : await collect(jobs, scheduleDays, now, !shadow);
  // History settlement can mutate entries that share references with the
  // input archive. Keep the exact pre-run state for validation and approval.
  const articleContexts = new Map();
  const output = buildUpdate({ ...structuredClone(input), ...data, now,
    reviewArticle: (article, context) => articleContexts.set(article, context), editorialDays: manual ? recentDays : 0, manualSchedule: manual });
  const reviewedAt = Date.now();
  const selection = research ? selectManualAnalysis(output.next, articleContexts, research, reviewedAt, editorial) : null;
  if (selection) {
    output.report.analysis = output.next.analysis.length;
    for (const sport of output.next.sports) {
      const row = output.report.sports[sport.id];
      row.selected = sport.events.length;
      row.qualifiedAnalysis = selection.evaluated.filter((item) => item.sport === sport.id && item.quality).length;
      row.articles = selection.articles.filter((item) => item.sport === sport.id).length;
      row.calendarOnly = row.selected - row.articles;
    }
  }
  const issues = blockers(output, now, Date.parse(input.current.updated_at), manual);
  if (replay) issues.push("Редакционный повтор по сохранённым ответам. Для публикации нужен свежий сетевой прогон.");
  try { validate(input, output, Date.now(), manual); } catch (e) { issues.push(e.message); }
  Object.assign(output.report, {
    checkedAt: H.toMskIso(new Date(now)), basedOn: input.current.updated_at,
    requests: data.requests, errors: data.errors, blockers: issues, eligible: issues.length === 0,
  });
  const run = process.env.GITHUB_ACTIONS === "true" ? "candidate" : `run-${new Date(wallClock).toISOString().replace(/[:.]/g, "-")}`;
  const path = join(root, ".sports-update", run);
  await saveCandidate(path, output);
  if (manual) {
    const report = { ...output.report, checkedAt: new Date(reviewedAt).toISOString(),
      researchApplied: selection.researchApplied, articles: selection.articles,
      evaluatedArticles: selection.evaluated, modelDecisions: selection.modelDecisions,
      runMode: replay ? "replay" : "live", editorialDays: recentDays, scheduleJobs: data.jobReport,
      rawRequests: Object.fromEntries([...Map.groupBy(research.requests.filter((request) => request.startedAt),
        (request) => request.status)].map(([name, items]) => [name, items.length])) };
    await writeFile(join(path, "manual-report.json"), json(report), { flag: "wx" });
    await writeFile(join(path, "network.json"), json({ mode: report.runMode, requests: research.requests, jobs: data.jobReport }), { flag: "wx" });
    await writeFile(join(path, "diagnostic.json"), json(research.diagnostics), { flag: "wx" });
    const packet = sealManualPacket(report, siteData(input), siteData(null, output));
    await writeFile(join(path, "manual-packet.json"), json(packet), { flag: "wx" });
    await writeFile(join(path, "review.md"), manualSummary(report, research.diagnostics, research.requests, research.snapshot), { flag: "wx" });
    log("info", "Подборка для ручной проверки", { run, approvalId: packet.approvalId, eligible: report.eligible,
      researchApplied: selection.researchApplied });
  }
  if (shadow) {
    const until = Date.parse(`${H.mskDateOf(new Date(now + DAY).toISOString())}T00:00:00+03:00`) + DAY;
    const supplemental = await loadResearchSources({ cacheDir: join(root, ".sports-update", "source-cache-v2"), now, until });
    const checkpoint = await buildShadowReport({ rows: data.rows, now, until, checkedAt: output.report.checkedAt,
      fetchData, legacyReport: output.report.sports, requestErrors: data.errors, clock: Date.now, supplemental, improve: true });
    await writeFile(join(path, "checkpoint-c2b20e1.json"), json(checkpoint), { flag: "wx" });
    const archive = await loadSeasonArchives({ events: checkpoint.assessed.filter((event) => event.status === "confirmed"), now, fetchData });
    const observedAt = Date.now();
    const snapshotsDir = join(root, ".sports-update", "research-history-v1");
    await saveResearchSnapshot(snapshotsDir, makeHistorySnapshot({ rows: data.rows, supplemental,
      archives: archive.results, archiveRequests: archive.requests, now, until, observedAt }));
    const diagnostics = compareHistory({ ...checkpoint, requests: [...checkpoint.requests, ...archive.requests] },
      await readResearchSnapshots(snapshotsDir, observedAt), observedAt);
    await writeFile(join(path, "diagnostics.json"), json(diagnostics), { flag: "wx" });
    log("info", "Диагностика нового движка сохранена", { coverage: diagnostics.coverage,
      predictions: diagnostics.forecastCount, trainingResults: diagnostics.trainingResults });
  }
  log(issues.length ? "error" : "info", "Пробный результат сохранён", { path, blockers: issues, sports: output.report.sports });
  if (issues.length) process.exitCode = 2;
}

async function verifyManualCandidate(run, approvalId, siteRoot = root) {
  ensure(RUN.test(run || "") && /^[a-f0-9]{64}$/.test(approvalId || ""),
    "Нужен каталог ручного прогона и его идентификатор");
  const path = join(root, ".sports-update", run);
  const [input, candidate, packet, report] = await Promise.all([
    loadInputs(resolve(siteRoot)), loadInputs(path), read(path, "manual-packet.json"), read(path, "manual-report.json"),
  ]);
  const now = Date.now();
  checkManualPacket(packet, approvalId, report, siteData(input), siteData(candidate), now);
  validate(input, { next: candidate.current, months: Object.fromEntries(candidate.historyFiles.map((file) => [file.month, file])),
    express: candidate.express }, now, true);
  log("info", "Пакет совпал с проверенной версией", { path, files: Object.keys(packet.candidate) });
}

async function applyCandidate() {
  ensure(process.env.GITHUB_ACTIONS === "true" && process.env.PREDICTIONS_PUBLISH_APPROVED === "true",
    "Применение разрешено только из согласованного задания GitHub");
  const base = join(root, ".sports-update", "candidate");
  const report = await read(base, "report.json");
  ensure(report.eligible === true && report.blockers.length === 0 && Date.now() - Date.parse(report.checkedAt) < 20 * 60_000,
    "Пробный результат не прошёл проверки или устарел");
  const previous = await loadInputs(root);
  const candidate = await loadInputs(base);
  ensure(previous.current.updated_at === report.basedOn, "Действующие прогнозы изменились во время проверки");
  validate(previous, {
    next: candidate.current, months: Object.fromEntries(candidate.historyFiles.map((file) => [file.month, file])), express: candidate.express,
  }, Date.now());
  const inputs = {
    "data/predictions.json": candidate.current, "data/history/index.json": candidate.indexFile, "data/history/express.json": candidate.express,
    ...Object.fromEntries(candidate.historyFiles.map((file) => [`data/history/${file.month}.json`, file])),
  };
  for (const [file, value] of Object.entries(inputs)) await writeFile(join(root, file), json(value));
}

async function verifyDeployment(siteRoot = root) {
  const origin = "https://prognozy-dnya.vercel.app";
  const input = await loadInputs(resolve(siteRoot));
  const files = {
    "data/predictions.json": input.current, "data/history/index.json": input.indexFile, "data/history/express.json": input.express,
    ...Object.fromEntries(input.historyFiles.map((file) => [`data/history/${file.month}.json`, file])),
  };
  for (let attempt = 0; attempt < 24; attempt++) {
    try {
      const published = await Promise.all(Object.keys(files).map((file) => fetchData(`${origin}/${file}?v=${Date.now()}`)));
      if (Object.values(files).every((file, i) => json(file) === json(published[i]))) {
        log("info", "Vercel отдаёт обновлённые прогнозы и историю");
        return;
      }
    } catch (e) { log("error", "Пока не удалось проверить Vercel", { error: e.message }); }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error("Vercel не подтвердил публикацию подготовленных файлов");
}

const command = process.argv[2] ?? "--preview";
try {
  if (command === "--preview") await preview();
  else if (command === "--shadow") {
    ensure(process.env.GITHUB_ACTIONS !== "true", "Режим исследования использует отдельный локальный архив");
    await preview("shadow");
  }
  else if (command === "--manual") {
    ensure(process.env.GITHUB_ACTIONS !== "true", "Ручное обновление запускается локально");
    ensure(!process.argv[3] || process.argv[3] === "--editorial" && process.argv[4], "Укажите файл после --editorial");
    await preview("manual", process.argv[4]);
  }
  else if (command === "--manual-review") {
    const [run, snapshot, editorial] = process.argv.slice(3);
    const parsed = RUN.exec(run || "");
    ensure(process.env.GITHUB_ACTIONS !== "true" && parsed && /^[a-f0-9]{64}$/.test(snapshot || ""), "Неверный снимок для редакционного повтора");
    const [, date, hour, minute, second, milli] = parsed;
    const { editorialDays = FORM_DAYS } = await read(join(root, ".sports-update", run), "manual-report.json");
    ensure(Number.isInteger(editorialDays) && editorialDays >= FORM_DAYS && editorialDays <= MANUAL_EDITORIAL_DAYS, "Неизвестный период сбора в снимке");
    await preview("manual", editorial, { run, snapshot, editorialDays, startedAt: Date.parse(`${date}T${hour}:${minute}:${second}.${milli}Z`) });
  }
  else if (command === "--check-manual") await verifyManualCandidate(process.argv[3], process.argv[4], process.argv[5]);
  else if (command === "--apply") await applyCandidate();
  else if (command === "--verify-deployment") await verifyDeployment(process.argv[3]);
  else throw new Error(`Неизвестный аргумент ${command}`);
} catch (error) {
  log("error", "Обновление остановлено", { error: error.message });
  process.exitCode = 1;
}
