// Проверка модуля синхронизации на подменённой сети (без обращения к GitHub)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import "../js/history-core.js";

const H = globalThis.HistoryCore;
const SHA = "a".repeat(40);
const store = {};
globalThis.sessionStorage = { setItem: (k, v) => { store[k] = v; }, getItem: (k) => store[k] ?? null };
const base = JSON.parse(fs.readFileSync(new URL("./fixtures/predictions-v1.json", import.meta.url)));
const v2 = structuredClone(base);
v2.updated_at = "2026-11-15T13:01+03:00";
v2.sports[0].picks = v2.sports[0].picks.slice(1); // первый футбольный прогноз снят

const remote = {
  [`https://github.com/iamdanilasergeev4-oss/prognozy-dnya/commits/main`]: `<a href="/x/commit/${SHA}">`,
  [`https://raw.githubusercontent.com/iamdanilasergeev4-oss/prognozy-dnya/${SHA}/data/predictions.json`]: JSON.stringify(base),
  [`https://api.github.com/repos/iamdanilasergeev4-oss/prognozy-dnya/commits?path=data/predictions.json&per_page=100&page=1`]: JSON.stringify([
    { sha: "c2".padEnd(40, "0"), commit: { committer: { date: "2026-11-15T10:01:27Z" } } },
    { sha: "bb".padEnd(40, "0"), commit: { committer: { date: "2026-11-14T22:34:05Z" } } },
    { sha: "c1".padEnd(40, "0"), commit: { committer: { date: "2026-11-14T22:35:00Z" } } },
  ]),
  [`https://raw.githubusercontent.com/iamdanilasergeev4-oss/prognozy-dnya/${"c1".padEnd(40, "0")}/data/predictions.json`]: JSON.stringify(base),
  [`https://raw.githubusercontent.com/iamdanilasergeev4-oss/prognozy-dnya/${"bb".padEnd(40, "0")}/data/predictions.json`]: "{ битый",
  [`https://raw.githubusercontent.com/iamdanilasergeev4-oss/prognozy-dnya/${"c2".padEnd(40, "0")}/data/predictions.json`]: JSON.stringify(v2),
};
let fail = 0;
globalThis.fetch = async (url) => {
  if (fail > 0) { fail--; throw new Error("network down"); }
  const body = remote[url];
  return { ok: body !== undefined, status: body === undefined ? 404 : 200, text: async () => body };
};
await import("../js/history-sync.js");
const S = globalThis.HistorySync;

test("backfill: собирает историю из коммитов, битую версию пропускает, снятый прогноз помечает", async () => {
  const r = await S.backfill();
  assert.ok(r.log.some((l) => l.includes("не JSON")));
  const m = JSON.parse(S.text("data/history/2026-11.json"));
  const ids = new Set(m.predictions.map((e) => e.id));
  assert.equal(ids.size, m.predictions.length);
  const firstFootball = base.sports[0].picks[0];
  const w = m.predictions.find((e) => e.match === firstFootball.match && e.bet === firstFootball.bet);
  assert.equal(w.published_at, "2026-11-15T01:35+03:00");
  // в 13:01 прогноз на матч 20:00 выпал из файла — снят до начала
  assert.equal(w.status, "withdrawn");
  assert.ok(r.changed.some((c) => c.path === "data/history/index.json" && c.isNew));
  const idx = JSON.parse(S.text("data/history/index.json"));
  assert.deepEqual(idx.months, ["2026-11"]);
});

test("prepare: архивирует новый файл, проверяет качество, применяет результат; временный сбой сети переживается", async () => {
  // «репозиторий» уже содержит историю после backfill
  remote[`https://raw.githubusercontent.com/iamdanilasergeev4-oss/prognozy-dnya/${SHA}/data/history/index.json`] = S.text("data/history/index.json");
  remote[`https://raw.githubusercontent.com/iamdanilasergeev4-oss/prognozy-dnya/${SHA}/data/history/2026-11.json`] = S.text("data/history/2026-11.json");
  const next = structuredClone(base);
  next.model_version = "v2";
  next.sports[0].picks = [{ ...base.sports[0].picks[1], match: "Новая — Пара", start: "16.11, 20:00 МСК", reason: "кф ниже" }];
  const target = JSON.parse(S.text("data/history/2026-11.json")).predictions.find((e) => e.match === base.sports[0].picks[1].match);
  fail = 1;
  const out = await S.prepare({ next, results: [{ id: target.id, score: "2:0" }], now: new Date("2026-11-16T09:00:00+03:00") });
  assert.equal(out.report.next.added.length, 1);
  assert.ok(out.report.quality.length >= 1);
  assert.deepEqual(out.report.results.updated, [target.id]);
  const m = JSON.parse(S.text("data/history/2026-11.json"));
  assert.ok(m.predictions.find((e) => e.match === "Новая — Пара" && e.model_version === "v2"));
  assert.ok(out.changed.find((c) => c.path === "data/history/2026-11.json" && !c.isNew));
});
