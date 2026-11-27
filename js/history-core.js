/*
 * Ядро истории прогнозов «Прогнозы дня».
 *
 * Чистые функции без сети и DOM: одинаково работают в браузере (сайт, задание
 * по расписанию на странице GitHub) и в Node (тесты). Подключение:
 *   браузер — <script src="js/history-core.js"> → window.HistoryCore
 *   Node    — import "./js/history-core.js" → globalThis.HistoryCore
 *
 * Хранилище: data/history/index.json + data/history/YYYY-MM.json (месяц — по дате события).
 *
 * Главные правила:
 *  - прогноз попадает в историю в момент публикации и больше не исчезает;
 *  - до начала события правка сохраняет прежнюю версию (versions[]), после начала — отклоняется;
 *  - прогноз, впервые опубликованный после начала события, помечается late и не оценивается;
 *  - «завершено» ставится только по подтверждённому счёту; расхождение источников → review;
 *  - статистика всегда пересчитывается с нуля по сохранённым записям.
 */
(function (root) {
  "use strict";

  const SCHEMA_VERSION = 1;

  /** Статусы записи истории */
  const STATUS = {
    pending: "pending",       // ожидается / идёт / ждёт проверки (уточняется по времени)
    won: "won",               // завершено — прогноз подтвердился
    lost: "lost",             // завершено — прогноз не подтвердился
    void: "void",             // возврат / не подлежит оценке (в т.ч. опубликован после начала)
    cancelled: "cancelled",   // матч отменён
    postponed: "postponed",   // матч перенесён
    review: "review",         // результат требует проверки (источники расходятся и т.п.)
    withdrawn: "withdrawn",   // прогноз снят до начала события
  };
  const FINAL = new Set([STATUS.won, STATUS.lost, STATUS.void, STATUS.cancelled]);
  const EXCLUDED = new Set([STATUS.void, STATUS.cancelled, STATUS.postponed, STATUS.withdrawn]);

  /** Сколько длится событие (для статуса «идёт» и порога проверки результата), часы */
  const EVENT_HOURS = { football: 2.25, basketball: 2.75, tennis: 3.5, volleyball: 2.5, cs2: 3.5, dota2: 3.5, hockey: 2.75 };
  const eventHours = (sport) => EVENT_HOURS[sport] || 3;

  /* ---------------- Нормализация и идентификаторы ---------------- */

  function norm(s) {
    return String(s ?? "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[«»"“”„'`’]/g, "")
      .replace(/\s+(—|–|-|vs\.?|v)\s+/g, "|")
      .replace(/[.,;:!?()]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\s*\|\s*/g, "|")
      .trim();
  }

  /** Ставка в каноническом виде: «П1 (победа Франции)» → «п1», «ТБ 2,5» → «тб 2.5» */
  function normBet(bet) {
    let s = String(bet ?? "").toLowerCase().replace(/ё/g, "е").replace(/−|–|—/g, "-");
    s = s.replace(/\((победа|ничья)[^)]*\)/g, " ");
    s = s.replace(/(\d),(\d)/g, "$1.$2");
    s = s.replace(/[«»"]/g, "").replace(/\s+/g, " ").trim();
    return s;
  }

  function splitTeams(match) {
    const parts = String(match ?? "").split(/\s+(?:—|–|-|vs\.?|v)\s+/i);
    return parts.length >= 2 ? { home: parts[0].trim(), away: parts.slice(1).join(" — ").trim() } : { home: String(match ?? "").trim(), away: "" };
  }

  /* ---------------- Время начала ---------------- */

  const pad = (n) => String(n).padStart(2, "0");

  /** Московское время в ISO с +03:00 */
  function toMskIso(date) {
    const d = new Date(date.getTime() + 3 * 3600e3);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}+03:00`;
  }
  function mskDateOf(iso) {
    const t = Date.parse(iso);
    if (isNaN(t)) return null;
    return toMskIso(new Date(t)).slice(0, 10);
  }

  /**
   * Разбор поля start («15.11, 22:45 МСК», «15.11, не ранее 16:00 МСК», «14.11, вечер/ночь МСК»).
   * refIso — момент публикации (для года и перехода через Новый год).
   * Возвращает { date: "YYYY-MM-DD"|null, iso: "...+03:00"|null, approx: bool }.
   */
  function parseStart(start, refIso) {
    const s = String(start ?? "");
    const m = s.match(/(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/);
    if (!m) return { date: null, iso: null, approx: true };
    const ref = new Date(Date.parse(refIso) || Date.now());
    const refMsk = new Date(ref.getTime() + 3 * 3600e3);
    let year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : refMsk.getUTCFullYear();
    const month = Number(m[2]);
    const day = Number(m[1]);
    if (!m[3]) {
      const refMonth = refMsk.getUTCMonth() + 1;
      if (month - refMonth > 6) year -= 1;
      if (refMonth - month > 6) year += 1;
    }
    const date = `${year}-${pad(month)}-${pad(day)}`;
    const rest = s.slice(m.index + m[0].length);
    const t = rest.match(/(\d{1,2}):(\d{2})/);
    if (!t) return { date, iso: null, approx: true };
    const approx = /не ранее|~|около|≈/i.test(rest);
    return { date, iso: `${date}T${pad(Number(t[1]))}:${t[2]}+03:00`, approx };
  }

  /** Момент начала в мс (если время неизвестно — начало дня по Москве) */
  function startMs(entry) {
    if (entry.start_iso) return Date.parse(entry.start_iso);
    if (entry.event_date) return Date.parse(entry.event_date + "T00:00+03:00");
    return NaN;
  }

  function makeId(sport, eventDate, match, bet) {
    const raw = [sport, eventDate || "????", norm(match), normBet(bet)].join("|");
    // короткий стабильный хэш (FNV-1a) + читаемый префикс
    let h = 0x811c9dc5;
    for (let i = 0; i < raw.length; i++) { h ^= raw.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return `${sport}-${(eventDate || "0000-00-00").replace(/-/g, "")}-${h.toString(36)}`;
  }

  /* ---------------- Снимок прогноза ---------------- */

  const SNAP_FIELDS = ["tournament", "match", "start", "bet", "odds", "confidence", "model_prob", "reason",
    "facts", "against", "uncertainty", "data_quality", "sources", "format", "market"];

  function snapshot(pick) {
    const o = {};
    for (const k of SNAP_FIELDS) if (pick[k] !== undefined && pick[k] !== "") o[k] = pick[k];
    return o;
  }
  /** Существенные поля: изменение odds одно по себе — не новая версия анализа, но тоже фиксируем */
  const sameSnap = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function marketProb(odds) {
    const o = parseFloat(String(odds ?? "").replace(",", "."));
    return o > 1 ? Math.round((1 / o) * 1000) / 1000 : null;
  }

  /* ---------------- Проверка качества прогноза ---------------- */

  const ODDS_ONLY = /(коэф|кф|линия|котировк|букмекер|рынок)/i;

  /**
   * Предупреждения по качеству одного прогноза (не блокируют, но показываются и логируются).
   * Нужны для запрета «фаворит, потому что коэффициент ниже».
   */
  function qualityIssues(pick) {
    const issues = [];
    const facts = Array.isArray(pick.facts) ? pick.facts.filter(Boolean) : [];
    if (facts.length < 3) issues.push("меньше 3 фактов в поддержку вывода");
    if (!Array.isArray(pick.against) || !pick.against.filter(Boolean).length) issues.push("не указаны факторы против");
    if (!pick.uncertainty) issues.push("не описана неопределённость");
    if (!pick.data_quality || !pick.data_quality.level) issues.push("нет оценки качества данных");
    if (!Array.isArray(pick.sources) || !pick.sources.length) issues.push("нет источников");
    const nonMarket = facts.filter((f) => !ODDS_ONLY.test(f));
    if (facts.length && !nonMarket.length) issues.push("все факты — про коэффициенты");
    const reason = String(pick.reason || "");
    if (ODDS_ONLY.test(reason) && !/\d/.test(reason.replace(/\d+[.,]\d+/g, ""))) issues.push("вывод опирается только на рынок");
    const mp = pick.model_prob;
    if (mp != null && (typeof mp !== "object" || !(mp.value > 0 && mp.value < 1) || !mp.source)) issues.push("model_prob без значения 0–1 или без источника");
    return issues;
  }

  /* ---------------- История ---------------- */

  function emptyHistory() {
    return { schema: SCHEMA_VERSION, predictions: [] };
  }
  function indexById(history) {
    const m = new Map();
    for (const e of history.predictions) m.set(e.id, e);
    return m;
  }
  function log(entry, at, from, to, note) {
    (entry.status_log = entry.status_log || []).push({ at, from, to, note });
    entry.status = to;
  }

  /**
   * Заносит в историю все прогнозы опубликованного файла predictions.json.
   * file — объект predictions.json; publishedAt — ISO-время публикации (коммита).
   * opts.modelVersion — версия методики; opts.markWithdrawn — снимать не вошедшие в файл
   *   прогнозы на ещё не начавшиеся матчи (true при каждой новой публикации).
   * Возвращает отчёт { added, versioned, rejected, late, withdrawn, restored }.
   */
  function archive(history, file, publishedAt, opts = {}) {
    const report = { added: [], versioned: [], rejected: [], late: [], withdrawn: [], restored: [] };
    const pubMs = Date.parse(publishedAt);
    if (isNaN(pubMs)) throw new Error("archive: некорректное время публикации " + publishedAt);
    const byId = indexById(history);
    const seen = new Set();
    const modelVersion = opts.modelVersion || file.model_version || "v1";

    for (const sport of file.sports || []) {
      for (const pick of sport.picks || []) {
        const st = pick.start_iso
          ? { date: mskDateOf(pick.start_iso), iso: pick.start_iso, approx: false }
          : parseStart(pick.start, publishedAt);
        const id = makeId(sport.id, st.date, pick.match, pick.bet);
        if (seen.has(id)) continue; // дубль внутри одного файла
        seen.add(id);
        const snap = snapshot(pick);
        const teams = splitTeams(pick.match);
        let e = byId.get(id);
        if (!e) {
          e = {
            id, sport: sport.id, sport_name: sport.name || sport.id,
            home: teams.home, away: teams.away,
            event_date: st.date, start_iso: st.iso, start_approx: !!st.approx,
            published_at: publishedAt, model_version: modelVersion,
            ...snap,
            market_prob: marketProb(pick.odds),
            status: STATUS.pending, result: null, versions: [], status_log: [],
          };
          const sMs = startMs(e);
          // без точного времени поздней считаем только публикацию после окончания дня события
          const lateFrom = e.start_iso ? sMs : sMs + 24 * 3600e3;
          if (!isNaN(sMs) && pubMs >= lateFrom) {
            e.late = true;
            log(e, publishedAt, null, STATUS.void, "опубликован после начала события — не оценивается");
            report.late.push(id);
          }
          history.predictions.push(e);
          byId.set(id, e);
          report.added.push(id);
          continue;
        }
        // запись уже есть
        if (e.status === STATUS.withdrawn && pubMs < startMs(e)) {
          log(e, publishedAt, STATUS.withdrawn, STATUS.pending, "прогноз снова опубликован до начала");
          report.restored.push(id);
        }
        const prev = snapshot(e);
        if (sameSnap(prev, snap)) continue;
        if (pubMs < startMs(e)) {
          e.versions.push({ at: e.updated_at || e.published_at, replaced_at: publishedAt, reason: opts.reason || "обновлено до начала события", snapshot: prev });
          for (const k of SNAP_FIELDS) delete e[k];
          Object.assign(e, snap);
          e.market_prob = marketProb(pick.odds);
          e.updated_at = publishedAt;
          report.versioned.push(id);
        } else {
          e.rejected_edits = (e.rejected_edits || 0) + 1;
          report.rejected.push(id);
        }
      }
    }

    if (opts.markWithdrawn) {
      for (const e of history.predictions) {
        if (seen.has(e.id) || e.status !== STATUS.pending) continue;
        if (Date.parse(e.published_at) >= pubMs) continue;
        const sMs = startMs(e);
        if (!isNaN(sMs) && sMs > pubMs + 15 * 60e3) {
          log(e, publishedAt, STATUS.pending, STATUS.withdrawn, "снят с публикации до начала события");
          report.withdrawn.push(e.id);
        }
      }
    }
    return report;
  }

  /* ---------------- Оценка ставки по счёту ---------------- */

  function parseScore(score) {
    const m = String(score ?? "").match(/(\d+)\s*[:\-–—]\s*(\d+)/);
    return m ? { a: Number(m[1]), b: Number(m[2]) } : null;
  }

  /**
   * Возвращает won | lost | void | null (null — тип ставки не разбирается автоматически).
   * score — итоговый счёт «хозяева:гости» в порядке, как в поле match
   *   (футбол — голы, баскетбол — очки, теннис — сеты, CS2/Dota — карты, волейбол — сеты; хоккей — шайбы основного времени).
   */
  function evaluateBet(bet, score) {
    const sc = parseScore(score);
    if (!sc) return null;
    const { a, b } = sc;
    const s = normBet(bet).replace(/\s+/g, " ");
    const total = a + b;

    let m;
    if (/^(п1|w1|победа хозяев)\b/.test(s)) return a > b ? "won" : "lost";
    if (/^(п2|w2|победа гостей)\b/.test(s)) return b > a ? "won" : "lost";
    if (/^(1х|1x)(?=\s|$)/.test(s)) return a >= b ? "won" : "lost";
    if (/^(х2|x2)\b/.test(s)) return b >= a ? "won" : "lost";
    if (/^12\b/.test(s)) return a !== b ? "won" : "lost";
    if (/^(х|x|ничья)$/.test(s)) return a === b ? "won" : "lost";
    if ((m = s.match(/^(тб|тм|тотал больше|тотал меньше)\s*\(?\s*(\d+(?:\.\d+)?)/))) {
      const line = Number(m[2]);
      if (total === line) return "void";
      const over = m[1] === "тб" || m[1] === "тотал больше";
      return (over ? total > line : total < line) ? "won" : "lost";
    }
    if ((m = s.match(/^обе забьют\s*[-—:]?\s*(да|нет)?/))) {
      const yes = m[1] !== "нет";
      const both = a > 0 && b > 0;
      return both === yes ? "won" : "lost";
    }
    if ((m = s.match(/^ф([12])\s*\(?\s*([+-]?\d+(?:\.\d+)?)\s*\)?/))) {
      const line = Number(m[2]);
      const diff = m[1] === "1" ? a + line - b : b + line - a;
      return diff > 0 ? "won" : diff < 0 ? "lost" : "void";
    }
    return null;
  }

  function evaluateMarket(market, score) {
    const sc = parseScore(score);
    if (!sc || !market) return null;
    const { a, b } = sc;
    const { kind, line, side, direction } = market;
    const sideScore = side === "home" ? a : b;
    const opponentScore = side === "home" ? b : a;
    const validSide = side === "home" || side === "away";
    if (kind === "outcome" && (validSide || side === "draw")) {
      return side === (a === b ? "draw" : a > b ? "home" : "away") ? "won" : "lost";
    }
    if (kind === "both-score" && ["yes", "no"].includes(direction)) {
      return (a > 0 && b > 0) === (direction === "yes") ? "won" : "lost";
    }
    if (kind === "double-chance" && validSide) return sideScore >= opponentScore ? "won" : "lost";
    if (kind === "handicap" && validSide && Number.isFinite(line) && Number.isInteger(line * 2)) {
      const margin = sideScore - opponentScore + line;
      return margin === 0 ? "void" : margin > 0 ? "won" : "lost";
    }
    if (!["total", "team-total"].includes(kind) || !Number.isFinite(line) || line < 0 ||
        !Number.isInteger(line * 2) || !["over", "under"].includes(direction) || kind === "team-total" && !validSide) return null;
    const actual = kind === "total" ? a + b : sideScore;
    if (actual === line) return "void";
    return (direction === "over" ? actual > line : actual < line) ? "won" : "lost";
  }

  /**
   * Применяет результаты проверки.
   * results: [{ id, score?, status?, note?, sources?: [{title,url}], source_scores?: [{source, score}] }]
   *   status допустим, когда ставка не разбирается автоматически или матч отменён/перенесён.
   * Возвращает { updated, review, unknown, skipped }.
   */
  function applyResults(history, results, checkedAt) {
    const report = { updated: [], review: [], unknown: [], skipped: [] };
    const byId = indexById(history);
    for (const r of results || []) {
      const e = byId.get(r.id);
      if (!e) { report.unknown.push(r.id); continue; }
      if (e.late || e.status === STATUS.withdrawn) { report.skipped.push(r.id); continue; }
      const now = checkedAt || toMskIso(new Date());
      let next = null;
      let note = r.note || "";

      // противоречивые источники
      const scores = (r.source_scores || []).map((x) => parseScore(x.score)).filter(Boolean);
      const distinct = new Set(scores.map((x) => x.a + ":" + x.b));
      if (distinct.size > 1) {
        next = STATUS.review;
        note = "источники расходятся: " + (r.source_scores || []).map((x) => `${x.source} ${x.score}`).join(", ");
      }

      const score = r.score || (scores.length && distinct.size === 1 ? `${scores[0].a}:${scores[0].b}` : null);
      if (!next) {
        if ([STATUS.cancelled, STATUS.postponed, STATUS.void].includes(r.status)) next = r.status;
        else if (score) {
          const auto = e.market ? evaluateMarket(e.market, score) : evaluateBet(e.bet, score);
          if (auto && r.status && r.status !== auto && [STATUS.won, STATUS.lost].includes(r.status)) {
            next = STATUS.review;
            note = `автоматическая оценка (${auto}) не совпала с ручной (${r.status})` + (note ? "; " + note : "");
          } else next = auto || (([STATUS.won, STATUS.lost, STATUS.review].includes(r.status)) ? r.status : STATUS.review);
          if (!auto && !r.status) note = "тип ставки не разобран автоматически" + (note ? "; " + note : "");
        } else if (r.status === STATUS.review) next = STATUS.review;
        else { report.skipped.push(r.id); continue; } // нет подтверждённого счёта — не завершаем
      }

      const prevResult = e.result;
      e.result = { score: score || null, note: note || null, sources: r.sources || [], checked_at: now };
      if (prevResult && (prevResult.score !== e.result.score || e.status !== next)) {
        (e.result_history = e.result_history || []).push({ ...prevResult, status: e.status });
      }
      if (e.status !== next) log(e, now, e.status, next, note || null);
      e.last_sync = now;
      (next === STATUS.review ? report.review : report.updated).push(r.id);
    }
    return report;
  }

  /* ---------------- Отображаемый статус ---------------- */

  /** pending → upcoming | live | awaiting (по времени); остальные — как есть */
  function displayStatus(e, nowMs = Date.now()) {
    if (e.status !== STATUS.pending) return e.status;
    const s = startMs(e);
    if (isNaN(s)) return "upcoming";
    if (nowMs < s) return "upcoming";
    if (e.start_iso && nowMs < s + eventHours(e.sport) * 3600e3) return "live";
    return "awaiting";
  }

  /** Записи, по которым пора искать результат */
  function dueForCheck(history, nowMs = Date.now()) {
    return history.predictions.filter((e) => {
      if (!(e.status === STATUS.pending || e.status === STATUS.review || e.status === STATUS.postponed)) return false;
      const s = startMs(e);
      if (isNaN(s)) return false;
      const end = e.start_iso ? s + eventHours(e.sport) * 3600e3 : s + 24 * 3600e3;
      return nowMs >= end;
    });
  }

  /* ---------------- Статистика ---------------- */

  function inPeriod(e, fromMs, toMs) {
    const s = startMs(e);
    if (isNaN(s)) return fromMs == null;
    return (fromMs == null || s >= fromMs) && (toMs == null || s < toMs);
  }

  /**
   * Статистика по записям. filter: { days?, sport?, nowMs? }.
   * accuracy = won / (won + lost) × 100. void/cancelled/postponed/withdrawn/late — исключены из знаменателя.
   */
  function computeStats(entries, filter = {}) {
    const nowMs = filter.nowMs ?? Date.now();
    const fromMs = filter.days ? nowMs - filter.days * 86400e3 : null;
    const list = entries.filter((e) => (!filter.sport || e.sport === filter.sport) && inPeriod(e, fromMs, null));
    const c = { total: list.length, won: 0, lost: 0, void: 0, cancelled: 0, postponed: 0, withdrawn: 0, review: 0, pending: 0, late: 0 };
    const bySport = {};
    const byConf = {};
    const byDay = {};
    let brierSum = 0, logSum = 0, probN = 0;
    for (const e of list) {
      if (e.late) c.late++;
      const st = e.status in c ? e.status : "pending";
      c[st]++;
      const sp = (bySport[e.sport] = bySport[e.sport] || { sport: e.sport, name: e.sport_name, total: 0, won: 0, lost: 0 });
      sp.total++;
      if (st === "won" || st === "lost") {
        sp[st]++;
        const k = Math.max(1, Math.min(5, Number(e.confidence) || 0)) || 0;
        const cb = (byConf[k] = byConf[k] || { confidence: k, won: 0, lost: 0 });
        cb[st]++;
        const d = e.event_date || mskDateOf(e.start_iso) || "?";
        const db = (byDay[d] = byDay[d] || { date: d, won: 0, lost: 0 });
        db[st]++;
        const p = e.model_prob && Number(e.model_prob.value);
        if (p > 0 && p < 1) {
          const y = st === "won" ? 1 : 0;
          brierSum += (p - y) ** 2;
          logSum += -(y * Math.log(Math.max(p, 1e-6)) + (1 - y) * Math.log(Math.max(1 - p, 1e-6)));
          probN++;
        }
      }
    }
    const rate = (w, l) => (w + l ? Math.round((w / (w + l)) * 1000) / 10 : null);
    const evaluated = c.won + c.lost;
    const days = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
    let cw = 0, cl = 0;
    for (const d of days) { cw += d.won; cl += d.lost; d.accuracy = rate(d.won, d.lost); d.cumulative = rate(cw, cl); }
    return {
      ...c,
      evaluated,
      excluded: c.void + c.cancelled + c.postponed + c.withdrawn,
      unresolved: c.pending + c.review,
      accuracy: rate(c.won, c.lost),
      bySport: Object.values(bySport).map((s) => ({ ...s, accuracy: rate(s.won, s.lost) })),
      byConfidence: [1, 2, 3, 4, 5].map((k) => {
        const b = byConf[k] || { confidence: k, won: 0, lost: 0 };
        return { ...b, n: b.won + b.lost, accuracy: rate(b.won, b.lost) };
      }),
      timeline: days,
      probability: probN ? { n: probN, brier: Math.round((brierSum / probN) * 1000) / 1000, logloss: Math.round((logSum / probN) * 1000) / 1000 } : { n: 0 },
    };
  }


  /* ---------------- Экспрессы ---------------- */

  const LEG_STATUS = { won: "won", lost: "lost", void: "void", cancelled: "void", postponed: "void", withdrawn: "void" };

  /** Находит запись истории для звена экспресса (по виду спорта, дате, матчу и ставке) */
  function legEntry(history, leg) {
    const date = leg.start_iso ? mskDateOf(leg.start_iso) : null;
    const id = leg.hid || makeId(leg.sport, date, leg.match, leg.bet);
    return history.predictions.find((e) => e.id === id) || null;
  }

  /** Пересчитывает статус экспресса по статусам звеньев */
  function settleExpress(x, history) {
    let anyLost = false, anyPending = false, allVoid = true, odds = 1;
    for (const l of x.legs || []) {
      const e = legEntry(history, l);
      if (e && !l.hid) l.hid = e.id;
      const st = e ? (LEG_STATUS[e.status] || "pending") : "pending";
      l.status = st;
      if (st === "lost") anyLost = true;
      else if (st === "pending") anyPending = true;
      if (st !== "void") allVoid = false;
      if (st === "won") odds *= Number(l.odds) || 1;
    }
    const prev = x.status;
    x.status = anyLost ? "lost" : anyPending ? "pending" : allVoid ? "void" : "won";
    x.settled_odds = x.status === "won" && !x.forecast_only ? Math.round(odds * 100) / 100 : null;
    return prev !== x.status;
  }

  /**
   * Синхронизирует архив экспрессов с новым файлом прогнозов и историей.
   * store — { schema, expresses: [] }; next — новый predictions.json или null; at — время публикации.
   * Экспресс можно заменить только до начала первого события; после — он фиксируется.
   * Экспресс, убранный из файла до начала первого события, помечается снятым и не учитывается.
   */
  function syncExpress(store, history, next, at) {
    store = store && Array.isArray(store.expresses) ? store : { schema: SCHEMA_VERSION, expresses: [] };
    const report = { added: [], replaced: [], withdrawn: [], settled: [] };
    const atMs = Date.parse(at);
    const firstStart = (x) => Math.min(...(x.legs || []).map((l) => Date.parse(l.start_iso)).filter((t) => !isNaN(t)));
    const byId = new Map(store.expresses.map((x) => [x.id, x]));
    if (next && Array.isArray(next.express)) {
      const seen = new Set();
      for (const src of next.express) {
        if (!src || !src.id || !(src.legs || []).length) continue;
        seen.add(src.id);
        const legs = src.legs.map((l) => ({ sport: l.sport, match: l.match, bet: l.bet, odds: Number(l.odds) || null, start_iso: l.start_iso || null }));
        const total = src.forecast_only ? null : Math.round(legs.reduce((a, l) => a * (l.odds || 1), 1) * 100) / 100;
        const item = { id: src.id, tier: src.tier || "mid", title: src.title || "", legs, total_odds: total, reason: src.reason || "", weak_link: src.weak_link || "", published_at: at, status: "pending" };
        if (src.forecast_only) item.forecast_only = true;
        const old = byId.get(src.id);
        if (!old) { store.expresses.push(item); byId.set(item.id, item); report.added.push(item.id); continue; }
        if (old.status === "withdrawn" && atMs < firstStart(old)) { old.status = "pending"; report.added.push(old.id); }
        const same = JSON.stringify(old.legs.map((l) => [l.sport, l.match, l.bet, l.odds])) === JSON.stringify(legs.map((l) => [l.sport, l.match, l.bet, l.odds]));
        if (!same && atMs < firstStart(old)) {
          (old.versions = old.versions || []).push({ replaced_at: at, legs: old.legs, total_odds: old.total_odds });
          Object.assign(old, { ...item, published_at: old.published_at, updated_at: at, versions: old.versions });
          report.replaced.push(old.id);
        }
      }
      for (const x of store.expresses) {
        if (x.status === "pending" && !seen.has(x.id) && atMs < firstStart(x)) { x.status = "withdrawn"; report.withdrawn.push(x.id); }
      }
    }
    for (const x of store.expresses) {
      if (x.status === "withdrawn") continue;
      if (settleExpress(x, history) && x.status !== "pending") report.settled.push(x.id);
    }
    store.expresses.sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at) || a.id.localeCompare(b.id));
    return { store, report };
  }

  /** Статистика экспрессов: ставка 1000 на каждый рассчитанный */
  function expressStats(store) {
    const list = (store && store.expresses) || [];
    const won = list.filter((x) => x.status === "won"), lost = list.filter((x) => x.status === "lost");
    const profit = won.filter((x) => !x.forecast_only).reduce((a, x) => a + 1000 * ((x.settled_odds || x.total_odds) - 1), 0) -
      1000 * lost.filter((x) => !x.forecast_only).length;
    return { total: list.length, won: won.length, lost: lost.length, pending: list.filter((x) => x.status === "pending").length, profit: Math.round(profit) };
  }

  /* ---------------- Шардирование по месяцам ---------------- */

  const monthOf = (e) => (e.event_date || mskDateOf(e.published_at) || "0000-00").slice(0, 7);

  function splitByMonth(history) {
    const out = {};
    for (const e of history.predictions) {
      const m = monthOf(e);
      (out[m] = out[m] || { schema: SCHEMA_VERSION, month: m, predictions: [] }).predictions.push(e);
    }
    for (const m of Object.values(out)) m.predictions.sort((a, b) => (startMs(a) || 0) - (startMs(b) || 0) || a.id.localeCompare(b.id));
    return out;
  }
  function mergeMonths(files) {
    const h = emptyHistory();
    const ids = new Set();
    for (const f of files) for (const e of (f && f.predictions) || []) {
      if (ids.has(e.id)) continue;
      ids.add(e.id);
      h.predictions.push(e);
    }
    return h;
  }

  const api = {
    SCHEMA_VERSION, STATUS, FINAL, EXCLUDED,
    norm, normBet, splitTeams, makeId, parseStart, startMs, toMskIso, mskDateOf,
    snapshot, marketProb, qualityIssues,
    emptyHistory, archive, evaluateBet, evaluateMarket, parseScore, applyResults,
    displayStatus, dueForCheck, computeStats, splitByMonth, mergeMonths, monthOf,
    syncExpress, settleExpress, expressStats,
  };
  root.HistoryCore = api;
})(typeof window !== "undefined" ? window : globalThis);
