/* Флаги сборных рядом с названиями команд.
   Всё рисуется здесь же в SVG — без внешних картинок и чужих эмблем. */
(function (root) {
  "use strict";

  const R = "#d52b1e", W = "#ffffff", B = "#0b3b8f", K = "#151515", Y = "#ffcd00", G = "#1e8a4c", LB = "#5eb6e4";

  // Простые флаги: h — горизонтальные полосы, v — вертикальные; f — своя отрисовка (viewBox 30×20)
  const nordic = (bg, cross, inner) =>
    `<rect width="30" height="20" fill="${bg}"/><rect x="8" width="${inner ? 5 : 4}" height="20" fill="${cross}"/><rect y="${inner ? 7.5 : 8}" width="30" height="${inner ? 5 : 4}" fill="${cross}"/>` +
    (inner ? `<rect x="9.25" width="2.5" height="20" fill="${inner}"/><rect y="8.75" width="30" height="2.5" fill="${inner}"/>` : "");
  const FLAGS = {
    "Германия": ["h", K, "#dd0000", Y], "Нидерланды": ["h", "#ae1c28", W, "#21468b"], "Франция": ["v", "#0055a4", W, "#ef4135"],
    "Италия": ["v", "#009246", W, "#ce2b37"], "Бельгия": ["v", K, "#fdda24", "#ef3340"], "Испания": ["h", "#c60b1e", "#ffc400", "#ffc400", "#c60b1e"],
    "Россия": ["h", W, "#0039a6", "#d52b1e"], "Сербия": ["h", "#c6363c", "#0c4076", W], 
    "Словения": ["h", W, "#005ce5", "#ed1c24"], "Австрия": ["h", "#ed2939", W, "#ed2939"], "Венгрия": ["h", "#ce2939", W, "#477050"],
    "Болгария": ["h", W, "#00966e", "#d62612"], "Румыния": ["v", "#002b7f", "#fcd116", "#ce1126"], "Ирландия": ["v", "#169b62", W, "#ff883e"],
    "Польша": ["h", W, "#dc143c"], "Украина": ["h", "#0057b7", "#ffd700"], "Сан-Марино": ["h", W, LB], "Монако": ["h", "#ce1126", W],
    "Эстония": ["h", "#0072ce", K, W], "Литва": ["h", "#fdb913", "#006a44", "#c1272d"], "Латвия": ["h", "#9e3039", "#9e3039", W, "#9e3039", "#9e3039"],
    "Люксембург": ["h", "#ed2939", W, "#00a1de"], "Армения": ["h", "#d90012", "#0033a0", "#f2a800"], "Азербайджан": ["h", "#0092bc", "#e4002b", "#00af66"],
    "Лихтенштейн": ["h", "#002b7f", "#ce1126"], "Андорра": ["v", "#10069f", "#fedd00", "#d50032"], "Молдова": ["v", "#0046ae", "#ffd200", "#cc092f"],
    "Мальта": ["v", W, "#cf142b"], "Германия U21": ["h", K, "#dd0000", Y], "Аргентина": ["h", "#74acdf", W, "#74acdf"], "Мексика": ["v", "#006847", W, "#ce1126"],
    "Нигерия": ["v", "#008751", W, "#008751"], "Колумбия": ["h", "#fcd116", "#fcd116", "#003893", "#ce1126"], "Эквадор": ["h", "#ffdd00", "#ffdd00", "#034ea2", "#ed1c24"],
    "Финляндия": ["f", nordic(W, "#002f6c")], "Швеция": ["f", nordic("#006aa7", "#fecc00")], "Дания": ["f", nordic("#c8102e", W)],
    "Норвегия": ["f", nordic("#ba0c2f", W, "#00205b")], "Исландия": ["f", nordic("#02529c", W, "#dc1e35")], "Фарерские острова": ["f", nordic(W, "#0065bd", "#ef303e")],
    "Англия": ["f", `<rect width="30" height="20" fill="${W}"/><rect x="13" width="4" height="20" fill="#ce1124"/><rect y="8" width="30" height="4" fill="#ce1124"/>`],
    "Шотландия": ["f", `<rect width="30" height="20" fill="#005eb8"/><path d="M0 0L30 20M30 0L0 20" stroke="${W}" stroke-width="3.4"/>`],
    "Уэльс": ["f", `<rect width="30" height="10" fill="${W}"/><rect y="10" width="30" height="10" fill="#00b140"/><path d="M9 13l3-5 3 2 3-3 2 4 2-1-1 4H10z" fill="#d30731"/>`],
    "Швейцария": ["f", `<rect width="30" height="20" fill="#da291c"/><rect x="13" y="4" width="4" height="12" fill="${W}"/><rect x="9" y="8" width="12" height="4" fill="${W}"/>`],
    "Турция": ["f", `<rect width="30" height="20" fill="#e30a17"/><circle cx="11.5" cy="10" r="5" fill="${W}"/><circle cx="12.8" cy="10" r="4" fill="#e30a17"/><path d="M17.2 10l3.6-1.2-2.2 3.1V8.1l2.2 3.1z" fill="${W}"/>`],
    "Греция": ["f", `<rect width="30" height="20" fill="#0d5eaf"/>${[1, 3, 5, 7].map((k) => `<rect y="${k * 20 / 9}" width="30" height="${20 / 9}" fill="${W}"/>`).join("")}<rect width="11.1" height="11.1" fill="#0d5eaf"/><rect x="4.44" width="2.22" height="11.1" fill="${W}"/><rect y="4.44" width="11.1" height="2.22" fill="${W}"/>`],
    "Чехия": ["f", `<rect width="30" height="10" fill="${W}"/><rect y="10" width="30" height="10" fill="#d7141a"/><path d="M0 0L15 10L0 20z" fill="#11457e"/>`],
    "Хорватия": ["f", `<rect width="30" height="6.67" fill="#ff0000"/><rect y="6.67" width="30" height="6.67" fill="${W}"/><rect y="13.33" width="30" height="6.67" fill="#171796"/><path d="M12 5h6v6.5a3 3 0 0 1-6 0z" fill="${W}" stroke="#ff0000" stroke-width=".5"/><path d="M12 5h2v2h-2zM16 5h2v2h-2zM14 7h2v2h-2zM12 9h2v2h-2zM16 9h2v2h-2zM14 11h2v2h-2z" fill="#ff0000"/>`],
    "Казахстан": ["f", `<rect width="30" height="20" fill="#00afca"/><circle cx="15" cy="9" r="3.4" fill="#fec50c"/><path d="M10 14q5 3 10 0" stroke="#fec50c" stroke-width="1.2" fill="none"/>`],
    "Беларусь": ["f", `<rect width="30" height="13.3" fill="#c8313e"/><rect y="13.3" width="30" height="6.7" fill="#4aa657"/><rect width="4" height="20" fill="${W}"/><path d="M2 1l1.3 2L2 5 .7 3zM2 7l1.3 2L2 11 .7 9zM2 13l1.3 2L2 17 .7 15z" fill="#c8313e"/>`],
    "Албания": ["f", `<rect width="30" height="20" fill="#e41e20"/><path d="M15 4l2 3 4-2-1.5 4 2.5 1-3 1.5 1 3.5-3-1.5L15 17l-2-3.5-3 1.5 1-3.5L8 10l2.5-1L9 5l4 2z" fill="${K}"/>`],
    "Португалия": ["f", `<rect width="30" height="20" fill="#ff0000"/><rect width="12" height="20" fill="#006600"/><circle cx="12" cy="10" r="3.6" fill="#ffcc00"/><circle cx="12" cy="10" r="2.2" fill="#ff0000"/>`],
    "Израиль": ["f", `<rect width="30" height="20" fill="${W}"/><rect y="2.5" width="30" height="2.5" fill="#0038b8"/><rect y="15" width="30" height="2.5" fill="#0038b8"/><path d="M15 6.5l3 5.2h-6zM15 13.5l-3-5.2h6z" fill="none" stroke="#0038b8" stroke-width=".9"/>`],
    "Грузия": ["f", `<rect width="30" height="20" fill="${W}"/><rect x="13" width="4" height="20" fill="#e8112d"/><rect y="8" width="30" height="4" fill="#e8112d"/>`],
    "Япония": ["f", `<rect width="30" height="20" fill="${W}"/><circle cx="15" cy="10" r="6" fill="#bc002d"/>`],
    "Бразилия": ["f", `<rect width="30" height="20" fill="#009c3b"/><path d="M15 2.5L27 10 15 17.5 3 10z" fill="#ffdf00"/><circle cx="15" cy="10" r="4.2" fill="#002776"/>`],
    "США": ["f", `<rect width="30" height="20" fill="${W}"/>${[0, 2, 4, 6, 8, 10, 12].map((k) => `<rect y="${k * 20 / 13}" width="30" height="${20 / 13}" fill="#b22234"/>`).join("")}<rect width="13" height="10.8" fill="#3c3b6e"/>`],
  };
  FLAGS["Словакия"] = ["f", `<rect width="30" height="6.67" fill="${W}"/><rect y="6.67" width="30" height="6.67" fill="#0b4ea2"/><rect y="13.33" width="30" height="6.67" fill="#ee1c25"/><path d="M7 4.5h7v6.5c0 3-1.8 4.5-3.5 5.3C8.8 15.5 7 14 7 11z" fill="#ee1c25" stroke="${W}" stroke-width=".7"/><path d="M10.5 6.5v6M9 8.3h3M8.6 10.2h3.8" stroke="${W}" stroke-width=".8"/>`];
  FLAGS["Чешская Республика"] = FLAGS["Чехия"];
  FLAGS["Белоруссия"] = FLAGS["Беларусь"];

  function flagSVG(name) {
    const f = FLAGS[name];
    if (!f) return "";
    let body;
    if (f[0] === "f") body = f[1];
    else {
      const cols = f.slice(1), n = cols.length;
      body = cols.map((c, i) => f[0] === "h"
        ? `<rect y="${(20 / n) * i}" width="30" height="${20 / n + .05}" fill="${c}"/>`
        : `<rect x="${(30 / n) * i}" width="${30 / n + .05}" height="20" fill="${c}"/>`).join("");
    }
    return `<svg class="crest flag" viewBox="0 0 30 20" aria-hidden="true"><defs><clipPath id="fc"><rect width="30" height="20" rx="3"/></clipPath></defs><g clip-path="url(#fc)">${body}</g><rect width="30" height="20" rx="3" fill="none" stroke="rgba(255,255,255,.18)"/></svg>`;
  }

  function crest(name) { return flagSVG(String(name).trim()); }

  /* «Команда А — Команда Б» → HTML с двумя значками */
  function matchHTML(match, sport, esc) {
    const parts = String(match || "").split(/\s+[—–-]\s+|\s+vs\.?\s+/i);
    if (parts.length !== 2) return esc(match);
    const flags = parts.map(crest);
    if (!flags[0] && !flags[1]) return esc(match); // не сборные — без значков
    return parts.map((p, i) => `<span class="side">${flags[i]}<span>${esc(p.trim())}</span></span>`).join('<span class="vs"> — </span>');
  }

  root.Crest = { crest, matchHTML, hasFlag: (n) => !!FLAGS[n] };
})(typeof window !== "undefined" ? window : globalThis);
