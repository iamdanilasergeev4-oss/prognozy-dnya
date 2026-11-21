import "../js/history-core.js";

const H = globalThis.HistoryCore;
const esports = new Set(["cs2", "dota2"]);
const UNIT = {
  football: { name: "голы", total: "гола", scope: "regulation" },
  basketball: { name: "очки", total: "очка", scope: "final" },
  hockey: { name: "шайбы", total: "шайбы", scope: "final" },
  tennis: { name: "сеты", total: "сета", scope: "final" },
  volleyball: { name: "сеты", total: "сета", scope: "final" },
  cs2: { name: "карты", total: "карты", scope: "final" },
  dota2: { name: "карты", total: "карты", scope: "final" },
};
const SIDES = ["home", "away"];
const number = (value) => String(value).replace(".", ",");
const signed = (value) => (value > 0 ? "+" : "") + number(value);

export function completedSeries(score, bestOf) {
  const parsed = H.parseScore(score);
  if (!parsed || ![3, 5, 7].includes(bestOf)) return false;
  const needed = (bestOf + 1) / 2;
  return Math.max(parsed.a, parsed.b) === needed && Math.min(parsed.a, parsed.b) < needed;
}

function candidates(row, sources) {
  const { name: unit, total: noun, scope } = UNIT[row.sport];
  const result = [];
  const addTotal = (line, source, bestOf) => {
    for (const direction of ["under", "over"]) {
      const caption = `${direction === "under" ? "ТМ" : "ТБ"} ${number(line)} ${noun}`;
      result.push({ market: { kind: "total", line, direction, unit, scope, ...(bestOf ? { bestOf } : {}) }, caption, source });
    }
  };
  const posted = sources.find((source) => source.markets);
  if (posted?.markets.total != null) addTotal(posted.markets.total, posted.markets);
  if (posted?.markets.handicap) {
    const same = posted.alignment === 1;
    const reversed = posted.alignment === -1;
    if (same || reversed) {
      const lines = same ? posted.markets.handicap : [...posted.markets.handicap].reverse();
      lines.forEach((line, i) => {
        if (line !== 0 || row.sport === "football") result.push({
          market: { kind: "handicap", line, side: SIDES[i], unit, scope },
          caption: `Ф${i + 1} (${signed(line)})`, source: posted.markets,
        });
      });
    }
  }
  if (row.sport === "football") {
    for (const direction of ["yes", "no"]) result.push({
      market: { kind: "both-score", direction, unit, scope }, caption: `Обе забьют — ${direction === "yes" ? "да" : "нет"}`,
    });
    SIDES.forEach((side, i) => result.push({
      market: { kind: "double-chance", side, unit, scope }, caption: i === 0 ? "1X (хозяева не проиграют)" : "X2 (гости не проиграют)",
    }));
  }
  const formats = sources.map((source) => source.format).filter(Boolean);
  const known = formats[0]?.match(/^BO([35])$/)?.[1];
  const trusted = formats.length >= 2 || sources.some((source) => source.format &&
    (row.sport === "tennis" && source.source === "ESPN" || row.sport === "volleyball" && source.source === "Lega Pallavolo"));
  if ((row.sport === "tennis" || row.sport === "volleyball" || esports.has(row.sport)) && known && trusted) {
    const bestOf = Number(known);
    addTotal((bestOf + 2) / 2, null, bestOf);
  }
  return result;
}

export function assessMarkets(row, sources, forms) {
  if (!UNIT[row.sport] || forms.length !== 2) return null;
  const assessed = candidates(row, sources).flatMap((entry) => {
    const { market } = entry;
    const aligned = forms.map(({ results }, i) => results.filter((r) => r.scores && (!market.bestOf ||
      (row.sport === "tennis" || r.format === `BO${market.bestOf}`) && completedSeries(r.scores.join(":"), market.bestOf)))
      .map((r) => ({ id: r.id, status: H.evaluateMarket(market, (i === 0 ? r.scores : [...r.scores].reverse()).join(":")),
        total: r.scores[0] + r.scores[1], sources: r.sources })));
    if (!aligned.every((sample) => sample.length >= 3)) return [];
    // Use only one observation for a head-to-head fixture in the pooled sample.
    const observations = [...new Map(aligned.flat().map((result) => [result.id, result])).values()];
    const hits = observations.filter((result) => result.status === "won").length;
    if (observations.length < 5 || hits < 5 || hits / observations.length < 0.8 ||
        aligned.some((sample) => sample.filter((result) => result.status === "won").length < 2)) return [];
    // A double chance at extreme prices is not treated as an equivalent to a quoted spread.
    const priority = market.kind === "handicap" ? 0 : market.kind === "total" ? 1 : market.kind === "both-score" ? 2 : 3;
    return [{ ...entry, aligned, hits, observations, priority }];
  }).sort((a, b) => b.hits / b.observations.length - a.hits / a.observations.length || a.priority - b.priority);
  const top = assessed[0];
  if (!top) return null;
  const { market } = top;
  const scope = row.sport === "football" ? "основное время, включая компенсированное" :
    row.sport === "hockey" ? "итог с учётом овертайма и буллитов" :
    row.sport === "basketball" ? "итог с учётом овертайма" : "полный матч";
  const countText = (results) => results.filter((r) => r.status === "won").length;
  const facts = top.aligned.map((sample, i) => {
    const values = market.kind === "total" ? ` Суммарные результаты: ${sample.map((r) => r.total).join(", ")}.` : "";
    return `${forms[i].name}: условие выполнено в ${countText(sample)} из ${sample.length} сверенных матчей.${values}`;
  });
  const lineNote = top.source ? `Предматчевый порог опубликован источником «${top.source.source}».` :
    market.bestOf ? `Порог соответствует формату BO${market.bestOf}. Коэффициент для него не проверен.` : "";
  if (lineNote) facts.push(lineNote);
  const caveat = top.aligned.flat().some((r) => r.status !== "won") ?
    "В части сверенных матчей условие не выполнялось. Уровень соперников в выборке различается." :
    "Короткая выборка. Уровень соперников в ней различается.";
  return {
    market: { ...market, ...(top.source ? { line_source: { title: top.source.source, url: top.source.url } } : {}) },
    bet: `${top.caption}${["hockey", "basketball"].includes(row.sport) ? " (с ОТ)" : ""}`,
    facts,
    reason: `${top.caption}: условие выполнялось в ${top.hits} из ${top.observations.length} разных сверенных матчей. Расчёт: ${scope}.`,
    against: caveat,
    sources: [...top.observations.flatMap((record) => record.sources),
      ...(top.source ? [{ title: top.source.source, url: top.source.url }] : [])],
  };
}
