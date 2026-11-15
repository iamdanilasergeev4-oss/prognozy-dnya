/*
 * Синхронизация истории с репозиторием — запускается в браузере на странице github.com
 * (там у пользователя открыт сеанс GitHub). Сеть: только raw.githubusercontent.com и api.github.com.
 *
 * Подключение в задании по расписанию (на вкладке github.com):
 *   const base = "https://raw.githubusercontent.com/iamdanilasergeev4-oss/prognozy-dnya/main/js/";
 *   for (const f of ["history-core.js", "history-sync.js"]) new Function(await (await fetch(base + f, {cache:"no-store"})).text())();
 *   const S = window.HistorySync;
 *
 * Сценарий одного обновления:
 *   1) const due = await S.due();                      // прогнозы, по которым пора искать результат
 *   2) …найти результаты в 2+ источниках…
 *   3) const out = await S.prepare({ next, results }); // next — новый predictions.json (объект) или null
 *      out.files — { "data/history/2026-11.json": текст, …, "data/history/index.json": текст }
 *      тексты кладутся в sessionStorage("hs:" + путь) — их переживает переход на страницу редактора.
 *   4) для каждого пути из out.changed: открыть /edit/main/<путь> (или /new/main/data/history для нового
 *      месяца), выделить всё и вставить S.text(путь); закоммитить; проверить S.verify(путь).
 */
(function (root) {
  "use strict";
  const H = root.HistoryCore;
  if (!H) throw new Error("history-sync: сначала подключите history-core.js");

  const REPO = "iamdanilasergeev4-oss/prognozy-dnya";
  const RAW = (ref, path) => `https://raw.githubusercontent.com/${REPO}/${ref}/${path}`;
  const MODELS = [
    { id: "v1", title: "v1 — сводка мнений источников", from: "2026-11-14", note: "Выбор ставок по согласию сайтов-прогнозистов; допускались ставки на фаворита по линии букмекеров." },
    { id: "v2", title: "v2 — многофакторный анализ", from: "2026-11-15", note: "Сначала данные (форма, составы, личные встречи, статистика вида спорта), затем вывод. Коэффициенты — только справочно. Факты «за» и «против», неопределённость, качество данных." },
  ];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function getText(url, tries = 3) {
    let last;
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(r.status + " " + url);
        return await r.text();
      } catch (e) { last = e; await sleep(800 * (i + 1)); }
    }
    throw last;
  }
  const getJSON = async (url) => { const t = await getText(url); return t == null ? null : JSON.parse(t); };

  /** SHA последнего коммита main — по HTML-странице (API отдаёт устаревший кэш) */
  async function headSha() {
    const html = await getText(`https://github.com/${REPO}/commits/main`);
    const m = html && html.match(/\/commit\/([0-9a-f]{40})/);
    if (!m) throw new Error("не удалось определить последний коммит");
    return m[1];
  }

  async function loadHistory(ref) {
    const index = (await getJSON(RAW(ref, "data/history/index.json"))) || { schema: 1, months: [], models: MODELS };
    const files = await Promise.all((index.months || []).map((m) => getJSON(RAW(ref, `data/history/${m}.json`))));
    return { index, history: H.mergeMonths(files.filter(Boolean)), originals: Object.fromEntries((index.months || []).map((m, i) => [m, files[i]])) };
  }

  /** Прогнозы, по которым пора искать результат (компактно — для поиска) */
  async function due(nowMs = Date.now()) {
    const sha = await headSha();
    const { history } = await loadHistory(sha);
    return H.dueForCheck(history, nowMs).map((e) => ({
      id: e.id, sport: e.sport, match: e.match, tournament: e.tournament, start: e.start_iso || e.start,
      bet: e.bet, status: e.status, note: e.result && e.result.note,
    }));
  }

  function serialize(index, history, originals) {
    const parts = H.splitByMonth(history);
    const months = Object.keys(parts).sort();
    const files = {};
    const changed = [];
    for (const m of months) {
      const path = `data/history/${m}.json`;
      const text = JSON.stringify(parts[m], null, 2) + "\n";
      files[path] = text;
      const before = originals[m] ? JSON.stringify(originals[m], null, 2) + "\n" : null;
      if (before !== text) changed.push({ path, isNew: !originals[m] });
    }
    const idx = { schema: 1, months, models: index.models && index.models.length ? mergeModels(index.models) : MODELS, updated_at: H.toMskIso(new Date()) };
    const idxBefore = JSON.stringify({ ...index, updated_at: undefined });
    const idxText = JSON.stringify(idx, null, 2) + "\n";
    files["data/history/index.json"] = idxText;
    if (changed.length || idxBefore !== JSON.stringify({ ...idx, updated_at: undefined })) changed.push({ path: "data/history/index.json", isNew: !index.months || !index.months.length });
    return { files, changed };
  }
  function mergeModels(list) {
    const m = new Map(list.map((x) => [x.id, x]));
    for (const x of MODELS) if (!m.has(x.id)) m.set(x.id, x);
    return [...m.values()];
  }

  function stash(files) {
    for (const [p, t] of Object.entries(files)) sessionStorage.setItem("hs:" + p, t);
  }
  const text = (path) => sessionStorage.getItem("hs:" + path);

  /**
   * Готовит файлы истории.
   * next — объект нового predictions.json (будет опубликован сразу после истории) или null;
   * results — массив результатов для HistoryCore.applyResults.
   */
  async function prepare({ next = null, results = [], modelVersion = "v2", now = new Date() } = {}) {
    const sha = await headSha();
    const live = await getJSON(RAW(sha, "data/predictions.json"));
    const { index, history, originals } = await loadHistory(sha);
    const report = {};
    // 1) текущий опубликованный файл (идемпотентно — на случай, если его ещё нет в истории)
    if (live && live.updated_at) report.live = H.archive(history, live, live.updated_at, { modelVersion: live.model_version || "v1" });
    // 2) новый файл — время публикации «сейчас»
    if (next) {
      const at = H.toMskIso(now);
      report.next = H.archive(history, next, at, { modelVersion: next.model_version || modelVersion, markWithdrawn: true, reason: "плановое обновление" });
      report.quality = [];
      for (const s of next.sports || []) for (const p of s.picks || []) {
        const issues = H.qualityIssues(p);
        if (issues.length) report.quality.push({ sport: s.id, match: p.match, bet: p.bet, issues });
      }
    }
    // 3) результаты
    if (results.length) report.results = H.applyResults(history, results, H.toMskIso(now));
    const out = serialize(index, history, originals);
    // 4) экспрессы: архив data/history/express.json
    const exPath = "data/history/express.json";
    const exBefore = await getText(RAW(sha, exPath));
    if (exBefore != null || (next && Array.isArray(next.express) && next.express.length)) {
      const ex = H.syncExpress(exBefore ? JSON.parse(exBefore) : null, history, next, H.toMskIso(now));
      const exText = JSON.stringify(ex.store, null, 2) + "\n";
      out.files[exPath] = exText;
      if (exText !== exBefore) {
        const k = out.changed.findIndex((c) => c.path === "data/history/index.json");
        out.changed.splice(k < 0 ? out.changed.length : k, 0, { path: exPath, isNew: exBefore == null });
      }
      report.express = { ...ex.report, stats: H.expressStats(ex.store) };
    }
    stash(out.files);
    return { sha, changed: out.changed, report, stats: H.computeStats(history.predictions, { nowMs: now.getTime() }) };
  }

  /**
   * Восстановление истории из всех опубликованных версий predictions.json (по коммитам).
   * Время публикации — время коммита. Версии, которые не читаются как JSON, пропускаются.
   */
  async function backfill() {
    const commits = [];
    for (let page = 1; page < 10; page++) {
      const list = await getJSON(`https://api.github.com/repos/${REPO}/commits?path=data/predictions.json&per_page=100&page=${page}`);
      if (!Array.isArray(list) || !list.length) break;
      commits.push(...list);
      if (list.length < 100) break;
    }
    commits.sort((a, b) => Date.parse(a.commit.committer.date) - Date.parse(b.commit.committer.date));
    const history = H.emptyHistory();
    const log = [];
    for (const c of commits) {
      const t = await getText(RAW(c.sha, "data/predictions.json"));
      let f;
      try { f = JSON.parse(t); } catch { log.push(`${c.sha.slice(0, 7)}: не JSON — пропущен`); continue; }
      const n = (f.sports || []).reduce((a, s) => a + (s.picks || []).length, 0);
      if (!n) { log.push(`${c.sha.slice(0, 7)}: прогнозов нет`); continue; }
      const at = H.toMskIso(new Date(c.commit.committer.date));
      const r = H.archive(history, f, at, { modelVersion: f.model_version || "v1", markWithdrawn: true, reason: "обновление файла прогнозов" });
      log.push(`${c.sha.slice(0, 7)} ${at}: +${r.added.length}, версий ${r.versioned.length}, отклонено ${r.rejected.length}, поздних ${r.late.length}, снято ${r.withdrawn.length}, возвращено ${r.restored.length}`);
    }
    const sha = await headSha();
    const { index, originals } = await loadHistory(sha);
    const out = serialize(index, history, originals);
    stash(out.files);
    return { changed: out.changed, log, total: history.predictions.length };
  }

  /** Проверка, что в main лежит ровно подготовленный текст */
  async function verify(path, tries = 6) {
    const want = text(path);
    for (let i = 0; i < tries; i++) {
      const sha = await headSha();
      const got = await getText(RAW(sha, path));
      if (got != null && (got === want || got === want.replace(/\n$/, "") || got + "\n" === want)) {
        try { JSON.parse(got); } catch { return { ok: false, sha, why: "битый JSON" }; }
        return { ok: true, sha };
      }
      await sleep(2500);
    }
    return { ok: false, why: "содержимое в репозитории не совпадает с подготовленным" };
  }

  root.HistorySync = { REPO, MODELS, headSha, loadHistory, due, prepare, backfill, verify, text };
})(typeof window !== "undefined" ? window : globalThis);
