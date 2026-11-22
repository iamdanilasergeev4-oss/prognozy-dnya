import { createHash } from "node:crypto";
import { access, link, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeIdentity } from "./sports-discovery.mjs";
import { evaluateProbabilities } from "./sports-evaluation.mjs";
import { projectionTargets } from "./sports-projections.mjs";
import { scoreMeasures } from "./sports-score-distribution.mjs";
import { storeResearchObject } from "./sports-research-ledger.mjs";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const day = 86_400_000;
const read = (file) => readFile(file, "utf8").then(JSON.parse);
async function immutable(root, file, record) {
  try {
    await access(file);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const bytes = await storeResearchObject(root, "objects", record);
  try {
    await link(join(root, "objects", `${bytes}.json`), file);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}

export function verifiedForecastResult(entry, history, now) {
  const candidates = history.filter((row) => row.sport === entry.sport && row.competition === entry.competition &&
    row.season === entry.season && (row.rules || null) === entry.rules &&
    row.home === normalizeIdentity(entry.home) && row.away === normalizeIdentity(entry.away) &&
    row.start === entry.start && row.start + day <= now && row.observedAt <= now &&
    Array.isArray(row.score) && row.score.length === 2 && row.sources?.some((source) => entry.schedule.some((claim) =>
      claim.title === source.title && String(claim.id) === String(source.id))) &&
    (["official", "independent", "corroborated_unknown_origin"].includes(row.tier) ||
      row.sport === "hockey" && row.competition === "nhl" && row.sources?.some((source) => source.title === "NHL" &&
        URL.parse(source.url)?.hostname === "www.nhl.com")));
  if (!candidates.length || new Set(candidates.map((row) => JSON.stringify(row.score))).size !== 1) return null;
  const best = candidates.find((row) => row.tier === "official") || candidates[0];
  return { checkedAt: now, observedAt: best.observedAt, score: best.score, id: best.id, sources: best.sources };
}

export async function recordForecastPreview(root, forecasts, history, now, model) {
  const trial = join(root, "forecast");
  const results = join(root, "result");
  await Promise.all([mkdir(trial, { recursive: true }), mkdir(results, { recursive: true })]);
  for (const f of forecasts) {
    const { event, targets, points, distributions, trainingIds, sources } = f;
    const schedule = event.sources.map(({ id, title, url }) => ({ id, title, url }));
    const stableId = schedule.find(({ id, title }) => id != null && ["ESPN", "NHL", "OpenLigaDB"].includes(title)) ||
      schedule.find(({ id }) => id != null);
    if (!stableId) continue;
    const id = hash([model, event.sport, event.competition, stableId.title, stableId.id]);
    await immutable(root, join(trial, `${id}.json`), {
      id, model, generatedAt: now, sport: event.sport, competition: event.competition, season: event.season,
      rules: event.rules || null, home: event.home, away: event.away, match: event.match, start: event.start,
      targets, points, distributions, trainingIds, sources, schedule, publication: "preview",
    });
  }
  const names = (await readdir(trial)).filter((name) => /^[0-9a-f]{64}\.json$/.test(name));
  const entries = await Promise.all(names.map((name) => read(join(trial, name))));
  for (const entry of entries.filter((item) => item.start + day <= now)) {
    const result = verifiedForecastResult(entry, history, now);
    if (result) await immutable(root, join(results, `${entry.id}.json`), { forecastId: entry.id, status: "verified", ...result });
  }
  const observed = await Promise.all(entries.map(async (entry) => ({
    ...entry, result: await read(join(results, `${entry.id}.json`)).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    }), status: entry.start + day > now ? "pending" : "awaiting_verified_result",
  })));
  const settled = observed.filter((entry) => entry.result);
  const comparisons = settled.flatMap((entry) => {
    const targets = projectionTargets(entry);
    const outcomes = entry.targets.flatMap(({ id, probabilities }) => {
      const target = targets.find((definition) => definition.id === id);
      return target ? [{ group: [entry.model, entry.sport, entry.competition, id].join("/"),
        actual: target.actual(...entry.result.score), probabilities }] : [];
    });
    const bands = (entry.distributions || []).flatMap(({ id, range, thresholds }) => {
      const measure = scoreMeasures[id];
      if (!measure) return [];
      const actual = measure.actual(entry.result.score);
      const make = (suffix, event, probability) => ({ group: [entry.model, entry.sport, entry.competition, suffix].join("/"),
        actual: event ? "yes" : "no", probabilities: { yes: probability, no: 1 - probability } });
      return [make(`distribution_${id}`, actual >= range.low && actual <= range.high, range.probability),
        ...thresholds.map(({ value, probability }) => make(`threshold_${id}`, actual >= value, probability))];
    });
    return [...outcomes, ...bands];
  });
  return { entries: observed.length, settled: settled.length,
    pending: observed.filter((entry) => !entry.result && entry.status === "pending").length,
    awaiting: observed.filter((entry) => !entry.result && entry.status === "awaiting_verified_result").length,
    metrics: Object.fromEntries([...Map.groupBy(comparisons, (item) => item.group)].map(([key, rows]) =>
      [key, { matches: rows.length, metrics: rows.length >= 20 ? evaluateProbabilities(rows) : null }])),
    results: settled.map(({ match, sport, generatedAt, model, targets, result }) => ({ match, sport, generatedAt, model, targets, result })) };
}
