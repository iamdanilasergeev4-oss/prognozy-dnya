import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sealManualPacket, digest } from "./sports-manual-update.mjs";
import { integrateSite } from "./sports-site-integration.mjs";
import { priceProbability } from "./sports-bookmaker-lines.mjs";

const [baselinePath, forecastPath, ...extra] = process.argv.slice(2);
if (!baselinePath || !forecastPath || extra.length) throw new Error("Укажите копию опубликованного сайта и сохранённое модельное превью");
const root = resolve(import.meta.dirname, "..");
const read = async (dir, file) => JSON.parse(await readFile(join(dir, file), "utf8"));
const predictionFile = "data/predictions.json";
const index = await read(baselinePath, "data/history/index.json");
if (!index.months.every((month) => /^\d{4}-\d{2}$/.test(month))) throw new Error("Некорректный индекс истории");
const archiveFiles = ["data/history/index.json", "data/history/express.json", ...index.months.map((month) => `data/history/${month}.json`)];
const files = [predictionFile, ...archiveFiles];
const load = async (dir) => Object.fromEntries(await Promise.all(files.map(async (file) => [file, await read(dir, file)])));
const [baseline, prior, packet, report, evaluation, quotes] = await Promise.all([
  load(baselinePath), load(forecastPath), read(forecastPath, "manual-packet.json"), read(forecastPath, "manual-report.json"),
  read(forecastPath, "evaluation.json"), read(forecastPath, "bookmaker-lines.json"),
]);
const saved = prior[predictionFile];
const at = Date.parse(saved.updated_at);
if (saved.source !== "model-preview" || !Number.isFinite(at) || digest(sealManualPacket(report, baseline, prior)) !== digest(packet) ||
    report.evidence.evaluation !== digest(evaluation) || report.evidence.quotes !== digest(quotes)) {
  throw new Error("Сохранённый расчёт, отчёт или исходная версия сайта отличаются от пакета");
}
if (!/^run-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/.test(report.sourceRun)) throw new Error("Некорректный источник расписания");
const scheduled = await read(join(root, ".sports-update", report.sourceRun), predictionFile);
const model = { ...saved, analysis: saved.analysis.map((article) => {
  const bookmaker = article.bookmaker;
  if (!bookmaker) return article;
  const start = Date.parse(article.start_iso);
  const sameFixture = ({ sport, match, start: time }) => sport === article.sport_id &&
    match === article.match && new Date(time).getTime() === start;
  const recorded = quotes.quotes.filter(sameFixture);
  const forecast = evaluation.forecastEvidence.find(({ event }) => sameFixture(event));
  const lines = (bookmaker.lines ?? []).filter((line) => !line.privateSnapshot).map((line) => {
    const offers = line.outcomes.map(({ condition, model, comparisonStatus, ...offer }) => offer);
    const receipt = recorded.find((row) => !row.privateSnapshot && [
      "type", "team", "scope", "bookmaker", "source", "sourceUrl", "referenceUrl", "rulesUrl", "receivedAt", "updatedAt",
      "publishedAt", "scannedAt", "providerEventId", "observationOnly", "modelComparable",
    ].every((key) => row[key] === line[key]) && digest(row.outcomes) === digest(offers));
    if (!receipt || URL.parse(receipt.sourceUrl)?.protocol !== "https:" ||
        !(Date.parse(receipt.receivedAt) <= at)) {
      throw new Error(`Снимок линии не подтверждён журналом: ${article.match}, ${line.source}`);
    }
    const market = { ...line, event: { ...receipt, start } };
    const outcomes = line.outcomes.map((offer) => {
      const verified = forecast ? priceProbability(market, offer, forecast, evaluation.distributionChecks) : null;
      const model = offer.comparisonStatus === "matched" && digest(offer.model) === digest(verified) ? verified : null;
      return { ...offer, model, comparisonStatus: model ? "matched" : "condition_mismatch" };
    });
    return { ...line, outcomes, archivedObservation: true };
  });
  return { ...article, bookmaker: { ...bookmaker, status: lines.length ? "snapshot" :
    bookmaker.lines?.length ? "missing" : bookmaker.status, lines } };
}) };
const integrated = integrateSite(baseline[predictionFile], scheduled, model, { snapshotAt: saved.updated_at });
const payload = { ...baseline, [predictionFile]: integrated };
const serialized = JSON.stringify(payload).replace(/</g, "\\u003c");
const html = await readFile(join(root, "index.html"), "utf8");
const script = `<base href="../../">
<meta name="robots" content="noindex,nofollow">
<script>
(() => {
  const payload = ${serialized};
  Date.now = () => ${at};
  window.fetch = async (url) => {
    const file = String(url).split("?")[0];
    return Object.hasOwn(payload, file) ? Response.json(payload[file]) : new Response(null, {status: 403});
  };
  const replace = history.replaceState.bind(history);
  history.replaceState = (state, title, url) => {
    if (typeof url === "string" && url.startsWith("#")) {
      const current = new URL(location.href);
      current.hash = url;
      return replace(state, title, current);
    }
    return replace(state, title, url);
  };
  document.addEventListener("click", (event) => {
    const anchor = event.target.closest("a[href^='#']");
    if (!anchor || event.defaultPrevented) return;
    event.preventDefault();
    location.hash = anchor.getAttribute("href");
    document.getElementById(location.hash.slice(1))?.scrollIntoView();
  });
  document.addEventListener("submit", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelector("#send").disabled = true;
  });
})();
</script>`;
const output = join(root, ".sports-update", "stable-preview");
await mkdir(output, { recursive: true });
await mkdir(join(output, "data", "history"), { recursive: true });
await Promise.all(archiveFiles.map((file) => copyFile(join(baselinePath, file), join(output, file))));
await writeFile(join(output, predictionFile), JSON.stringify(integrated, null, 2) + "\n");
const time = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Moscow" }).format(at);
const coverage = [
  "# Покрытие букмекерскими данными",
  "",
  `Архивный снимок от ${time} МСК. Использован сохранённый журнал источников.`,
  "",
  "| Категория | Карточки с архивной линией | Рынки | Карточки с точным сравнением | Источники |",
  "| --- | ---: | ---: | ---: | --- |",
  ...integrated.sports.map(({ name, forecasts }) => {
    const lines = forecasts.flatMap((article) => article.bookmaker?.lines ?? []);
    const covered = forecasts.filter((article) => article.bookmaker?.lines.length).length;
    const compared = forecasts.filter((article) => article.bookmaker?.lines.some((line) =>
      line.outcomes.some((offer) => offer.model))).length;
    const sources = [...new Set(lines.map((line) => line.source))].join(", ") || "—";
    return `| ${name} | ${covered}/${forecasts.length} | ${lines.length} | ${compared} | ${sources} |`;
  }),
  "",
  "Активные цены не подтверждены ни в одной категории. Частные выгрузки исключены.",
  "",
];
await writeFile(join(output, "bookmaker-coverage.md"), coverage.join("\n"));
const banner = `<p class="note stable-preview-notice" role="note">Локальное превью. Снимок на ${time} МСК. Прогнозы и цены показаны в архивном контексте. Отправка предложений отключена.</p>`;
await writeFile(join(output, "preview-site.html"), html.replace("<head>", () => "<head>\n" + script)
  .replace(/<title>[^<]+<\/title>/, "<title>Прогнозы дня · Локальное превью</title>")
  .replace('<main id="main">', '<main id="main">\n' + banner));
console.log(output);
