import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildUpdate, DAY, esportsFormLinks, esportsResultLinks, FOOTBALL_FORM_DAYS, FORM_DAYS, PUBLISH_BUFFER, SPORTS,
  tennisPreviewLinks, verifiedEsportsForm } from "./sports-update-core.mjs";
import { parseAtpHeadToHead, parseEnsiForm, parseEnsiResult, parseStrafeForm, sourceJobs } from "./sports-sources.mjs";
import { buildShadowReport } from "./sports-shadow.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const H = globalThis.HistoryCore;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/;
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

async function collect(jobs, scheduleDays, now) {
  const errors = [];
  const outcomes = new Array(jobs.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (cursor < jobs.length) {
      const index = cursor++;
      const job = jobs[index];
      try {
        const rows = job.parse(await fetchData(job.url, job.html));
        outcomes[index] = { job, rows };
      } catch (error) {
        errors.push(log("error", "Ошибка источника", {
          publisher: job.source, sports: job.sports, date: job.day, url: job.url, error: error.message,
        }));
      }
    }
  }));
  const received = outcomes.filter(Boolean);
  const coverage = Object.fromEntries(SPORTS.map(([sport]) => {
    const available = received.filter(({ job }) => !job.standings && !job.resultIndex && job.sports.includes(sport));
    const publishers = [...new Set(available.map(({ job }) => job.source))].filter((source) => {
      const feeds = available.filter(({ job }) => job.source === source);
      return feeds.some(({ job }) => job.day === null) || scheduleDays.every((day) => feeds.some(({ job }) => job.day === day));
    }).sort();
    return [sport, publishers];
  }));
  const rows = received.filter(({ job }) => !job.standings && !job.resultIndex)
    .flatMap(({ rows }) => rows.filter((row) => row.source !== "Ensigame" || row.status !== "finished"));
  const links = esportsResultLinks(received.filter(({ job }) => job.resultIndex).flatMap(({ rows }) => rows), rows);
  const results = await Promise.all(links.map(async (row) => {
    try {
      return parseEnsiResult(await fetchData(row.url, true), row);
    } catch (error) {
      errors.push(log("error", "Ошибка проверки результата серии", { publisher: row.source, url: row.url, error: error.message }));
      return null;
    }
  }));
  const fixtures = esportsFormLinks(rows, now);
  const forms = new Array(fixtures.length);
  let nextFixture = 0;
  await Promise.all(Array.from({ length: Math.min(3, fixtures.length) }, async () => {
    while (nextFixture < fixtures.length) {
      const i = nextFixture++;
      const fixture = fixtures[i];
      const { strafe, ensi, row } = fixture;
      try {
        const [first, second] = await Promise.all([fetchData(strafe.url, true), fetchData(ensi.url, true)]);
        forms[i] = [row.url, verifiedEsportsForm(fixture, parseStrafeForm(first), parseEnsiForm(second), now)];
      } catch (error) {
        errors.push(log("error", "Ошибка сверки формы команд", { sport: row.sport, match: `${row.home} — ${row.away}`, error: error.message }));
      }
    }
  }));
  let previewsTried = 0;
  let previewsReceived = 0;
  const tennisPreviews = await Promise.all(tennisPreviewLinks(rows, now).map(async ({ row, urls }) => {
    for (const url of urls) {
      previewsTried++;
      try {
        const html = await fetchData(url, true);
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
    tennisPreviews: new Map(tennisPreviews.filter(Boolean)),
    coverage, errors, requests: { total: jobs.length + links.length + 2 * fixtures.length + previewsTried,
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

function validate(input, output, now) {
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
      new Set(e.sources.map((s) => s.title)).size >= 2), `Некорректное расписание в категории ${sport.id}`);
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

function blockers(output, now, lastUpdated) {
  const issues = SPORTS.flatMap(([sport]) => {
    const info = output.report.sports[sport];
    const missing = required[sport].filter((name) => !info.publishers.includes(name));
    if (sport === "cs2" && !["GosuGamers", "Ensigame"].some((name) => info.publishers.includes(name))) missing.push("GosuGamers или Ensigame");
    if (sport === "volleyball" && !["Lega Pallavolo", "TheSportsDB", "ESPN"].some((name) => info.publishers.includes(name))) {
      missing.push("Lega Pallavolo, TheSportsDB или ESPN");
    }
    return missing.length ? [`${sport}: недоступны ${missing.join(", ")}`] : [];
  });
  if (lastUpdated > now) issues.push("Исходные прогнозы датированы будущим временем");
  if (!output.next.sports.some((s) => s.events.length)) issues.push("Ни одного события не подтверждено для всех семи категорий");
  return issues;
}

async function saveCandidate(base, update) {
  const files = {
    "data/predictions.json": update.next,
    "data/history/express.json": update.express,
    "data/history/index.json": update.nextIndex,
    ...Object.fromEntries(Object.entries(update.months).map(([month, archive]) => [`data/history/${month}.json`, archive])),
    "report.json": update.report,
  };
  await mkdir(dirname(base), { recursive: true });
  await mkdir(base);
  await mkdir(join(base, "data/history"), { recursive: true });
  for (const [file, content] of Object.entries(files)) await writeFile(join(base, file), json(content), { flag: "wx" });
}

async function preview(shadow = false) {
  const now = Date.now();
  const input = await loadInputs(root);
  const scheduleDays = [...new Set([dateKey(now), dateKey(now + DAY), H.mskDateOf(new Date(now + DAY).toISOString())])];
  const recent = Array.from({ length: FORM_DAYS + 1 }, (_, i) => dateKey(now - (FORM_DAYS - i) * DAY));
  // Also request older exact dates for unresolved predictions, with a fixed
  // bound on extra requests. Older unmatched entries remain in the archive.
  const due = H.dueForCheck(H.mergeMonths(input.historyFiles), now);
  const older = [...new Set(due.filter((e) => e.start_iso && !e.start_approx && !e.late)
    .map((e) => dateKey(Date.parse(e.start_iso))))].sort().slice(-7);
  const days = [...new Set([...recent, ...older, ...scheduleDays])].sort();
  const footballDays = Array.from({ length: FOOTBALL_FORM_DAYS - FORM_DAYS }, (_, i) => dateKey(now - (FOOTBALL_FORM_DAYS - i) * DAY));
  const jobs = sourceJobs(days, scheduleDays, footballDays);
  log("info", "Начата проверка источников", { dates: days, requests: jobs.length });
  const data = await collect(jobs, scheduleDays, now);
  const output = buildUpdate({ ...input, ...data, now });
  const issues = blockers(output, now, Date.parse(input.current.updated_at));
  try { validate(input, output, Date.now()); } catch (e) { issues.push(e.message); }
  Object.assign(output.report, {
    checkedAt: H.toMskIso(new Date(now)), basedOn: input.current.updated_at,
    requests: data.requests, errors: data.errors, blockers: issues, eligible: issues.length === 0,
  });
  const run = process.env.GITHUB_ACTIONS === "true" ? "candidate" : `run-${new Date(now).toISOString().replace(/[:.]/g, "-")}`;
  const path = join(root, ".sports-update", run);
  await saveCandidate(path, output);
  if (shadow) {
    const until = Date.parse(`${H.mskDateOf(new Date(now + DAY).toISOString())}T00:00:00+03:00`) + DAY;
    const diagnostics = await buildShadowReport({ rows: data.rows, now, until, checkedAt: output.report.checkedAt,
      fetchData, legacyReport: output.report.sports, requestErrors: data.errors, clock: Date.now });
    await writeFile(join(path, "diagnostics.json"), json(diagnostics), { flag: "wx" });
    log("info", "Диагностика нового движка сохранена", { coverage: diagnostics.coverage,
      predictions: diagnostics.forecastCount, trainingResults: diagnostics.trainingResults });
  }
  log(issues.length ? "error" : "info", "Пробный результат сохранён", { path, blockers: issues, sports: output.report.sports });
  if (issues.length) process.exitCode = 2;
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

async function verifyDeployment() {
  const origin = "https://prognozy-dnya.vercel.app";
  const input = await loadInputs(root);
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
    await preview(true);
  }
  else if (command === "--apply") await applyCandidate();
  else if (command === "--verify-deployment") await verifyDeployment();
  else throw new Error(`Неизвестный аргумент ${command}`);
} catch (error) {
  log("error", "Обновление остановлено", { error: error.message });
  process.exitCode = 1;
}
