import { evaluateProbabilities } from "./sports-evaluation.mjs";
import { pairedWeekInterval } from "./sports-model-comparison.mjs";
import { normalizeIdentity } from "./sports-discovery.mjs";
import { adaptiveThresholds, centralRange, evaluateScoreDistribution, scoreDistributions, scoreForecastTest, scoreMeasures }
  from "./sports-score-distribution.mjs";

const DAY = 86_400_000;
const PERIODS = [Date.parse("2025-10-01"), Date.parse("2026-02-01")];
const leagues = new Set(["eng1", "eng2", "eng3", "eng4", "deu2", "deu3", "esp2", "deu4b", "deu4n", "deu4e", "nhl", "nba"]);
const sum = (values) => values.reduce((a, b) => a + b, 0);
const average = (values) => sum(values) / values.length;
const binary = (predicate) => (a, b) => predicate(a, b) ? "yes" : "no";
const outcome = (a, b) => a > b ? "home" : a < b ? "away" : "draw";
const series = new Set(["cs2", "dota2"]);

export function projectionTargets(event) {
  const { sport, rules } = event;
  const draw = sport === "football" || sport === "dota2" && rules === "BO2";
  const targets = [{ id: "outcome", title: "Исход матча", keys: draw ? ["home", "draw", "away"] : ["home", "away"], actual: outcome }];
  const total = { football: 3, hockey: 6, basketball: 220, tennis: 3, volleyball: 5, cs2: rules === "BO5" ? 4 : 3,
    dota2: rules === "BO5" ? 4 : 3 }[sport];
  const gap = { football: 2, hockey: 2, basketball: 10, volleyball: 2, cs2: 2, dota2: 2 }[sport];
  const individual = { football: 2, hockey: 3, basketball: 110 }[sport];
  const unit = (value) => {
    const few = [2, 3, 4].includes(value % 10) && ![12, 13, 14].includes(value % 100);
    return { football: few ? "гола" : "голов", hockey: few ? "шайбы" : "шайб",
      basketball: few ? "очка" : "очков", tennis: few ? "сета" : "сетов", volleyball: few ? "сета" : "сетов",
      cs2: few ? "карты" : "карт", dota2: few ? "карты" : "карт" }[sport];
  };
  const add = (id, title, predicate) => targets.push({ id, title, actual: binary(predicate), keys: ["yes", "no"] });
  if (total && !(series.has(sport) && !["BO3", "BO5"].includes(rules))) add("total", `Суммарно ${total} ${unit(total)} или больше`, (a, b) => a + b >= total);
  if (gap) add("margin", `Разница ${gap} ${unit(gap)} или больше`, (a, b) => Math.abs(a - b) >= gap);
  if (individual) add("home_score", `Первая команда ${sport === "basketball" ? "наберёт" : "забьёт"} ${individual} ${unit(individual)} или больше`,
    (a) => a >= individual);
  return targets;
}

const cohortKey = ({ sport, competition, rules }) => JSON.stringify([sport, competition, rules || null]);
const clean = (event) => event.id && event.competition && event.home && event.away && event.home !== event.away &&
  Number.isFinite(event.start) && Array.isArray(event.score) && event.score.length === 2 &&
  event.score.every((value) => Number.isSafeInteger(value) && value >= 0) &&
  (!["basketball", "hockey", "tennis", "volleyball", "cs2"].includes(event.sport) || event.score[0] !== event.score[1]);

export function prepareProjectionHistory(rows, archived, now) {
  const replaced = new Set(archived.map(cohortKey));
  const eligible = rows.filter((row) => !replaced.has(cohortKey(row)));
  return [...new Map([...eligible, ...archived].filter((row) => clean(row) && row.observedAt <= now && row.start + 2 * DAY <= now)
    .map((row) => [row.id, { ...row, home: normalizeIdentity(row.home), away: normalizeIdentity(row.away) }]))
    .values()].sort((a, b) => a.start - b.start);
}

function distributions(event, past, before, includeContext = false) {
  const league = past.filter((row) => row.start >= before - 540 * DAY).slice(-520);
  if (league.length < 45) return null;
  const teamRows = [event.home, event.away].map((name) => league.filter((row) => row.home === name || row.away === name).slice(-36)
    .map((row) => row.home === name ? row.score : row.score.slice().reverse()));
  if (teamRows.some((rows) => rows.length < 8)) return null;
  const [homeMean, awayMean] = [0, 1].map((side) => average(league.map((row) => row.score[side])));
  const mean = (homeMean + awayMean) / 2;
  const adjusted = (rows, side) => (sum(rows.map((score) => score[side])) + 10 * mean) / (rows.length + 10) - mean;
  const offsets = teamRows.map((rows, i) => (adjusted(rows, 0) + adjusted(teamRows[1 - i], 1)) / 2);
  // Scores in a BO series are discrete and constrained by the format. Use
  // the archive inventory for these groups until a dedicated model is tested.
  if (!["football", "hockey", "basketball"].includes(event.sport)) return null;
  const rawScores = league.map(({ score: [a, b] }) => [a, b, 1]);
  const shifts = offsets.map((value) => {
    const floor = Math.floor(value);
    return [[floor, 1 - (value - floor)], [floor + 1, value - floor]];
  });
  const projected = rawScores.flatMap(([a, b]) => shifts[0].flatMap(([da, wa]) =>
    shifts[1].map(([db, wb]) => [Math.max(0, a + da), Math.max(0, b + db), wa * wb])))
    .filter(([a, b, weight]) => weight > 0 && (event.sport === "football" || a !== b));
  if (sum(projected.map(([, , weight]) => weight)) < 40) return null;
  const pointTargets = [
    { id: "expected_total", title: "Ожидаемый общий счёт", actual: ([a, b]) => a + b },
    { id: "expected_margin", title: "Ожидаемая разница (первая минус вторая команда)", actual: ([a, b]) => a - b },
  ];
  const weightedAverage = (scores, target) =>
    sum(scores.map((score) => target.actual(score) * score[2])) / sum(scores.map((score) => score[2]));
  const toProbability = (scores, target) => {
    const frequencies = Object.fromEntries(target.keys.map((key) => [key, 1]));
    for (const [a, b, weight] of scores) frequencies[target.actual(a, b)] += weight;
    const total = sum(Object.values(frequencies));
    return Object.fromEntries(target.keys.map((key) => [key, frequencies[key] / total]));
  };
  const context = [];
  if (includeContext && event.sport === "football") {
    const sides = event.match?.split(/\s+[—–]\s+/) || [event.home, event.away];
    for (const [i, name] of [event.home, event.away].entries()) {
      const venue = league.filter((row) => row.season === event.season && row.homeField === true &&
        (i ? row.away : row.home) === name);
      if (venue.length >= 4) {
        const wins = venue.filter(({ score }) => score[i] > score[1 - i]).length;
        context.push(`${sides[i]} ${i ? "в гостях" : "дома"} в текущем сезоне — ${wins} побед из ${venue.length} игр с подтверждённым полем.`);
      }
      const opponents = new Set(league.filter((row) => row.home === name || row.away === name).slice(-36)
        .map((row) => row.home === name ? row.away : row.home));
      const rates = [...opponents].flatMap((opponent) => {
        const games = league.filter((row) => (row.home === opponent && row.away !== name) ||
          (row.away === opponent && row.home !== name));
        return games.length < 5 ? [] : [games.filter((row) => row.home === opponent ?
          row.score[0] > row.score[1] : row.score[1] > row.score[0]).length / games.length];
      });
      if (rates.length >= 3) context.push(`Соперники «${sides[i]}» в среднем выиграли ${Math.round(average(rates) * 100)}% своих матчей в выборке лиги. Учтено ${rates.length} команд без игр против «${sides[i]}».`);
    }
    context.push(`В исторической выборке лиги — ${league.filter(({ score: [a, b] }) => a === b).length} ничьих из ${league.length} матчей.`);
  }
  return { samples: teamRows.map((rows) => rows.length), scores: league.length,
    form: teamRows.map((rows) => ({ scored: average(rows.map(([scored]) => scored)), allowed: average(rows.map(([, allowed]) => allowed)),
      wins: rows.filter(([a, b]) => a > b).length, draws: rows.filter(([a, b]) => a === b).length })),
    context, trainingIds: league.map((row) => row.id), scoreRows: { model: projected, baseline: rawScores, recent: rawScores.slice(-60) },
    points: pointTargets.map((target) => ({ target, model: weightedAverage(projected, target),
      baseline: weightedAverage(rawScores, target), recent: weightedAverage(rawScores.slice(-60), target) })),
    targets: projectionTargets(event).map((target) => ({ target,
      baseline: toProbability(rawScores, target),
      recent: toProbability(rawScores.slice(-60), target),
      model: toProbability(projected, target) })),
    sources: [...new Map(league.flatMap((row) => row.sources ?? []).map((item) => [item.title, item])).values()] };
}

const brier = (actual, p) => sum(Object.entries(p).map(([key, value]) => (value - Number(actual === key)) ** 2));
const ece = (metric) => sum(metric.reliability.map((bin) => bin.count * Math.abs(bin.predicted - bin.actual))) /
  sum(metric.reliability.map((bin) => bin.count));

export function evaluateProjections(history, pointChecks = [], distributionChecks) {
  const cohorts = Map.groupBy(history, cohortKey);
  const checks = [];
  for (const [key, source] of cohorts) {
    const rows = [...source].sort((a, b) => a.start - b.start);
    const test = rows.filter((row) => row.start >= PERIODS[0]);
    const byTarget = new Map(projectionTargets(rows[0]).map(({ id, title }) => [id, { id, title, predictions: [] }]));
    const byPoint = new Map();
    const distributionRows = distributionChecks && Object.fromEntries(Object.keys(scoreMeasures).map((id) => [id, []]));
    let cursor = 0;
    for (const event of test) {
      // In retrospective data, final scores become eligible two days after
      // their start. In live use, observedAt is checked independently.
      while (cursor < rows.length && rows[cursor].start + 2 * DAY <= event.start) cursor++;
      const estimate = distributions(event, rows.slice(0, cursor), event.start);
      for (const { target, baseline, recent, model } of estimate?.targets ?? []) {
        byTarget.get(target.id).predictions.push({ start: event.start, actual: target.actual(...event.score), baseline, recent, model });
      }
      for (const { target, baseline, recent, model } of estimate?.points ?? []) {
        if (!byPoint.has(target.id)) byPoint.set(target.id, { title: target.title, predictions: [] });
        byPoint.get(target.id).predictions.push({ start: event.start, actual: target.actual(event.score), baseline, recent, model });
      }
      if (distributionRows && estimate) {
        const models = Object.fromEntries(Object.entries(estimate.scoreRows).map(([name, rows]) => [name, scoreDistributions(rows)]));
        for (const [id, measure] of Object.entries(scoreMeasures)) {
          const family = Object.fromEntries(Object.entries(models).map(([name, forecasts]) => [name, forecasts[id]]));
          distributionRows[id].push(scoreForecastTest(family, measure.actual(event.score), event.start));
        }
      }
    }
    for (const { id, title, predictions } of byTarget.values()) {
      const metrics = (sample, kind) => {
        const evaluation = evaluateProbabilities(sample.map((row) => ({ actual: row.actual, probabilities: row[kind] })));
        return evaluation && { ...evaluation, ece: ece(evaluation) };
      };
      const periods = [predictions.filter((row) => row.start < PERIODS[1]), predictions.filter((row) => row.start >= PERIODS[1])]
        .map((sample) => ({ n: sample.length, model: metrics(sample, "model"), baseline: metrics(sample, "baseline") }));
      const interval = pairedWeekInterval(predictions, "model", brier, "baseline");
      const model = metrics(predictions, "model");
      const baseline = metrics(predictions, "baseline");
      const scope = leagues.has(rows[0].competition);
      const approved = Boolean(scope && model && predictions.length >= 150 && periods.every((p) => p.n >= 40 &&
        p.model.brier <= p.baseline.brier && p.model.logLoss <= p.baseline.logLoss && p.model.ece <= 0.09) &&
        interval.high < 0 && interval.high != null && model.ece <= 0.075);
      checks.push({ key, sport: rows[0].sport, competition: rows[0].competition, rules: rows[0].rules ?? null,
        id, title, available: test.length, paired: predictions.length, periods, model, baseline,
        recent: metrics(predictions, "recent"), interval, approved });
    }
    const absolute = (actual, predicted) => Math.abs(actual - predicted);
    for (const [id, { title, predictions }] of byPoint) {
      const summarize = (rows) => ({ n: rows.length, ...Object.fromEntries(["model", "baseline", "recent"].map((kind) => [
        kind, rows.length ? average(rows.map((row) => absolute(row.actual, row[kind]))) : null,
      ])) });
      const periods = [predictions.filter((row) => row.start < PERIODS[1]), predictions.filter((row) => row.start >= PERIODS[1])].map(summarize);
      const interval = pairedWeekInterval(predictions, "model", absolute, "baseline");
      pointChecks.push({ key, sport: rows[0].sport, competition: rows[0].competition, id, title, available: test.length,
        ...summarize(predictions), periods, interval,
        approved: leagues.has(rows[0].competition) && predictions.length >= 150 && interval.high != null && interval.high < 0 &&
          periods.every((p) => p.n >= 40 && p.model < p.baseline && p.model <= p.recent) });
    }
    if (distributionRows) for (const [id, rows] of Object.entries(distributionRows)) {
      distributionChecks.push({ key, sport: source[0].sport, competition: source[0].competition,
        id, title: scoreMeasures[id].title, available: test.length,
        ...evaluateScoreDistribution(rows, PERIODS[1], leagues.has(source[0].competition)) });
    }
  }
  return checks;
}

export function assessUpcomingProjection(event, history, checks, now, pointChecks = [], distributionChecks) {
  const key = cohortKey(event);
  const approved = new Set(checks.filter((row) => row.key === key && row.approved).map((row) => row.id));
  const validated = distributionChecks?.filter((row) => row.key === key && row.approved) ?? [];
  const outcomeAllowed = approved.has("outcome");
  if (event.start <= now + 10 * 60_000) return { reason: "start_buffer" };
  if (event.verificationReason || event.dataQuality?.identityConflict ||
      !["confirmed", "official"].includes(event.status) && event.sourceTier !== "official") return { reason: "identity_or_schedule" };
  if (event.sport === "hockey" && !event.sources?.some((source) => source.title === "NHL" &&
    source.reportedStatus === "scheduled" && source.reportedStart === event.start)) return { reason: "identity_or_schedule" };
  const cohort = history.filter((row) => cohortKey(row) === key && row.observedAt <= now &&
    row.start + 2 * DAY <= now && row.start >= now - 540 * DAY).slice(-520);
  if (distributionChecks ? !outcomeAllowed && !validated.length : !approved.size) {
    return { reason: "no_verified_cohort_model", cohortResults: cohort.length };
  }
  const home = normalizeIdentity(event.home), away = normalizeIdentity(event.away);
  const available = [home, away].map((name) => cohort.filter((row) => row.home === name || row.away === name).length);
  const estimate = distributions({ ...event, home, away }, cohort, now, true);
  if (!estimate) return { reason: "insufficient_current_sample", available, cohortResults: cohort.length };
  const targets = estimate.targets.filter(({ target }) => approved.has(target.id) && (!distributionChecks || target.id === "outcome")).map(({ target, model }) =>
    ({ id: target.id, title: target.title, probabilities: model }));
  const verifiedPoints = new Set(pointChecks.filter((row) => row.key === key && row.approved).map((row) => row.id));
  const points = estimate.points.filter(({ target }) => verifiedPoints.has(target.id))
    .map(({ target, model }) => ({ id: target.id, title: target.title, value: model }));
  const forecasts = distributionChecks ? scoreDistributions(estimate.scoreRows.model) : {};
  const distributionsByMeasure = validated.map((benchmark) => {
    const forecast = forecasts[benchmark.id];
    return { id: benchmark.id, mean: forecast.mean, range: centralRange(forecast), support: forecast.support,
      thresholds: benchmark.thresholds.approved ? adaptiveThresholds(forecast) : [] };
  });
  return { projection: { targets, points, distributions: distributionsByMeasure,
    samples: estimate.samples, scores: estimate.scores, sources: estimate.sources,
    form: estimate.form, context: estimate.context, trainingIds: estimate.trainingIds }, available, cohortResults: cohort.length };
}

export function upcomingProjection(event, history, checks, now, pointChecks = []) {
  return assessUpcomingProjection(event, history, checks, now, pointChecks).projection ?? null;
}
