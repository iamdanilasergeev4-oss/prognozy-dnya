/* PROEBALI KAZHETSYA — сцены видов спорта, зоны страницы, мобильная навигация.
   Только оформление: читает выбранную вкладку из DOM, данные и логику app.js не меняет. */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const SCENES = ["football", "volleyball", "basketball", "hockey", "tennis", "cs2", "dota2", "express", "analysis"];
  const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Слой сцены: два слоя для плавной смены ---------- */
  const scene = document.createElement("div");
  scene.className = "scene";
  scene.setAttribute("aria-hidden", "true");
  scene.innerHTML = '<div class="scene-l"></div><div class="scene-l"></div><div class="scene-shade"></div>';
  document.body.prepend(scene);
  const layers = [...scene.querySelectorAll(".scene-l")];
  let front = 0, shown = null, zone = "hero", sport = null;

  function paint() {
    const want = zone === "board" && sport && SCENES.includes(sport) ? sport : null;
    if (want === shown) return;
    shown = want;
    const cur = layers[front];
    if (!want) { layers.forEach((l) => l.classList.remove("on")); return; }
    const next = layers[1 - front];
    next.className = "scene-l s-" + want;
    // кадр на применение фона, затем crossfade
    requestAnimationFrame(() => {
      next.classList.add("on");
      cur.classList.remove("on");
      front = 1 - front;
    });
  }

  function setSport(id) {
    if (!id || id === sport) return;
    sport = id;
    document.body.dataset.sport = id;
    paint();
  }

  /* ---------- Текущая вкладка (меняет app.js) ---------- */
  const tabs = $("#tabs");
  const readTab = () => { const t = tabs && tabs.querySelector('.tab[aria-selected="true"]'); if (t) setSport(t.dataset.id); };
  if (tabs) new MutationObserver(readTab).observe(tabs, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-selected"] });

  /* прогрев картинки при наведении на вкладку — переход без пустого кадра */
  const warmed = new Set();
  function warm(id) {
    if (!SCENES.includes(id) || warmed.has(id) || id === "analysis") return;
    warmed.add(id);
    const probe = document.createElement("div");
    probe.className = "scene-l s-" + id;
    probe.style.cssText = "visibility:hidden;width:1px;height:1px";
    scene.appendChild(probe);
    const url = (getComputedStyle(probe).backgroundImage.match(/url\("?([^")]+)"?\)/) || [])[1];
    probe.remove();
    if (url) { const im = new Image(); im.decoding = "async"; im.src = url; }
  }
  if (tabs) {
    tabs.addEventListener("pointerover", (e) => { const t = e.target.closest(".tab"); if (t) warm(t.dataset.id); });
    tabs.addEventListener("focusin", (e) => { const t = e.target.closest(".tab"); if (t) warm(t.dataset.id); });
  }

  /* ---------- Зона страницы: фон вида спорта только у табло ---------- */
  const zones = [["hero", $(".hero")], ["board", $("#board")], ["history", $("#history")], ["suggest", $("#suggest")]].filter((z) => z[1]);
  function readZone() {
    const mid = window.innerHeight * 0.45;
    let z = "hero";
    for (const [name, el] of zones) { const r = el.getBoundingClientRect(); if (r.top <= mid && r.bottom > mid) { z = name; break; } }
    if (z !== zone) { zone = z; document.body.dataset.zone = z; paint(); syncHome(); }
  }
  let ticking = false;
  window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; readZone(); }); } }, { passive: true });
  window.addEventListener("resize", readZone, { passive: true });

  /* ---------- Навигация ---------- */
  const navHome = $('.nav [data-nav="home"]');
  const navExpress = $('.nav [data-nav="express"]');
  function syncHome() {
    if (!navHome) return;
    if (zone === "hero") {
      document.querySelectorAll(".nav a").forEach((a) => a.removeAttribute("aria-current"));
      navHome.setAttribute("aria-current", "true");
    } else if (navHome.getAttribute("aria-current")) {
      navHome.removeAttribute("aria-current");
      const key = zone === "history" ? "history" : zone === "suggest" ? "suggest" : (sport === "express" || sport === "analysis") ? sport : "board";
      const a = $(`.nav [data-nav="${key}"]`);
      if (a && !a.hidden) a.setAttribute("aria-current", "true");
    }
  }
  if (navHome) navHome.addEventListener("click", (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: calm() ? "auto" : "smooth" });
  });
  if (navExpress) navExpress.addEventListener("click", (e) => {
    e.preventDefault();
    const t = $("#tab-express");
    if (!t) return;
    t.click();
    $("#board").scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "start" });
  });
  /* ссылка «Экспрессы» видна только когда экспрессы есть в данных */
  function syncExpressLink() {
    const has = !!$("#tab-express");
    if (navExpress) navExpress.hidden = !has;
    const m = $('.mnav [data-nav="express"]');
    if (m) m.hidden = !has;
  }
  if (tabs) new MutationObserver(syncExpressLink).observe(tabs, { childList: true });

  /* постер: «чипы» видов спорта ведут на вкладки */
  document.querySelectorAll(".hero-chips a").forEach((a) => a.addEventListener("click", (e) => {
    const t = document.getElementById("tab-" + a.dataset.sport);
    if (!t) return; // вкладки ещё нет — сработает обычный переход по #id
    e.preventDefault();
    t.click();
    $("#board").scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "start" });
  }));

  /* ---------- Нижняя панель для телефонов ---------- */
  const ICON = {
    home: '<path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z"/>',
    board: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    express: '<path d="M5 7h14M5 12h14M5 17h14"/><circle cx="8" cy="7" r="1.6"/><circle cx="14" cy="12" r="1.6"/><circle cx="10" cy="17" r="1.6"/>',
    analysis: '<path d="M4 5.5h16M4 10h16M4 14.5h10M4 19h7"/><path d="M17 15.5l1.4 1.4 2.6-3"/>',
    history: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/>',
  };
  const mnav = document.createElement("nav");
  mnav.className = "mnav";
  mnav.setAttribute("aria-label", "Разделы");
  const LABEL = { home: "Главная", board: "Прогнозы", express: "Экспрессы", analysis: "Разбор", history: "История" };
  mnav.innerHTML = Object.keys(LABEL).map((k) => {
    const src = $(`.nav [data-nav="${k}"]`);
    return `<a href="${src ? src.getAttribute("href") : "#"}" data-nav="${k}"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg><span>${LABEL[k]}</span></a>`;
  }).join("");
  document.body.appendChild(mnav);
  // клики дублируют поведение верхних ссылок (там висят обработчики app.js)
  mnav.addEventListener("click", (e) => {
    const a = e.target.closest("a"); if (!a) return;
    const src = $(`.nav [data-nav="${a.dataset.nav}"]`);
    if (src) { e.preventDefault(); src.click(); }
  });
  function mirror() {
    mnav.querySelectorAll("a").forEach((a) => {
      const src = $(`.nav [data-nav="${a.dataset.nav}"]`);
      if (!src) return;
      a.hidden = src.hidden;
      if (src.getAttribute("aria-current") === "true") a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
  }
  new MutationObserver(() => {
    // app.js отмечает «Прогнозы», пока мы ещё на постере, — возвращаем «Главную»
    if (zone === "hero" && navHome && !navHome.getAttribute("aria-current")) syncHome();
    mirror();
  }).observe($(".nav"), { subtree: true, attributes: true, attributeFilter: ["aria-current", "hidden"] });

  /* ---------- Старт ---------- */
  readTab();
  syncExpressLink();
  readZone();
  document.body.dataset.zone = zone;
  syncHome();
  mirror();
})();
