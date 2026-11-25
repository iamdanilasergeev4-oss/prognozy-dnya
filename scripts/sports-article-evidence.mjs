import { normalizeIdentity } from "./sports-discovery.mjs";
import { reconcileClaims } from "./sports-reconciliation.mjs";

const day = 86_400_000;
const pair = (match) => match.split(/\s+[—–]\s+/).map(normalizeIdentity).sort().join("|");
const outcome = ([scored, allowed]) => scored > allowed ? "win" : scored === allowed ? "draw" : "loss";
const numbers = new Intl.NumberFormat("ru", { maximumFractionDigits: 1 });
const decimal = (n) => numbers.format(n);
const date = new Intl.DateTimeFormat("ru", { timeZone: "Europe/Moscow", day: "numeric", month: "short" });
const units = { football: "голов", basketball: "очков", tennis: "сетов", volleyball: "сетов", hockey: "шайб", cs2: "карт", dota2: "карт" };
const scoringUnit = { football: "голы", basketball: "очки", tennis: "сеты", volleyball: "сеты", hockey: "шайбы", cs2: "карты", dota2: "карты" };
const series = new Set(["cs2", "dota2"]);
const scorePatterns = {
  football: ["матчи с 3+ голами", ([own, allowed]) => own + allowed >= 3, "матчи с 2+ своими голами", ([own]) => own >= 2],
  hockey: ["матчи с 6+ шайбами", ([own, allowed]) => own + allowed >= 6, "матчи с 3+ своими шайбами", ([own]) => own >= 3],
  basketball: ["матчи с разницей до 5 очков включительно", ([own, allowed]) => Math.abs(own - allowed) <= 5],
};
const limits = {
  football: "Стартовые составы и травмы", basketball: "Составы, минуты лидеров и темп",
  hockey: "Стартовые вратари и игра в большинстве", tennis: "Текущее состояние игроков",
  volleyball: "Составы, эффективность подачи и приёма", cs2: "Составы, пул карт и вето", dota2: "Составы, патч и драфты",
};

function normalizedSides({ match, sport_id: sport, tournament }) {
  const [home, away] = match.split(/\s+[—–]\s+/);
  if (sport !== "volleyball" || !home || !away) return [home, away].map(normalizeIdentity);
  const [row] = reconcileClaims([{ sport, tournament, home, away }], normalizeIdentity);
  return [row.home, row.away].map(normalizeIdentity);
}

function fixtureFor(article, assessed, row) {
  const start = Date.parse(article.start_iso);
  const same = assessed.filter((event) => event.sport === article.sport_id &&
    Math.abs(event.start - start) <= 5 * 60_000 && (normalizeIdentity(event.tournament) === normalizeIdentity(article.tournament) &&
      normalizedSides({ ...event, sport_id: event.sport }).sort().join("|") ===
      normalizedSides(article).sort().join("|") ||
      row?.id != null && event.sources?.some((source) => source.title === row.source && String(source.id) === String(row.id) &&
        (row.sourceCompetitionId == null || source.sourceCompetitionId == null ||
          String(row.sourceCompetitionId) === String(source.sourceCompetitionId)))));
  const confirmed = same.filter((event) => event.status === "confirmed" && !event.verificationReason);
  return confirmed.length === 1 && !confirmed[0].dataQuality?.identityConflict ? confirmed[0] : null;
}

function teamRows(rows, side) {
  return rows.filter((row) => row.home === side || row.away === side).map((row) => ({
    id: row.id, start: row.start, sources: row.sources, scores: row.home === side ? row.score : row.score.slice().reverse(),
    opponent: row.home === side ? row.away : row.home, venue: row.homeField === true ? (row.home === side ? "home" : "away") : null,
  }));
}

const wins = (rows) => rows.filter((row) => (row.scores ? outcome(row.scores) === "win" : row.win)).length;
const verifiedScores = (rows) => rows.map(({ scores }) => scores).filter((score) => Array.isArray(score) &&
  score.length === 2 && score.every((value) => Number.isSafeInteger(value) && value >= 0));

function describeScoring(names, matches, sport) {
  const samples = matches.map(verifiedScores);
  if (samples.some((scores) => scores.length < 4)) {
    const note = series.has(sport) && matches.every((rows) => rows.length >= 4)
      ? "Результаты серий позволяют сравнить победы. Сверенных счётов по картам недостаточно для сравнения тоталов карт."
      : "";
    return { lines: note ? [note] : [], counts: samples.map((scores) => scores.length), included: false };
  }
  const [pattern, isMatch, individual, isIndividual] = scorePatterns[sport] ?? [];
  const lines = samples.map((scores, i) => {
    const mean = (f) => scores.reduce((sum, score) => sum + f(score), 0) / scores.length;
    const difference = mean(([own, allowed]) => own - allowed);
    const summary = `${names[i]} — средний общий счёт ${decimal(mean(([own, allowed]) => own + allowed))} (${units[sport]} за матч), средняя разница ${difference > 0 ? "+" : ""}${decimal(difference)}.`;
    const frequency = pattern ? ` В выборке ${pattern} — ${scores.filter(isMatch).length} из ${scores.length}.` : "";
    const teamFrequency = individual ? ` ${individual[0].toUpperCase() + individual.slice(1)} — ${scores.filter(isIndividual).length} из ${scores.length}.` : "";
    return summary + frequency + teamFrequency;
  });
  const scoreScope = sport === "hockey" ? "Итоговые счета с овертаймом и буллитами." : "Сверенные итоговые счета.";
  return { lines: [`Результативность. ${scoreScope} Частоты описывают прошлые матчи. Вероятности для этих показателей не рассчитывались.`, ...lines],
    counts: samples.map((scores) => scores.length), included: true };
}

function describeSide(name, rows, sport) {
  if (!rows.length) return `${name} — сопоставимых результатов нет.`;
  const scored = rows.filter(({ scores }) => Array.isArray(scores));
  const outcomes = scored.length === rows.length ? `, ничьих ${scored.filter(({ scores }) => outcome(scores) === "draw").length}` : "";
  const dates = rows.map((row) => row.start);
  const interval = `${date.format(Math.min(...dates))} — ${date.format(Math.max(...dates))}`;
  const [own, allowed] = ["football", "hockey", "basketball"].includes(sport) ? ["свои", "соперника"] : ["выиграно", "проиграно"];
  const scores = scored.length >= 3 ? ` В среднем за матч, ${units[sport]} — ${own} ${decimal(scored.reduce((a, row) => a + row.scores[0], 0) / scored.length)}, ${allowed} ${decimal(scored.reduce((a, row) => a + row.scores[1], 0) / scored.length)}. В выборке ${scored.length} счётов.` : "";
  return `${name} — побед ${wins(rows)} из ${rows.length}${outcomes} (${interval}).${scores}`;
}

const scenarioPatterns = {
  football: ["Вероятен матч с небольшим числом голов", "было забито не больше двух голов", (a, b) => a + b <= 2],
  basketball: ["Развязка может быть близкой", "разница в счёте не превышала пяти очков", (a, b) => Math.abs(a - b) <= 5],
  hockey: ["Вероятен плотный счёт", "разница в итоговом счёте не превышала одной шайбы", (a, b) => Math.abs(a - b) <= 1],
  tennis: ["Матч может затянуться до третьего сета", "матч доходил до третьего сета", (a, b) => a + b === 3],
  volleyball: ["Вероятен обмен партиями", "обе команды брали хотя бы одну партию", (a, b) => Math.min(a, b) > 0],
  cs2: ["Серия может дойти до решающей карты", "серия доходила до третьей карты", (a, b) => a + b === 3],
  dota2: ["Серия может дойти до решающей карты", "серия доходила до третьей карты", (a, b) => a + b === 3],
};

function describeScenario(article, names, samples, recentEnough) {
  const sport = article.sport_id;
  if (!recentEnough || samples.some((scores) => scores.length < 3) ||
      (series.has(sport) && !article.format)) return null;

  const sizes = samples.map((scores) => scores.length);
  const limitation = `Выборка короткая и может включать соперников разной силы. Перед матчем не сверены ${limits[sport].toLowerCase()}.`;
  if (sport === "tennis") {
    const balance = samples.map((scores) => scores.reduce((sum, [own, other]) => sum + own - other, 0));
    const leader = balance.findIndex((n) => n > 0);
    if (leader >= 0 && balance[1 - leader] < 0 && samples[leader].filter(([a,b]) => a > b).length > sizes[leader] / 2 &&
        samples[1 - leader].filter(([a,b]) => a > b).length < sizes[1 - leader] / 2) {
      return { label: `«${names[leader]}» может навязать сопернице борьбу за каждый сет`,
        reason: `У «${names[leader]}» баланс партий +${balance[leader]} за ${sizes[leader]} матчей, у «${names[1-leader]}» — ${balance[1-leader]} за ${sizes[1-leader]}. Если эта форма сохранится, сопернице будет особенно важно удержать преимущество после выигранного сета.`,
        limitation: "Это короткая выборка. По итоговым счетам нельзя судить о качестве подачи, приёма и физическом состоянии перед матчем." };
    }
  }
  const [label, pattern, matches] = scenarioPatterns[sport];
  const counts = samples.map((scores) => scores.filter(([own, allowed]) => matches(own, allowed)).length);
  const compatible = series.has(sport) ? /^BO3$/i.test(article.format) :
    sport !== "tennis" || /^BO3$/i.test(article.format || "");
  if (compatible && counts.every((count, i) => count / sizes[i] >= 2 / 3)) {
    return { label, reason: `У «${names[0]}» в ${counts[0]} из ${sizes[0]} матчей и у «${names[1]}» в ${counts[1]} из ${sizes[1]} ${pattern}. Если эта тенденция сохранится, она может проявиться и в очной встрече.`, limitation };
  }

  if (sport === "basketball" || sport === "hockey") {
    const averages = samples.map((scores) => [0, 1].map((side) =>
      scores.reduce((sum, score) => sum + score[side], 0) / scores.length));
    if (sport === "hockey" && averages.every(([own, allowed]) => own >= 3 && allowed >= 3)) {
      return {
        label: "Обе команды могут регулярно создавать угрозу",
        reason: `В последних сверенных матчах обе команды в среднем забрасывали и пропускали не меньше трёх шайб. При сохранении этой результативности игра может получиться открытой с обеих сторон.`,
        limitation: `${limitation} В статистике учтены итоговые счета с овертаймом и буллитами.`,
      };
    }
    if (sport === "basketball") {
      const attack = averages[0][0] > averages[1][0] ? 0 : 1;
      const rival = 1 - attack;
      if (averages[attack][0] - averages[rival][0] >= 8 && averages[attack][1] - averages[rival][1] >= 8) {
        const [own, allowed] = averages[attack];
        const [rivalOwn, rivalAllowed] = averages[rival];
        return {
          label: `Результативность «${names[attack]}» может стать ключом к игре`,
          reason: `В сверенной выборке «${names[attack]}» набирал ${decimal(own)} очка за матч против ${decimal(rivalOwn)} у «${names[rival]}», но и пропускал больше — ${decimal(allowed)} против ${decimal(rivalAllowed)}. Если разница сохранится, более результативной команде всё равно понадобится сдерживать соперника в защите.`,
          limitation,
        };
      }
    }
  }

  const margins = samples.map((scores) => scores.reduce((sum, [own, allowed]) => sum + own - allowed, 0) / scores.length);
  const shares = samples.map((scores) => scores.filter(([own, allowed]) => own > allowed).length / scores.length);
  if (sport === "volleyball" && shares.every((share) => share === 1)) {
    return {
      label: "Соперники проверят победные серии друг друга",
      reason: `«${names[0]}» выиграл все ${sizes[0]} сверенных матчей, а «${names[1]}» — все ${sizes[1]}. Обе команды подходят к встрече с положительным балансом партий, поэтому преимущество в предыдущих играх даёт мало оснований ждать такого же контроля в очном матче.`,
      limitation,
    };
  }
  const leader = shares[0] > shares[1] ? 0 : 1;
  const other = 1 - leader;
  if (shares[leader] - shares[other] < 1 / 3 || margins[leader] <= 0 || margins[other] >= 0) return null;

  const advantages = { football: "лучшим балансом забитых и пропущенных голов", basketball: "лучшей разницей набранных и пропущенных очков",
    hockey: "лучшим балансом заброшенных и пропущенных шайб", tennis: "лучшим балансом выигранных и проигранных сетов",
    volleyball: "лучшим балансом партий", cs2: "лучшим балансом карт", dota2: "лучшим балансом карт" };
  return {
    label: `«${names[leader]}» подходит к матчу в более убедительной форме`,
    reason: `В последних сверенных матчах «${names[leader]}» чаще выигрывал и отличался ${advantages[sport]}. При сохранении этой формы «${names[other]}» будет сложнее удерживать равный счёт.`,
    limitation,
  };
}

function scoreboardForm(context, names, sport) {
  const row = context?.evidence?.find((r) => r.source === "ESPN" && r.status === "scheduled" && r.records);
  if (!row) return null;
  const sides = [row.home, row.away].map(normalizeIdentity);
  const order = names.map((name) => sides.indexOf(normalizeIdentity(name)));
  if (order.some((i) => i < 0) || order[0] === order[1]) return null;
  const records = order.map((i) => row.records[i]);
  const totals = records.map((r) => r.total?.split("-").map(Number));
  const columns = { football: ["победы, ничьи, поражения", 3], hockey: ["победы, поражения, поражения в ОТ или по буллитам", 3],
    basketball: ["победы и поражения", 2], volleyball: ["победы и поражения", 2] }[sport];
  if (!columns || totals.some((v) => v?.length !== columns[1])) return null;
  const sizes = totals.map((v) => v.reduce((a, b) => a + b, 0));
  if (sizes.some((n) => !n)) return null;
  const fact = `Баланс в турнире по ESPN (${columns[0]}): «${names[0]}» ${records[0].total}, «${names[1]}» ${records[1].total}.`;
  const shares = totals.map((v, i) => v[0] / sizes[i]);
  const ahead = shares[0] > shares[1] ? 0 : 1;
  const venue = sport !== "football" && row.neutralSite === false && order[0] === 0 && records[0].home && records[1].road ?
    ` В матчах дома у «${names[0]}» ${records[0].home}, в гостях у «${names[1]}» ${records[1].road}.` : "";
  const scenario = sizes.every((n) => n >= 4) && Math.abs(shares[0] - shares[1]) >= 0.25 ? {
    label: `Турнирная форма даёт преимущество «${names[ahead]}»`,
    reason: `${fact} В этой встрече у «${names[ahead]}» есть основания рассчитывать на инициативу: команда чаще доводила матчи турнира до победы.`,
    limitation: "Соперники в предыдущих турах различались. Баланс побед не учитывает стартовый состав и ход отдельных матчей.",
  } : null;
  return { fact: fact + venue, scenario };
}

function recentTournamentMaps(article, names, research, now) {
  if (article.sport_id !== "dota2") return null;
  const tournament = (name) => normalizeIdentity(name).replace(/^blast slam (?:ix|season 9)(?: 2026)?$/, "blast slam ix");
  const receipt = research.requests?.findLast((r) => r.source === "OpenDota" && Number.isFinite(r.receivedAt));
  const maps = (research.diagnostics.dotaMapEvidence || []).filter((m) => m.end < now && m.start >= now - 14 * day &&
    m.end > m.start && m.radiantId && m.direId && tournament(m.tournament) === tournament(article.tournament));
  const samples = names.map((name) => maps.filter((m) => [m.radiant, m.dire].some((n) => normalizeIdentity(n) === normalizeIdentity(name))));
  if (new Set(maps.map((m) => m.competition)).size !== 1 || samples.some((rows, i) =>
    !rows.length || new Set(rows.map((m) => normalizeIdentity(m.radiant) === normalizeIdentity(names[i]) ? m.radiantId : m.direId)).size !== 1)) return null;
  const last = samples.map((rows) => [...new Map(rows.map((m) => [m.id, m])).values()].sort((a,b) => b.start - a.start).slice(0, 5));
  const means = last.map((rows) => rows.reduce((sum,m) => sum + (m.end - m.start) / 60000, 0) / rows.length);
  const fact = names.map((name, i) => `«${name}»: средняя длительность карты ${decimal(means[i])} мин (${last[i].length} в этом турнире)`).join(". ") + ".";
  const enoughMaps = last.every((rows) => rows.length >= 3 && new Set(rows.map((m) => m.seriesId).filter(Boolean)).size >= 2);
  let scenario = enoughMaps && means.every((n) => n >= 40) ? {
    label: "Серия может потребовать выдержки в поздней игре", reason: fact + " При похожем темпе командам придётся сохранять ресурсы для поздних сражений.",
    limitation: "Длительность карт зависит от драфта. Составы и патч предстоящей серии не подтверждены.",
  } : null;
  if (!scenario && enoughMaps && Math.abs(means[0] - means[1]) >= 10) {
    const medians = last.map((rows) => {
      const times = rows.map((m) => (m.end - m.start) / 60000).sort((a,b) => a-b);
      return (times[Math.floor((times.length-1)/2)] + times[Math.floor(times.length/2)]) / 2;
    });
    const slow = means[0] > means[1] ? 0 : 1;
    if (medians[slow] - medians[1-slow] >= 8) scenario = {
      label: "В серии могут столкнуться два разных темпа игры",
      reason: fact + ` Если карты снова затянутся, для «${names[slow]}» это будет более привычный сценарий, чем для соперника.`,
      limitation: "Длительность прошлых карт зависит также от соперников и драфтов. Составы и патч на эту серию не сверены.",
    };
  }
  return { fact, scenario, sources: [...new Set(last.flat().map((m) => m.id))].map((id) => ({
    title: "OpenDota", url: `https://www.opendota.com/matches/${id}`, freshness: "archive",
    receivedAt: receipt ? new Date(receipt.receivedAt).toISOString() : null,
    snapshotAt: Number.isFinite(receipt?.snapshotAt) ? new Date(receipt.snapshotAt).toISOString() : null,
  })) };
}

function contextName(article) {
  return article.key_factors?.find((text) => text.startsWith("Формат ")) ||
    (["tennis", "volleyball", "cs2", "dota2"].includes(article.sport_id) ? "Формат серии не удалось подтвердить." : "");
}

export function describeEvidence(article, context, research, now, editorial = []) {
  const fixture = fixtureFor(article, research.diagnostics.assessed, context?.row);
  const original = article.text.split("\n");
  const model = original.filter((line) => /^(Оценка модели исхода|В расчёте вероятностей|Применена фиксированная поправка|Поправка на домашнее поле не применялась)/u.test(line));
  const modelEvent = model.length && research.diagnostics.forecastEvidence?.find((event) =>
    event.sport === article.sport_id && event.start === Date.parse(article.start_iso) && pair(event.match) === pair(article.match));
  const baselineNotes = (article.key_factors || []).filter((line) => /рейтинг|таблиц|очков за|Предматчевый порог|Порог соответствует/.test(line));
  const sourceNotes = editorial.filter((item) => item.sport === article.sport_id && item.match === pair(article.match) &&
    Date.parse(item.start) === Date.parse(article.start_iso) && typeof item.note === "string" &&
    URL.parse(item.source?.url)?.protocol === "https:");
  const contextEvent = modelEvent || fixture;
  const season = contextEvent?.season && research.history.filter((event) => event.sport === contextEvent.sport &&
    event.competition === contextEvent.competition && event.season === contextEvent.season &&
    (event.rules || null) === (contextEvent.rules || null) &&
    event.start < now && event.observedAt <= now);
  const articleTeams = article.match.split(/\s+[—–]\s+/);
  if (articleTeams.length !== 2) return;
  const storedSides = contextEvent && normalizedSides({ ...contextEvent, sport_id: contextEvent.sport });
  const publicSides = normalizedSides(article);
  const sameOrder = contextEvent && (storedSides.every((name, i) => name === publicSides[i]) ||
    context?.row?.participantIds?.length === 2 && context.row.participantIds.every((id) => id != null) &&
    contextEvent.sources?.some((source) => source.title === context.row.source && String(source.id) === String(context.row.id) &&
      source.participantIds?.length === 2 && source.participantIds.every((id, i) => String(id) === String(context.row.participantIds[i]))));
  const fixtureOrderKnown = sameOrder || contextEvent && storedSides[1] === publicSides[0] && storedSides[0] === publicSides[1];
  const sides = contextEvent ? (sameOrder ? [contextEvent.home, contextEvent.away] : [contextEvent.away, contextEvent.home]) : [];
  // Use the same window and definition of a result on both sides. Keep overlapping
  // season archives and fixture feeds separate so a match cannot be counted twice.
  const stored = articleTeams.map((_, i) => season && fixtureOrderKnown ? teamRows(season, sides[i]) : []);
  const feeds = articleTeams.map((_, i) => context?.forms[i]?.longer || []);
  const seriesResults = articleTeams.map((_, i) => {
    const form = context?.forms[i];
    return form?.editorial?.length ? form.editorial : form?.results || [];
  });
  const windows = [
    { type: "season", matches: stored },
    { type: "calendar", matches: feeds },
    ...(series.has(article.sport_id) ? [{ type: "series", matches: seriesResults }] : []),
  ];
  const fresh = (matches) => matches.every((rows) => rows.some(({ start }) => start >= now - 28 * day));
  const minimum = (matches) => Math.min(...matches.map((rows) => rows.length));
  windows.sort((a, b) => Number(fresh(b.matches)) - Number(fresh(a.matches)) ||
    minimum(b.matches) - minimum(a.matches) || b.matches.flat().length - a.matches.flat().length);
  // Keep a coherent result window. For esports, prefer a window with enough
  // corroborated map scores on both sides over a larger winner-only window.
  const scoredWindow = series.has(article.sport_id) && windows.find(({ matches }) =>
    fresh(matches) && matches.every((rows) => verifiedScores(rows).length >= 3));
  const domestic = context?.forms?.map((form) => form.domestic || []) || [];
  const useDomestic = domestic.length === 2 && minimum(windows[0].matches) < 3 && minimum(domestic) > minimum(windows[0].matches) && fresh(domestic);
  const best = scoredWindow || (useDomestic ? { type: "domestic", matches: domestic } : windows[0]);
  const rowsBySide = best.matches.map((rows) => ({ rows }));
  const stats = rowsBySide.map(({ rows }, i) => describeSide(articleTeams[i], rows, article.sport_id));
  const scoring = describeScoring(articleTeams, best.matches, article.sport_id);
  const usedSeason = best.type === "season" && stored.every((rows) => rows.length);
  const splits = usedSeason && article.sport_id === "football" ? rowsBySide.flatMap(({ rows }, i) => {
    const relevant = rows.filter((row) => row.venue === (i ? "away" : "home"));
    return relevant.length < 3 ? [] : [`${articleTeams[i]} ${i ? "на выезде" : "дома"} — побед ${wins(relevant)} из ${relevant.length} игр с подтверждённым полем.`];
  }) : [];
  const opponents = usedSeason && season.length >= 24 ? new Map(sides.map((side, i) => {
    const group = rowsBySide[i].rows;
    const unique = [...new Set(group.map((row) => row.opponent))];
    const measured = unique.flatMap((name) => {
      const sample = teamRows(season, name).filter((row) => row.opponent !== side);
      return sample.length < 5 ? [] : [wins(sample) / sample.length];
    });
    return [side, { count: measured.length, pct: measured.length ? Math.round(measured.reduce((a, b) => a + b, 0) * 100 / measured.length) : null }];
  })) : null;
  const strength = opponents && sides.every((side) => opponents.get(side).count >= 3) ?
    `Средняя доля побед соперников по доступным результатам лиги — ${opponents.get(sides[0]).pct}% и ${opponents.get(sides[1]).pct}% соответственно. Матчи против сравниваемой команды исключены.` : "";
  const meetings = usedSeason ? rowsBySide[0].rows.filter((row) => row.opponent === sides[1]) : [];
  const headToHead = meetings.length ?
    `Личные встречи сезона (${articleTeams.join(" — ")}, в указанном порядке): ${meetings.map((row) => row.scores.join(":")).join(", ")}.` : "";
  const tourHistory = best.matches.flat().some((row) => row.tour === "wta125");
  const basis = !best.matches.some((rows) => rows.length) ? "" :
    useDomestic ? "Форма взята из национальных чемпионатов перед еврокубковой встречей. Уровень соперников различается." :
    usedSeason ? `Выборка по текущему сезону ${contextEvent.season} в этом соревновании.` :
    tourHistory ? "Сравнены завершённые одиночные матчи основной сетки турниров WTA 125 на открытом грунте." :
    best.type === "series" ? "Сравнены завершённые серии того же формата. Уровень турниров может различаться." :
    series.has(article.sport_id) ? "Сравнены завершённые серии того же формата. Уровень турниров может различаться." :
    "Сравнены недавние результаты в том же соревновании.";
  const unavailable = `Что не удалось проверить: ${limits[article.sport_id].toLowerCase()}.`;
  const surface = article.sport_id === "tennis" && contextEvent?.rules === "outdoor-clay" &&
    contextEvent.contextSource?.startsWith("https://www.wtatennis.com/") ? "Покрытие по данным WTA — открытый грунт." : "";
  const marketEvidence = (article.key_factors || []).filter((line) => /условие выполнено|предматчевый порог|порог соответствует/i.test(line));
  const recent = best.matches.map((results) => [...results].sort((a, b) => b.start - a.start).slice(0, 5));
  const recentScores = recent.map(verifiedScores);
  const reportedMaps = series.has(article.sport_id) ? seriesResults.map((rows) => rows.filter((r) =>
    r.format === article.format && r.reportedMapScore && r.start < now && r.start >= now - 28 * day).slice(0, 5)) : [[], []];
  const mapNotes = reportedMaps.flatMap((rows,i) => rows.length ? [
    `Счета по картам у «${articleTeams[i]}» по Ensigame: ${rows.map((r) => r.reportedMapScore.join(":")).join(", ")}. Победители серий сверены со Strafe.`,
  ] : []);
  const board = scoreboardForm(context, articleTeams, article.sport_id);
  const maps = recentTournamentMaps(article, articleTeams, research, now);
  let scenario = describeScenario(article, articleTeams, recentScores, fresh(recent));
  if (useDomestic && scenario && scenario.label !== scenarioPatterns.football[0]) scenario = null;
  if (useDomestic && scenario) scenario.limitation = basis + " " + scenario.limitation;
  scenario ||= board?.scenario || maps?.scenario;
  if (!scenario && article.sport_id === "tennis" && best.matches.flat().some((r) => r.tour === "wta125")) {
    const side = recentScores.findIndex((scores) => scores.length >= 4 && scores.filter(([own, allowed]) => own === 0 && allowed === 2).length >= 3);
    if (side >= 0 && recent[side].some((r) => r.start >= now - 28 * day)) {
      const losses = recentScores[side].filter(([own, allowed]) => own === 0 && allowed === 2).length;
      scenario = { label: `Первый сет особенно важен для «${articleTeams[side]}»`,
        reason: `На открытом грунте WTA 125 она уступила в двух сетах в ${losses} из ${recentScores[side].length} сверенных матчей. При неудачном начале ей придётся изменить привычный для этой выборки ход встречи и отыгрываться по сетам.`,
        limitation: "Вывод касается игры одной теннисистки. Подтверждённых показателей подачи и приёма в этом сравнении нет." };
    }
  }
  if (!scenario && article.format === "BO3" && reportedMaps.every((rows) => rows.length >= 2 &&
      rows.filter((r) => r.reportedMapScore.every((v) => v > 0)).length >= Math.ceil(rows.length * 2 / 3))) {
    scenario = { label: "Команды могут обменяться картами", reason: `${mapNotes.join(" ")} При повторении такой борьбы преимущество после первой карты может оказаться временным.`,
      limitation: "Точные счета карт приводит Ensigame. Составы на предстоящую серию пока не подтверждены." };
  }
  if (!scenario && series.has(article.sport_id) && article.format && fresh(recent) && recent.every((rows) => rows.length >= 1)) {
    const streak = recent.findIndex((rows) => rows.length >= 3 && rows.every((r) => r.win === rows[0].win) &&
      rows.every((r) => r.format === article.format));
    if (streak >= 0) {
      const winning = recent[streak][0].win;
      scenario = { label: winning ? `«${articleTeams[streak]}» может продолжить удачную игру в ${article.format}` :
        `«${articleTeams[streak]}» предстоит прервать серию поражений`,
        reason: `В последних ${recent[streak].length} сверенных сериях этого формата у команды только ${winning ? "победы" : "поражения"}. Если рисунок последних серий повторится, ${winning ? "сопернику будет сложно переломить встречу" : "команде будет трудно удержать инициативу"}.`,
        limitation: `Уровень прошлых соперников мог отличаться. Не сверены ${limits[article.sport_id].toLowerCase()}.` };
    }
  }
  if (scenario) article.matchScenario = scenario;
  article.comparisonSample = Math.min(...recent.map((rows) => rows.length));
  const scoreDiff = (scores) => scores.reduce((sum, [own, allowed]) => sum + own - allowed, 0) / scores.length;
  const differentBalance = recentScores.every((scores) => scores.length >= 3) &&
    recentScores.some((scores) => scoreDiff(scores) > 0) && recentScores.some((scores) => scoreDiff(scores) < 0);
  const balance = differentBalance ?
    `${articleTeams[recentScores.findIndex((scores) => scoreDiff(scores) > 0)]} в этой выборке в среднем набирал больше соперников. У второй стороны баланс отрицательный.` : "";
  const recentForm = recent.flatMap((results, index) => {
    if (!results.length) return [];
    const scores = recentScores[index];
    const form = `${articleTeams[index]} — побед ${wins(results)} из ${results.length} в последних сверенных матчах`;
    if (!scores.length) return [form + "."];
    const latest = scores[0].join(":");
    if (scores.length < 3) return [`${form}. Последний сверенный счёт — ${latest} (сначала результат этой стороны).`];
    const own = scores.reduce((sum, [scored]) => sum + scored, 0) / scores.length;
    const allowed = scores.reduce((sum, [, conceded]) => sum + conceded, 0) / scores.length;
    return [`${form}. Средний счёт в ${scores.length} матчах — ${decimal(own)}:${decimal(allowed)} (${scoringUnit[article.sport_id]}, сначала результат этой стороны).`];
  });
  const tableNotes = baselineNotes.filter((note) => !marketEvidence.includes(note));
  const verifiedMeeting = original.find((line) => line.startsWith("Очные встречи:"));
  const contextFacts = [surface, maps?.fact, ...mapNotes, board?.fact, verifiedMeeting, ...splits, ...tableNotes].filter(Boolean);
  const format = series.has(article.sport_id) && article.format ? `Формат встречи — ${article.format}.` : "";
  const observations = [format, useDomestic ? basis : "", ...recentForm, balance, ...contextFacts.slice(0, 2)].filter(Boolean);
  if (recentForm.length === 1) observations.push("Сопоставимых результатов второй стороны в этой выборке нет.");
  article.overview = observations.length ? observations.join(" ") :
    `Матч в турнире «${article.tournament}»${article.format ? `, формат ${article.format}` : ""}. Свежих сверенных результатов пока нет.`;
  const recentMeeting = [...meetings].sort((a, b) => b.start - a.start)[0];
  if (recentMeeting) article.overview += ` Последняя встреча — ${recentMeeting.scores.join(":")} в порядке команд в карточке.`;
  article.hasStatistics = Boolean(recentForm.length || tableNotes.length || verifiedMeeting || board || maps || mapNotes.length);
  article.comparativeReview = Boolean(board || maps || verifiedMeeting || tableNotes.length >= 2 ||
    recentScores.every((s) => s.length >= 2) || reportedMaps.every((rows) => rows.length >= 2));
  article.overviewLead = board?.fact || maps?.fact || verifiedMeeting || tableNotes.slice(0, 2).join(" ") ||
    mapNotes.slice(0, 2).join(" ") || article.overview;
  if (model.length) article.checkedModel = { conclusion: article.verdict, lines: model };
  const descriptive = model.length ? [] : ["Вероятности исходов не рассчитаны.", context?.method, ...marketEvidence];
  article.text = [original[0], ...model, ...descriptive, "Контекст матча и статистика для сравнения",
    ...(article.hasStatistics ? [`Спортивный обзор. ${article.overview}`] : []),
    ...sourceNotes.map((item) => item.note), basis, surface, ...stats, ...scoring.lines, ...splits, strength, headToHead, verifiedMeeting, board?.fact,
    ...tableNotes, unavailable].filter(Boolean).join("\n");
  article.key_factors = [contextName(article), model.length ? "Вероятности рассчитаны по отдельной модели исхода." : "Без численной оценки вероятности."].filter(Boolean);
  const sources = [...article.sources, ...(maps?.sources || []), ...reportedMaps.flat().flatMap((r) => r.sources.map((s) => ({ ...s, freshness: "archive" }))), ...rowsBySide.flatMap(({ rows }) =>
    rows.flatMap((row) => row.sources.map((source) => ({ ...source, freshness: "archive" })))),
    ...sourceNotes.map((item) => item.source), ...(surface ? [{ title: "WTA", url: contextEvent.contextSource }] : [])];
  article.sources = [...new Map(sources.map(({ title, url, receivedAt, snapshotAt, freshness }) =>
    [`${title}|${url}|${freshness ?? ""}`, { title, url, receivedAt, snapshotAt, freshness }])).values()];
  const counts = rowsBySide.map(({ rows }) => rows.length);
  const freshResults = fresh(best.matches);
  const formatKnown = !series.has(article.sport_id) || Boolean(article.format);
  const quality = counts.every((count) => count >= 4) && freshResults && formatKnown;
  const publishers = [...new Set(rowsBySide.flatMap(({ rows }) => rows.flatMap((row) => row.sources.map(({ title }) => title))))];
  return { match: article.match, sport: article.sport_id, start: article.start_iso, history: counts, season: Boolean(usedSeason),
    splits: splits.length, opponentComparison: Boolean(strength), model: model.length > 0, editorialChecks: sourceNotes.length,
    quality, historyType: tourHistory ? "wta125_clay" : best.type, freshResults, formatKnown, historySources: publishers,
    scoreSamples: scoring.counts, scoringContext: scoring.included, historicalWins: best.matches.map(wins) };
}
