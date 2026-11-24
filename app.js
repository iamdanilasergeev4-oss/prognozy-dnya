(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const calm = () => reduceMotion.matches;
  const H = window.HistoryCore || null;
  document.documentElement.classList.add("js");

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
    hockey: '<path d="M3.2 3.6l7.6 12.2c.5.8 1.3 1.2 2.2 1.2h3.6"/><path d="M20.8 3.6l-7.6 12.2c-.5.8-1.3 1.2-2.2 1.2H7.4"/><ellipse cx="12" cy="20.1" rx="3.1" ry="1.3"/>',
    express: '<path d="M4 6.5h11a1.5 1.5 0 011.5 1.5v2.2a1.8 1.8 0 000 3.6V16a1.5 1.5 0 01-1.5 1.5H4A1.5 1.5 0 012.5 16v-2.2a1.8 1.8 0 000-3.6V8A1.5 1.5 0 014 6.5z"/><path d="M8 4.5h12A1.5 1.5 0 0121.5 6v10"/><path d="M6.5 12h6M6.5 9.5h3"/>',
    analysis: '<path d="M4 5.5h16M4 10h16M4 14.5h10M4 19h7"/><path d="M17 15.5l1.4 1.4 2.6-3"/>',
    generic: '<circle cx="12" cy="12" r="9.2"/><path d="M8 12h8"/>',
  };
  const icon = (id, cls) => svg(ICON_PATHS[id] || ICON_PATHS.generic, cls ? "ico " + cls : "ico");
  const I_OUT = svg('<path d="M9 6h9v9"/><path d="M18 6L7 17"/>');
  const I_CHEV = svg('<path d="M6 9l6 6 6-6"/>');
  const I_OK = svg('<circle cx="12" cy="12" r="9.5" opacity=".35"/><path d="M7.5 12.5l3 3 6-6.5"/>');
  const I_ERR = svg('<circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v5.5M12 16.4v.1"/>');
  const I_PLUS = svg('<path d="M5 12.5l4 4 10-10"/>');
  const I_MINUS = svg('<path d="M6 12h12"/>');
  const I_FOG = svg('<path d="M4 9h11M7 13h13M4 17h9"/>');

  /* Цвет каждого вида спорта внутри общей системы */
  const COLORS = {
    football: "#F0386E", basketball: "#FF8A1F", tennis: "#8BE04E", volleyball: "#FF7A5C",
    cs2: "#FFB22E", dota2: "#B5489F", hockey: "#67C6FF", express: "#FF4FB0", analysis: "#9B7BFF",
  };
  const colorOf = (id) => COLORS[id] || "#FF4FB0";

  const CONF_LABEL = ["", "очень низкая", "низкая", "средняя", "высокая", "очень высокая"];
  const DQ_LABEL = { high: "полные", medium: "частичные", low: "скудные" };
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

  /* ---------- Время (всё по Москве) ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  const MSK = 3 * 3600e3;
  const mskD = (ms) => new Date(ms + MSK);
  const hhmm = (ms) => { const d = mskD(ms); return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()); };
  const dayKey = (ms) => mskD(ms).toISOString().slice(0, 10);
  const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const MONTHS_FULL = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const dayShort = (ms) => { const d = mskD(ms); return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()]; };
  function dayRel(ms, now = Date.now()) {
    const diff = Math.round((Date.parse(dayKey(ms)) - Date.parse(dayKey(now))) / 864e5);
    if (diff === 0) return "сегодня";
    if (diff === 1) return "завтра";
    if (diff === -1) return "вчера";
    return dayShort(ms);
  }
  function inRel(ms, now = Date.now()) {
    const m = Math.round((ms - now) / 6e4);
    if (m < 60) return `через ${Math.max(1, m)} мин`;
    const h = Math.floor(m / 60), r = m % 60;
    if (h < 12) return `через ${h} ч${r >= 5 ? " " + r + " мин" : ""}`;
    return "";
  }
  function agoRel(ms, now = Date.now()) {
    const m = Math.max(0, Math.round((now - ms) / 6e4));
    if (m < 2) return "только что";
    if (m < 60) return `${m} мин назад`;
    const h = Math.floor(m / 60), r = m % 60;
    if (h < 24) return `${h} ч${r >= 5 && h < 6 ? " " + r + " мин" : ""} назад`;
    return dayShort(ms);
  }
  function fmtDate(iso) {
    const t = Date.parse(iso);
    if (isNaN(t)) return "";
    const d = mskD(t);
    return `${d.getUTCDate()} ${MONTHS_FULL[d.getUTCMonth()]}, ${hhmm(t)} МСК`;
  }
  /* Момент начала прогноза: start_iso или разбор строки «15.11, 22:45 МСК» */
  function startOf(p) {
    if (p.start_iso) { const t = Date.parse(p.start_iso); if (!isNaN(t)) return { ms: t, exact: true, approx: /не ранее/i.test(p.start || "") }; }
    if (H && p.start) {
      const r = H.parseStart(p.start, data && data.updated_at);
      if (r.iso) return { ms: Date.parse(r.iso), exact: true, approx: r.approx };
      if (r.date) return { ms: Date.parse(r.date + "T12:00+03:00"), exact: false, approx: true };
    }
    return { ms: NaN, exact: false, approx: true };
  }
  function statusOf(p, sportId, now = Date.now()) {
    const s = startOf(p);
    if (!s.exact || isNaN(s.ms)) return { k: "upcoming", s };
    const k = H ? H.displayStatus({ status: "pending", start_iso: new Date(s.ms).toISOString(), sport: sportId }, now) : (now < s.ms ? "upcoming" : "live");
    return { k, s };
  }
  function whenHTML(p, sportId) {
    const now = Date.now();
    const { k, s } = statusOf(p, sportId, now);
    if (isNaN(s.ms)) return `<span class="when"><i></i>${esc(p.start || "время уточняется")}</span>`;
    const day = dayRel(s.ms, now);
    const time = s.exact ? `${s.approx ? "не ранее " : ""}${hhmm(s.ms)}` : String(p.start || "").replace(/^[\d.]+,?\s*/, "").replace(/\s*МСК$/, "");
    const label = `${day[0].toUpperCase() + day.slice(1)}, ${time}`;
    const extra = k === "live" ? "идёт" : k === "awaiting" ? "завершён" : (s.exact ? inRel(s.ms, now) : "");
    return `<span class="when st-${k}"><i></i><time datetime="${new Date(s.ms).toISOString()}">${esc(label)}</time>${extra ? `<span class="when-rel">${esc(extra)}</span>` : ""}</span>`;
  }

  function host(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "источник"; }
  }
  const integrated = () => data?.analysis_engine === "sports-intelligence-2";
  const analytical = () => integrated() || data?.source === "model-preview";
  const hasAnalysis = () => Array.isArray(data?.analysis) && (data.analysis.length > 0 || analytical());
  const hasExpress = () => Array.isArray(data?.express) &&
    (data.express.length > 0 || ["sports-update", "model-preview"].includes(data.source));
  const cardKey = (card) => {
    const teams = splitTeams(card.match);
    const time = Date.parse(card.start_iso);
    return teams && Number.isFinite(time) ? JSON.stringify([teams.map(teamKey), time]) : null;
  };
  const displayCards = (sport) => {
    if (!integrated()) return (data.source === "model-preview" ? sport.forecasts : sport.picks) || [];
    const projections = new Map((sport.forecasts || []).map((card) => [cardKey(card), card]));
    const picks = (sport.picks || []).map((pick) => {
      const key = cardKey(pick);
      const projection = key && projections.get(key);
      if (!projection) return pick;
      projections.delete(key);
      return { ...pick, projection };
    });
    return [...picks, ...projections.values()];
  };
  const allPicks = () => data.sports.flatMap((s) => displayCards(s).map((p, i) => ({ p, i, sport: s.id, name: s.name })));
  const pickCount = (sport) => displayCards(sport).length;
  const firstForecastSport = () => (data.sports.find(pickCount) || data.sports[0]).id;
  const countLabel = (n) => plural(n, "прогноз", "прогноза", "прогнозов");
  const analysisCountLabel = (n) => plural(n, "разбор", "разбора", "разборов");
  const ru = (value, sport) => window.SportsRu?.text(value, sport) ?? value;
  const ruTournament = (value, sport) => window.SportsRu?.tournament(value, sport) ?? value;
  function splitTeams(match) {
    const parts = String(match || "").split(/\s+[—–-]\s+|\s+vs\.?\s+/i);
    return parts.length === 2 ? parts.map((x) => x.trim()) : null;
  }
  const flag = (name) => (window.Crest ? Crest.crest(name) : "");
  /* Окно времени для фильтра «Скоро / Сегодня / Завтра» */
  let whenFilter = "all";
  function bucketOf(p, now = Date.now()) {
    const s = startOf(p);
    if (isNaN(s.ms)) return { soon: false, day: "later" };
    const soon = s.exact && s.ms - now <= 3 * 3600e3 && now - s.ms <= 2.5 * 3600e3;
    const d = Math.round((Date.parse(dayKey(s.ms)) - Date.parse(dayKey(now))) / 864e5);
    return { soon: soon && (!integrated() || s.ms >= now), day: d === 0 || d < 0 && !integrated() ? "today" : d === 1 ? "tomorrow" : "later" };
  }
  /* Прогноз ↔ материал «Разбора дня» по совпадению обеих команд */
  const teamKey = (t) => String(t || "").toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, "");
  function storyIndexFor(match, sport, start) {
    if (!hasAnalysis()) return -1;
    const t = splitTeams(match);
    if (!t) return -1;
    const k = t.map(teamKey).sort().join("|");
    return data.analysis.findIndex((a) => {
      const u = splitTeams(a.match);
      return u && u.map(teamKey).sort().join("|") === k &&
        (!a.sport_id || a.sport_id === sport && Math.abs(Date.parse(a.start_iso) - Date.parse(start)) <= 5 * 60e3);
    });
  }

  /* ---------- Шапка ---------- */
  const top = $("#top");
  const onScroll = () => top.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Фон: два слоя узлов, редкие импульсы вдоль связей ---------- */
  (function background() {
    const el = $("#bg");
    const NS = "http://www.w3.org/2000/svg";
    let layers = [], w = 0, h = 0, raf = 0, t0 = performance.now(), pulses = [], nextPulse = 0;
    const mouse = { x: -9999, y: -9999, px: 0, py: 0, tx: 0, ty: 0 };

    function makeLayer(count, cfg, seed) {
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", "layer " + cfg.cls);
      el.appendChild(g);
      const cols = Math.ceil(Math.sqrt(count * (w / h)));
      const rows = Math.ceil(count / cols);
      const nodes = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (nodes.length >= count) break;
        const hx = ((c + 0.15 + rnd() * 0.7) / cols) * w * 1.1 - w * 0.05;
        const hy = ((r + 0.15 + rnd() * 0.7) / rows) * h * 1.1 - h * 0.05;
        nodes.push({ hx, hy, x: hx, y: hy, ax: cfg.amp * (0.5 + rnd()), ay: cfg.amp * (0.5 + rnd()),
          sx: 0.00006 + rnd() * 0.00012, sy: 0.00006 + rnd() * 0.00012, p: rnd() * 6.28, r: cfg.r * (0.7 + rnd() * 0.6), glow: 0 });
      }
      const seen = new Set(), edges = [];
      nodes.forEach((a, i) => {
        nodes.map((b, j) => [j, (a.hx - b.hx) ** 2 + (a.hy - b.hy) ** 2])
          .filter(([j]) => j !== i).sort((x, y) => x[1] - y[1]).slice(0, cfg.k)
          .forEach(([j, d]) => {
            const key = i < j ? i + "-" + j : j + "-" + i;
            if (seen.has(key) || d > (Math.max(w, h) * 0.3) ** 2) return;
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
      return { g, nodes, edges, cfg };
    }

    function build() {
      w = window.innerWidth; h = window.innerHeight;
      el.setAttribute("viewBox", `0 0 ${w} ${h}`);
      el.innerHTML = "";
      pulses = [];
      const area = w * h;
      layers = [
        makeLayer(Math.max(10, Math.min(46, Math.round(area / 52000))), { cls: "far", r: 0.9, amp: 10, k: 2, par: 6 }, 11),
        makeLayer(Math.max(8, Math.min(30, Math.round(area / 78000))), { cls: "near", r: 1.6, amp: 18, k: 2, par: 16 }, 7),
      ];
      const near = layers[1].nodes;
      [Math.floor(near.length / 3), Math.floor((near.length * 3) / 4)].forEach((i) => near[i] && near[i].el.classList.add("hot"));
      frame(performance.now(), true);
    }

    function spawnPulse(now) {
      const L = layers[1];
      if (!L || !L.edges.length || pulses.length >= 2) return;
      const e = L.edges[Math.floor(Math.random() * L.edges.length)];
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("class", "spark");
      c.setAttribute("r", "1.8");
      L.g.appendChild(c);
      e.el.classList.add("lit");
      pulses.push({ e, c, t: now, dur: 1700 + Math.random() * 900, dir: Math.random() < 0.5 });
    }

    function frame(now, once) {
      const t = now - t0;
      mouse.px += (mouse.tx - mouse.px) * 0.05;
      mouse.py += (mouse.ty - mouse.py) * 0.05;
      for (const L of layers) {
        const ox = mouse.px * L.cfg.par, oy = mouse.py * L.cfg.par;
        for (const n of L.nodes) {
          n.x = n.hx + Math.sin(t * n.sx + n.p) * n.ax;
          n.y = n.hy + Math.cos(t * n.sy + n.p) * n.ay;
          n.el.setAttribute("cx", (n.x + ox).toFixed(1));
          n.el.setAttribute("cy", (n.y + oy).toFixed(1));
          if (L.cfg.cls === "near") {
            const d = Math.hypot(n.x + ox - mouse.x, n.y + oy - mouse.y);
            const target = d < 160 ? 1 - d / 160 : 0;
            n.glow += (target - n.glow) * 0.08;
            n.el.style.opacity = (0.45 + n.glow * 0.55).toFixed(2);
          }
        }
        for (const e of L.edges) {
          const a = L.nodes[e.a], b = L.nodes[e.b];
          e.el.setAttribute("x1", (a.x + ox).toFixed(1)); e.el.setAttribute("y1", (a.y + oy).toFixed(1));
          e.el.setAttribute("x2", (b.x + ox).toFixed(1)); e.el.setAttribute("y2", (b.y + oy).toFixed(1));
        }
      }
      if (!once) {
        if (now > nextPulse) { spawnPulse(now); nextPulse = now + 2600 + Math.random() * 2600; }
        const L = layers[1];
        pulses = pulses.filter((p) => {
          const k = (now - p.t) / p.dur;
          if (k >= 1) { p.c.remove(); p.e.el.classList.remove("lit"); return false; }
          const a = L.nodes[p.e.a], b = L.nodes[p.e.b];
          const q = p.dir ? k : 1 - k;
          const ox = mouse.px * L.cfg.par, oy = mouse.py * L.cfg.par;
          p.c.setAttribute("cx", (a.x + (b.x - a.x) * q + ox).toFixed(1));
          p.c.setAttribute("cy", (a.y + (b.y - a.y) * q + oy).toFixed(1));
          p.c.style.opacity = Math.sin(Math.PI * k).toFixed(2);
          return true;
        });
        raf = requestAnimationFrame(frame);
      }
    }

    const start = () => { cancelAnimationFrame(raf); if (!calm() && !document.hidden) raf = requestAnimationFrame(frame); };
    let rt;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (Math.abs(window.innerWidth - w) > 40 || Math.abs(window.innerHeight - h) > 120) { build(); start(); } }, 200); });
    window.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      mouse.x = e.clientX; mouse.y = e.clientY;
      mouse.tx = (e.clientX / w - 0.5) * -1;
      mouse.ty = (e.clientY / h - 0.5) * -1;
    }, { passive: true });
    document.addEventListener("visibilitychange", start);
    reduceMotion.addEventListener?.("change", start);
    build(); start();
    requestAnimationFrame(() => el.classList.add("on"));
  })();

  /* ---------- Табло на первом экране ---------- */
  const board = $("#pulse");
  const tip = document.createElement("div");
  tip.className = "bd-tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;

  function freshnessHTML() {
    const t = Date.parse(data.updated_at);
    if (isNaN(t)) return "";
    const now = Date.now();
    const hours = (now - t) / 36e5;
    const frac = Math.max(0.02, Math.min(1, hours / 12));
    const R = 15, C = 2 * Math.PI * R;
    const nowH = mskD(now).getUTCHours();
    const next = nowH < 7 ? "утром, после 07:00" : nowH < 17 ? "вечером, после 17:00" : "утром, после 07:00";
    const stale = hours > 14;
    return `
      <div class="bd-fresh${stale ? " stale" : ""}">
        <svg class="ring" viewBox="0 0 36 36" aria-hidden="true">
          <circle class="ring-bg" cx="18" cy="18" r="${R}"/>
          <circle class="ring-fg" cx="18" cy="18" r="${R}" stroke-dasharray="${(C * frac).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 18 18)"/>
        </svg>
        <div><b>Обновлено ${esc(agoRel(t, now))}</b><span>${analytical() ? "Ручное обновление" : `Следующее обновление ${esc(next)}`}</span></div>
      </div>`;
  }

  function timelineData() {
    const now = Date.now();
    const rows = data.sports.filter(pickCount);
    const items = [];
    rows.forEach((s, lane) => displayCards(s).forEach((p, i) => {
      const st = startOf(p);
      if (!isNaN(st.ms)) items.push({ p, i, sport: s.id, name: s.name, lane, ms: st.ms, exact: st.exact, conf: Math.max(1, Math.min(5, Number(p.confidence) || 3)) });
    }));
    if (!items.length) return null;
    let t0 = Math.min(...items.map((x) => x.ms)), t1 = Math.max(...items.map((x) => x.ms));
    if (now > t0 - 6 * 3600e3 && now < t1) t0 = Math.min(t0, now);
    t0 -= 3600e3; t1 += 3600e3;
    if (t1 - t0 < 8 * 3600e3) t1 = t0 + 8 * 3600e3;
    if (t1 - t0 > 54 * 3600e3) t1 = t0 + 54 * 3600e3;
    return { rows, items: items.filter((x) => x.ms <= t1), t0, t1, now };
  }

  function timelineSVG(td, W) {
    const narrow = W < 460;
    const LBL = narrow ? 12 : 84, PADR = 14, laneH = narrow ? 30 : 32, TOP = 22, AX = 26;
    const Hh = TOP + td.rows.length * laneH + AX;
    const iw = W - LBL - PADR;
    const x = (ms) => LBL + ((ms - td.t0) / (td.t1 - td.t0)) * iw;
    const span = (td.t1 - td.t0) / 3600e3;
    const step = [1, 2, 3, 4, 6, 12].find((s) => span / s <= iw / (narrow ? 56 : 64)) || 12;
    let ticks = "", days = "";
    const first = Math.ceil(td.t0 / 3600e3) * 3600e3;
    for (let t = first; t <= td.t1; t += 3600e3) {
      const hr = mskD(t).getUTCHours();
      if (hr === 0 && !(td.now >= td.t0 && td.now <= td.t1 && Math.abs(x(t) - x(td.now)) < (narrow ? 90 : 110))) {
        days += `<line class="tl-day" x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${TOP - 14}" y2="${Hh - AX + 4}"/>
          <text class="tl-dayl" x="${(x(t) + 6).toFixed(1)}" y="${TOP - 6}">${esc(dayShort(t))}</text>`;
      }
      if (hr % step === 0) ticks += `<text class="tl-ax" x="${x(t).toFixed(1)}" y="${Hh - 8}" text-anchor="middle">${pad(hr)}:00</text>
        <line class="tl-tick" x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${Hh - AX + 2}" y2="${Hh - AX + 6}"/>`;
    }
    const lanes = td.rows.map((s, l) => {
      const cy = TOP + l * laneH + laneH / 2;
      return `<line class="tl-lane" x1="${LBL}" x2="${W - PADR}" y1="${cy}" y2="${cy}" style="--c:${colorOf(s.id)}"/>
        ${narrow ? "" : `<text class="tl-name" x="0" y="${cy + 4}" style="--c:${colorOf(s.id)}">${esc(s.name)}</text>`}`;
    }).join("");
    // одинаковое время в одной дорожке — одна точка с числом
    const groups = new Map();
    for (const it of td.items) {
      const key = it.lane + ":" + Math.round(x(it.ms) / 7);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    let dots = "", gi = 0;
    const byIndex = new Map();
    for (const list of groups.values()) {
      const a = list[0];
      const cx = list.reduce((k, it) => k + x(it.ms), 0) / list.length;
      const cy = TOP + a.lane * laneH + laneH / 2;
      const conf = Math.max(...list.map((it) => it.conf));
      const r = 3.4 + conf * 0.75 + Math.min(4, (list.length - 1) * 1.2);
      const past = a.ms < td.now;
      const label = `${a.name}, ${dayRel(a.ms)} ${a.exact ? hhmm(a.ms) : ""}: ` +
        list.map((it) => [ru(it.p.match, it.sport), ru(it.p.lines?.[0] || it.p.bet, it.sport)].filter(Boolean).join(" — ")).join("; ");
      dots += `<g class="tl-dot${past ? " past" : ""}" tabindex="0" role="button" data-g="${gi}" data-sport="${esc(a.sport)}" style="--c:${colorOf(a.sport)};--d:${(cx / W).toFixed(3)}"
          aria-label="${esc(label)}">
          <circle class="hit" cx="${cx.toFixed(1)}" cy="${cy}" r="${(r + 3.5).toFixed(1)}"/>
          <circle class="dot" cx="${cx.toFixed(1)}" cy="${cy}" r="${r.toFixed(1)}" style="--o:${(0.42 + conf * 0.11).toFixed(2)}"/>
          ${list.length > 1 ? `<text class="cnt" x="${cx.toFixed(1)}" y="${cy + 3.4}" text-anchor="middle">${list.length}</text>` : ""}
        </g>`;
      byIndex.set(gi++, list);
    }
    const nowLine = td.now >= td.t0 && td.now <= td.t1
      ? `<g class="tl-now"><line x1="${x(td.now).toFixed(1)}" x2="${x(td.now).toFixed(1)}" y1="${TOP - 4}" y2="${Hh - AX + 2}"/>
          <text x="${(x(td.now)).toFixed(1)}" y="${TOP - 8}" text-anchor="${x(td.now) < LBL + 50 ? "start" : x(td.now) > W - 60 ? "end" : "middle"}">сейчас ${narrow ? "" : hhmm(td.now)}</text></g>` : "";
    timelineGroups = byIndex;
    return `<svg class="tl" viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" role="group" aria-label="Время начала матчей с прогнозами">
      ${days}${lanes}${ticks}${nowLine}${dots}</svg>`;
  }
  let timelineGroups = new Map();

  function renderBoard() {
    const cards = allPicks();
    const total = cards.length;
    const hosts = new Set();
    cards.forEach(({ p }) => (p.sources || []).forEach((x) => hosts.add(host(x.url))));
    (data.analysis || []).forEach((a) => (a.sources || []).forEach((x) => hosts.add(host(x.url))));
    const withWhy = cards.filter(({ p }) => Array.isArray(p.facts) && p.facts.length).length;
    const ms = cards.map(({ p }) => startOf(p).ms).filter((t) => !isNaN(t));
    const days = [...new Set(ms.map(dayKey))].sort();
    const range = days.length > 1
      ? (() => { const a = mskD(Date.parse(days[0])), b = mskD(Date.parse(days[days.length - 1])); return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${b.getUTCDate()} ${MONTHS_FULL[b.getUTCMonth()]}` : `${dayShort(Date.parse(days[0]))} – ${dayShort(Date.parse(days[days.length - 1]))}`; })()
      : days.length ? (() => { const a = mskD(Date.parse(days[0])); return `${a.getUTCDate()} ${MONTHS_FULL[a.getUTCMonth()]}`; })() : "";
    const sports = data.sports.filter(pickCount);
    const dist = sports.map((s) => {
      const n = pickCount(s);
      const label = displayCards(s).some((card) => card.statisticalSummary) ? analysisCountLabel(n) : countLabel(n);
      return `<button type="button" class="bd-seg" data-id="${esc(s.id)}" style="--c:${colorOf(s.id)};flex-grow:${n}" aria-label="${esc(s.name)}: ${n} ${label}"></button>`;
    }).join("");
    const legend = data.sports.map((s) => {
      const n = pickCount(s);
      return `<button type="button" class="bd-leg${n ? "" : " zero"}" data-id="${esc(s.id)}" style="--c:${colorOf(s.id)}"${n ? "" : " disabled"}>
        ${icon(s.id)}<span>${esc(s.name)}</span><b>${n}</b></button>`;
    }).join("");
    board.innerHTML = `
      <div class="bd-top">
        <div class="bd-total">
          <b class="bd-num">${total}</b>
          <span>${cards.some(({ p }) => p.statisticalSummary) ? analysisCountLabel(total) : countLabel(total)}${range ? `<br>на ${esc(range)}` : ""}</span>
        </div>
        ${freshnessHTML()}
      </div>
      <div class="bd-kpis">
        <button type="button" class="bd-kpi" id="bd-next" hidden></button>
        <a class="bd-kpi" id="bd-acc" href="#history" hidden></a>
      </div>
      <div class="bd-chart">
        <div class="bd-title"><span>Когда начинаются матчи</span>${analytical() || data.source === "sports-update" ? "" : "<small>чем крупнее точка, тем выше уверенность</small>"}</div>
        <div id="bd-tl"></div>
      </div>
      <div class="bd-dist" role="group" aria-label="Сводка по видам спорта">
        <div class="bd-bar">${dist}</div>
        <div class="bd-legend">${legend}</div>
      </div>
      ${total ? `<p class="bd-cap">${data.source === "model-preview" ? "Все прогнозы прошли историческую проверку" : `${withWhy} из ${total} — с разбором «за» и «против»`} · ${hosts.size} ${plural(hosts.size, "источник", "источника", "источников")}</p>` : ""}`;
    board.appendChild(tip);
    drawTimeline();
    board.querySelectorAll(".bd-seg, .bd-leg").forEach((b) => {
      b.addEventListener("click", () => select(b.dataset.id, true));
      b.addEventListener("pointerenter", () => highlightSport(b.dataset.id));
      b.addEventListener("pointerleave", () => highlightSport(null));
      b.addEventListener("focus", () => highlightSport(b.dataset.id));
      b.addEventListener("blur", () => highlightSport(null));
    });
    syncBoard();
    fillKpis();
  }
  /* «Ближайший матч» и точность за 30 дней — главный аргумент доверия держим на виду */
  let accCache = null;
  async function fillKpis() {
    const now = Date.now();
    const next = allPicks().map((x) => ({ ...x, s: startOf(x.p) })).filter((x) => x.s.exact && x.s.ms > now).sort((a, b) => a.s.ms - b.s.ms)[0];
    const nb = $("#bd-next");
    if (nb && next) {
      const rel = inRel(next.s.ms, now) || `${dayRel(next.s.ms, now)}, ${hhmm(next.s.ms)}`;
      nb.innerHTML = `<small>Ближайший матч с прогнозом ${esc(rel)}</small><b>${esc(ru(next.p.match, next.sport))}</b>`;
      nb.style.setProperty("--c", colorOf(next.sport));
      nb.hidden = false;
      nb.onclick = () => {
        pendingFocus = `#pick-${next.sport}-${next.i}`;
        if (current === next.sport) focusAfterPaint(); else select(next.sport, false);
      };
    }
    const ab = $("#bd-acc");
    if (!ab || !H) return;
    try {
      if (!accCache) {
        const idx = await fetch("data/history/index.json?v=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
        const files = await Promise.all((idx?.months || []).map((m) => fetch(`data/history/${m}.json?v=${Date.now()}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
        accCache = H.computeStats(H.mergeMonths(files.filter(Boolean)).predictions, { days: 30 });
      }
      const s = accCache;
      if (s.accuracy == null || s.evaluated < 10) return;
      ab.innerHTML = `<small>Точность за 30 дней</small><b>${String(s.accuracy).replace(".", ",")}%</b><span>сыграли ${s.won} из ${s.evaluated} ${plural(s.evaluated, "прогноза", "прогнозов", "прогнозов")}</span>`;
      ab.hidden = false;
    } catch { /* история недоступна — блок просто не показываем */ }
  }
  function highlightSport(id) {
    board.classList.toggle("focus", !!id);
    board.querySelectorAll(".bd-seg, .bd-leg").forEach((el) => el.classList.toggle("hl", el.dataset.id === id));
    board.querySelectorAll(".tl-dot").forEach((el) => el.classList.toggle("hl", el.dataset.sport === id));
  }
  let lastTlW = 0;
  function drawTimeline() {
    const box = $("#bd-tl");
    if (!box) return;
    const td = timelineData();
    if (!td) {
      box.innerHTML = `<div class="bd-empty">${allPicks().length ? "Время начала матчей пока не указано" : "Готовых прогнозов пока нет"}</div>`;
      return;
    }
    const W = Math.max(260, Math.round(box.clientWidth || 480));
    lastTlW = W;
    box.innerHTML = timelineSVG(td, W);
    box.querySelectorAll(".tl-dot").forEach((g) => {
      const list = timelineGroups.get(Number(g.dataset.g)) || [];
      const show = () => showTip(g, list);
      g.addEventListener("pointerenter", show);
      g.addEventListener("focus", show);
      g.addEventListener("pointerleave", hideTip);
      g.addEventListener("blur", hideTip);
      const go = () => { hideTip(); jumpTo(list[0]); };
      g.addEventListener("click", go);
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }
  function showTip(g, list) {
    if (!list.length) return;
    const a = list[0];
    tip.innerHTML = `<div class="tt-h" style="--c:${colorOf(a.sport)}">${icon(a.sport)}<span>${esc(a.name)} · ${esc(dayRel(a.ms))}${a.exact ? ", " + hhmm(a.ms) : ""}</span></div>` +
      list.slice(0, 6).map((it) => `<div class="tt-r"><b>${esc(ru(it.p.match, it.sport))}</b><span>${it.p.lines ?
        esc(ru(it.p.lines[0], it.sport)) : `${esc(ru(it.p.bet, it.sport))} · уверенность ${esc(CONF_LABEL[it.conf])}`}</span></div>`).join("") +
      (list.length > 6 ? `<div class="tt-more">и ещё ${list.length - 6}</div>` : "") +
      `<div class="tt-go">Нажмите, чтобы перейти к матчу</div>`;
    tip.hidden = false;
    const br = board.getBoundingClientRect(), dr = g.querySelector(".dot").getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = dr.left - br.left + dr.width / 2 - tw / 2;
    left = Math.max(8, Math.min(br.width - tw - 8, left));
    let topY = dr.top - br.top - th - 10;
    if (topY < 4) topY = dr.bottom - br.top + 10;
    tip.style.transform = `translate(${left.toFixed(0)}px, ${topY.toFixed(0)}px)`;
  }
  function hideTip() { tip.hidden = true; }
  function jumpTo(it) {
    if (!it) return;
    const go = () => {
      const card = document.getElementById(`pick-${it.sport}-${it.i}`);
      if (!card) return;
      card.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "center" });
      card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash");
    };
    if (current !== it.sport) { select(it.sport); setTimeout(go, calm() ? 30 : 260); } else go();
  }
  function syncBoard() {
    board.querySelectorAll(".bd-seg, .bd-leg").forEach((b) => b.classList.toggle("on", b.dataset.id === current));
  }

  /* ---------- Вкладки ---------- */
  const tabsEl = $("#tabs");
  const ind = $("#tab-ind");
  const panel = $("#panel");

  function tabList() {
    const list = data.sports.map((s) => {
      const confirmed = s.events?.filter((event) => Date.parse(event.start_iso) > Date.now()).length || 0;
      const count = pickCount(s);
      return { id: s.id, name: s.name, n: count || confirmed, scheduled: !count && confirmed > 0 };
    });
    if (analytical()) list.push({ id: "summary", name: "Сводка дня", n: data.dailySummary?.length || 0 });
    if (hasExpress()) list.push({ id: "express", name: "Экспрессы", n: data.express.length || data.expressHighlights?.length || 0 });
    if (hasAnalysis()) list.push({ id: "analysis", name: "Разбор дня", n: data.analysis.length });
    return list;
  }

  function renderTabs() {
    tabsEl.querySelectorAll(".tab").forEach((t) => t.remove());
    const html = tabList().map((t) => `
      <button class="tab${t.n ? "" : " zero"}" role="tab" id="tab-${esc(t.id)}" data-id="${esc(t.id)}" aria-controls="panel"
        aria-selected="${t.id === current}" tabindex="${t.id === current ? 0 : -1}" style="--c:${colorOf(t.id)}"
        ${t.scheduled ? `aria-label="${esc(t.name)}. В расписании: ${t.n}"` : ""}>
        ${icon(t.id)}<span class="tn">${esc(t.name)}</span><span class="n">${t.n}</span>
      </button>`).join("");
    tabsEl.insertAdjacentHTML("beforeend", html);
    tabsEl.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => select(b.dataset.id)));
    panel.setAttribute("aria-labelledby", "tab-" + current);
    requestAnimationFrame(() => { moveIndicator(true); edges(); });
  }

  function moveIndicator(instant) {
    const b = tabsEl.querySelector(`.tab[aria-selected="true"]`);
    if (!b) return;
    if (instant) ind.style.transition = "none";
    ind.style.width = b.offsetWidth + "px";
    ind.style.transform = `translateX(${b.offsetLeft}px)`;
    if (instant) { ind.getBoundingClientRect(); ind.style.transition = ""; }
    const sl = tabsEl.scrollLeft, vis = tabsEl.clientWidth;
    if (b.offsetLeft < sl + 24 || b.offsetLeft + b.offsetWidth > sl + vis - 24) {
      tabsEl.scrollTo({ left: b.offsetLeft - vis / 2 + b.offsetWidth / 2, behavior: calm() || instant ? "auto" : "smooth" });
    }
  }
  /* Мягкие края у прокручиваемых вкладок */
  function edges() {
    const shell = tabsEl.parentElement;
    const max = tabsEl.scrollWidth - tabsEl.clientWidth;
    shell.classList.toggle("fade-l", tabsEl.scrollLeft > 4);
    shell.classList.toggle("fade-r", tabsEl.scrollLeft < max - 4);
  }
  tabsEl.addEventListener("scroll", edges, { passive: true });
  window.addEventListener("resize", () => {
    moveIndicator(true); edges();
    if (data && $("#bd-tl") && Math.abs(($("#bd-tl").clientWidth || 0) - lastTlW) > 24) drawTimeline();
  });
  document.fonts?.ready?.then(() => { moveIndicator(true); edges(); });

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
    panel.setAttribute("aria-labelledby", "tab-" + id);
    moveIndicator();
    syncNav();
    syncBoard();
    renderPanel(true);
  }

  /* ---------- Карточки прогнозов ---------- */
  function sourceTiming(source) {
    if (!source.receivedAt && !source.freshness) return "";
    const archival = source.freshness === "archive" || data?.review_snapshot_at;
    return [archival ? "Архив" : "Ответ источника",
      source.receivedAt ? `получен ${fmtDate(source.receivedAt)}` : "",
      source.snapshotAt ? `снимок от ${fmtDate(source.snapshotAt)}` : "дата снимка не указана"].filter(Boolean).join(" · ");
  }
  function srcChips(list) {
    return (list || []).map((s) =>
      `<a class="src" href="${esc(s.url)}" target="_blank" rel="nofollow noopener" title="${esc([s.title, sourceTiming(s)].filter(Boolean).join(" · "))}">${esc(host(s.url))}${I_OUT}</a>`).join("");
  }
  function srcList(list) {
    return `<ul class="src-list">` + (list || []).map((s) =>
      `<li><a href="${esc(s.url)}" target="_blank" rel="nofollow noopener"><span>${esc(s.title || host(s.url))}</span><small>${esc(host(s.url))}</small>${I_OUT}</a>${sourceTiming(s) ? `<small class="source-timing">${esc(sourceTiming(s))}</small>` : ""}</li>`).join("") + `</ul>`;
  }
  function groupedStorySources(sources) {
    if (!sources?.length) return "";
    const distinct = Map.groupBy(sources, (source) => source.title || host(source.url));
    return `<details class="st-src story-sources"><summary>Источники · ${[...distinct.keys()].map(esc).join(", ")}</summary>
      ${[...distinct].map(([title, group]) => {
        const byLink = Map.groupBy(group, (source) => source.url);
        return `<section><h4>${esc(title)} · ${byLink.size}</h4><ul class="src-list">
          ${[...byLink].map(([url, entries], index) => {
            const timing = [...new Set(entries.map(sourceTiming).filter(Boolean))];
            const dated = entries.find((source) => source.snapshotAt || source.receivedAt);
            const label = dated ? `Материал ${index + 1} · ${fmtDate(dated.snapshotAt || dated.receivedAt)}` : `Материал ${index + 1}`;
            return `<li><a href="${esc(url)}" target="_blank" rel="nofollow noopener"><span>${esc(label)}</span><small>${esc(host(url))}</small>${I_OUT}</a>
              ${timing.map((value) => `<small class="source-timing">${esc(value)}</small>`).join("")}</li>`;
          }).join("")}</ul></section>`;
      }).join("")}</details>`;
  }
  /* Уверенность: пять делений растущей высоты */
  function gauge(conf) {
    const bars = Array.from({ length: 5 }, (_, k) => {
      const hgt = 4 + k * 2.6;
      return `<rect class="${k < conf ? "on" : ""}" x="${k * 5}" y="${(16 - hgt).toFixed(1)}" width="3.4" height="${hgt.toFixed(1)}" rx="1"/>`;
    }).join("");
    return `<svg class="gauge" viewBox="0 0 24.4 16" aria-hidden="true">${bars}</svg>`;
  }
  function teamsHTML(match, sport) {
    const t = splitTeams(match);
    if (!t) return `<h3 class="pk-teams single"><span class="team"><span class="tm">${esc(ru(match, sport))}</span></span></h3>`;
    return `<h3 class="pk-teams"><span class="team">${flag(t[0])}<span class="tm" title="${esc(ru(t[0], sport))}">${esc(ru(t[0], sport))}</span></span>` +
      `<span class="sep"><span class="vh">против</span></span>` +
      `<span class="team">${flag(t[1])}<span class="tm" title="${esc(ru(t[1], sport))}">${esc(ru(t[1], sport))}</span></span></h3>`;
  }
  function pickHTML(p, i, sport, lead) {
    const shown = (value) => esc(ru(value, sport.id));
    const market = { total: "Тотал", "team-total": "Индивидуальный тотал", handicap: "Фора",
      "both-score": "Обе забьют", "double-chance": "Двойной шанс" }[p.market?.kind];
    const conf = Math.max(1, Math.min(5, Number(p.confidence) || 3));
    const facts = (Array.isArray(p.facts) ? p.facts : []).filter(Boolean);
    const against = (Array.isArray(p.against) ? p.against : []).filter(Boolean);
    const v2 = facts.length > 0 || !!p.uncertainty;
    const id = `pick-${sport.id}-${i}`;
    const dq = p.data_quality && p.data_quality.level;
    const preview = facts.slice(0, lead ? 3 : 2);
    const prob = p.model_prob && p.model_prob.value ? Math.round(p.model_prob.value * 100) : null;
    const bk = bucketOf(p);
    const si = storyIndexFor(p.match, sport.id, p.start_iso);
    const fixture = (sport.events || []).find((event) => cardKey(event) === cardKey(p));
    const nSrc = (p.sources || []).length;
    const confWhy = `Это оценка того, насколько вывод подкреплён данными, а не вероятность исхода. ` +
      (v2 ? `Под этим прогнозом: ${facts.length} ${plural(facts.length, "факт", "факта", "фактов")} «за», ${against.length} «против»` : `Подробного разбора у этого прогноза нет`) +
      (dq ? `, данные ${DQ_LABEL[dq] || dq}` : "") + (nSrc ? `, ${nSrc} ${plural(nSrc, "источник", "источника", "источников")}` : "") + ".";
    const detail = v2 ? `
      <div class="more" id="${id}-more"><div><div class="pk-detail">
        <div class="pk-cols">
          <section class="pk-col pro"><h4>${I_PLUS}Факты в пользу вывода</h4><ul>${facts.map((x) => `<li>${shown(x)}</li>`).join("")}</ul></section>
          ${against.length ? `<section class="pk-col con"><h4>${I_MINUS}Что говорит против</h4><ul>${against.map((x) => `<li>${shown(x)}</li>`).join("")}</ul></section>` : ""}
        </div>
        ${p.uncertainty ? `<div class="pk-unc">${I_FOG}<div><h4>Что неизвестно</h4><p>${shown(p.uncertainty)}</p></div></div>` : ""}
        ${prob != null ? `<div class="pk-prob"><span>Вероятность по модели ${esc(p.model_prob.source || "")}</span><span class="pk-prob-bar"><i style="--w:${prob}%"></i></span><b>${prob}%</b></div>` : ""}
        ${dq && p.data_quality.note ? `<p class="pk-dqn">Данные ${esc(DQ_LABEL[dq] || dq)}: ${shown(p.data_quality.note)}</p>` : ""}
        ${(p.sources || []).length ? `<h4 class="pk-srch">Источники</h4>${srcList(p.sources)}` : ""}
      </div></div></div>` : "";
    return `
      <article class="pick${lead ? " lead" : ""}${v2 ? "" : " v1"}" id="${id}" style="--i:${i}" data-day="${bk.day}"${bk.soon ? " data-soon" : ""}>
        <div class="pk-meta">
          <span class="pk-tour">${esc(ruTournament(p.tournament, sport.id))}${p.format ? `<span class="pk-fmt">${esc(p.format)}</span>` : ""}</span>
          ${whenHTML(p, sport.id)}
        </div>
        <div class="pk-main">
          ${teamsHTML(p.match, sport.id)}
          <div class="pk-bet">
            <span class="pk-label"><span class="pl">${market || "Прогноз"}</span>${p.odds && !integrated() && !data.manual_schedule ? `<span class="odds">кф <b>${esc(p.odds)}</b></span>` : ""}</span>
            <strong>${shown(p.bet)}</strong>
          </div>
        </div>
        ${p.projection ? projectionDetails(p.projection, sport.id) : ""}
        ${p.reason ? `<p class="pk-reason">${shown(p.reason)}</p>` : ""}
        ${preview.length ? `<ul class="pk-key">${preview.map((x) => `<li>${shown(x)}</li>`).join("")}</ul>` : ""}
        <div class="pk-foot">
          <span class="conf-wrap"><button type="button" class="conf" aria-expanded="false" aria-controls="${id}-why">${gauge(conf)}<span>Уверенность <b>${CONF_LABEL[conf]}</b></span><i class="conf-q" aria-hidden="true">?</i></button>
            <span class="conf-pop" id="${id}-why" role="note" hidden>${esc(confWhy)}</span></span>
          ${dq ? `<span class="dq dq-${esc(dq)}" title="${esc(p.data_quality.note || "")}"><i></i>Данные: ${esc(DQ_LABEL[dq] || dq)}</span>` : `<span class="dq dq-old" title="Прогноз опубликован до появления разбора «за» и «против»"><i></i>Без разбора</span>`}
          ${v2 ? `<button class="pk-more" type="button" aria-expanded="false" aria-controls="${id}-more">
              <span>Полный разбор</span><small>${facts.length} ${plural(facts.length, "факт", "факта", "фактов")}${against.length ? ` · ${against.length} против` : ""}</small>${I_CHEV}</button>`
            : `<span class="srcs">${srcChips(p.sources)}</span>`}
        </div>
        ${si >= 0 ? `<button type="button" class="pk-story" data-story="${si}">${icon("analysis")}<span>Подробный разбор этого матча</span></button>` : ""}
        ${si < 0 ? scheduleContext(fixture, sport.id) : ""}
        ${!p.projection ? bookmakerHTML(p.bookmaker || fixture?.bookmaker, sport.id) : ""}
        ${detail}
      </article>`;
  }

  function scheduleEvents(sport, cards) {
    const displayed = new Set(cards.map(cardKey).filter(Boolean));
    return (sport.events || []).filter((event) => !event.has_pick &&
      !displayed.has(cardKey(event)) && Date.parse(event.start_iso) > Date.now());
  }

  function scheduleContext(event, sport) {
    const context = event?.analysis_context;
    if (!context) return "";
    const labels = {
      insufficient_results: "Нужно минимум по 4 сопоставимых результата у каждой стороны.",
      no_recent_results: "У одной из сторон нет подтверждённого результата за последние 28 дней.",
      unconfirmed_format: "Формат серии пока не подтверждён.",
      editorial_limit: "Матч не вошёл в подборку подробных разборов.",
      not_assessed: "Статистика матча пока не прошла сверку.",
    };
    const teams = splitTeams(event.match);
    const counts = teams && context.history?.length === 2 ? teams.map((team, index) => {
      const count = context.history[index];
      const wins = context.historicalWins?.[index];
      return `${ru(team, sport)} — ${count} ${plural(count, "результат", "результата", "результатов")}${count && Number.isInteger(wins) ? `, побед ${wins}` : ""}`;
    }).join("; ") : "";
    return `<div class="schedule-context"><strong>Почему нет разбора</strong>
      <p>${esc(context.reasons.map((reason) => labels[reason]).filter(Boolean).join(" "))}</p>
      ${counts ? `<p>${esc(counts)}. ${context.historySources?.length ? esc("История: " + context.historySources.join(", ") + ".") : ""}</p>` : ""}</div>`;
  }

  function scheduleHTML(sport, events) {
    if (!events.length) return "";
    events.sort((a, b) => Date.parse(a.start_iso) - Date.parse(b.start_iso));
    return `<section class="sport-schedule"><h3>Расписание</h3><ul>${events.map((event) => {
      const story = storyIndexFor(event.match, sport.id, event.start_iso);
      const bucket = bucketOf(event);
      return `<li class="schedule-match" data-day="${bucket.day}"${bucket.soon ? " data-soon" : ""}>
        <div class="schedule-meta"><span>${esc(ruTournament(event.tournament, sport.id))}${event.format ? " · " + esc(event.format) : ""}</span>${whenHTML(event, sport.id)}</div>
        <strong>${esc(ru(event.match, sport.id))}</strong>
        <div class="schedule-meta"><span class="srcs">${srcChips(event.sources)}</span>
        ${story < 0 ? "" : `<button type="button" class="pk-story" data-story="${story}">${icon("analysis")}<span>Разбор</span></button>`}</div>
        ${(event.sources || []).filter((source) => sourceTiming(source)).map((source) =>
          `<small class="source-timing">${esc(source.title)} · ${esc(sourceTiming(source))}</small>`).join("")}
        ${story < 0 ? scheduleContext(event, sport.id) : ""}
        ${bookmakerHTML(event.bookmaker, sport.id)}
      </li>`;
    }).join("")}</ul></section>`;
  }

  function bookmakerHTML(bookmaker, sport) {
    if (!bookmaker && !integrated() && !data.manual_schedule) return "";
    bookmaker ||= { status: "missing", lines: [] };
    const { status, lines } = bookmaker;
    const now = new Date().getTime();
    const available = (Array.isArray(lines) ? lines : []).flatMap((line) => {
      const source = URL.parse(line.referenceUrl || line.sourceUrl);
      if (source?.protocol !== "https:" || !Number.isFinite(Date.parse(line.receivedAt)) ||
          !Array.isArray(line.outcomes) || !line.outcomes.length) return [];
      if (line.privateSnapshot) return data.source === "model-preview" ? [{ line, freshness: "snapshot" }] : [];
      if (line.archivedObservation) return data.review_snapshot_at ? [{ line, freshness: "snapshot" }] : [];
      if (!["current", "observed"].includes(status) || !(Date.parse(line.expiresAt) > now)) return [];
      const freshness = status === "observed" || line.observationOnly || !Number.isFinite(Date.parse(line.updatedAt)) ?
        "observed" : "current";
      return [{ line, freshness }];
    });
    const message = {
      stale: "Срок актуальности полученной линии истёк.",
      unsupported: "В подключённом источнике для этого турнира нет проверенной схемы линий.",
      unconfigured: "Актуальная линия не найдена. Источник с ключом доступа не подключён.",
      access_required: "Нет доступа к источнику линий.",
      unauthorized: "Ошибка авторизации источника линий.",
      quota_exhausted: "Исчерпана квота источника линий.",
      unavailable: "Источник линий временно недоступен.",
      unmatched: "Матч у поставщика не удалось сопоставить.",
      missing: "Подтверждённых котировок пока нет.",
    };
    if (!available.length) {
      return `<div class="st-src bookmaker-lines"><h4>Букмекерская линия</h4><p>${esc(message[["current", "observed"].includes(status) ? "stale" : status] || message.missing)}</p></div>`;
    }
    const scopes = { regulation: "90 минут с добавленным временем", overtime: "Весь матч с овертаймом",
      overtime_shootout: "Весь матч с овертаймом и буллитами", match_bo5: "Матч до трёх выигранных сетов",
      series_bo3: "Вся серия BO3", tennis_match: "Весь матч в одиночном разряде" };
    const labels = { outcome: "Исход матча", total: "Общий тотал", handicap: sport === "football" ? "Азиатская фора" : "Фора" };
    const percentage = (p) => `${Math.round(p * 100)}%`;
    const price = new Intl.NumberFormat("ru", { minimumFractionDigits: 2, maximumFractionDigits: 12 });
    const freshnessLabel = { snapshot: "Архивный снимок", observed: "Снимок опубликованной линии", current: "Актуальная котировка" };
    const freshnessNote = { snapshot: "Архивные коэффициенты.", observed: "Текущая цена у букмекера не подтверждена.", current: "" };
    const comparableModel = (line, offer) => line.modelComparable !== false && offer.comparisonStatus === "matched" && offer.model;
    const groupBySource = Map.groupBy(available, ({ line, freshness }) => JSON.stringify([
      line.bookmaker, line.source, line.referenceUrl || line.sourceUrl, line.receivedAt, line.scope, freshness,
    ]));
    return `<div class="st-src bookmaker-lines"><h4>Букмекерская линия</h4>
      ${[...groupBySource.values()].map((lines) => {
        const [{ line: source, freshness }] = lines;
        const sources = [{ url: source.referenceUrl || source.sourceUrl, title: source.source },
          ...new Map(lines.map(({ line }) => line).filter((line) => URL.parse(line.rulesUrl)?.protocol === "https:").map((line) => [line.rulesUrl, { url: line.rulesUrl,
            title: line.type === "handicap" && sport === "football" ? "Правила азиатской форы" : "Правила расчёта" }])).values()];
        return `<details class="bookmaker-source">
      <summary><strong>${freshnessLabel[freshness]}</strong> · ${esc(source.bookmaker)} · ${esc(source.source)}</summary>
      <p>${esc(scopes[source.scope] || "Период расчёта не подтверждён")}. ${freshnessNote[freshness]}</p>
      ${source.modelComparable === false ? "<p>Подробные правила расчёта букмекера не подтверждены.</p>" : ""}
      <p>Получено <time datetime="${esc(source.receivedAt)}">${esc(fmtDate(source.receivedAt))}</time>.${source.publishedAt ?
        ` Файл обновлён ${esc(fmtDate(source.publishedAt))}. Время изменения каждой цены не указано.` :
        source.scannedAt ? ` Снимок источника от ${esc(fmtDate(source.scannedAt))}. Время изменения каждой цены не указано.` :
          source.observationOnly ? " Время обновления цены источник не сообщил." : ""}</p>
      ${lines.map(({ line }) => `<div class="bookmaker-market"${freshness !== "snapshot" ? ` data-expires-at="${esc(line.expiresAt)}"` : ""}><strong>${esc(line.marketName || labels[line.type])}</strong>
        ${line.updatedAt ? `<small> · Обновление у источника ${esc(fmtDate(line.updatedAt))}</small>` : ""}
        <ul class="pk-key">${line.outcomes.map((offer) => {
          const { condition, price: odds, point, americanPrice } = offer;
          const model = comparableModel(line, offer);
          return `<li>
          ${esc(ru(condition, sport))} · коэффициент <b>${esc(Number.isSafeInteger(americanPrice) ? fmtOdds(odds) : price.format(odds))}</b> ·
          ${Number.isSafeInteger(americanPrice) ? `в источнике ${americanPrice > 0 ? "+" : ""}${americanPrice} · ` : ""}
          ${model ? `модель ${percentage(model.win)}${model.push == null ? "" : `, возврат ${percentage(model.push)}`}` :
            point != null && !Number.isInteger(2 * point) ? "условие линии требует двух расчётов, проверенной оценки нет" :
              "для этого условия нет проверенной модельной оценки"}
        </li>`;
        }).join("")}</ul></div>`).join("")}${srcChips(sources)}</details>`;
      }).join("")}
      ${available.some(({ line }) => line.outcomes.some((offer) => comparableModel(line, offer))) ?
        "<p>Вероятности рассчитаны отдельно от коэффициентов.</p>" : ""}</div>`;
  }

  function modelConclusionHTML(conclusion, sport, showStats = false) {
    if (!conclusion) return "";
    const shown = (value) => esc(ru(value, sport));
    const fields = showStats ? ["expected", "scenario", "statistic", "caution", "limitations"] :
      ["expected", "scenario", "evidence", "caution", "inputs", "limitations"];
    return `<footer class="verdict model-conclusion"><small>Итог модели</small>
      ${fields.filter((key) => conclusion[key]).map((key) => `<p>${shown(conclusion[key])}</p>`).join("")}</footer>`;
  }

  function projectionHTML(p, i, sport) {
    const bk = bucketOf(p);
    const story = storyIndexFor(p.match, sport.id, p.start_iso);
    return `<article class="pick projection" id="pick-${sport.id}-${i}" style="--i:${i}" data-day="${bk.day}"${bk.soon ? " data-soon" : ""}>
      <div class="pk-meta"><span class="pk-tour">${esc(ruTournament(p.tournament, sport.id))}</span>${whenHTML(p, sport.id)}</div>
      <div class="pk-main">${teamsHTML(p.match, sport.id)}</div>
      ${projectionDetails(p, sport.id)}
      ${story < 0 ? "" : `<button type="button" class="pk-story" data-story="${story}">${icon("analysis")}<span>${p.statisticalSummary ? "Полный разбор и источники" : "Методика, проверка и источники"}</span></button>`}
    </article>`;
  }

  function projectionDetails(p, sport) {
    const scenarioLines = p.scenarioLines || (p.scenarios?.length ? (p.lines || []).slice(-p.scenarios.length) : []);
    return `${modelConclusionHTML(p.modelConclusion, sport, true)}
      ${p.statisticalSummary && !p.modelConclusion ? `<div class="verdict"><small>Статистический разбор · без модельной вероятности</small>
        <p>${esc(ru(p.statisticalSummary, sport))}</p></div>` : ""}
      ${bookmakerHTML(p.bookmaker, sport)}
      ${p.scoreSections?.length || scenarioLines.length ? `<details class="projection-estimates">
        <summary>${p.statisticalSummary ? "Результаты и детали" : "Счёт команд и другие оценки"}</summary>
        ${(p.scoreSections || []).map(({ title, lines }) => `<section><h4>${esc(title)}</h4>
          <ul class="pk-key">${lines.map((line) => `<li>${esc(ru(line, sport))}</li>`).join("")}</ul></section>`).join("")}
        ${scenarioLines.length ? `<ul class="pk-key">${scenarioLines.map((line) => `<li>${esc(ru(line, sport))}</li>`).join("")}</ul>` : ""}
      </details>` : ""}`;
  }

  function sportHTML(sport) {
    const projections = data.source === "model-preview";
    const cards = displayCards(sport);
    const count = cards.length;
    const tours = new Set(cards.map((p) => String(p.tournament || "").split(",")[0].trim()).filter(Boolean));
    const sub = count
      ? `${count} ${cards.some((card) => card.statisticalSummary) ? analysisCountLabel(count) : countLabel(count)} · ${tours.size} ${plural(tours.size, "турнир", "турнира", "турниров")}`
      : "";
    let html = `
      <div class="sport-head">
        <span class="sh-ico">${icon(sport.id, "big-ico")}</span>
        <div><h2>${esc(sport.name)}</h2>${sub ? `<p>${sub}</p>` : ""}</div>
      </div>`;
    if (sport.stale && sport.updated_at) {
      html += `<p class="note warn">Сегодня обновить не удалось — показаны прогнозы от ${esc(fmtDate(sport.updated_at))}.</p>`;
    }
    const fullSchedule = integrated() || data.manual_schedule;
    const events = fullSchedule || !cards.length || ["tennis", "volleyball", "dota2"].includes(sport.id) ?
      scheduleEvents(sport, fullSchedule ? cards : []) : [];
    if (!cards.length && !events.length) {
      const story = (data.analysis || []).findIndex((a) => a.sport_id === sport.id);
      const emptyMessage = {
        model_unavailable: "Для предстоящих матчей нет модели, прошедшей историческую проверку на доступных данных.",
        unavailable: "Часть источников недоступна. Сверить расписание пока не удалось.",
        unconfirmed: "В доступных расписаниях есть события, но для публикации нужно совпадение двух источников.",
        insufficient_quality: sport.id === "cs2" ? "В расписании есть серии, но два источника пока не подтвердили их формат." :
          "Расписание сверено, но для отбора нужно минимум по два подтверждённых недавних результата на каждую команду.",
        empty: "В проверенных расписаниях нет предстоящих матчей до конца завтрашнего дня по Москве.",
      };
      return html + `
        <div class="empty">
          ${svg('<path class="e-line" d="M4 30h40l8-14 10 22 8-12h46"/><circle class="e-dot" cx="116" cy="30" r="3"/>', "e-svg", "0 0 124 44")}
          <strong>Готовых прогнозов нет</strong>
          <p>${esc(story >= 0 ? "Подтверждённые матчи и данные по ним доступны в «Разборе дня»." :
            emptyMessage[sport.availability] || "Новые прогнозы появятся, когда будет достаточно подтверждённых данных.")}</p>
          ${story < 0 ? "" : `<button type="button" class="pk-story" data-story="${story}">${icon("analysis")}<span>Открыть разборы</span></button>`}
        </div>`;
    }
    const topConf = Math.max(...cards.map((p) => Number(p.confidence) || 0));
    const now = Date.now();
    const bks = [...cards, ...events].map((p) => bucketOf(p, now));
    const cnt = { all: bks.length, soon: bks.filter((b) => b.soon).length, today: bks.filter((b) => b.day === "today").length, tomorrow: bks.filter((b) => b.day === "tomorrow").length };
    const chips = [["all", "Все"], ["soon", "Ближайшие 3 часа"], ["today", "Сегодня"], ["tomorrow", "Завтра"]]
      .map(([k, l]) => `<button type="button" class="when-chip" data-when="${k}" aria-pressed="${whenFilter === k}"${cnt[k] || k === "all" ? "" : " disabled"}>${l}<b>${cnt[k]}</b></button>`).join("");
    html += `<div class="when" role="group" aria-label="Когда начинается матч">${chips}</div>`;
    html += `<div class="list" data-when="${whenFilter}">` + cards.map((p, i) =>
      projections || integrated() && !p.bet ? projectionHTML(p, i, sport) : pickHTML(p, i, sport, i === 0 && topConf >= 4)).join("") + `</div>`;
    html += `<div class="when-empty" hidden><p>В этом окне матчей нет.</p><button type="button" class="when-chip" data-when="all">Показать все</button></div>`;
    return html + scheduleHTML(sport, events);
  }


  /* ---------- Экспрессы дня ---------- */
  const TIER = { safe: "Надёжный", mid: "Средний", bold: "Смелый" };
  const fmtOdds = (x) => (Number(x) || 0).toFixed(2).replace(".", ",");
  const rub = (n) => Math.round(n).toLocaleString("ru-RU").replace(/\u00a0/g, " ") + " ₽";
  const sportById = (id) => data.sports.find((s) => s.id === id);
  function legWhen(l) {
    const t = Date.parse(l.start_iso);
    if (isNaN(t)) return esc(l.start || "");
    const now = Date.now();
    const st = H ? H.displayStatus({ status: "pending", start_iso: l.start_iso, sport: l.sport }, now) : (now < t ? "upcoming" : "live");
    const d = dayRel(t, now);
    return `<span class="xl-when st-${st}">${esc(d[0].toUpperCase() + d.slice(1))}, ${hhmm(t)}${st === "live" ? " · идёт" : ""}</span>`;
  }
  function legPick(l) {
    const s = sportById(l.sport);
    return s && (s.picks || []).find((p) => p.match === l.match && p.bet === l.bet);
  }
  function legHTML(l, k) {
    const s = sportById(l.sport);
    const p = legPick(l);
    const conf = p ? Math.max(1, Math.min(5, Number(p.confidence) || 3)) : null;
    return `
      <li class="xl" style="--c:${colorOf(l.sport)}">
        <span class="xl-n">${k + 1}</span>
        <span class="xl-ico">${icon(l.sport)}</span>
        <div class="xl-body">
          <div class="xl-top"><span class="xl-sport">${esc(s ? s.name : l.sport)}</span>${legWhen(l)}</div>
          <div class="xl-match">${esc(ru(l.match, l.sport))}</div>
          <div class="xl-bet"><span>${esc(ru(l.bet, l.sport))}</span>${conf ? `<span class="xl-conf" title="Уверенность в прогнозе">${gauge(conf)}</span>` : ""}</div>
        </div>
        ${l.odds ? `<span class="xl-odds">${fmtOdds(l.odds)}</span>` : ""}
      </li>`;
  }
  function expressCard(x, i, archived = false) {
    const total = archived ? Number(x.settled_odds || x.total_odds) :
      Number(x.total_odds) || (x.legs || []).reduce((a, l) => a * (Number(l.odds) || 1), 1);
    const market = Math.round(100 / total);
    const tier = x.tier || "mid";
    const verified = data.source === "sports-update";
    const seasonSources = verified && x.legs?.every((leg) => leg.basis === "season") ? [
      { title: "Таблица NHL", url: "https://www.nhl.com/standings/" },
      { title: "Таблица NHL на ESPN", url: "https://www.espn.com/nhl/standings" },
    ] : [];
    return `
      <article class="xp tier-${esc(tier)}" style="--i:${i}">
        <header class="xp-head">
          <div>
            <span class="xp-tier">${esc(x.title || TIER[tier] || "Экспресс")}</span>
            <h3>${(x.legs || []).length} ${plural((x.legs || []).length, "событие", "события", "событий")}</h3>
          </div>
          <div class="xp-total">${x.forecast_only || !total ? "<small>Без коэффициента</small>" :
            `<small>${verified ? "Кф из публикаций" : "Общий коэффициент"}</small><b>${fmtOdds(total)}</b>`}</div>
        </header>
        <ol class="xp-legs">${(x.legs || []).map(legHTML).join("")}</ol>
        ${x.reason ? `<p class="xp-reason">${esc(x.reason)}</p>` : ""}
        ${x.weak_link ? `<p class="xp-weak"><b>${verified ? "Что может повлиять." : "Слабое звено."}</b> ${esc(x.weak_link)}</p>` : ""}
        ${seasonSources.length ? `<footer class="xp-foot"><span class="srcs">${srcChips(seasonSources)}</span></footer>` : verified || archived ? "" :
          `<footer class="xp-foot"><span class="xp-mkt" title="Обратная величина общего коэффициента — оценка букмекера с учётом маржи, а не наша вероятность">Шанс по линии ≈ ${market}%</span></footer>`}
      </article>`;
  }
  function expressScenario(article, i) {
    const sid = article.sport_id;
    const conclusion = article.modelConclusion;
    const story = storyIndexFor(article.match, sid, article.start_iso);
    const shown = (value) => esc(ru(value, sid));
    return `<article class="xp tier-mid" style="--i:${i}">
      <header class="xp-head"><div><span class="xp-tier">${esc(article.sport)}</span>
        <h3>${shown(article.match)}</h3></div>${legWhen({ ...article, sport: sid })}</header>
      ${conclusion.expected ? `<p class="xp-reason">${shown(conclusion.expected)}</p>` : ""}
      <p class="xp-reason">${shown(conclusion.scenario)}</p>
      <p class="xp-weak">${shown(conclusion.limitations)}</p>
      ${story < 0 ? "" : `<footer class="xp-foot"><button type="button" class="pk-story" data-story="${story}">${icon("analysis")}<span>Открыть подробный разбор</span></button></footer>`}
    </article>`;
  }
  function expressHTML() {
    const list = data.express || [];
    const highlights = integrated() ? [] : data.expressHighlights || [];
    return `
      <div class="sport-head">
        <span class="sh-ico">${icon("express", "big-ico")}</span>
        <div><h2>Экспрессы дня</h2><p>${data.source === "model-preview" ?
          "Отдельные статистические сценарии по матчам дня." :
          "Собраны из прогнозов сайта. Общий коэффициент указан для подборок, в которых есть коэффициенты всех событий."}</p></div>
      </div>
      ${highlights.length ? `<div class="xp-list express-highlights">${highlights.map(expressScenario).join("")}</div>` : ""}
      ${list.length ? `<div class="xp-list">${list.map((item, i) => expressCard(item, i)).join("")}</div>` : highlights.length ? "" :
        '<div class="empty"><strong>На сегодня нет опубликованных экспрессов</strong><p><a href="#xp-past">Перейти к истории экспрессов</a></p></div>'}
      <section class="xp-past" id="xp-past"><p class="note" role="status">Загружаем историю экспрессов…</p></section>`;
  }
  let expressPast = null;
  async function loadExpressPast() {
    const box = $("#xp-past");
    if (!box) return;
    if (!expressPast) {
      try {
        const r = await fetch("data/history/express.json?v=" + Date.now(), { cache: "no-store" });
        if (!r.ok) throw new Error("Экспресс-архив недоступен");
        expressPast = await r.json();
      } catch {
        box.innerHTML = '<h3 class="xp-past-h">История экспрессов</h3><p class="note">Не удалось загрузить историю. Откройте раздел ещё раз, чтобы повторить попытку.</p>';
        return;
      }
    }
    const all = (expressPast.expresses || []).filter((x) => x.status !== "withdrawn").sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
    const settled = all.filter((x) => x.status === "won" || x.status === "lost");
    if ($("#xp-past") !== box) return;
    if (!all.length) {
      box.innerHTML = '<h3 class="xp-past-h">История экспрессов</h3><p class="note">В архиве пока нет записей.</p>';
      return;
    }
    const won = settled.filter((x) => x.status === "won");
    const profit = settled.filter((x) => !x.forecast_only).reduce((a, x) =>
      a + (x.status === "won" ? 1000 * ((Number(x.settled_odds) || Number(x.total_odds)) - 1) : -1000), 0);
    const LBL = { won: "Зашёл", lost: "Не зашёл", pending: "Ждёт результата", void: "Возврат" };
    box.hidden = false;
    box.innerHTML = `
      <h3 class="xp-past-h">История экспрессов</h3>
      <div class="xp-kpis">
        <div><b>${settled.length}</b><span>${plural(settled.length, "рассчитан", "рассчитано", "рассчитано")}</span></div>
        <div><b>${won.length}</b><span>${plural(won.length, "зашёл", "зашло", "зашло")}</span></div>
        <div class="${profit >= 0 ? "pos" : "neg"}"><b>${profit >= 0 ? "+" : "−"}${rub(Math.abs(profit))}</b><span>при ставке 1 000 ₽ на каждый экспресс с коэффициентом</span></div>
      </div>
      <ul class="xp-rows">${all.slice(0, 30).map((x) => `
        <li class="xr st-${esc(x.status)}">
          <span class="xr-d">${esc(dayShort(Date.parse(x.published_at)))}</span>
          <span class="xr-t">${esc(x.title || TIER[x.tier] || "Экспресс")}</span>
          <span class="xr-l">${(x.legs || []).map((l) => `<i class="lg-${esc(l.status || "pending")}" title="${esc(ru(l.match + " — " + l.bet, l.sport))}"></i>`).join("")}</span>
          <span class="xr-o">${x.forecast_only || !(Number(x.settled_odds || x.total_odds) > 1) ? "—" : fmtOdds(x.settled_odds || x.total_odds)}</span>
          <span class="xr-s">${LBL[x.status] || x.status}</span>
        </li>`).join("")}</ul>
      ${analytical() ? `<details class="xp-past-cards"><summary>Показать карточки из архива</summary>
        <div class="xp-list">${all.map((item, i) => expressCard(item, i, true)).join("")}</div></details>` : ""}`;
  }

  /* ---------- Разбор дня ---------- */
  function scenarioCardHTML(article) {
    const conclusion = article.modelConclusion;
    const story = storyIndexFor(article.match, article.sport_id, article.start_iso);
    const shown = (value) => esc(ru(value, article.sport_id));
    return `<article class="story" style="--c:${colorOf(article.sport_id)}"><p class="st-kicker">${esc(article.sport)}</p>
      <h3 class="st-title">${shown(article.match)}</h3>
      <div class="verdict">${conclusion.expected ? `<p>${shown(conclusion.expected)}</p>` : ""}<p>${shown(conclusion.scenario)}</p></div>
      <p>${shown(conclusion.statistic)}</p>
      <p>${shown(conclusion.caution)}</p>
      ${story < 0 ? "" : `<button type="button" class="pk-story" data-story="${story}">${icon("analysis")}<span>Открыть подробный разбор</span></button>`}</article>`;
  }

  function modelSummaryHTML() {
    const articles = data.dailySummary || [];
    return `<div class="sport-head"><span class="sh-ico">${icon("analysis", "big-ico")}</span>
      <div><h2>Сводка дня</h2><p>Отдельные оценки по сегодняшним матчам. Для каждой указан результат исторической проверки.</p></div></div>
      ${articles.length ? `<div class="stories">${articles.map((article) => scenarioCardHTML(article)).join("")}</div>` :
      '<p class="note">На сегодня нет оценок, прошедших проверку.</p>'}`;
  }

  function sportIdByLabel(label) {
    const s = String(label || "").toLowerCase();
    const hit = data.sports.find((x) => s.includes(String(x.name).toLowerCase()));
    return hit ? hit.id : "analysis";
  }

  function analysisHTML() {
    const hasStatisticalAnalysis = data.analysis.some((article) => article.statisticalSummary);
    let html = `
      <div class="sport-head">
        <span class="sh-ico">${icon("analysis", "big-ico")}</span>
        <div><h2>Разбор дня</h2><p>${hasStatisticalAnalysis ? "Форма участников, статистика и источники. Вероятности указаны для матчей с проверенными моделями." :
          data.source === "model-preview" ? "Как рассчитаны вероятности, как прошла проверка моделей и какие источники использованы." :
          data.source === "sports-update" ? "Проверенное расписание, результаты последних матчей и факторы, которые пока не удалось сверить." :
            "Главные матчи подробнее: форма, составы, личные встречи и мнения аналитиков. Это мнение, а не гарантия."}</p></div>
      </div>`;
    if (!data.analysis.length) return html + '<p class="note">Подробные разборы появятся после проверки данных и моделей.</p>';
    html += `<div class="stories">` + data.analysis.map((a, i) => {
      const sid = a.sport_id || sportIdByLabel(a.sport);
      const shown = (value) => esc(ru(value, sid));
      const sportName = String(a.sport || "").replace(/^[^\p{L}]+/u, "").trim();
      const paras = String(a.text || "").split(/\n+/).map((t) => t.trim()).filter(Boolean);
      const first = paras.shift();
      const limitations = paras.filter((line) => /^(Что не удалось проверить|Не сверены|Ограничения)[.:]/u.test(line));
      const facts = paras.filter((line) => line !== "Контекст матча и статистика для сравнения" && !limitations.includes(line));
      const factors = (a.key_factors || []).filter((item) => !a.automated || item !== first);
      const t = splitTeams(a.match);
      const title = t
        ? `<span class="team">${flag(t[0])}<span class="tm" title="${shown(t[0])}">${shown(t[0])}</span></span><span class="sep"><span class="vh">против</span></span><span class="team">${flag(t[1])}<span class="tm" title="${shown(t[1])}">${shown(t[1])}</span></span>`
        : `<span class="tm">${shown(a.match)}</span>`;
      const st = startOf(a);
      const when = !isNaN(st.ms) && st.exact ? `${dayRel(st.ms)}, ${hhmm(st.ms)}` : (a.start || "");
      const moreId = `story-${i}`;
      return `
        <article class="story${i === 0 ? " lead" : ""}" id="story-card-${i}" style="--c:${colorOf(sid)};--i:${i}">
          <p class="st-kicker">${icon(sid)}<span>${esc(sportName || "Матч")}</span><span class="st-dot"></span><span>${esc(ruTournament(a.tournament, sid))}</span><span class="st-dot"></span><span>${esc(when)}</span></p>
          <h3 class="st-title">${title}</h3>
          ${modelConclusionHTML(a.modelConclusion, sid)}
          ${!a.modelConclusion && a.verdict ? `<div class="verdict"><small>${a.statisticalSummary ? "Статистический вывод" : a.automated ? "Итог аналитики" : "Вывод"}</small><p>${shown(a.verdict)}</p></div>` : ""}
          <div class="st-grid">
            <div class="st-text">
              ${first && first !== a.verdict ? `<p class="st-lead">${shown(first)}</p>` : ""}
              ${facts.length || a.scoreSections?.length ? `
                <div class="more" id="${moreId}"><div>
                  <h4>Подтверждающие факты</h4>
                  ${(a.scoreSections || []).map(({ title, lines }) => `<section><h4>${shown(title)}</h4>${lines.map((x) => `<p>${shown(x)}</p>`).join("")}</section>`).join("")}
                  ${facts.map((x) => `<p>${shown(x)}</p>`).join("")}</div></div>
                <button class="toggle" type="button" aria-expanded="false" aria-controls="${moreId}"><span>Читать разбор полностью</span>${I_CHEV}</button>` : ""}
            </div>
            ${factors.length || limitations.length ? `<aside class="st-side">
              ${factors.length ? `<div class="st-factors"><h4>Ключевые факторы</h4><ul>${factors.map((f) => `<li>${shown(f)}</li>`).join("")}</ul></div>` : ""}
              ${limitations.length ? `<div class="st-factors"><h4>Ограничения</h4><ul>${limitations.map((line) =>
                `<li>${shown(line.replace(/^[^:]+:\s*/, ""))}</li>`).join("")}</ul></div>` : ""}
            </aside>` : ""}
          </div>
          ${bookmakerHTML(a.bookmaker, sid)}
          ${groupedStorySources(a.sources)}
        </article>`;
    }).join("") + `</div>`;
    return html;
  }

  function setOpen(box, btn, open, labels) {
    box.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", open);
    btn.querySelector("span").textContent = open ? labels[1] : labels[0];
  }
  function applyWhen() {
    const list = panel.querySelector(".list[data-when]");
    if (!list) return;
    list.dataset.when = whenFilter;
    panel.querySelectorAll(".when .when-chip").forEach((c) => c.setAttribute("aria-pressed", c.dataset.when === whenFilter));
    const filter = { all: "", soon: "[data-soon]", today: '[data-day="today"]', tomorrow: '[data-day="tomorrow"]' }[whenFilter];
    const schedule = panel.querySelector(".sport-schedule");
    if (schedule) {
      schedule.querySelectorAll(".schedule-match").forEach((event) => { event.hidden = !event.matches(".schedule-match" + filter); });
      schedule.hidden = !schedule.querySelector(".schedule-match:not([hidden])");
    }
    const empty = !list.querySelector(".pick" + filter) && (!schedule || schedule.hidden);
    panel.querySelector(".when-empty").hidden = !empty;
  }
  let pendingFocus = null; // элемент, к которому прокрутить после отрисовки панели
  function focusAfterPaint() {
    if (!pendingFocus) return;
    const el = $(pendingFocus);
    pendingFocus = null;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "start" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1800);
    });
  }
  function openStory(i) {
    pendingFocus = "#story-card-" + i;
    if (current === "analysis") focusAfterPaint(); else select("analysis", false);
  }
  function bindPanel() {
    panel.querySelectorAll(".when-chip").forEach((c) => c.addEventListener("click", () => { whenFilter = c.dataset.when; applyWhen(); }));
    applyWhen();
    panel.querySelectorAll(".pk-story").forEach((b) => b.addEventListener("click", () => openStory(+b.dataset.story)));
    panel.querySelectorAll(".conf[aria-controls]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const pop = $("#" + b.getAttribute("aria-controls"));
      const open = b.getAttribute("aria-expanded") !== "true";
      panel.querySelectorAll('.conf[aria-expanded="true"]').forEach((x) => { x.setAttribute("aria-expanded", "false"); $("#" + x.getAttribute("aria-controls")).hidden = true; });
      b.setAttribute("aria-expanded", open); pop.hidden = !open;
    }));
    panel.querySelectorAll(".pk-more").forEach((btn) => btn.addEventListener("click", () => {
      const card = btn.closest(".pick");
      setOpen(card, btn, !card.classList.contains("open"), ["Полный разбор", "Свернуть разбор"]);
    }));
    panel.querySelectorAll(".toggle").forEach((btn) => btn.addEventListener("click", () => {
      const story = btn.closest(".story");
      setOpen(story, btn, !story.classList.contains("open"), ["Читать разбор полностью", "Свернуть"]);
    }));
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest(".conf-wrap")) return;
    panel.querySelectorAll('.conf[aria-expanded="true"]').forEach((x) => { x.setAttribute("aria-expanded", "false"); $("#" + x.getAttribute("aria-controls")).hidden = true; });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    panel.querySelectorAll('.conf[aria-expanded="true"]').forEach((x) => { x.setAttribute("aria-expanded", "false"); $("#" + x.getAttribute("aria-controls")).hidden = true; x.focus(); });
  });

  function renderPanel(animated) {
    const html = current === "analysis" ? analysisHTML() : current === "express" ? expressHTML() :
      current === "summary" ? modelSummaryHTML() : sportHTML(data.sports.find((s) => s.id === current));
    clearTimeout(rendering);
    const paint = () => {
      panel.innerHTML = html;
      bindPanel();
      focusAfterPaint();
      if (current === "express") loadExpressPast();
      panel.classList.remove("leaving");
      if (!calm()) {
        panel.classList.add("entering");
        rendering = setTimeout(() => panel.classList.remove("entering"), 1400);
      }
    };
    if (animated && !calm()) {
      panel.classList.remove("entering");
      panel.classList.add("leaving");
      rendering = setTimeout(paint, 160);
    } else paint();
  }

  function renderModelJournal() {
    const journal = data.modelJournal;
    if (!journal) return;
    const box = document.createElement("section");
    box.className = "note";
    box.setAttribute("aria-label", "Проверка новых моделей");
    const labels = { outcome: "исход", total: "общий счёт", margin: "разница счёта", home_score: "результативность первой команды",
      distribution_total: "диапазон общего счёта", distribution_home: "диапазон счёта первой команды",
      distribution_away: "диапазон счёта второй команды", distribution_margin: "диапазон разницы счёта",
      threshold_total: "границы общего счёта", threshold_home: "границы счёта первой команды",
      threshold_away: "границы счёта второй команды", threshold_margin: "границы разницы счёта" };
    const scores = Object.entries(journal.metrics || {}).map(([key, row]) => {
      const [, sport, , target] = key.split("/");
      const name = data.sports.find((item) => item.id === sport)?.name || sport;
      return `<li>${esc(name)} · ${esc(labels[target] || target)} — ${esc(row.matches)} матчей${row.metrics ?
        `, Брайер ${esc(row.metrics.brier.toFixed(3).replace(".", ","))}` : ", выборка пока мала для метрик"}.</li>`;
    }).join("");
    box.innerHTML = `<h3>Проверка новых моделей</h3>
      <p>Локальные прогнозы — ${esc(journal.entries)}. Сверено результатов — ${esc(journal.settled)}. Ожидают завершения или сверки — ${esc(journal.pending + journal.awaiting)}.</p>
      ${scores ? `<ul>${scores}</ul>` : "<p>Данных для оценки на новых матчах пока недостаточно.</p>"}`;
    $("#history .h-head")?.after(box);
  }

  /* ---------- Навигация в шапке ---------- */
  const navAnalysis = $('[data-nav="analysis"]');
  navAnalysis.addEventListener("click", (e) => { e.preventDefault(); select("analysis", true); });
  $('[data-nav="board"]').addEventListener("click", (e) => {
    e.preventDefault();
    if (current === "analysis" && data) select(firstForecastSport());
    $("#board").scrollIntoView({ behavior: calm() ? "auto" : "smooth" });
  });
  const inView = { suggest: false, history: false };
  function syncNav() {
    document.querySelectorAll(".nav a").forEach((a) => a.removeAttribute("aria-current"));
    const key = inView.suggest ? "suggest" : inView.history ? "history" : current === "analysis" ? "analysis" : current === "express" ? "express" : "board";
    $(`[data-nav="${key}"]`)?.setAttribute("aria-current", "true");
  }
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((ents) => ents.forEach((en) => { inView[en.target.id] = en.isIntersecting; syncNav(); }),
      { rootMargin: "-40% 0px -40% 0px" });
    ["suggest", "history"].forEach((id) => $("#" + id) && io.observe($("#" + id)));
  }

  /* ---------- Плавное появление разделов при прокрутке (один раз) ---------- */
  (function reveal() {
    const els = document.querySelectorAll("[data-reveal]");
    if (!("IntersectionObserver" in window) || calm()) { els.forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((ents) => ents.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    }), { rootMargin: "0px 0px -8% 0px" });
    els.forEach((e) => io.observe(e));
  })();

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
      board.innerHTML = `<div class="bd-empty">Не удалось загрузить сводку</div>`;
      panel.innerHTML = `<div class="empty"><strong>Не удалось загрузить прогнозы</strong><p>Проверьте подключение к интернету и обновите страницу.</p></div>`;
      return;
    }
    if (!data.sports || !data.sports.length) {
      setUpdated("", false);
      board.innerHTML = `<div class="bd-empty">Прогнозов пока нет</div>`;
      panel.innerHTML = `<div class="empty"><strong>Прогнозов пока нет</strong><p>Они появятся после первого обновления.</p></div>`;
      return;
    }
    const upd = data.updated_at ? Date.parse(data.updated_at) : NaN;
    const fresh = !isNaN(upd) && dayKey(upd) === dayKey(Date.now());
    setUpdated(data.updated_at ? "Обновлено " + fmtDate(data.updated_at) : "", fresh);
    navAnalysis.hidden = !hasAnalysis();

    const fromHash = location.hash.slice(1);
    current = tabList().some((t) => t.id === fromHash) ? fromHash : firstForecastSport();
    document.documentElement.style.setProperty("--sport", colorOf(current));
    renderBoard();
    renderTabs();
    renderPanel(false);
    renderModelJournal();
    syncNav();
    if (fromHash && fromHash === current) $("#board").scrollIntoView({ block: "start" });
    document.body.classList.add("loaded");
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

  /* Относительное время («через 2 ч», «идёт») обновляем раз в минуту */
  setInterval(() => {
    if (!data || document.hidden) return;
    const now = new Date().getTime();
    panel.querySelectorAll(".bookmaker-market[data-expires-at]").forEach((market) => {
      if (Date.parse(market.dataset.expiresAt) > now) return;
      const block = market.closest(".bookmaker-lines");
      const source = market.closest(".bookmaker-source");
      market.remove();
      if (source && !source.querySelector(".bookmaker-market")) source.remove();
      if (!block.querySelector(".bookmaker-market")) block.outerHTML = bookmakerHTML({ status: "stale", lines: [] });
    });
    panel.querySelectorAll(".pick").forEach((card) => {
      const m = card.id.match(/^pick-(.+)-(\d+)$/);
      const s = m && data.sports.find((x) => x.id === m[1]);
      const p = s && displayCards(s)[Number(m[2])];
      const el = card.querySelector(".when");
      if (p && el) el.outerHTML = whenHTML(p, s.id);
    });
    const f = board.querySelector(".bd-fresh");
    if (f) f.outerHTML = freshnessHTML();
  }, 60e3);

  /* ---------- Первый экран: одно согласованное появление ---------- */
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("ready")));
  load();
})();
