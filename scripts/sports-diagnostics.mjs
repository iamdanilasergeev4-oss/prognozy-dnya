import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [shadowPath, backtestPath] = process.argv.slice(2);
if (!shadowPath || !backtestPath) throw new Error("Передайте пути к diagnostics.json и отчёту backtest");
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const [shadow, backtest] = await Promise.all([read(shadowPath), read(backtestPath)]);
const escape = (value) => String(value ?? "—").replace(/[&<>"']/g,
  (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const format = (number) => Number.isFinite(number) ? number.toLocaleString("ru-RU", { maximumFractionDigits: 3 }) : "—";
const table = (headers, rows) => `<table><thead><tr>${headers.map((header) => `<th>${escape(header)}</th>`).join("")}</tr></thead>
<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
const sports = Object.entries(shadow.sports).map(([sport, row]) =>
  [sport, row.detected, row.confirmed, row.forecast, row.legacy.selected, row.legacy.publishers?.join(", ")]);
const sources = shadow.requests.map((row) => [row.source, row.competition, row.status, row.count, row.error]);
const metricRows = Object.entries(backtest.byDivision).map(([division, row]) => [division, row.eligibleEvents,
  ...["statistical", "fixedHomeBaseline"].flatMap((key) => [format(row.modelsOnly[key]?.brier), format(row.modelsOnly[key]?.logLoss)])]);
const probabilityBins = backtest.summary.modelsOnly.statistical?.reliability || [];
const points = probabilityBins.map((bin) => {
  const x = 44 + bin.predicted * 275;
  const y = 265 - bin.actual * 225;
  return `<circle cx="${x}" cy="${y}" r="4"><title>${escape(`${format(bin.predicted)} → ${format(bin.actual)} (n=${bin.count})`)}</title></circle>`;
}).join("");
const plot = probabilityBins.length ? `<svg width="400" viewBox="0 0 400 315" role="img"
 aria-label="Калибровка. По горизонтали оценка модели, по вертикали наблюдаемая доля исходов.">
<path d="M44 40V265H319" fill="none" stroke="#64748b"/><path d="M44 265L319 40" stroke="#64748b" stroke-dasharray="4"/>
<g fill="#044a99">${points}</g><text x="27" y="45">1</text><text x="27" y="269">0</text>
<text x="315" y="283">1</text><text x="93" y="307">Оценка модели</text><text x="50" y="22">Доля наступивших исходов</text></svg>` : "";
const html = `<!doctype html><html lang="ru"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Диагностика спортивного движка</title>
<style>body{font:1rem/1.6 system-ui;margin:2rem auto;padding:0 1rem;max-width:64rem;color:#172536}
table{width:100%;border-collapse:collapse;margin-bottom:1.5rem}th,td{border-bottom:1px solid #cbd5e1;padding:.35rem;text-align:left}
section{overflow:auto}svg{max-width:100%}</style><main>
<h1>Диагностика спортивного движка</h1>
<p>Проверено ${escape(shadow.checkedAt)}. Модель ${escape(shadow.modelVersion)} работает в пробном режиме.</p>
<p>Подтверждённые расписания найдены у ${format(shadow.coverage.confirmedSchedule)} из ${format(shadow.coverage.denominator)}
соревнований, включённых в проверку охвата. В выборке для модели ${format(shadow.trainingResults)} сверенных результатов.</p>
<h2>Календарь и данные</h2><section>
${table(["Спорт", "Найдено", "Подтверждено", "Оценено моделью", "Карточек в текущем режиме", "Издатели"], sports)}
</section>
<details><summary>Источники и ошибки</summary><section>
${table(["Источник", "Соревнование", "Статус", "События с датой", "Ошибка"], sources)}
${table(["Источник", "Дата", "Ошибка"], shadow.requestErrors.map((row) => [row.publisher, row.date, row.error]))}
</section></details>
<h2>Историческое тестирование</h2>
<p>Пары с рыночными оценками: ${format(backtest.summary.paired.market?.matches ?? 0)}. Прогнозы архивной модели
доступны для ${format(backtest.summary.showModel)} встреч из ${format(backtest.summary.eligibleEvents)}.</p>
<section>${table(["Дивизион", "Матчи", "Brier модели", "Log loss модели", "Brier базы", "Log loss базы"], metricRows)}</section>
<h3>Калибровка вероятностей</h3>${plot}
<section>${table(["Диапазон от", "До", "Число исходов", "Оценка", "Наблюдаемая доля"],
  probabilityBins.map((bin) => [bin.from, bin.to, bin.count, bin.predicted, bin.actual].map(format)))}</section>
</main></html>`;
const output = resolve(shadowPath, "..", "diagnostics.html");
await writeFile(output, html, { flag: "wx" });
console.log(output);
