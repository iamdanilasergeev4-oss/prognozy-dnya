(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const calm = () => reduceMotion.matches;

  /* ---------- Иконки (собственные линейные SVG) ---------- */
  const svg = (inner, cls = "ico", vb = "0 0 24 24") =>
    `<svg class="${cls}" viewBox="${vb}" aria-hidden="true" focusable="false">${inner}</svg>`;
  const ICON_PATHS = {
    football: '<circle cx="12" cy="12" r="9.2"/><path d="M12 7.6l3.6 2.6-1.4 4.2H9.8L8.4 10.2z"/><path d="M12 7.6V2.9M15.6 10.2l4.3-1.5M14.2 14.4l2.7 3.9M9.8 14.4l-2.7 3.9M8.4 10.2L4.1 8.7"/>',
    basketball: '<circle cx="12" cy="12" r="9.2"/><path d="M2.8 12h18.4M12 2.8v18.4"/><path d="M5.6 5.4c2.6 2 3.9 4.2 3.9 6.6s-1.3 4.6-3.9 6.6M18.4 5.4c-2.6 2-3.9 4.2-3.9 6.6s1.3 4.6 3.9 6.6"/>',
    tennis: '<circle cx="12" cy="12" r="9.2"/><path d="M4.6 6.4c3.4 1.7 5 3.6 5 5.6s-1.6 3.9-5 5.6M19.4 6.4c-3.4 1.7-5 3.6-5 5.6s1.6 3.9 5 5.6"/>',
    volleyball: '<circle cx="12" cy="12" r="9.2"/><path d="M12 12c0-3.6 1.6-6.6 4.6-8.4M12 12c-3.1 1.8-6.5 1.9-9.1.4M12 12c3.1 1.8 4.9 4.7 4.5 7.9"/><path d="M8 3.8c2.2 1.8 3.6 4.5 4 8.2M2.9 13.2c3.2-.4 6.2.3 9.1 2.6"/>',
    cs2: '<circle cx="12" cy="12" r="7.4"/><circle cx="12" cy="12" r="1.3"/><path d="M12 1.8v5M12 17.2v5M1.8 12h5M17.2 12h5"/>',
    dota2: '<path d="M4.5 3.5h15a1 1 0 011 1v15a1 1 0 01-1 1h-15a1 1 0 01-1-1v-15a1 1 0 011-1z"/><path d="M5.5 18.5L18.5 5.5"/><path d="M6.5 9.5l1.6-1.6M15.9 16.1l1.6-1.6"/><circle cx="7" cy="17" r="1.3"/><circle cx="17" cy="7" r="1.3"/>',
    analysis: '<path d="M3.5 19.5h17"/><path d="M5.5 16l4-5 3.5 3 5.5-7"/><circle cx="18.5" cy="7" r="1.4"/>',
    generic: '<circle cx="12" cy="12" r="9.2"/><path d="M8 12h8"/>',
  };
  const icon = (id, cls) => svg(ICON_PATHS[id] || ICON_PATHS.generic, cls ? "ico " + cls : "ico");
  const I_CLOCK = svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>');
  const I_TROPHY = svg('<path d="M8 4h8v5a4 4 0 01-8 0z"/><path d="M8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8.5 20h7"/>');
  const I_OUT = svg('<path d="M9 6h9v9"/><path d="M18 6L7 17"/>');
  const I_CHEV = svg('<path d="M6 9l6 6 6-6"/>');
  const I_OK = svg('<circle cx="12" cy="12" r="9.5" opacity=".35"/><path d="M7.5 12.5l3 3 6-6.5"/>');
  const I_ERR = svg('<circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v5.5M12 16.4v.1"/>');

  /* Цвет каждого вида спорта внутри общей системы */
  const COLORS = {
    football: "#72F5BB", basketball: "#FF9F5A", tennis: "#D9F36A", volleyball: "#FFD166",
    cs2: "#65B9FF", dota2: "#FF6B7A", analysis: "#B9A2FF",
  };
  const colorOf = (id) => COLORS[id] || "#72F5BB";

  const CONF_LABEL = ["", "низкое", "слабое", "среднее", "высокое", "очень высокое"];
  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  };

  let data = null;
  let current = null;
  let rendering = null;

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
    }).replace(" в ", ", ") + " МСК";
  }
  const mskDay = (d) => d.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
  function host(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "источник"; }
  }
  const hasAnalysis = () => Array.isArray(data?.analysis) && data.analysis.length > 0;

  /* ---------- Шапка ---------- */
  const top = $("#top");
  const onScroll = () => top.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Фон: узлы и связи ---------- */
  (function background() {
    const el = $("#bg");
    const NS = "http://www.w3.org/2000/svg";
    let nodes = [], edges = [], g, w = 0, h = 0, raf = 0, t0 = performance.now();
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };

    function build() {
      w = window.innerWidth; h = window.innerHeight;
      el.setAttribute("viewBox", `0 0 ${w} ${h}`);
      el.innerHTML = "";
      g = document.createElementNS(NS, "g");
      el.appendChild(g);
      const count = Math.max(12, Math.min(40, Math.round((w * h) / 46000)));
      // псевдослучайная, но стабильная раскладка: сетка с дрожанием
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const cols = Math.ceil(Math.sqrt(count * (w / h)));
      const rows = Math.ceil(count / cols);
      nodes = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (nodes.length >= count) break;
        const hx = ((c + 0.2 + rnd() * 0.6) / cols) * w * 1.08 - w * 0.04;
        const hy = ((r + 0.2 + rnd() * 0.6) / rows) * h * 1.08 - h * 0.04;
        nodes.push({ hx, hy, x: hx, y: hy, ax: 8 + rnd() * 18, ay: 8 + rnd() * 18,
          sx: 0.00008 + rnd() * 0.00016, sy: 0.00008 + rnd() * 0.00016, p: rnd() * 6.28, r: 1 + rnd() * 1.2 });
      }
      // рёбра: два ближайших соседа
      const seen = new Set();
      edges = [];
      nodes.forEach((a, i) => {
        nodes.map((b, j) => [j, (a.hx - b.hx) ** 2 + (a.hy - b.hy) ** 2])
          .filter(([j]) => j !== i).sort((x, y) => x[1] - y[1]).slice(0, 2)
          .forEach(([j, d]) => {
            const key = i < j ? i + "-" + j : j + "-" + i;
            if (seen.has(key) || d > (Math.max(w, h) * 0.32) ** 2) return;
            seen.add(key);
            const ln = document.createElementNS(NS, "line");
            g.appendChild(ln);
            edges.push({ a: i, b: j, el: ln });
          });
      });
      nodes.forEach((n) => {
        n.el = document.createElementNS(NS, "circle");
        n.el.setAttribute("r", n.r.toFixed(2));
        g.appendChild(n.el);
      });
      nodes[Math.floor(nodes.length / 3)].el.classList.add("hot");
      nodes[Math.floor((nodes.length * 3) / 4)].el.classList.add("hot");
      frame(performance.now(), true);
    }

    function frame(now, once) {
      const t = now - t0;
      for (const n of nodes) {
        n.x = n.hx + Math.sin(t * n.sx + n.p) * n.ax;
        n.y = n.hy + Math.cos(t * n.sy + n.p) * n.ay;
        n.el.setAttribute("cx", n.x.toFixed(1));
        n.el.setAttribute("cy", n.y.toFixed(1));
      }
      for (const e of edges) {
        const a = nodes[e.a], b = nodes[e.b];
        e.el.setAttribute("x1", a.x.toFixed(1)); e.el.setAttribute("y1", a.y.toFixed(1));
        e.el.setAttribute("x2", b.x.toFixed(1)); e.el.setAttribute("y2", b.y.toFixed(1));
      }
      mouse.x += (mouse.tx - mouse.x) * 0.05;
      mouse.y += (mouse.ty - mouse.y) * 0.05;
      g.setAttribute("transform", `translate(${mouse.x.toFixed(2)} ${mouse.y.toFixed(2)})`);
      if (!once) raf = requestAnimationFrame(frame);
    }

    function ping() {
      if (calm() || document.hidden || !nodes.length) return;
      const n = nodes[Math.floor(Math.random() * nodes.length)];
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("class", "ping");
      c.setAttribute("cx", n.x); c.setAttribute("cy", n.y); c.setAttribute("r", "2");
      g.appendChild(c);
      const anim = c.animate([{ r: 2, opacity: 0.5 }, { r: 26, opacity: 0 }], { duration: 2600, easing: "ease-out" });
      anim.onfinish = () => c.remove();
    }

    const start = () => { cancelAnimationFrame(raf); if (!calm() && !document.hidden) raf = requestAnimationFrame(frame); };
    let rt;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { build(); start(); }, 200); });
    window.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      mouse.tx = (e.clientX / w - 0.5) * -18;
      mouse.ty = (e.clientY / h - 0.5) * -18;
    }, { passive: true });
    document.addEventListener("visibilitychange", start);
    reduceMotion.addEventListener?.("change", start);
    build(); start();
    setInterval(ping, 2800);
  })();

  /* ---------- Сводка на первом экране ---------- */
  function signalPath(confs) {
    const W = 200, B = 25, n = confs.length;
    if (!n) return { d: `M2 ${B}H198`, area: "", tip: [198, B] };
    let d = `M2 ${B}`;
    const step = 186 / n;
    confs.forEach((c, i) => {
      const x = 10 + step * (i + 0.5);
      const hgt = 4 + Math.max(1, Math.min(5, c)) * 3.9;
      const w2 = Math.min(5, step / 2.6);
      d += ` L${(x - w2).toFixed(1)} ${B} L${(x - w2 / 3).toFixed(1)} ${(B - hgt).toFixed(1)} L${(x + w2 / 3).toFixed(1)} ${(B + hgt * 0.16).toFixed(1)} L${(x + w2).toFixed(1)} ${B}`;
    });
    d += ` L${W - 2} ${B}`;
    return { d, area: d + ` L${W - 2} ${B} L2 ${B}Z`, tip: [W - 2, B] };
  }

  function renderPulse() {
    const rows = $("#pulse-rows");
    const list = data.sports.map((s) => {
      const confs = (s.picks || []).map((p) => Number(p.confidence) || 3);
      const sig = signalPath(confs);
      const n = confs.length;
      return `
        <button class="lane${n ? "" : " empty"}${s.id === current ? " on" : ""}" type="button" data-id="${esc(s.id)}" style="--c:${colorOf(s.id)}"
          aria-label="${esc(s.name)}: ${n} ${plural(n, "прогноз", "прогноза", "прогнозов")}">
          ${icon(s.id)}
          <span class="nm">${esc(s.name)}</span>
          <svg class="sig" viewBox="0 0 200 30" preserveAspectRatio="none" aria-hidden="true">
            <line class="base" x1="2" y1="25" x2="198" y2="25" vector-effect="non-scaling-stroke"/>
            ${sig.area ? `<path class="area" d="${sig.area}"/>` : ""}
            <path class="wave" d="${sig.d}" vector-effect="non-scaling-stroke"/>
          </svg>
          <span class="num${n ? "" : " zero"}">${n}</span>
        </button>`;
    }).join("");
    rows.innerHTML = list;

    const hosts = new Set();
    data.sports.forEach((s) => (s.picks || []).forEach((p) => (p.sources || []).forEach((x) => hosts.add(host(x.url)))));
    (data.analysis || []).forEach((a) => (a.sources || []).forEach((x) => hosts.add(host(x.url))));
    const total = data.sports.reduce((k, s) => k + (s.picks || []).length, 0);
    $("#pulse-cap").textContent =
      `${total} ${plural(total, "прогноз", "прогноза", "прогнозов")} по данным ${hosts.size} ${plural(hosts.size, "сайта", "сайтов", "сайтов")}. ` +
      `Каждый пик — один прогноз, его высота — уверенность прогноза.`;

    rows.querySelectorAll(".lane").forEach((b, i) => {
      b.addEventListener("click", () => { select(b.dataset.id, true); });
      if (calm()) return;
      const wave = b.querySelector(".wave");
      // non-scaling-stroke: длина штриха считается в экранных пикселях
      const box = wave.ownerSVGElement.getBoundingClientRect();
      const k = Math.max(box.width / 200, box.height / 30, 1);
      const len = Math.ceil((wave.getTotalLength ? wave.getTotalLength() : 400) * k * 1.1);
      wave.addEventListener("transitionend", () => { wave.style.strokeDasharray = "none"; }, { once: true });
      wave.style.strokeDasharray = len;
      wave.style.strokeDashoffset = len;
      wave.getBoundingClientRect();
      wave.style.transition = `stroke-dashoffset 1.3s cubic-bezier(.2,.7,.2,1) ${0.35 + i * 0.09}s`;
      wave.style.strokeDashoffset = 0;
    });
  }

  /* ---------- Вкладки ---------- */
  const tabsEl = $("#tabs");
  const ind = $("#tab-ind");
  const panel = $("#panel");

  function tabList() {
    const list = data.sports.map((s) => ({ id: s.id, name: s.name, n: (s.picks || []).length }));
    if (hasAnalysis()) list.push({ id: "analysis", name: "Разбор дня", n: data.analysis.length });
    return list;
  }

  function renderTabs() {
    tabsEl.querySelectorAll(".tab").forEach((t) => t.remove());
    const html = tabList().map((t) => `
      <button class="tab" role="tab" id="tab-${esc(t.id)}" data-id="${esc(t.id)}" aria-controls="panel"
        aria-selected="${t.id === current}" tabindex="${t.id === current ? 0 : -1}" style="--c:${colorOf(t.id)}">
        ${icon(t.id)}<span>${esc(t.name)}</span><span class="n">${t.n}</span>
      </button>`).join("");
    tabsEl.insertAdjacentHTML("beforeend", html);
    tabsEl.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => select(b.dataset.id)));
    panel.setAttribute("aria-labelledby", "tab-" + current);
    requestAnimationFrame(() => moveIndicator(true));
  }

  function moveIndicator(instant) {
    const b = tabsEl.querySelector(`.tab[aria-selected="true"]`);
    if (!b) return;
    if (instant) ind.style.transition = "none";
    ind.style.width = b.offsetWidth + "px";
    ind.style.transform = `translateX(${b.offsetLeft}px)`;
    if (instant) { ind.getBoundingClientRect(); ind.style.transition = ""; }
    const sl = tabsEl.scrollLeft, vis = tabsEl.clientWidth;
    if (b.offsetLeft < sl + 8 || b.offsetLeft + b.offsetWidth > sl + vis - 8) {
      tabsEl.scrollTo({ left: b.offsetLeft - vis / 2 + b.offsetWidth / 2, behavior: calm() ? "auto" : "smooth" });
    }
  }
  window.addEventListener("resize", () => moveIndicator(true));
  document.fonts?.ready?.then(() => moveIndicator(true));

  tabsEl.addEventListener("keydown", (e) => {
    const tabs = [...tabsEl.querySelectorAll(".tab")];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    let j = null;
    if (e.key === "ArrowRight") j = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = tabs.length - 1;
    if (j === null) return;
    e.preventDefault();
    select(tabs[j].dataset.id);
    tabsEl.querySelector(`#tab-${CSS.escape(tabs[j].dataset.id)}`)?.focus();
  });

  function select(id, scroll) {
    if (!data) return;
    const valid = tabList().some((t) => t.id === id);
    if (!valid) return;
    if (scroll) $("#board").scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "start" });
    if (id === current) return;
    current = id;
    history.replaceState(null, "", "#" + id);
    document.documentElement.style.setProperty("--sport", colorOf(id));
    tabsEl.querySelectorAll(".tab").forEach((b) => {
      const on = b.dataset.id === id;
      b.setAttribute("aria-selected", on);
      b.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll(".lane").forEach((l) => l.classList.toggle("on", l.dataset.id === id));
    panel.setAttribute("aria-labelledby", "tab-" + id);
    moveIndicator();
    syncNav();
    renderPanel(true);
  }

  /* ---------- Содержимое панели ---------- */
  function srcChips(list) {
    return (list || []).map((s) =>
      `<a class="src" href="${esc(s.url)}" target="_blank" rel="nofollow noopener" title="${esc(s.title)}">${esc(host(s.url))}${I_OUT}</a>`).join("");
  }
  function facts(tournament, start) {
    return `<div class="facts">
      ${tournament ? `<span>${I_TROPHY}${esc(tournament)}</span>` : ""}
      ${start ? `<span>${I_CLOCK}${esc(start)}</span>` : ""}
    </div>`;
  }

  const DQ_LABEL = { high: "полные", medium: "частичные", low: "скудные" };
  /* Разбор прогноза: факты «за», «против», неопределённость */
  function whyHTML(p, i) {
    const li = (a) => (Array.isArray(a) ? a : []).filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join("");
    const pro = li(p.facts), con = li(p.against);
    if (!pro && !con && !p.uncertainty) return "";
    const id = `why-${current}-${i}`;
    return `
      <div class="why">
        <button class="why-btn" type="button" aria-expanded="false" aria-controls="${id}"><span>Почему такой вывод</span>${I_CHEV}</button>
        <div class="more" id="${id}"><div>
          ${pro ? `<p class="factors-title">Факты в пользу вывода</p><ul class="factors">${pro}</ul>` : ""}
          ${con ? `<p class="factors-title">Что говорит против</p><ul class="factors con">${con}</ul>` : ""}
          ${p.uncertainty ? `<p class="factors-title">Неопределённость</p><p class="why-text">${esc(p.uncertainty)}</p>` : ""}
          ${p.model_prob && p.model_prob.value ? `<p class="why-text small">Вероятность по модели ${esc(p.model_prob.source || "")}: ${Math.round(p.model_prob.value * 100)}%</p>` : ""}
        </div></div>
      </div>`;
  }

  function sportHTML(sport) {
    const picks = sport.picks || [];
    const tours = new Set(picks.map((p) => String(p.tournament || "").split(",")[0].trim()).filter(Boolean));
    const sub = picks.length
      ? `${picks.length} ${plural(picks.length, "прогноз", "прогноза", "прогнозов")} из ${tours.size} ${plural(tours.size, "турнира", "турниров", "турниров")}`
      : "Прогнозов пока нет";
    let html = `
      <div class="sport-head">
        ${icon(sport.id, "big-ico")}
        <div><h2>${esc(sport.name)}</h2><p>${sub}</p></div>
      </div>`;
    if (sport.stale && sport.updated_at) {
      html += `<p class="note warn">Сегодня обновить не удалось — показаны прогнозы от ${esc(fmtDate(sport.updated_at))}.</p>`;
    }
    if (!picks.length) {
      return html + `
        <div class="empty">
          ${svg('<path d="M2 20h116"/>', "", "0 0 120 40")}
          <strong>На сегодня подходящих прогнозов нет</strong>
          <p>Источники ещё не опубликовали прогнозы на ближайшие матчи. Сводка обновляется утром и вечером — загляните позже.</p>
        </div>`;
    }
    const top = Math.max(...picks.map((p) => Number(p.confidence) || 0));
    html += `<div class="list">` + picks.map((p, i) => {
      const conf = Math.max(1, Math.min(5, Number(p.confidence) || 3));
      const bars = Array.from({ length: 5 }, (_, k) => `<i class="${k < conf ? "on" : ""}"></i>`).join("");
      return `
        <article class="pick${conf === top && conf >= 4 ? " lead" : ""}" style="--i:${i}">
          <div class="rank" aria-label="Место ${i + 1}">${i + 1}</div>
          <h3 class="match">${window.Crest ? Crest.matchHTML(p.match, sport.id, esc) : esc(p.match)}</h3>
          <div class="betbox">
            <span class="bet">${esc(p.bet)}</span>
            ${p.odds ? `<span class="odds">кф<b>${esc(p.odds)}</b></span>` : ""}
          </div>
          ${facts(p.tournament, p.start)}
          ${p.reason ? `<p class="reason">${esc(p.reason)}</p>` : ""}
          ${whyHTML(p, i)}
          <div class="pick-foot">
            <span class="meter" title="Насколько вывод подкреплён фактами и согласием независимых источников">
              <span class="bars" aria-hidden="true">${bars}</span>
              <span>Уверенность: <b>${CONF_LABEL[conf]}</b></span>
            </span>
            ${p.data_quality && p.data_quality.level ? `<span class="dq dq-${esc(p.data_quality.level)}" title="${esc(p.data_quality.note || "")}">Данные: ${esc(DQ_LABEL[p.data_quality.level] || p.data_quality.level)}</span>` : ""}
            ${(p.sources || []).length ? `<span class="srcs">${srcChips(p.sources)}</span>` : ""}
          </div>
        </article>`;
    }).join("") + `</div>`;
    return html;
  }

  function sportIdByLabel(label) {
    const s = String(label || "").toLowerCase();
    const hit = data.sports.find((x) => s.includes(String(x.name).toLowerCase()));
    return hit ? hit.id : "analysis";
  }

  function analysisHTML() {
    let html = `
      <div class="sport-head">
        ${icon("analysis", "big-ico")}
        <div><h2>Разбор дня</h2><p>Форма, составы, личные встречи и мнения аналитиков по главным матчам. Это мнение, а не гарантия.</p></div>
      </div>`;
    html += data.analysis.map((a, i) => {
      const sid = sportIdByLabel(a.sport);
      const sportName = String(a.sport || "").replace(/^[^\p{L}]+/u, "").trim();
      const paras = String(a.text || "").split(/\n+/).map((t) => t.trim()).filter(Boolean);
      const first = paras.shift();
      const factors = (a.key_factors || []).map((f) => `<li>${esc(f)}</li>`).join("");
      const rest = paras.map((t) => `<p>${esc(t)}</p>`).join("") +
        (factors ? `<p class="factors-title">Ключевые факторы</p><ul class="factors">${factors}</ul>` : "");
      const moreId = `more-${i}`;
      return `
        <article class="story" style="--i:${i}">
          <div class="story-side" style="--c:${colorOf(sid)}">
            <span class="story-sport">${icon(sid)}${esc(sportName || "Матч")}</span>
            <h3>${window.Crest ? Crest.matchHTML(a.match, sid, esc) : esc(a.match)}</h3>
            ${facts(a.tournament, a.start)}
          </div>
          <div class="story-body" style="--c:${colorOf(sid)}">
            ${first ? `<p>${esc(first)}</p>` : ""}
            ${rest ? `
              <div class="more" id="${moreId}"><div>${rest}</div></div>
              <button class="toggle" type="button" aria-expanded="false" aria-controls="${moreId}">
                <span>Читать разбор полностью</span>${I_CHEV}
              </button>` : ""}
            ${a.verdict ? `<div class="verdict"><small>Вывод</small>${esc(a.verdict)}</div>` : ""}
            ${(a.sources || []).length ? `<div class="srcs">${srcChips(a.sources)}</div>` : ""}
          </div>
        </article>`;
    }).join("");
    return html;
  }

  function bindPanel() {
    panel.querySelectorAll(".why-btn").forEach((btn) => btn.addEventListener("click", () => {
      const box = btn.closest(".why");
      const open = !box.classList.contains("open");
      box.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", open);
      btn.querySelector("span").textContent = open ? "Свернуть" : "Почему такой вывод";
    }));
    panel.querySelectorAll(".toggle").forEach((btn) => btn.addEventListener("click", () => {
      const story = btn.closest(".story");
      const open = !story.classList.contains("open");
      story.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", open);
      btn.querySelector("span").textContent = open ? "Свернуть" : "Читать разбор полностью";
    }));
  }

  function renderPanel(animated) {
    const html = current === "analysis" ? analysisHTML() : sportHTML(data.sports.find((s) => s.id === current));
    clearTimeout(rendering);
    const paint = () => {
      panel.innerHTML = html;
      bindPanel();
      panel.classList.remove("leaving");
      if (!calm()) {
        panel.classList.add("entering");
        rendering = setTimeout(() => panel.classList.remove("entering"), 1400);
      }
    };
    if (animated && !calm()) {
      panel.classList.remove("entering");
      panel.classList.add("leaving");
      rendering = setTimeout(paint, 170);
    } else paint();
  }

  /* ---------- Навигация в шапке ---------- */
  const navAnalysis = $('[data-nav="analysis"]');
  navAnalysis.addEventListener("click", (e) => { e.preventDefault(); select("analysis", true); });
  $('[data-nav="board"]').addEventListener("click", (e) => {
    e.preventDefault();
    if (current === "analysis" && data) select(data.sports[0].id);
    $("#board").scrollIntoView({ behavior: calm() ? "auto" : "smooth" });
  });
  const inView = { suggest: false, history: false };
  function syncNav() {
    document.querySelectorAll(".nav a").forEach((a) => a.removeAttribute("aria-current"));
    const key = inView.suggest ? "suggest" : inView.history ? "history" : current === "analysis" ? "analysis" : "board";
    $(`[data-nav="${key}"]`)?.setAttribute("aria-current", "true");
  }
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((ents) => ents.forEach((en) => { inView[en.target.id] = en.isIntersecting; syncNav(); }),
      { rootMargin: "-40% 0px -40% 0px" });
    ["suggest", "history"].forEach((id) => $("#" + id) && io.observe($("#" + id)));
  }

  /* ---------- Загрузка данных ---------- */
  function setUpdated(text, fresh) {
    const u = $("#updated");
    u.classList.toggle("fresh", !!fresh);
    u.querySelector("span").innerHTML = text.startsWith("Обновлено ")
      ? `<span class="pre">Обновлено </span>${esc(text.slice(10))}` : esc(text);
  }

  async function load() {
    try {
      const r = await fetch("data/predictions.json?v=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error();
      data = await r.json();
    } catch {
      setUpdated("Нет связи", false);
      $("#pulse-rows").innerHTML = "";
      panel.innerHTML = `<div class="empty"><strong>Не удалось загрузить прогнозы</strong><p>Проверьте подключение к интернету и обновите страницу.</p></div>`;
      return;
    }
    if (!data.sports || !data.sports.length) {
      setUpdated("", false);
      $("#pulse-rows").innerHTML = "";
      panel.innerHTML = `<div class="empty"><strong>Прогнозов пока нет</strong><p>Они появятся после первого обновления.</p></div>`;
      return;
    }
    const upd = data.updated_at ? new Date(data.updated_at) : null;
    const fresh = upd && !isNaN(upd) && mskDay(upd) === mskDay(new Date());
    setUpdated(data.updated_at ? "Обновлено " + fmtDate(data.updated_at) : "", fresh);
    navAnalysis.hidden = !hasAnalysis();

    const fromHash = location.hash.slice(1);
    current = tabList().some((t) => t.id === fromHash) ? fromHash : data.sports[0].id;
    document.documentElement.style.setProperty("--sport", colorOf(current));
    renderPulse();
    renderTabs();
    renderPanel(false);
    syncNav();
    if (fromHash && fromHash === current) $("#board").scrollIntoView({ block: "start" });
  }

  window.addEventListener("hashchange", () => {
    const id = location.hash.slice(1);
    if (id === "suggest" || id === "board" || id === "history") return;
    if (data && tabList().some((t) => t.id === id)) select(id, true);
  });

  /* ---------- Форма предложений → /api/suggest → Telegram ---------- */
  const form = $("#suggest-form");
  const msg = $("#message");
  const counter = $("#msg-count");
  const status = $("#status");
  const btn = $("#send");
  const setStatus = (kind, text) => {
    status.className = "status" + (kind ? " " + kind : "");
    status.innerHTML = (kind === "ok" ? I_OK : kind === "err" ? I_ERR : "") + `<span>${esc(text)}</span>`;
  };
  msg.addEventListener("input", () => {
    counter.textContent = `${msg.value.length} / 2000`;
    if (msg.value.trim().length >= 3) msg.closest(".field").classList.remove("invalid");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const message = msg.value.trim();
    if (message.length < 3) {
      msg.closest(".field").classList.add("invalid");
      msg.setAttribute("aria-invalid", "true");
      setStatus("err", "Напишите хотя бы пару слов.");
      msg.focus();
      return;
    }
    msg.removeAttribute("aria-invalid");
    btn.disabled = true;
    btn.classList.add("busy");
    btn.querySelector(".btn-label").textContent = "Отправляем";
    setStatus("", "");
    try {
      const r = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, contact: $("#contact").value.trim(), website: form.website.value }),
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok || !res.ok) throw new Error(res.error || "Не удалось отправить. Попробуйте позже.");
      setStatus("ok", "Отправлено. Спасибо за идею!");
      form.reset();
      counter.textContent = "0 / 2000";
    } catch (err) {
      setStatus("err", err.message || "Не удалось отправить. Попробуйте позже.");
    } finally {
      btn.disabled = false;
      btn.classList.remove("busy");
      btn.querySelector(".btn-label").textContent = "Отправить";
    }
  });

  /* ---------- Первый экран: одно согласованное появление ---------- */
  requestAnimationFrame(() => document.body.classList.add("ready"));
  load();
})();
