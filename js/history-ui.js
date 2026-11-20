/* Раздел «История прогнозов»: дашборд точности, графики и список завершённых событий. */
(function () {
  "use strict";
  const H = window.HistoryCore;
  const root = document.getElementById("history");
  if (!H || !root) return;

  const $ = (s, r = root) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "источник"; } };
  const SVGI = (inner) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${inner}</svg>`;
  const I_OUT = SVGI('<path d="M9 6h9v9"/><path d="M18 6L7 17"/>');
  const I_CHEV = SVGI('<path d="M6 9l6 6 6-6"/>');

  const SPORT = {
    football: { name: "Футбол", c: "#F0386E" }, basketball: { name: "Баскетбол", c: "#FF8A1F" },
    tennis: { name: "Теннис", c: "#8BE04E" }, volleyball: { name: "Волейбол", c: "#FF7A5C" },
    cs2: { name: "CS2", c: "#FFB22E" }, dota2: { name: "Dota 2", c: "#B5489F" },
    hockey: { name: "Хоккей", c: "#67C6FF" },
  };
  const sportName = (id, fb) => (SPORT[id] && SPORT[id].name) || fb || id;
  const sportColor = (id) => (SPORT[id] && SPORT[id].c) || "#8d99aa";

  const ST = {
    upcoming: { t: "Ожидается", k: "wait" },
    live: { t: "Идёт", k: "live" },
    awaiting: { t: "Ждёт результата", k: "wait" },
    won: { t: "Прогноз подтвердился", k: "won" },
    lost: { t: "Прогноз не подтвердился", k: "lost" },
    void: { t: "Возврат, не оценивается", k: "off" },
    cancelled: { t: "Матч отменён", k: "off" },
    postponed: { t: "Матч перенесён", k: "off" },
    review: { t: "Результат требует проверки", k: "review" },
    withdrawn: { t: "Снят до начала матча", k: "off" },
  };
  const DQ = { high: "полные", medium: "частичные", low: "скудные" };

  const state = { days: 30, sport: "", status: "", q: "", date: "", shown: 30, open: new Set() };
  let all = [];
  let models = {};
  let loaded = false;

  const fmtDayLong = (d) => {
    const t = new Date(d + "T12:00+03:00");
    const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
    const tom = new Date(Date.now() + 27 * 3600e3).toISOString().slice(0, 10);
    const yes = new Date(Date.now() - 21 * 3600e3).toISOString().slice(0, 10);
    const base = t.toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "short", timeZone: "Europe/Moscow" });
    return (d === today ? "Сегодня · " : d === tom ? "Завтра · " : d === yes ? "Вчера · " : "") + base;
  };
  const fmtDay = (d) => new Date(d + "T12:00+03:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
  function fmtWhen(e) {
    if (e.start_iso) {
      const s = new Date(e.start_iso).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
      return s.replace(" в ", ", ") + " МСК";
    }
    return e.start || (e.event_date ? fmtDay(e.event_date) : "");
  }
  const fmtStamp = (iso) => {
    const t = Date.parse(iso);
    return isNaN(t) ? "" : new Date(t).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).replace(" в ", ", ") + " МСК";
  };
  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  };

  /* ---------- Загрузка ---------- */
  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      const idx = await fetch("data/history/index.json?v=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
      if (!idx || !Array.isArray(idx.months)) throw new Error("index");
      (idx.models || []).forEach((m) => { models[m.id] = m; });
      const files = await Promise.all(idx.months.map((m) =>
        fetch(`data/history/${m}.json?v=${Date.now()}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
      all = H.mergeMonths(files.filter(Boolean)).predictions;
      render();
    } catch {
      $("#h-body").innerHTML = `<div class="empty"><strong>История пока недоступна</strong><p>Не удалось загрузить файл истории. Обновите страницу чуть позже.</p></div>`;
    }
  }

  /* ---------- Фильтрация ---------- */
  function filtered(list, nowMs) {
    const from = state.days ? nowMs - state.days * 86400e3 : null;
    const q = state.q.trim().toLowerCase();
    return list.filter((e) => {
      const s = H.startMs(e);
      if (from != null && !(s >= from)) return false;
      if (state.sport && e.sport !== state.sport) return false;
      if (state.date && e.event_date !== state.date) return false;
      if (q && !(`${e.tournament} ${e.match}`.toLowerCase().includes(q))) return false;
      if (state.status) {
        const d = H.displayStatus(e, nowMs);
        if (state.status === "won" && d !== "won") return false;
        if (state.status === "lost" && d !== "lost") return false;
        if (state.status === "open" && !["upcoming", "live", "awaiting", "review"].includes(d)) return false;
        if (state.status === "off" && !["void", "cancelled", "postponed", "withdrawn"].includes(d)) return false;
      }
      return true;
    });
  }

  /* ---------- Графики ---------- */
  function timelineSVG(tl) {
    if (!tl.length) return emptyChart("Появится после первых проверенных результатов");
    const W = Math.max(300, Math.round($("#h-timeline").clientWidth || 640)), Hh = W < 600 ? 190 : 250, L = 40, R = 12, T = 14, B = 34;
    const iw = W - L - R, ih = Hh - T - B;
    const n = tl.length;
    const step = iw / n;
    const maxDay = Math.max(1, ...tl.map((d) => d.won + d.lost));
    const barH = ih * 0.36;
    const y = (p) => T + ih * (1 - p / 100);
    const x = (i) => L + step * i + step / 2;
    let grid = "";
    for (const p of [0, 50, 100]) grid += `<line class="g" x1="${L}" x2="${W - R}" y1="${y(p)}" y2="${y(p)}"/><text class="ax" x="${L - 6}" y="${y(p) + 4}" text-anchor="end">${p}%</text>`;
    const bw = Math.min(22, step * 0.56);
    const bars = tl.map((d, i) => {
      const hw = (d.won / maxDay) * barH, hl = (d.lost / maxDay) * barH;
      const base = T + ih;
      return `<g class="bar" style="--d:${i}"><title>${fmtDay(d.date)}: ${d.won} верно, ${d.lost} ошибочно</title>
        <rect class="bw" x="${x(i) - bw / 2}" y="${base - hw - hl}" width="${bw}" height="${hw}" rx="2"/>
        <rect class="bl" x="${x(i) - bw / 2}" y="${base - hl}" width="${bw}" height="${hl}" rx="2"/></g>`;
    }).join("");
    const pts = tl.map((d, i) => [x(i), y(d.cumulative)]);
    const path = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const dots = pts.map((p, i) => `<circle class="pt" cx="${p[0]}" cy="${p[1]}" r="3.2"><title>${fmtDay(tl[i].date)}: накопленная точность ${tl[i].cumulative}%</title></circle>`).join("");
    const every = Math.ceil(n / 8);
    const labels = tl.map((d, i) => (i % every === 0 || i === n - 1) ? `<text class="ax" x="${x(i)}" y="${Hh - 12}" text-anchor="middle">${fmtDay(d.date)}</text>` : "").join("");
    return `<svg class="chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Динамика точности по дням">
      ${grid}${bars}<path class="line" d="${path}" pathLength="1"/>${dots}${labels}</svg>
      <div class="legend"><span><i class="lg-line"></i>Накопленная точность</span><span><i class="lg-won"></i>Верно за день</span><span><i class="lg-lost"></i>Ошибочно за день</span></div>`;
  }

  function sportBarsHTML(bySport) {
    const rows = bySport.filter((s) => s.won + s.lost > 0).sort((a, b) => (b.won + b.lost) - (a.won + a.lost));
    if (!rows.length) return emptyChart("Нет оценённых прогнозов за период");
    return `<ul class="hbars">` + rows.map((s, i) => {
      const n = s.won + s.lost;
      return `<li style="--c:${sportColor(s.sport)};--i:${i}">
        <span class="hb-name">${esc(sportName(s.sport, s.name))}</span>
        <span class="hb-track" title="${s.won} из ${n}"><span class="hb-fill" style="--w:${s.accuracy}%"></span></span>
        <span class="hb-val"><b>${s.accuracy}%</b> ${s.won}/${n}</span></li>`;
    }).join("") + `</ul>`;
  }

  function calibrationHTML(byConf, prob) {
    const rows = byConf.filter((c) => c.n > 0);
    if (!rows.length) return emptyChart("Нет оценённых прогнозов за период");
    const body = `<ul class="cal">` + byConf.map((c) => `
      <li class="${c.n ? "" : "none"}">
        <span class="cal-bar"><span class="cal-fill" style="--h:${c.accuracy ?? 0}%"></span></span>
        <b>${c.n ? c.accuracy + "%" : "—"}</b>
        <span class="cal-k">${c.confidence}<small>${c.n} ${plural(c.n, "прогноз", "прогноза", "прогнозов")}</small></span>
      </li>`).join("") + `</ul>`;
    const metric = prob && prob.n
      ? `<p class="chart-note">По ${prob.n} ${plural(prob.n, "прогнозу", "прогнозам", "прогнозам")} с вероятностью модели: Brier ${prob.brier}, Log Loss ${prob.logloss} (меньше — лучше).</p>`
      : `<p class="chart-note">Brier Score и Log Loss появятся, когда у прогнозов будут вероятности от моделей-источников.</p>`;
    return body + metric;
  }
  const emptyChart = (t) => `<div class="chart-empty"><svg viewBox="0 0 96 34" aria-hidden="true"><path d="M2 26h20l8-12 10 16 9-20 9 10h36"/></svg>${esc(t)}</div>`;

  function donutHTML(s) {
    const R = 46, C = 2 * Math.PI * R, n = s.won + s.lost;
    const per = { 7: "7 дней", 30: "30 дней", 90: "90 дней", 0: "всё время" }[state.days] || "период";
    const wonL = n ? (s.won / n) * C : 0, lostL = n ? (s.lost / n) * C : 0;
    const gap = n && s.won && s.lost ? 2 : 0;
    return `
      <svg class="donut" viewBox="0 0 112 112" role="img" aria-label="${n ? `Точность ${s.accuracy}%: ${s.won} подтвердилось, ${s.lost} не подтвердилось` : "Нет оценённых прогнозов"}">
        <circle class="d-bg" cx="56" cy="56" r="${R}"/>
        ${n ? `<circle class="d-won" cx="56" cy="56" r="${R}" stroke-dasharray="${Math.max(0, wonL - gap).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 56 56)"/>
        <circle class="d-lost" cx="56" cy="56" r="${R}" stroke-dasharray="${Math.max(0, lostL - gap).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-wonL).toFixed(2)}" transform="rotate(-90 56 56)"/>` : ""}
        <text class="d-val" x="56" y="60" text-anchor="middle">${n ? s.accuracy + "%" : "—"}</text>
        <text class="d-sub" x="56" y="76" text-anchor="middle">${n ? "точность" : "нет оценок"}</text>
      </svg>
      <div>
        <h3>Точность за ${esc(per)}</h3>
        <dl>
          <div><dt><i style="background:var(--accent)"></i>Подтвердилось</dt><dd>${s.won}</dd></div>
          <div><dt><i style="background:var(--err)"></i>Не подтвердилось</dt><dd>${s.lost}</dd></div>
        </dl>
      </div>`;
  }

  /* ---------- Карточки ---------- */
  function analysisBlock(e) {
    const li = (a) => (a || []).filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join("");
    const facts = li(e.facts), against = li(e.against);
    const ver = (e.versions || []).length
      ? `<details class="h-ver"><summary>Предыдущие версии: ${e.versions.length}</summary>${e.versions.map((v) => `
          <div class="h-v"><small>${esc(fmtStamp(v.at))} → заменена ${esc(fmtStamp(v.replaced_at))}. ${esc(v.reason || "")}</small>
          <p><b>${esc(v.snapshot.bet || "")}</b>${v.snapshot.odds ? ` · кф ${esc(v.snapshot.odds)}` : ""}${v.snapshot.confidence ? ` · уверенность ${esc(v.snapshot.confidence)}/5` : ""}</p>
          ${v.snapshot.reason ? `<p>${esc(v.snapshot.reason)}</p>` : ""}</div>`).join("")}</details>` : "";
    const log = (e.status_log || []).length
      ? `<p class="h-meta">${e.status_log.map((l) => `${esc(fmtStamp(l.at))}: ${esc((ST[l.to] || {}).t || l.to)}${l.note ? ` — ${esc(l.note)}` : ""}`).join("<br>")}</p>` : "";
    const res = e.result
      ? `<p class="h-meta">Результат проверен ${esc(fmtStamp(e.result.checked_at))}${e.result.note ? ` · ${esc(e.result.note)}` : ""}${(e.result.sources || []).length ? " · " + e.result.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="nofollow noopener">${esc(host(s.url))}</a>`).join(", ") : ""}</p>` : "";
    const model = models[e.model_version];
    return `
      <p class="h-meta">Опубликован ${esc(fmtStamp(e.published_at))}${e.updated_at ? ` · последняя правка до начала ${esc(fmtStamp(e.updated_at))}` : ""} · методика ${esc(model ? model.title : e.model_version || "v1")}</p>
      ${e.reason ? `<p class="h-reason">${esc(e.reason)}</p>` : ""}
      ${facts ? `<p class="h-sub">Факты в пользу вывода</p><ul class="factors">${facts}</ul>` : ""}
      ${against ? `<p class="h-sub">Что говорит против</p><ul class="factors con">${against}</ul>` : ""}
      ${e.uncertainty ? `<p class="h-sub">Неопределённость</p><p class="h-text">${esc(e.uncertainty)}</p>` : ""}
      ${e.data_quality && e.data_quality.level ? `<p class="h-meta">Данные: ${esc(DQ[e.data_quality.level] || e.data_quality.level)}${e.data_quality.note ? ` — ${esc(e.data_quality.note)}` : ""}</p>` : ""}
      ${!facts && !e.uncertainty ? `<p class="h-meta">Прогноз опубликован по прежней методике, без разбора фактов «за» и «против».</p>` : ""}
      ${(e.sources || []).length ? `<div class="srcs">${e.sources.map((s) => `<a class="src" href="${esc(s.url)}" target="_blank" rel="nofollow noopener" title="${esc(s.title)}">${esc(host(s.url))}${I_OUT}</a>`).join("")}</div>` : ""}
      ${res}${log}${ver}`;
  }

  function cardHTML(e, nowMs, i) {
    const d = H.displayStatus(e, nowMs);
    const st = ST[d] || { t: d, k: "wait" };
    const open = state.open.has(e.id);
    const did = "ha-" + e.id;
    return `
      <article class="h-card st-${st.k}${open ? " open" : ""}" style="--c:${sportColor(e.sport)};--i:${Math.min(i, 10)}" data-id="${esc(e.id)}">
        <div class="h-main">
          <span class="h-sport">${esc(sportName(e.sport, e.sport_name))}</span>
          <h3>${esc(e.match)}</h3>
          <p class="h-tour">${esc(e.tournament || "")}${e.tournament ? " · " : ""}${esc(fmtWhen(e))}</p>
        </div>
        <dl class="h-out">
          <div><dt>Прогноз</dt><dd>${esc(e.bet)}${e.odds ? ` <small>кф ${esc(e.odds)}</small>` : ""}</dd></div>
          <div><dt>Результат</dt><dd>${e.result && e.result.score ? `<b class="score">${esc(e.result.score)}</b>` : "—"}</dd></div>
        </dl>
        <span class="h-status"><i></i>${esc(st.t)}</span>
        <button class="h-toggle" type="button" aria-expanded="${open}" aria-controls="${esc(did)}">
          <span>${open ? "Скрыть анализ" : "Посмотреть первоначальный анализ"}</span>${I_CHEV}
        </button>
        <div class="more" id="${esc(did)}"><div><div class="h-analysis">${analysisBlock(e)}</div></div></div>
      </article>`;
  }

  /* ---------- Отрисовка ---------- */
  function render() {
    const nowMs = Date.now();
    const scope = filtered(all, nowMs);
    const statsBase = all.filter((e) => (!state.sport || e.sport === state.sport));
    const s = H.computeStats(statsBase, { days: state.days || null, nowMs });

    // фильтр по видам спорта — только виды, что есть в истории
    const sports = [...new Set(all.map((e) => e.sport))];
    $("#h-sport").innerHTML = `<option value="">Все виды спорта</option>` +
      sports.map((id) => `<option value="${esc(id)}"${state.sport === id ? " selected" : ""}>${esc(sportName(id))}</option>`).join("");

    $("#h-acc").innerHTML = donutHTML(s);
    const kpi = [
      ["Опубликовано", s.total, "все прогнозы за период"],
      ["Оценено", s.evaluated, "результат известен"],
      ["Ожидают результата", s.unresolved, "матч впереди или идёт"],
      ["Не оцениваются", s.excluded, "возвраты, отмены, снятые"],
    ];
    $("#h-kpi").innerHTML = kpi.map(([t, v, d]) => `<div class="kpi"><b>${v}</b><span>${t}<br><small>${d}</small></span></div>`).join("");
    $("#h-kpi-note").textContent = s.excluded || s.late
      ? `Не входят в точность: ${s.excluded} (возвраты, отмены, переносы и снятые до начала)${s.late ? `, из них опубликованы после начала: ${s.late}` : ""}. Точность = подтвердившиеся / (подтвердившиеся + неподтвердившиеся).`
      : "Точность = подтвердившиеся / (подтвердившиеся + неподтвердившиеся). Возвраты и отменённые матчи не учитываются.";

    $("#h-timeline").innerHTML = timelineSVG(s.timeline);
    $("#h-sports").innerHTML = sportBarsHTML(s.bySport);
    $("#h-cal").innerHTML = calibrationHTML(s.byConfidence, s.probability);

    const OPEN = new Set(["upcoming", "live", "awaiting", "review"]);
    const list = scope.slice().sort((a, b) => (H.startMs(b) || 0) - (H.startMs(a) || 0));
    const body = $("#h-list");
    $("#h-count").textContent = list.length
      ? `${list.length} ${plural(list.length, "событие", "события", "событий")}`
      : "";
    if (!list.length) {
      body.innerHTML = `<div class="empty"><strong>${all.length ? "Ничего не найдено" : "История только начинается"}</strong><p>${all.length ? "Измените период или фильтры." : "Прогнозы попадают сюда в момент публикации, а результаты — после проверки по итогам матчей."}</p></div>`;
    } else {
      const openAll = list.filter((e) => OPEN.has(H.displayStatus(e, nowMs))).sort((a, b) => (H.startMs(a) || 0) - (H.startMs(b) || 0)); // ближайшие сверху
      const doneAll = list.filter((e) => !OPEN.has(H.displayStatus(e, nowMs)));
      const open = openAll.slice(0, state.shown);
      const done = doneAll.slice(0, Math.max(0, state.shown - open.length));
      let k = 0;
      const days = (arr) => {
        const by = new Map();
        arr.forEach((e) => { const d = e.event_date || "—"; if (!by.has(d)) by.set(d, []); by.get(d).push(e); });
        return [...by.entries()].map(([d, items]) => `
          <div class="h-day"><span class="h-date">${d === "—" ? "Дата не указана" : esc(fmtDayLong(d))}</span>
            <div class="h-cards">${items.map((e) => cardHTML(e, nowMs, k++)).join("")}</div></div>`).join("");
      };
      body.innerHTML =
        (open.length ? `<section class="h-group"><h3><i></i>Ожидают результата<small>${openAll.length}</small></h3>${days(open)}</section>` : "") +
        (done.length ? `<section class="h-group done"><h3><i></i>Завершённые и снятые<small>${doneAll.length}</small></h3>${days(done)}</section>` : "") +
        (list.length > state.shown ? `<button class="toggle h-more" type="button">Показать ещё ${Math.min(30, list.length - state.shown)}</button>` : "");
    }
    root.classList.add("ready");
  }

  /* ---------- События ---------- */
  root.addEventListener("click", (ev) => {
    const per = ev.target.closest("[data-days]");
    if (per) {
      state.days = Number(per.dataset.days) || 0;
      state.shown = 30;
      root.querySelectorAll("[data-days]").forEach((b) => b.setAttribute("aria-pressed", b === per));
      render();
      return;
    }
    const t = ev.target.closest(".h-toggle");
    if (t) {
      const card = t.closest(".h-card");
      const id = card.dataset.id;
      const open = !card.classList.contains("open");
      card.classList.toggle("open", open);
      open ? state.open.add(id) : state.open.delete(id);
      t.setAttribute("aria-expanded", open);
      t.querySelector("span").textContent = open ? "Скрыть анализ" : "Посмотреть первоначальный анализ";
      return;
    }
    if (ev.target.closest(".h-more")) { state.shown += 30; render(); }
  });
  $("#h-sport").addEventListener("change", (e) => { state.sport = e.target.value; state.shown = 30; render(); });
  $("#h-status").addEventListener("change", (e) => { state.status = e.target.value; state.shown = 30; render(); });
  $("#h-date").addEventListener("change", (e) => { state.date = e.target.value; state.shown = 30; render(); });
  let qT;
  $("#h-q").addEventListener("input", (e) => { clearTimeout(qT); qT = setTimeout(() => { state.q = e.target.value; state.shown = 30; render(); }, 180); });

  // загружаем историю, когда раздел близко к экрану (или сразу по ссылке #history)
  if (location.hash === "#history" || !("IntersectionObserver" in window)) load();
  else {
    const io = new IntersectionObserver((ents) => { if (ents.some((x) => x.isIntersecting)) { io.disconnect(); load(); } }, { rootMargin: "600px 0px" });
    io.observe(root);
  }
  window.addEventListener("hashchange", () => { if (location.hash === "#history") load(); });
  if (calm()) root.classList.add("calm");
  let lastW = 0, rT;
  window.addEventListener("resize", () => {
    clearTimeout(rT);
    rT = setTimeout(() => { const w = $("#h-timeline").clientWidth; if (all.length && Math.abs(w - lastW) > 40) { lastW = w; render(); } }, 200);
  });
})();
