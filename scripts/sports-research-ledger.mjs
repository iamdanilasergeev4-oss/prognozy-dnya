import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { evaluateProbabilities } from "./sports-evaluation.mjs";
import { DAY } from "./sports-research-history.mjs";
import { validSeries } from "./sports-evidence.mjs";

export const sports = ["football", "basketball", "tennis", "volleyball", "hockey", "cs2", "dota2"];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const dataHash = (value) => digest(JSON.stringify(value));
const stable = (event) => JSON.stringify([event.sport, event.competition, [event.home, event.away].sort()]);
const exact = (event) => JSON.stringify([stable(event), event.start]);
const sourceKeys = (event) => (event.sources ?? []).filter((source) => source.title && source.id != null && source.id !== "")
  .map(({ title, id }) => JSON.stringify([event.sport, title, String(id)]));
const trusted = (tier) => ["official", "independent"].includes(tier);
const scheduled = (tier) => trusted(tier) || tier === "corroborated_unknown_origin";
const cohort = (event) => [event.sport, event.tier || "unknown"];
const resultOf = ([a, b]) => a > b ? "home" : a < b ? "away" : "draw";
const validScore = (score) => Array.isArray(score) && score.length === 2 &&
  score.every((value) => Number.isSafeInteger(value) && value >= 0);
const fullMatch = (event) => sports.includes(event.sport) && typeof event.competition === "string" &&
  Boolean(event.competition && event.home && event.away && event.home !== event.away) && Number.isFinite(event.start);

export async function storeResearchObject(root, kind, value) {
  const body = Buffer.isBuffer(value) || typeof value === "string" ? value : JSON.stringify(value);
  const hash = digest(body);
  const directory = join(root, kind);
  await mkdir(directory, { recursive: true });
  const file = join(directory, hash + ".json");
  const temporary = join(directory, randomUUID() + ".tmp");
  try {
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(body);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try { await link(temporary, file); } catch (error) {
      if (error.code !== "EEXIST" || digest(await readFile(file)) !== hash) throw error;
    }
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
  return hash;
}

export async function verifyResearchObject(root, kind, hash) {
  if (!/^[a-f0-9]{64}$/.test(hash ?? "")) throw new Error("Некорректная ссылка на объект " + kind);
  const body = await readFile(join(root, kind, hash + ".json"));
  if (digest(body) !== hash) throw new Error("Повреждён исследовательский снимок " + kind + "/" + hash);
  return body;
}

function references(run) {
  return [["features", run.featuresHash], ["normalized", run.normalizedHash],
    ...(run.requests ?? []).filter((row) => row.rawHash).map((row) => ["raw", row.rawHash])];
}

export async function readResearchRuns(root) {
  const folder = join(root, "runs");
  const names = await readdir(folder).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return Promise.all(names.filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).sort().map(async (name) => {
    const body = await verifyResearchObject(root, "runs", name.slice(0, 64));
    const run = JSON.parse(body);
    if (run.schema !== 1 || !Number.isFinite(run.at) || !Array.isArray(run.events) ||
        !Array.isArray(run.forecasts) || !Array.isArray(run.results)) throw new Error("Неизвестный формат прогона " + name);
    return run;
  }));
}

export async function verifyResearchStore(root) {
  const runs = await readResearchRuns(root);
  const unique = new Map();
  const runKeys = new Map();
  for (const run of runs) {
    for (const [kind, hash] of references(run)) unique.set(kind + "/" + hash, [kind, hash]);
    const hash = dataHash(run);
    if (run.runKey) {
      if (runKeys.has(run.runKey) && runKeys.get(run.runKey) !== hash) throw new Error("Два снимка для ключа " + run.runKey);
      runKeys.set(run.runKey, hash);
    }
    unique.set("runs/" + hash, ["runs", hash]);
  }
  for (const [kind, hash] of unique.values()) await verifyResearchObject(root, kind, hash);
  return { runs: runs.length, runKeys: Object.fromEntries(runKeys), objects: [...unique.values()] };
}

export async function copyResearchStore(source, destination) {
  const snapshot = await verifyResearchStore(source);
  if (!snapshot.runs) throw new Error("Пустое хранилище");
  const existing = await verifyResearchStore(destination);
  for (const [key, hash] of Object.entries(snapshot.runKeys)) {
    if (Object.hasOwn(existing.runKeys, key) && existing.runKeys[key] !== hash) throw new Error("Разные снимки для ключа " + key);
  }
  for (const [kind, hash] of snapshot.objects.filter(([kind]) => kind !== "runs")) {
    await storeResearchObject(destination, kind, await verifyResearchObject(source, kind, hash));
  }
  for (const [kind, hash] of snapshot.objects.filter(([kind]) => kind === "runs")) {
    await storeResearchObject(destination, kind, await verifyResearchObject(source, kind, hash));
  }
  return verifyResearchStore(destination);
}

function makeIdentityIndex() {
  const aliases = new Map();
  const ids = new Map();
  return (event) => {
    const keys = [exact(event), ...sourceKeys(event)];
    const matches = [...new Set(keys.map((key) => aliases.get(key)).filter(Boolean))];
    if (matches.length > 1 || matches.length === 1 && ids.get(matches[0]) !== stable(event)) return null;
    const id = matches[0] ?? dataHash(exact(event));
    ids.set(id, stable(event));
    for (const key of keys) aliases.set(key, id);
    return id;
  };
}

const modelKeys = (event) => event.sport === "football" || event.sport === "dota2" && event.rules === "BO2" ?
  ["away", "draw", "home"] : ["away", "home"];

function validForecast(forecast, event, at) {
  const keys = modelKeys(event);
  const probabilities = forecast.probabilities;
  return typeof forecast.version === "string" && forecast.version && probabilities &&
    Object.keys(probabilities).sort().join(",") === keys.join(",") &&
    keys.every((key) => Number.isFinite(probabilities[key]) && probabilities[key] >= 0 && probabilities[key] <= 1) &&
    Math.abs(keys.reduce((sum, key) => sum + probabilities[key], 0) - 1) < 1e-8 &&
    at + 600_000 < event.start;
}

function probabilitiesFor(forecast, event) {
  return forecast.home === event.home ? forecast.probabilities :
    { ...forecast.probabilities, home: forecast.probabilities.away, away: forecast.probabilities.home };
}

function statistics(rows) {
  const metrics = (sample, model) => evaluateProbabilities(sample.map((row) =>
    ({ actual: row.actual, probabilities: row.models[model] })));
  const versions = [...new Set(rows.flatMap((row) => Object.keys(row.models)))].sort();
  return { scoredEvents: rows.length, models: Object.fromEntries(versions.map((version) => {
    const sample = rows.filter((row) => row.models[version]);
    return [version, { ...metrics(sample, version), shareOfScoredEvents: sample.length / rows.length }];
  })), paired: versions.flatMap((first, index) => versions.slice(index + 1).flatMap((second) => {
    const sample = rows.filter((row) => row.models[first] && row.models[second] &&
      row.modelObservedAt[first] === row.modelObservedAt[second]);
    return sample.length ? [{ first, second, matches: sample.length, firstMetrics: metrics(sample, first),
      secondMetrics: metrics(sample, second) }] : [];
  })) };
}

const counts = (items, group) => Object.fromEntries([...Map.groupBy(items, group)]
  .map(([key, values]) => [key, values.length]));

export function researchReport(input, asOf) {
  const runs = input.filter((run) => run.at <= asOf).sort((a, b) => a.at - b.at || dataHash(a).localeCompare(dataHash(b)));
  const identify = makeIdentityIndex();
  const events = new Map();
  const forecasts = new Map();
  const results = new Map();
  const holds = new Set();
  for (const run of runs) {
    for (const event of run.events.filter(fullMatch)) {
      const id = identify(event);
      if (!id) continue;
      const previous = events.get(id);
      if (previous && previous.start !== event.start) holds.add(id);
      events.set(id, { ...event, id, observedAt: run.at, firstSeen: previous?.firstSeen ?? run.at,
        everConfirmed: Boolean(previous?.everConfirmed || scheduled(event.sourceTier)) });
    }
    for (const forecast of run.forecasts.filter(fullMatch)) {
      const id = identify(forecast);
      const event = events.get(id);
      if (!event || event.observedAt !== run.at || event.start !== forecast.start || holds.has(id) ||
          !scheduled(event.sourceTier) || event.dataQuality?.identityConflict ||
          forecast.rules !== event.rules || !validForecast(forecast, event, run.at)) continue;
      if (!forecasts.has(id)) forecasts.set(id, new Map());
      const entries = forecasts.get(id);
      if (!entries.has(forecast.version)) entries.set(forecast.version, { ...forecast, observedAt: run.at });
    }
    for (const result of run.results.filter(fullMatch)) {
      if (result.dateOnly || !trusted(result.tier) || result.start + DAY > result.observedAt ||
          result.observedAt > run.at || !Number.isFinite(result.observedAt) || !validScore(result.score)) continue;
      const id = identify(result);
      if (!id) continue;
      const event = events.get(id);
      if (!event) continue;
      const scoreValid = ["cs2", "dota2"].includes(event.sport) ? validSeries(result.score, result.rules, event.sport) :
        event.sport === "volleyball" ? Math.max(...result.score) === 3 && result.score[0] !== result.score[1] :
        event.sport === "tennis" ? [2, 3].includes(Math.max(...result.score)) && result.score[0] !== result.score[1] : true;
      if (event.start !== result.start || event.rules !== result.rules || !scoreValid) {
        holds.add(id);
        continue;
      }
      const score = result.home < result.away ? result.score : [...result.score].reverse();
      if (!modelKeys(event).includes(resultOf(score))) { holds.add(id); continue; }
      const previous = results.get(id);
      if (previous && previous.score.join(":") !== score.join(":")) holds.add(id);
      if (!previous) results.set(id, { ...result, score });
    }
  }
  const records = [...events.values()].map((event) => {
    const predictions = forecasts.get(event.id);
    const models = Object.fromEntries([...(predictions ?? [])].map(([version, forecast]) =>
      [version, probabilitiesFor(forecast, event)]));
    const modelObservedAt = Object.fromEntries([...(predictions ?? [])].map(([version, forecast]) => [version, forecast.observedAt]));
    const settled = results.get(event.id);
    const result = settled && { ...settled, home: event.home, away: event.away,
      score: event.home < event.away ? settled.score : [...settled.score].reverse() };
    const hold = holds.has(event.id);
    return { ...event, models, modelObservedAt, result: result && !hold ? result : null,
      actual: result && !hold ? resultOf(result.score) : null,
      status: hold ? "conflict" : result ? "settled" : event.start + DAY <= asOf ? "result_missing" : "pending" };
  });
  const bySport = Object.fromEntries(sports.map((sport) => {
    const all = records.filter((row) => row.sport === sport);
    const summarize = (rows, completeWindow) => {
      const scored = rows.filter((row) => row.actual && Object.keys(row.models).length);
      const detected = rows.length;
      const confirmed = rows.filter((row) => row.everConfirmed).length;
      const predicted = rows.filter((row) => Object.keys(row.models).length).length;
      const models = rows.flatMap((row) => Object.keys(row.models));
      return { completeWindow, detected, confirmed, predicted, forecastCoverage: confirmed ? predicted / confirmed : null,
        settledEvents: rows.filter((row) => row.status === "settled").length,
        forecastCoverageByModel: Object.fromEntries(Object.entries(counts(models, (model) => model))
          .map(([model, total]) => [model, { total, coverage: confirmed ? total / confirmed : null }])),
        historyAvailable: rows.filter((row) => row.historyAvailable).length,
        sourceTiers: counts(rows, (row) => row.sourceTier ?? "unknown"), statuses: counts(rows, (row) => row.status),
        skipped: counts(rows.filter((row) => !Object.keys(row.models).length).flatMap((row) => row.missing ?? []), (reason) => reason),
        ...statistics(scored), byLevel: Object.fromEntries([...Map.groupBy(scored, (row) => cohort(row)[1])]
          .map(([level, sample]) => [level, statistics(sample)])) };
    };
    const captureDays = new Set(runs.map(({ at }) => Math.floor(at / DAY)));
    const complete = (from, until) => Array.from({ length: Math.floor(until / DAY) - Math.floor(from / DAY) },
      (_, index) => Math.floor(from / DAY) + index).every((day) => captureDays.has(day));
    return [sport, { all: summarize(all, runs.length > 0),
      ...Object.fromEntries([7, 30].map((days) => {
        const from = asOf - days * DAY;
        const current = summarize(all.filter((row) => row.start > from && row.start <= asOf), complete(from, asOf));
        const previous = summarize(all.filter((row) => row.start > from - days * DAY && row.start <= from),
          complete(from - days * DAY, from));
        const changes = Object.fromEntries(Object.entries(current.models).filter(([version]) => previous.models[version])
          .map(([version, model]) => [version, {
            brier: model.brier - previous.models[version].brier,
            logLoss: model.logLoss - previous.models[version].logLoss,
            currentMatches: model.matches, previousMatches: previous.models[version].matches,
          }]));
        return [`days${days}`, { ...current, previous, changes }];
      })) }];
  }));
  const readiness = Object.fromEntries(sports.map((sport) => [sport, {
    sourcesResearched: true,
    historicalData: ({ football: "season_results", basketball: "limited_verified_results", hockey: "limited_verified_results",
      tennis: "singles_tours", volleyball: "two_verified_protocols", cs2: "two_verified_series",
      dota2: "two_verified_series_and_map_archive" })[sport],
    modelImplemented: true,
    historicalValidation: ["football", "tennis"].includes(sport),
    calibrationMeasuredOnHoldout: ["football", "tennis"].includes(sport),
    calibrationVerified: false,
    readyForLimitedValidation: false,
    evidence: ["football", "tennis"].includes(sport) ? "SPORTS_ENGINE_AUDIT.md" :
      "SPORTS_ENGINE_AUDIT.md: limited source evidence, no independent model test",
  }]));
  const requestHistory = runs.flatMap(({ requests }) => requests ?? []);
  return { asOf, mode: runs.at(-1)?.mode ?? null, runs: runs.length,
    firstCaptureAt: runs[0]?.at ?? null, lastCaptureAt: runs.at(-1)?.at ?? null,
    sourceRequests: runs.at(-1)?.requests ?? [], sourceHistory: Object.fromEntries(
      [...Map.groupBy(requestHistory, (row) => row.source)].map(([source, rows]) => [source, counts(rows, (row) => row.status)])),
    history: runs.at(-1)?.history ?? null,
    readiness, bySport, records };
}

export function researchMarkdown(report) {
  const lines = ["# Исследовательская диагностика", "",
    `Режим — ${report.mode ?? "снимков нет"}. Прогонов — ${report.runs}. Дата отчёта — ${new Date(report.asOf).toISOString()}.`,
    "", "## Источники последнего прогона", ""];
  for (const [source, rows] of Map.groupBy(report.sourceRequests, (row) => row.source)) {
    const statuses = Object.entries(counts(rows, (row) => row.status)).map(([status, n]) => `${status} ${n}`);
    lines.push(`- ${source} — ${statuses.join(", ")}.`);
  }
  if (!report.sourceRequests.length) lines.push("Запросы пока отсутствуют.");
  for (const [label, key] of [["Накопленные наблюдения", "all"], ["Последние 7 дней", "days7"], ["Последние 30 дней", "days30"]]) {
    lines.push("", `## ${label}`, "");
    if (key !== "all" && !report.bySport.football[key].completeWindow) lines.push("Есть пропуски в ежедневных снимках.", "");
    lines.push("| Спорт | Найдено | Подтверждено | С историей | С оценкой | Оценок с исходом |",
      "| --- | ---: | ---: | ---: | ---: | ---: |");
    for (const [sport, entry] of Object.entries(report.bySport)) {
      const row = entry[key];
      lines.push(`| ${sport} | ${row.detected} | ${row.confirmed} | ${row.historyAvailable} | ${row.predicted} | ${row.scoredEvents} |`);
    }
    const models = Object.entries(report.bySport).flatMap(([sport, data]) =>
      Object.entries(data[key].models).map(([version, row]) =>
        `- ${sport}, ${version} — Brier ${row.brier.toFixed(4)}, Log Loss ${row.logLoss.toFixed(4)}, событий ${row.matches}.`));
    lines.push("", ...(models.length ? models : ["Данных для оценки качества моделей пока нет."]));
    if (key === "all") {
      const missing = Object.entries(report.bySport).flatMap(([sport, data]) => Object.keys(data.all.skipped).length ?
        [`- ${sport} — ${Object.entries(data.all.skipped).map(([reason, n]) => `${reason} (${n})`).join(", ")}.`] : []);
      if (missing.length) lines.push("", "Причины пропусков:", "", ...missing);
    }
  }
  return lines.join("\n");
}
