(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const CONF_LABEL = ["", "низкая", "ниже средней", "средняя", "высокая", "очень высокая"];
  let data = null;
  let current = null;

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
    }) + " МСК";
  }

  function host(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "источник"; }
  }

  const hasAnalysis = () => Array.isArray(data.analysis) && data.analysis.length > 0;

  function renderTabs() {
    const tabs = $("#tabs");
    let html = data.sports.map((s) => `
      <button class="tab" role="tab" data-id="${esc(s.id)}" aria-selected="${s.id === current}">
        <span>${esc(s.emoji)}</span>${esc(s.name)}<span class="count">${(s.picks || []).length}</span>
      </button>`).join("");
    if (hasAnalysis()) {
      html += `
      <button class="tab tab-ai" role="tab" data-id="analysis" aria-selected="${current === "analysis"}">
        <span>🧠</span>Разбор дня<span class="count">${data.analysis.length}</span>
      </button>`;
    }
    tabs.innerHTML = html;
    tabs.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
      current = b.dataset.id;
      history.replaceState(null, "", "#" + current);
      renderTabs();
      renderPicks();
    }));
  }

  function srcLinks(list) {
    return (list || []).map((s) =>
      `<a href="${esc(s.url)}" target="_blank" rel="nofollow noopener" title="${esc(s.title)}">${esc(host(s.url))}</a>`).join("");
  }

  function renderAnalysis() {
    const box = $("#picks");
    box.innerHTML = `<p class="ai-note">Подробный разбор главных матчей дня: форма, составы, личные встречи и что думают аналитики. Это мнение, а не гарантия.</p>` +
      data.analysis.map((a) => {
        const meta = [a.sport, a.tournament, a.start].filter(Boolean).map(esc).join(" · ");
        const paras = String(a.text || "").split(/\n+/).filter(Boolean).map((t) => `<p>${esc(t)}</p>`).join("");
        const factors = (a.key_factors || []).map((f) => `<li>${esc(f)}</li>`).join("");
        const srcs = srcLinks(a.sources);
        return `
        <article class="card analysis">
          <div class="match">${esc(a.match)}</div>
          <div class="meta">${meta || "&nbsp;"}</div>
          <div class="analysis-body">${paras}</div>
          ${factors ? `<ul class="factors">${factors}</ul>` : ""}
          ${a.verdict ? `<div class="verdict"><span>Вывод</span>${esc(a.verdict)}</div>` : ""}
          ${srcs ? `<div class="foot-row"><span class="srcs">Источники: ${srcs}</span></div>` : ""}
        </article>`;
      }).join("");
  }

  function renderPicks() {
    if (current === "analysis") return renderAnalysis();
    const box = $("#picks");
    const sport = data.sports.find((s) => s.id === current);
    if (!sport) { box.innerHTML = ""; return; }
    const picks = sport.picks || [];
    let html = "";
    if (sport.stale && sport.updated_at) {
      html += `<p class="stale">Сегодня обновить не удалось — показаны прогнозы от ${esc(fmtDate(sport.updated_at))}.</p>`;
    }
    if (!picks.length) {
      box.innerHTML = html + `<div class="empty">На сегодня по этому виду спорта подходящих прогнозов не нашлось. Загляните завтра.</div>`;
      return;
    }
    html += picks.map((p, i) => {
      const meta = [p.tournament, p.start].filter(Boolean).map(esc).join(" · ");
      const conf = Math.max(1, Math.min(5, Number(p.confidence) || 3));
      const bars = Array.from({ length: 5 }, (_, k) => `<i class="${k < conf ? "on" : ""}"></i>`).join("");
      const srcs = (p.sources || []).map((s) =>
        `<a href="${esc(s.url)}" target="_blank" rel="nofollow noopener" title="${esc(s.title)}">${esc(host(s.url))}</a>`).join("");
      return `
        <article class="card">
          <div class="rank">${i + 1}</div>
          <div class="match">${esc(p.match)}</div>
          <div class="betbox">
            <span class="bet">${esc(p.bet)}</span>
            ${p.odds ? `<span class="odds">кф <b>${esc(p.odds)}</b></span>` : ""}
          </div>
          <div class="meta">${meta || "&nbsp;"}</div>
          ${p.reason ? `<p class="reason">${esc(p.reason)}</p>` : ""}
          <div class="foot-row">
            <span class="conf" title="Насколько источники сходятся">${bars}&nbsp;${CONF_LABEL[conf]}</span>
            ${srcs ? `<span class="srcs">Источники: ${srcs}</span>` : ""}
          </div>
        </article>`;
    }).join("");
    box.innerHTML = html;
  }

  async function load() {
    try {
      const r = await fetch("data/predictions.json?v=" + Date.now(), { cache: "no-store" });
      data = await r.json();
    } catch {
      $("#updated").textContent = "";
      $("#picks").innerHTML = `<div class="empty">Не удалось загрузить прогнозы. Обновите страницу.</div>`;
      return;
    }
    if (!data.sports || !data.sports.length) {
      $("#updated").textContent = "";
      $("#picks").innerHTML = `<div class="empty">Прогнозы появятся после первого обновления.</div>`;
      return;
    }
    $("#updated").textContent = data.updated_at ? "Обновлено " + fmtDate(data.updated_at) : "";
    const fromHash = location.hash.slice(1);
    const valid = data.sports.some((s) => s.id === fromHash) || (fromHash === "analysis" && hasAnalysis());
    current = valid ? fromHash : data.sports[0].id;
    renderTabs();
    renderPicks();
  }

  // Форма предложений → /api/suggest → Telegram
  $("#suggest-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = $("#status");
    const btn = $("#send");
    const message = $("#message").value.trim();
    if (message.length < 3) {
      status.className = "status err";
      status.textContent = "Напишите хотя бы пару слов.";
      return;
    }
    btn.disabled = true;
    status.className = "status";
    status.textContent = "Отправляем…";
    try {
      const r = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          contact: $("#contact").value.trim(),
          website: e.target.website.value,
        }),
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok || !res.ok) throw new Error(res.error || "Ошибка отправки");
      status.className = "status ok";
      status.textContent = "Спасибо! Предложение отправлено.";
      e.target.reset();
    } catch (err) {
      status.className = "status err";
      status.textContent = err.message || "Не удалось отправить. Попробуйте позже.";
    } finally {
      btn.disabled = false;
    }
  });

  load();
})();
