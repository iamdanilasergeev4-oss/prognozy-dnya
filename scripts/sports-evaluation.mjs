import { createHash } from "node:crypto";
import { createOutcomeModel, MODEL_VERSION } from "./sports-models.mjs";
import { createFootballScoreModel } from "./sports-score-model.mjs";
import { createSparseModel } from "./sports-sparse-model.mjs";

const DAY = 86_400_000;
const outcomes = ["home", "draw", "away"];
const outcome = ([a, b]) => a > b ? "home" : a < b ? "away" : "draw";
const favorite = (probabilities) => Object.keys(probabilities).reduce((a, b) => probabilities[b] > probabilities[a] ? b : a);
const sum = (values) => values.reduce((a, b) => a + b, 0);

export function evaluateProbabilities(rows) {
  if (!rows.length) return null;
  const bins = Array.from({ length: 10 }, (_, i) => ({ from: i / 10, to: (i + 1) / 10, count: 0, predicted: 0, actual: 0 }));
  let brier = 0;
  let logLoss = 0;
  let hits = 0;
  for (const { actual, probabilities } of rows) {
    const entries = Object.entries(probabilities);
    if (!(actual in probabilities) || entries.some(([, p]) => !Number.isFinite(p) || p < 0 || p > 1) ||
      Math.abs(sum(Object.values(probabilities)) - 1) > 1e-8) throw new Error("Некорректное распределение вероятностей");
    const top = favorite(probabilities);
    hits += Number(top === actual);
    brier += sum(entries.map(([key, p]) => (p - Number(actual === key)) ** 2));
    logLoss -= Math.log(Math.max(1e-15, probabilities[actual]));
    for (const [key, p] of entries) {
      const bin = bins[Math.min(9, Math.floor(p * 10))];
      bin.count++;
      bin.predicted += p;
      bin.actual += Number(actual === key);
    }
  }
  return { matches: rows.length, accuracy: hits / rows.length, brier: brier / rows.length,
    logLoss: logLoss / rows.length, reliability: bins.filter((bin) => bin.count).map((bin) => ({ ...bin,
      predicted: bin.predicted / bin.count, actual: bin.actual / bin.count })) };
}

export function walkForward(events, testFrom) {
  const model = createOutcomeModel();
  const scores = createFootballScoreModel();
  const sparse = createSparseModel();
  const sorted = [...events].sort((a, b) => a.start - b.start);
  const rows = [];
  const recentByTeam = new Map();
  let cursor = 0;
  const formKey = (event, team) => JSON.stringify([event.sport, event.competition, team]);
  for (const event of sorted) {
    // Input has the calendar day only. A gap excludes all same-day and
    // previous-day matches from the features, including in the form baseline.
    while (cursor < sorted.length && sorted[cursor].start + 2 * DAY <= event.start) {
      const past = sorted[cursor++];
      if (!model.observe(past)) continue;
      scores.observe(past);
      sparse.observe(past);
      for (const [i, team] of [past.home, past.away].entries()) {
        const key = formKey(past, team);
        recentByTeam.set(key, [...(recentByTeam.get(key) || []).slice(-2),
          { start: past.start, won: past.score[i] > past.score[1 - i] }]);
      }
    }
    if (event.start < testFrom) continue;
    const actual = outcome(event.score);
    const modelPrediction = model.predict(event);
    const recent = [event.home, event.away].map((team) =>
      (recentByTeam.get(formKey(event, team)) || []).filter((game) => event.start - game.start <= 21 * DAY));
    const rates = recent.map((games) => games.length ? games.filter((game) => game.won).length / games.length : 0);
    const side = rates[0] > rates[1] ? 0 : 1;
    const sample = Math.min(...recent.map((games) => games.length));
    const formPick = sample >= 2 && recent[side].filter((game) => game.won).length >= 2 &&
      rates[side] - rates[1 - side] >= (sample === 2 ? 0.5 : 2 / 3) ? ["home", "away"][side] : null;
    rows.push({ id: event.id, start: event.start, actual, formPick, model: modelPrediction?.probabilities,
      scoreModel: scores.predict(event), sparseModel: sparse.predict(event)?.probabilities, market: event.market || null, sport: event.sport,
      competition: event.competition, level: event.level, period: event.season });
  }
  return rows;
}

export function summarizeEvaluation(rows) {
  const modeled = rows.filter((row) => row.model);
  const paired = rows.filter((row) => row.model && row.market);
  const comparable = paired.filter((row) => row.formPick);
  const form = rows.filter((row) => row.formPick);
  const modelAndForm = modeled.filter((row) => row.formPick);
  const accuracy = (sample, pick) => sample.length ? sample.filter((row) => pick(row) === row.actual).length / sample.length : null;
  const pairedMetrics = (sample) => ({
    statistical: evaluateProbabilities(sample.map((row) => ({ actual: row.actual, probabilities: row.model }))),
    market: evaluateProbabilities(sample.map((row) => ({ actual: row.actual, probabilities: row.market }))),
  });
  return {
    eligibleEvents: rows.length, showModel: rows.filter((row) => row.model).length, marketAvailable: rows.filter((row) => row.market).length,
    modelsOnly: {
      statistical: evaluateProbabilities(modeled.map((row) => ({ actual: row.actual, probabilities: row.model }))),
      fixedHomeBaseline: evaluateProbabilities(modeled.map((row) => ({ actual: row.actual,
        probabilities: { home: 0.45, draw: 0.25, away: 0.30 } }))),
    },
    paired: pairedMetrics(paired),
    formProxy: { matches: form.length, accuracy: accuracy(form, (row) => row.formPick) },
    modelAndForm: { matches: modelAndForm.length,
      statisticalAccuracy: accuracy(modelAndForm, (row) => favorite(row.model)),
      formAccuracy: accuracy(modelAndForm, (row) => row.formPick) },
    headToHead: { matches: comparable.length, ...pairedMetrics(comparable),
      formAccuracy: accuracy(comparable, (row) => row.formPick) },
    differentFavorites: paired.length ? paired.filter((row) => favorite(row.model) !== favorite(row.market)).length : null,
  };
}

export const historicalLeagues = { E0: "professional_major", E1: "professional_mid",
  E2: "lower_division", E3: "lower_division" };

export function parseOpenFootballSeason(json, competition, level, season) {
  if (!Array.isArray(json.matches)) throw new Error("Неизвестный формат openfootball");
  const ids = new Set();
  return json.matches.flatMap((match) => {
    const score = Array.isArray(match.score) ? match.score : match.score?.ft;
    if (!score) return [];
    const { date, team1: home, team2: away } = match;
    const start = Date.parse(date);
    const id = JSON.stringify([competition, season, date, home, away]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !Number.isFinite(start) ||
      new Date(start).toISOString().slice(0, 10) !== date || !home || !away || home === away ||
      !Array.isArray(score) || score.length !== 2 || score.some((n) => !Number.isSafeInteger(n) || n < 0) ||
      ids.has(id)) throw new Error("Некорректный или повторяющийся матч openfootball");
    ids.add(id);
    return [{ id, sport: "football", competition, level, season, start, home, away, homeField: true, score }];
  });
}

export function parseCsvRow(line) {
  return [...line.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^",]*))/g)]
    .map((cell) => cell[1]?.replaceAll('""', '"') ?? cell[2]);
}

export function parseEnglishSeason(csv, division, season) {
  if (!historicalLeagues[division] || !/^\d{4}$/.test(season)) throw new Error("Неизвестный дивизион или сезон");
  const [header, ...lines] = csv.replace(/^\ufeff/, "").trim().split(/\r?\n/);
  const headings = parseCsvRow(header);
  const required = ["Div", "Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG", "FTR"];
  if (!required.every((key) => headings.includes(key))) throw new Error("Неизвестный формат Football-Data");
  const used = new Set();
  const events = lines.filter((line) => line.trim()).map((line) => {
    const cells = parseCsvRow(line);
    const value = (name) => cells[headings.indexOf(name)]?.trim();
    const date = value("Date")?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const iso = date ? `${date[3]}-${date[2]}-${date[1]}` : "";
    const start = Date.parse(iso);
    const home = value("HomeTeam");
    const away = value("AwayTeam");
    const scores = [value("FTHG"), value("FTAG")];
    if (value("Div") !== division || !Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== iso ||
      !home || !away || home === away || !scores.every((score) => /^\d+$/.test(score || ""))) throw new Error("Некорректный исторический матч");
    const score = scores.map(Number);
    const id = JSON.stringify([division, season, iso, home, away]);
    if (used.has(id) || ({ H: "home", D: "draw", A: "away" })[value("FTR")] !== outcome(score)) {
      throw new Error("Дубликат или противоречивый результат Football-Data");
    }
    used.add(id);
    const price = ["AvgH", "AvgD", "AvgA"].map((key) => Number(value(key)));
    const weights = price.every((p) => Number.isFinite(p) && p > 1) ? price.map((p) => 1 / p) : null;
    const market = weights ? Object.fromEntries(outcomes.map((key, i) => [key, weights[i] / sum(weights)])) : null;
    return { id, sport: "football", competition: division, season, level: historicalLeagues[division],
      home, away, start, homeField: true, score, market };
  });
  if (!events.length) throw new Error("Исторический файл пуст");
  return { events, sha256: createHash("sha256").update(csv).digest("hex") };
}
