import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { historicalLeagues, parseEnglishSeason, parseOpenFootballSeason, summarizeEvaluation, walkForward } from "./sports-evaluation.mjs";
import { MODEL_VERSION } from "./sports-models.mjs";
import { compareFootballModels, compareSparseModel } from "./sports-model-comparison.mjs";
import { indexedOpenFootballUrl } from "./sports-openfootball.mjs";

const root = fileURLToPath(new URL("../.sports-update", import.meta.url));
const provider = process.argv[2] || "--openfootball";
if (!["--market-dir", "--openfootball"].includes(provider) || provider === "--market-dir" && !process.argv[3]) {
  throw new Error("Выберите --openfootball или --market-dir <каталог с разрешёнными CSV>");
}
const open = provider === "--openfootball";
const cache = join(root, "openfootball-v2");
const openLeagues = { "en.1": "professional_major", "en.2": "professional_mid", "en.3": "lower_division", "en.4": "lower_division",
  "en.5": "lower_division", "de.2": "professional_mid", "de.3": "lower_division", "es.2": "professional_mid",
  "de.4b": "regional", "de.4n": "regional", "de.4e": "regional", "de.4s": "regional", "de.4w": "regional" };
const divisions = Object.keys(open ? openLeagues : historicalLeagues);
const seasons = ["2223", "2324", "2425", "2526"];
const testFrom = Date.parse("2024-07-01");
const holdoutFrom = Date.parse("2025-07-01");

async function loadSeason(division, season) {
  if (!open) {
    const file = `${season}-${division}.csv`;
    try {
      return { ...parseEnglishSeason(await readFile(join(process.argv[3], file), "utf8"), division, season), division, season, file };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { division, season, file, status: "local_file_missing", events: [] };
    }
  }
  if (division.startsWith("de.4") && season !== "2425") return { division, season, status: "not_in_publisher_index", events: [] };
  const path = join(cache, `${season}-${division}.json`);
  const formatted = `20${season.slice(0, 2)}-${season.slice(2)}`;
  const url = indexedOpenFootballUrl(division, formatted);
  let data;
  try {
    data = await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return { division, season, url, status: response.status, events: [] };
      data = await response.text();
    } catch (networkError) {
      return { division, season, url, status: "unavailable", error: networkError.message, events: [] };
    }
  }
  const parsed = { events: parseOpenFootballSeason(JSON.parse(data), division, openLeagues[division], season),
    sha256: createHash("sha256").update(data).digest("hex") };
  if (!parsed.events.length) throw new Error(`Нет результатов: ${season} ${division}`);
  await writeFile(path, data, { flag: "wx" }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  return { ...parsed, division, season, url };
}

await mkdir(cache, { recursive: true });
const sources = [];
for (const season of seasons) {
  for (const division of divisions) sources.push(await loadSeason(division, season));
}
const evaluation = walkForward(sources.flatMap((source) => source.events), testFrom);
const grouped = (key) => Object.fromEntries([...Map.groupBy(evaluation, (row) => row[key])]
  .map(([label, rows]) => [label, summarizeEvaluation(rows)]));
const report = {
  model: MODEL_VERSION,
  testFrom: new Date(testFrom).toISOString(),
  input: sources.map(({ division, season, url, file, sha256, status, error, events }) =>
    ({ division, season, url, file, sha256, status, error, matches: events.length })),
  summary: summarizeEvaluation(evaluation), bySport: grouped("sport"), byDivision: grouped("competition"),
  byLevel: grouped("level"), bySeason: grouped("period"),
  modelComparison: compareFootballModels(evaluation.filter((row) => row.level !== "regional"), holdoutFrom),
  regionalComparison: compareFootballModels(evaluation.filter((row) => row.level === "regional"), Date.parse("2025-01-01")),
  sparseComparison: compareSparseModel(evaluation.filter((row) => row.level !== "regional"), holdoutFrom),
  sparseRegionalComparison: compareSparseModel(evaluation.filter((row) => row.level === "regional"), Date.parse("2025-01-01")),
  method: {
    scores: `${provider.slice(2)} published final scores on historical calendar dates with a two-calendar-day embargo. Historical feed snapshots are unavailable.`,
    benchmark: open ? "Market prices unavailable; fixed comparison is 45% home / 25% draw / 30% away." :
      "Average pre-match bookmaker odds converted to implied probabilities and normalized across all three outcomes.",
    legacy: "Reconstructed winner form rule on the last two or three eligible results, not a replay of the full publishing pipeline.",
    missing: "Other sports and amateur cohorts have no test dataset in this run. Regional results have a separate single-season split.",
  },
};
const run = join(root, `backtest-${new Date().toISOString().replace(/[:.]/g, "-")}`);
await mkdir(run);
await writeFile(join(run, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ path: run, matches: evaluation.length, statistical: report.summary.modelsOnly.statistical?.matches,
  market: report.summary.paired.market?.matches ?? 0, failed: sources.filter((source) => source.status).map(({ division, season, status }) =>
    ({ division, season, status })) }));
if (!report.summary.modelsOnly.statistical) process.exitCode = 2;
