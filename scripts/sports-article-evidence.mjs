import { normalizeIdentity } from "./sports-discovery.mjs";
import { reconcileClaims } from "./sports-reconciliation.mjs";

const day = 86_400_000;
const pair = (match) => match.split(/\s+[—–]\s+/).map(normalizeIdentity).sort().join("|");
const outcome = ([scored, allowed]) => scored > allowed ? "win" : scored === allowed ? "draw" : "loss";
const numbers = new Intl.NumberFormat("ru", { maximumFractionDigits: 1 });
const decimal = (n) => numbers.format(n);
const date = new Intl.DateTimeFormat("ru", { timeZone: "Europe/Moscow", day: "numeric", month: "short" });
const units = { football: "голов", basketball: "очков", tennis: "сетов", volleyball: "сетов", hockey: "шайб", cs2: "карт", dota2: "карт" };
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
  const best = windows[0];
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
  const headToHead = meetings.length >= 2 ?
    `Личные встречи сезона (${articleTeams.join(" — ")}, в указанном порядке): ${meetings.map((row) => row.scores.join(":")).join(", ")}.` : "";
  const basis = usedSeason ? `Выборка по текущему сезону ${contextEvent.season} в этом соревновании.` :
    best.type === "series" ? "Сравнены завершённые серии того же формата. Уровень турниров может различаться." :
    series.has(article.sport_id) ? "Сравнены завершённые серии того же формата. Уровень турниров может различаться." :
    "Сравнены недавние результаты в том же соревновании.";
  const unavailable = `Что не удалось проверить: ${limits[article.sport_id].toLowerCase()}.`;
  const surface = article.sport_id === "tennis" && contextEvent?.rules === "outdoor-clay" &&
    contextEvent.contextSource?.startsWith("https://www.wtatennis.com/") ? "Покрытие по данным WTA — открытый грунт." : "";
  const marketEvidence = (article.key_factors || []).filter((line) => /условие выполнено|предматчевый порог|порог соответствует/i.test(line));
  const descriptive = model.length ? [] : ["Вероятности исходов не рассчитаны.", context?.method, ...marketEvidence];
  article.text = [original[0], ...model, ...descriptive, "Контекст матча и статистика для сравнения",
    ...sourceNotes.map((item) => item.note), basis, surface, ...stats, ...scoring.lines, ...splits, strength, headToHead,
    ...baselineNotes.filter((note) => !marketEvidence.includes(note)), unavailable].filter(Boolean).join("\n");
  article.key_factors = [contextName(article), model.length ? "Вероятности рассчитаны по отдельной модели исхода." : "Без численной оценки вероятности."].filter(Boolean);
  const sources = [...article.sources, ...rowsBySide.flatMap(({ rows }) => rows.flatMap((row) => row.sources)),
    ...sourceNotes.map((item) => item.source), ...(surface ? [{ title: "WTA", url: contextEvent.contextSource }] : [])];
  article.sources = [...new Map(sources.map(({ title, url }) => [`${title}|${url}`, { title, url }])).values()];
  const counts = rowsBySide.map(({ rows }) => rows.length);
  const freshResults = fresh(best.matches);
  const formatKnown = !series.has(article.sport_id) || Boolean(article.format);
  const quality = counts.every((count) => count >= 4) && freshResults && formatKnown;
  const publishers = [...new Set(rowsBySide.flatMap(({ rows }) => rows.flatMap((row) => row.sources.map(({ title }) => title))))];
  return { match: article.match, sport: article.sport_id, start: article.start_iso, history: counts, season: Boolean(usedSeason),
    splits: splits.length, opponentComparison: Boolean(strength), model: model.length > 0, editorialChecks: sourceNotes.length,
    quality, historyType: best.type, freshResults, formatKnown, historySources: publishers,
    scoreSamples: scoring.counts, scoringContext: scoring.included };
}
