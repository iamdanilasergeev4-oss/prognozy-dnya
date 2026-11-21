import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateProbabilities } from "./sports-evaluation.mjs";
import { pairedWeekInterval } from "./sports-model-comparison.mjs";
import { createOutcomeModel } from "./sports-models.mjs";
import { DAY } from "./sports-research-history.mjs";
import { tennisSingles } from "./sports-historical-inputs.mjs";

const binary = (home) => ({ home, away: 1 - home });
const cutoffDays = 7;
const probability = (difference) => binary(1 / (1 + Math.exp(-difference)));
const controls = ["uniform", "tourRank", "winRate", "allSurfaceElo"];
const loss = {
  accuracy: (actual, p) => Number(actual === (p.home >= p.away ? "home" : "away")),
  brier: (actual, p) => 2 * (p.home - Number(actual === "home")) ** 2,
  logLoss: (actual, p) => -Math.log(p[actual]),
};

export function rankingIndex(csv) {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  if (!/^ranking_date,(?:ranking|rank),(?:player_id|player),/.test(header)) throw new Error("Invalid ranking CSV");
  const players = new Map();
  for (const line of lines) {
    const [date, rank, player] = line.split(",");
    if (!/^\d{8}$/.test(date) || !/^\d+$/.test(rank) || !/^\d+$/.test(player) || Number(rank) < 1) continue;
    const iso = date.replace(/^(\d{4})(\d\d)(\d\d)$/, "$1-$2-$3");
    const time = Date.parse(iso);
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== iso) continue;
    if (!players.has(player)) players.set(player, new Map());
    const dates = players.get(player);
    const value = Number(rank);
    dates.set(time, dates.has(time) && dates.get(time) !== value ? null : value);
  }
  return new Map([...players].map(([player, dates]) => [player, [...dates].sort((a, b) => b[0] - a[0])]));
}

export function rankBefore(index, player, cutoff) {
  const entry = index.get(player)?.find(([time]) => time < cutoff);
  return entry && entry[0] >= cutoff - 28 * DAY ? entry[1] : null;
}

const cohort = (event, allSurfaces = false) => ({
  ...event, competition: event.tour, season: "longitudinal",
  rules: allSurfaces ? event.rules.replace(event.surface, "all") : event.rules,
});
const appearanceKey = (event, player) => JSON.stringify([event.tour, event.rules, player]);
const formKey = (event, player) => JSON.stringify([event.tour, player]);

export function tennisAudit(events, rankings, testFrom, testUntil) {
  if (new Set(events.map(({ id }) => id)).size !== events.length) throw new Error("Duplicate tennis match ID");
  const history = [...events].sort((a, b) => a.available - b.available || a.id.localeCompare(b.id));
  const targets = events.filter(({ start }) => start >= testFrom && start < testUntil).sort((a, b) => a.start - b.start);
  const surfaceElo = createOutcomeModel();
  const allElo = createOutcomeModel();
  const appearances = new Map();
  const form = new Map();
  let next = 0;
  return targets.map((event) => {
    const cutoff = event.start - cutoffDays * DAY;
    while (next < history.length && history[next].available < cutoff) {
      const past = history[next++];
      const observed = { ...past, start: past.available };
      surfaceElo.observe(cohort(observed));
      allElo.observe(cohort(observed, true));
      for (const [side, player] of [past.home, past.away].entries()) {
        const key = appearanceKey(past, player);
        appearances.set(key, { count: (appearances.get(key)?.count ?? 0) + 1, time: observed.start });
        const formId = formKey(past, player);
        const games = form.get(formId) ?? [];
        form.set(formId, [...games.slice(-19), { time: observed.start, win: Number(past.score[side] > past.score[1 - side]) }]);
      }
    }
    const target = { ...event, start: cutoff };
    const participants = [event.home, event.away];
    const samples = participants.map((player) => appearances.get(appearanceKey(event, player)));
    const ranks = participants.map((player) => rankBefore(rankings.get(event.tour), player, cutoff));
    const rates = participants.map((player) => {
      const recent = (form.get(formKey(event, player)) ?? []).filter(({ time }) => time >= cutoff - 180 * DAY);
      return recent.length >= 4 ? (2 + recent.reduce((sum, game) => sum + game.win, 0)) / (4 + recent.length) : null;
    });
    const candidate = surfaceElo.predict(cohort(target))?.probabilities;
    return { id: event.id, start: event.start, cutoff, tour: event.tour, level: event.level, surface: event.surface,
      actual: event.score[0] > event.score[1] ? "home" : "away", candidate, uniform: binary(0.5),
      allSurfaceElo: allElo.predict(cohort(target, true))?.probabilities,
      tourRank: ranks.every((rank) => rank != null) ? probability(0.5 * Math.log(ranks[1] / ranks[0])) : null,
      winRate: rates.every((rate) => rate != null) ? probability(Math.log(
        rates[0] * (1 - rates[1]) / (rates[1] * (1 - rates[0])))) : null,
      missing: candidate ? null : samples.some((sample) => !sample) ? "no_prior_cohort_history" :
        samples.some((sample) => sample.count < 4) ? "fewer_than_four" : "last_observation_older_than_60_days" };
  });
}

function summarize(rows) {
  const metrics = (sample, model) => {
    const result = evaluateProbabilities(sample.map((row) =>
      ({ actual: row.actual, probabilities: row[model] })));
    return result && { ...result, calibrationError: result.reliability.reduce((sum, bin) =>
      sum + bin.count * Math.abs(bin.predicted - bin.actual), 0) / (sample.length * 2) };
  };
  const models = ["candidate", ...controls];
  return { eligible: rows.length,
    coverage: Object.fromEntries(models.map((model) => [model, rows.filter((row) => row[model]).length])),
    missing: Object.fromEntries([...Map.groupBy(rows.filter((row) => row.missing), (row) => row.missing)]
      .map(([reason, sample]) => [reason, sample.length])),
    comparisons: Object.fromEntries(controls.map((control) => {
      const paired = rows.filter((row) => row.candidate && row[control]);
      return [control, { candidate: metrics(paired, "candidate"), control: metrics(paired, control),
        difference95: Object.fromEntries(Object.entries(loss).map(([key, metric]) =>
          [key, pairedWeekInterval(paired, "candidate", metric, control)])) }];
    })),
  };
}

export async function auditArchive(directory) {
  const sources = [];
  const read = async (file) => {
    const bytes = await readFile(join(directory, file));
    sources.push({ file, sha256: createHash("sha256").update(bytes).digest("hex") });
    return bytes.toString("utf8");
  };
  const events = [];
  const rankings = new Map();
  let outsideFileYear = 0;
  for (const tour of ["atp", "wta"]) {
    const key = tour.toUpperCase();
    rankings.set(key, rankingIndex(await read(`${tour}/${tour}_rankings_20s.csv`)));
    for (const season of [2022, 2023, 2024, 2025]) {
      const parsed = tennisSingles(await read(`${tour}/${tour}_matches_${season}.csv`), key).filter(Boolean);
      outsideFileYear += parsed.filter((event) => event.season !== String(season)).length;
      events.push(...parsed.filter((event) => event.season === String(season)));
    }
  }
  const periods = Object.fromEntries([2024, 2025].map((year) => {
    const rows = tennisAudit(events, rankings, Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1));
    return [year, { ...summarize(rows), byTour: Object.fromEntries(
      [...Map.groupBy(rows, (row) => row.tour)].map(([tour, sample]) => [tour, summarize(sample)])),
    byTourSurfaceLevel: Object.fromEntries([...Map.groupBy(rows, (row) => JSON.stringify([row.tour, row.surface, row.level]))]
      .map(([group, sample]) => [group, summarize(sample)])) }];
  }));
  return { sources, outsideFileYear, cutoffDays, resultDelayDays: 30, periods };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await auditArchive(process.argv[2]), null, 2));
}
