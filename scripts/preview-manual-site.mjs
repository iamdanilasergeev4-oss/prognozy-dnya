import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { checkUpcomingSelection, digest, MANUAL_REVIEW_AGE, sealManualPacket } from "./sports-manual-update.mjs";
import { isUpcoming, localSportsPreview, siteFixtureKey } from "./sports-site-integration.mjs";

const [run] = process.argv.slice(2);
if (!/^run-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/.test(run ?? "")) {
  throw new Error("Укажите каталог свежего ручного прогона");
}
const root = resolve(import.meta.dirname, "..");
const directory = join(root, ".sports-update", run);
const read = async (base, file) => JSON.parse(await readFile(join(base, file), "utf8"));
const [report, packet, network, html] = await Promise.all([
  read(directory, "manual-report.json"), read(directory, "manual-packet.json"), read(directory, "network.json"),
  readFile(join(root, "index.html"), "utf8"),
]);
const files = async (base, hashes) => Object.fromEntries(await Promise.all(Object.keys(hashes).map(async (file) => {
  if (!/^data\/(?:predictions\.json|history\/(?:index|express|\d{4}-\d{2})\.json)$/.test(file)) throw new Error("Неизвестный файл в пакете");
  return [file, await read(base, file)];
})));
const [baseline, payload] = await Promise.all([files(root, packet.baseline), files(directory, packet.candidate)]);
const now = Date.now();
const age = now - Date.parse(report.checkedAt);
if (!(age >= 0 && age <= MANUAL_REVIEW_AGE) || digest(sealManualPacket(report, baseline, payload)) !== digest(packet) ||
    report.runMode !== "live" || network.mode !== "live" || digest(network) !== report.networkDigest) {
  throw new Error("Для превью нужен проверенный сетевой прогон");
}
const data = payload["data/predictions.json"];
checkUpcomingSelection(data, Date.parse(report.checkedAt));
const upcoming = (row) => isUpcoming(row, now);
data.manual_schedule = true;
data.sports = data.sports.map((sport) => {
  const picks = sport.picks.filter(upcoming);
  const keys = new Set(picks.map((pick) => siteFixtureKey(sport.id, pick)));
  return { ...sport, picks, events: sport.events.filter(upcoming).map((event) =>
    ({ ...event, has_pick: keys.has(siteFixtureKey(sport.id, event)) })) };
});
data.analysis = data.analysis.filter(upcoming);
data.express = (data.express ?? []).filter(({ legs }) => legs.every(upcoming));
checkUpcomingSelection(data, now);
const time = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Moscow" })
  .format(Date.parse(report.checkedAt));
const output = join(directory, "preview-site.html");
await writeFile(output, localSportsPreview(html, payload, {
  notice: `Локальное превью. Расписание сверено ${time} МСК. Отправка предложений отключена.`,
}));
console.log(output);
console.log(JSON.stringify(data.sports.map(({ id, events }) =>
  ({ sport: id, events: events.length, articles: data.analysis.filter(({ sport_id }) => sport_id === id).length }))));
