import { writeFile } from "node:fs/promises";
import { auditCs2Archive } from "./sports-cs2-research.mjs";

const [archive, output, ...extra] = process.argv.slice(2);
const options = {};
for (const flag of extra) {
  const match = flag.match(/^--(metadata-dir|series-review)=(.+)$/);
  if (!match || Object.hasOwn(options, match[1])) throw new Error(`Некорректный аргумент ${flag}`);
  options[match[1]] = match[2];
}
if (!archive || !output) {
  throw new Error("Укажите пути к matches.parquet и к новому JSON-отчёту [--metadata-dir=...] [--series-review=...]");
}
const report = await auditCs2Archive(archive, { metadataDir: options["metadata-dir"], seriesReview: options["series-review"] });
await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(`BO3 — ${report.archiveSeries}. Проверка — ${report.predictions} из ${report.testSeries} серий.`);
