import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readResearchSnapshots } from "./sports-research-history.mjs";
import { compareHistory } from "./sports-history-analysis.mjs";

const [checkpointPath, archiveDir, cutoffText, outputPath] = process.argv.slice(2);
const cutoff = Date.parse(cutoffText);
if (!checkpointPath || !archiveDir || !Number.isFinite(cutoff) || !outputPath) {
  throw new Error("Укажите JSON контрольной точки, каталог истории, момент отсечения ISO и путь к новому отчёту");
}
const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
if (Date.parse(checkpoint.checkedAt) > cutoff) throw new Error("Контрольный календарь получен после момента отсечения");
const snapshots = await readResearchSnapshots(archiveDir, cutoff);
const report = compareHistory(checkpoint, snapshots, cutoff);
report.replay = { checkpointAt: checkpoint.checkedAt, cutoff: new Date(cutoff).toISOString() };
await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(resolve(outputPath));
