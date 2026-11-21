import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { historicalLeagues, parseEnglishSeason, parseOpenFootballSeason, summarizeEvaluation, walkForward } from "./sports-evaluation.mjs";
import { MODEL_VERSION } from "./sports-models.mjs";

const root = fileURLToPath(new URL("../.sports-update", import.meta.url));
const provider = process.argv[2] || "--football-data";
if (!["--football-data", "--openfootball"].includes(provider)) throw new Error("Выберите --football-data или --openfootball");
const open = provider === "--openfootball";
const cache = join(root, open ? "openfootball" : "football-data");
const openLeagues = { "en.1": "professional_major", "en.2": "professional_mid", "en.3": "lower_division", "en.4": "lower_division",
  "de.2": "professional_mid", "de.3": "lower_division", "es.2": "professional_mid" };
const divisions = Object.keys(open ? openLeagues : historicalLeagues);
const seasons = ["2223", "2324", "2425", "2526"];
const testFrom = Date.parse("2024-07-01");

async function loadSeason(division, season) {
  const path = join(cache, `${season}-${division}.${open ? "json" : "csv"}`);
  const formatted = `20${season.slice(0, 2)}-${season.slice(2)}`;
  const url = open ? `https://raw.githubusercontent.com/openfootball/football.json/master/${formatted}/${division}.json` :
    `https://www.football-data.co.uk/mmz4281/${season}/${division}.csv`;
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
  const parsed = open ? { events: parseOpenFootballSeason(JSON.parse(data), division, openLeagues[division], season),
    sha256: createHash("sha256").update(data).digest("hex") } : parseEnglishSeason(data, division, season);
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
  input: sources.map(({ division, season, url, sha256, status, error, events }) =>
    ({ division, season, url, sha256, status, error, matches: events.length })),
  summary: summarizeEvaluation(evaluation), bySport: grouped("sport"), byDivision: grouped("competition"),
  byLevel: grouped("level"), bySeason: grouped("period"),
  method: {
    scores: `${provider.slice(2)} published final scores on historical calendar dates with a two-calendar-day embargo. Historical feed snapshots are unavailable.`,
    benchmark: open ? "Market prices unavailable; fixed comparison is 45% home / 25% draw / 30% away." :
      "Average pre-match bookmaker odds converted to implied probabilities and normalized across all three outcomes.",
    legacy: "Reconstructed winner form rule on the last two or three eligible results, not a replay of the full publishing pipeline.",
    missing: "Other sports and regional or amateur cohorts have no test dataset in this run.",
  },
};
const run = join(root, `backtest-${new Date().toISOString().replace(/[:.]/g, "-")}`);
await mkdir(run);
await writeFile(join(run, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ path: run, matches: evaluation.length, statistical: report.summary.modelsOnly.statistical?.matches,
  market: report.summary.paired.market?.matches ?? 0, failed: sources.filter((source) => source.status).map(({ division, season, status }) =>
    ({ division, season, status })) }));
if (!report.summary.modelsOnly.statistical) process.exitCode = 2;
