import "../js/history-core.js";
import { createHash } from "node:crypto";
import { assessMarkets, completedSeries } from "./sports-markets.mjs";

const H = globalThis.HistoryCore;
const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;
export const FORM_DAYS = 10;
export const FOOTBALL_FORM_DAYS = 21;
const FOOTBALL_LIMIT = 6;
const CS2_LIMIT = 5;
const FORM_MODEL = "v5-form";
const MARKET_MODEL = "v6-markets";
export const PUBLISH_BUFFER = 10 * MINUTE;
const esports = new Set(["dota2", "cs2"]);
export const SPORTS = [
  ["football", "Футбол", "⚽", "составы, травмы и контекст турнира"],
  ["basketball", "Баскетбол", "🏀", "составы, игровое время лидеров и темп"],
  ["tennis", "Теннис", "🎾", "покрытие, состояние игроков и формат матча"],
  ["volleyball", "Волейбол", "🏐", "составы, подача, приём и формат матча"],
  ["hockey", "Хоккей", "🏒", "стартовые вратари, составы и игра в большинстве"],
  ["cs2", "CS2", "🔫", "составы, пул карт и вето"],
  ["dota2", "Dota 2", "🐉", "составы, патч и драфты"],
];
const aliases = [
  ["PSG", "Paris Saint-Germain", "ПСЖ"], ["Nice", "Ницца"], ["Lens", "Ланс"], ["Toulouse", "Тулуза"],
  ["GAIS", "ГАИС"], ["Västerås SK", "Vasteras", "Вестерос"], ["Parma", "Парма"], ["AS Roma", "Roma", "Рома"],
  ["Kalamata", "Каламата"], ["AEK Athens", "AEK", "АЕК"], ["Empoli", "Эмполи"], ["Pisa", "Пиза"],
  ["Motherwell", "Мотеруэлл"], ["Rangers", "Рейнджерс"], ["1. FC Kaiserslautern", "Kaiserslautern", "Кайзерслаутерн"],
  ["Dynamo Dresden", "Динамо Дрезден"], ["AC Horsens", "Horsens", "Хорсенс"], ["Silkeborg IF", "Silkeborg", "Силькеборг"],
  ["BK Häcken", "Häcken", "Хеккен"], ["IF Elfsborg", "Elfsborg", "Эльфсборг"], ["Paris FC", "Пари"],
  ["Angers SCO", "Angers", "Анже"], ["IF Brommapojkarna", "Brommapojkarna", "Броммапойкарна"],
  ["Halmstads BK", "Halmstad", "Хальмстад"], ["Marseille", "Olympique Marseille", "Марсель"], ["Le Mans", "Ле-Ман"],
  ["Leicester City", "Leicester", "Лестер"], ["Bradford City", "Bradford", "Брэдфорд"],
  ["Nashville Predators", "Нэшвилл"], ["Pittsburgh Penguins", "Питтсбург"], ["Montreal Canadiens", "Монреаль"],
  ["Philadelphia Flyers", "Филадельфия"], ["Ottawa Senators", "Оттава"], ["Los Angeles Kings", "Лос-Анджелес"],
  ["Boston Bruins", "Бостон"], ["Washington Capitals", "Вашингтон"], ["Detroit Red Wings", "Детройт"],
  ["New York Islanders", "Айлендерс"], ["Vancouver Canucks", "Ванкувер"], ["Minnesota Wild", "Миннесота"],
  ["Valsa Group Modena", "Modena Volley", "Pallavolo Modena", "Modena"],
  ["Gas Sales Bluenergy Piacenza", "Pallavolo Piacenza", "Piacenza"],
  ["Sir Susa Scai Perugia", "Volley Perugia"], ["Cucine Lube Civitanova", "Lube Civitanova"],
  ["Tinet Prata di Pordenone", "Prata di Pordenone"], ["Itas Trentino", "Trentino Volley"],
  ["Vero Volley Monza", "Volley Monza"],
  ["Brooklyn Nets", "Brooklyn"], ["NY Knicks", "New York Knicks"],
  ["Inner Circle x Insanity", "Inner Circle"], ["LGD Gaming", "LGD"], ["1W Team", "1Win"],
  ["BBL Esports", "BBL"], ["Sinners Esports", "SINNERS"], ["The Huns Esports", "The Huns"],
  ["Team Spirit", "Spirit"], ["Xtreme Gaming", "XG"], ["PARIVISION", "PARI"], ["Team Liquid", "Liquid"],
];

function normalize(text) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const names = new Map(aliases.flatMap((group) => group.map((name) => [normalize(name), normalize(group[0])])));
const team = (name) => names.get(normalize(name)) || normalize(name);
const pair = (e) => e.home && e.away && e.sport ? `${e.sport}|${[team(e.home), team(e.away)].sort().join("|")}` : "";
const orientation = (a, b) => team(a.home) === team(b.home) && team(a.away) === team(b.away) ? 1
  : team(a.home) === team(b.away) && team(a.away) === team(b.home) ? -1 : 0;
const align = (score, a, b) => score && (orientation(a, b) === 1 ? score : [...score].reverse());
const scoreText = (score) => score?.join(":");
const sameScore = (a, b) => !!a && !!b && scoreText(a) === scoreText(b);
const tolerance = (sport) => (sport === "tennis" ? 5 : 15) * MINUTE;
const link = (e) => ({ title: e.source, url: e.url });
const validLink = (value) => {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
};

export function eventIndex(events) {
  const index = new Map();
  const seen = new Set();
  for (const row of events) {
    const key = pair(row);
    const id = [row.source, row.sport, row.id, row.start, row.status].join("|");
    if (!key || team(row.home) === team(row.away) || !validLink(row.url) || seen.has(id)) continue;
    seen.add(id);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  }
  return index;
}

export function esportsResultLinks(rows, published) {
  const references = eventIndex(published.filter((row) => esports.has(row.sport) && row.status === "finished" && row.score));
  return [...new Map(rows.filter((row) => row.status === "finished" && row.score &&
    (references.get(pair(row)) || []).some((candidate) => row.start >= candidate.start - 15 * MINUTE &&
      row.start - candidate.start <= 4 * 60 * MINUTE)).map((row) => [row.url, row])).values()].slice(0, 15);
}

export function esportsFormLinks(rows, now) {
  const index = eventIndex(rows);
  return [...esports].flatMap((sport) => selectUpcoming(index, sport, now + PUBLISH_BUFFER, now + 2 * DAY)
    .flatMap(({ row, evidence }) => {
      const strafe = evidence.find((source) => source.source === "Strafe" && source.format);
      const ensi = evidence.find((source) => source.source === "Ensigame" && source.format === strafe?.format);
      return ensi && strafe ? [{ row, strafe, ensi }] : [];
    }).slice(0, 9));
}

export function tennisPreviewLinks(rows, now) {
  return selectUpcoming(eventIndex(rows), "tennis", now, now + 2 * DAY).flatMap(({ row, evidence }) => {
    if (!evidence.some((source) => /Nitto ATP Finals/i.test(source.tournament))) return [];
    const [a, b] = [row.home, row.away].map((name) => normalize(name).split(" ").at(-1));
    if (![a, b].every((surname) => /^[a-z]+$/.test(surname))) return [];
    const year = new Date(row.start).getUTCFullYear();
    return [{ row, urls: [[a, b], [b, a]].map((pair) =>
      `https://www.nittoatpfinals.com/en/news/${pair.join("-")}-nitto-atp-finals-${year}-sf-preview`) }];
  }).slice(0, 3);
}

export function verifiedEsportsForm({ row, strafe }, first, second, now) {
  const key = (names) => names.map(team).sort().join("|");
  const entries = [...new Map(second.filter((entry) => entry.format === strafe.format && entry.ended < now &&
    entry.ended > now - 7 * DAY).map((entry) => [entry.url, entry])).values()];
  return [row.home, row.away].map((name) => {
    const involves = (entry) => entry.names.some((side) => team(side) === team(name));
    const [matches = []] = first.map((series) => series.filter(involves)).sort((a, b) => b.length - a.length);
    const candidates = entries.filter(involves);
    return candidates.flatMap((entry) => {
      const pairKey = key(entry.names);
      const duplicate = candidates.filter((other) => key(other.names) === pairKey).length !== 1;
      const corroborated = matches.filter((other) => key(other.names) === pairKey);
      if (duplicate || corroborated.length !== 1 || team(corroborated[0].winner) !== team(entry.winner)) return [];
      return [{ win: team(entry.winner) === team(name), start: entry.ended, match: entry.names.join(" — "),
        outcome: `победа «${entry.winner}»`, sources: [link(strafe), { title: "Ensigame", url: entry.url }] }];
    }).sort((a, b) => b.start - a.start).slice(0, 3);
  });
}

export function evidenceFor(index, target) {
  const close = (index.get(pair(target)) || []).filter((e) =>
    Math.abs(e.start - target.start) <= tolerance(target.sport) &&
    (e.league === target.league || !e.league || !target.league));
  const bySource = Map.groupBy(close, (e) => e.source);
  if ([...bySource.values()].some((rows) => new Set(rows.map((r) => r.id)).size > 1)) return [];
  return [...bySource.values()].flatMap((rows) => {
    if (rows.some((r) => r.status === "finished")) return [rows.find((r) => r.status === "finished")];
    return rows.every((r) => r.status === rows[0].status) ? [rows[0]] : [];
  });
}

export function upcomingEvidence(index, event, now, until) {
  const rows = evidenceFor(index, event);
  if (rows.length < 2 || rows.some((row) => row.status !== "scheduled" || row.start <= now || row.start >= until) ||
      Math.max(...rows.map((row) => row.start)) - Math.min(...rows.map((row) => row.start)) > tolerance(event.sport)) return [];
  const formats = new Set(rows.map((row) => row.format).filter(Boolean));
  return formats.size > 1 ? [] : rows;
}

function consensusScore(index, target, scope) {
  const rows = evidenceFor(index, target);
  if (rows.some((row) => row.status === "cancelled" || row.status === "postponed")) return [];
  if (rows.length && Math.max(...rows.map((row) => row.start)) - Math.min(...rows.map((row) => row.start)) > tolerance(target.sport)) return [];
  if (target.sport === "football" && rows.some((row) => row.extra)) return [];
  const field = scope === "regulation" && target.sport !== "football" ? "regulation" : "score";
  return rows.filter((row) => row.status === "finished" && row[field])
    .map((row) => ({ ...row, aligned: align(row[field], target, row) }));
}

function targetFor(sport, match, start, tournament) {
  const { home, away } = H.splitTeams(match);
  return { sport, home, away, start: Date.parse(start), league: /\bNHL\b|НХЛ/i.test(tournament) ? "nhl" : null };
}

const finalHockey = (bet) => /(?:^|\s)с\s+ОТ(?=[\s,).]|$)|с\s+уч[её]том\s+овертайма|включая\s+овертайм/iu.test(bet);

export function resultFor(index, entry) {
  if (!entry.start_iso || entry.start_approx || entry.late) return null;
  const target = targetFor(entry.sport, entry.match, entry.start_iso, entry.tournament);
  const rows = evidenceFor(index, target);
  if (rows.length >= 2 && rows.every((r) => r.status === rows[0].status) &&
      ["cancelled", "postponed"].includes(rows[0].status)) {
    return { id: entry.id, status: rows[0].status, sources: rows.map(link), note: "Статус совпал в независимых источниках" };
  }
  const bet = entry.bet;
  const hockeyFinal = entry.sport === "hockey" && (entry.market ? entry.market.scope === "final" : finalHockey(bet));
  const scope = entry.market?.scope || (entry.sport === "hockey" && !hockeyFinal ? "regulation" : "final");
  const finals = consensusScore(index, target, scope);
  if (finals.length < 2) return null;
  const sources = finals.map(link);
  if (finals.some((r) => !sameScore(r.aligned, finals[0].aligned))) {
    return { id: entry.id, status: H.STATUS.review, sources,
      source_scores: finals.map((r) => ({ source: r.source, score: scoreText(r.aligned) })) };
  }
  const canonical = bet.replace(/\s*\((?:победа [^)]*|[хx])\)\s*$/iu, "").trim();
  const supported = /^(?:п[12]|ничья|[хx]|1[хx]|[хx]2|12|(?:тб|тм)\s*\d+(?:[.,][05])?|обе забьют\s*[—–:-]?\s*(?:да|нет)|ф[12]\s*\([+-]?\d+(?:[.,][05])?\))$/iu.test(canonical);
  const verifiedScore = scoreText(finals[0].aligned);
  if (entry.market?.bestOf && !completedSeries(verifiedScore, entry.market.bestOf)) {
    return { id: entry.id, status: H.STATUS.review, sources, note: "Счёт не подтверждает завершение матча в указанном формате" };
  }
  const settled = entry.market ? H.evaluateMarket(entry.market, verifiedScore) : supported ? H.evaluateBet(canonical, verifiedScore) : null;
  // Keep composite, period-specific and unsupported markets in review even if the
  // existing history engine would match a prefix and calculate a different market.
  if (!settled || !entry.market && /(?:по сетам|по картам|основное время|перв[а-я]+\s+(?:сет|карт|период|тайм))/iu.test(bet)) {
    return { id: entry.id, status: H.STATUS.review, sources,
      note: `Подтверждён счёт ${scoreText(finals[0].aligned)}, условия прогноза требуют ручной проверки` };
  }
  return { id: entry.id, status: settled, score: scoreText(finals[0].aligned), sources,
    note: scope === "regulation" ? "Счёт основного времени подтверждён" : hockeyFinal ? "Подтверждён итог с учётом ОТ и буллитов" : "Итоговый счёт подтверждён" };
}

function formFor(index, event, name, now) {
  const results = [];
  const used = new Set();
  const formDays = ["football", "volleyball"].includes(event.sport) ? FOOTBALL_FORM_DAYS : FORM_DAYS;
  for (const group of index.values()) {
    for (const row of group) {
      if (row.sport !== event.sport || row.start >= now || row.start < now - formDays * DAY ||
          ![team(row.home), team(row.away)].includes(team(name))) continue;
      // Keep the form window within the same competitions to avoid mixing levels of play.
      if (normalize(row.tournament) !== normalize(event.tournament) && !(row.league && row.league === event.league) &&
          !(esports.has(event.sport) && row.format && row.format === event.format)) continue;
      const sources = consensusScore(index, row, "final");
      if (sources.length < 2 || sources.some((r) => !sameScore(r.aligned, sources[0].aligned))) continue;
      const id = sources.map((r) => `${r.source}|${r.id}`).sort().join(";");
      if (used.has(id)) continue;
      used.add(id);
      const scores = sources[0].aligned;
      const [own, opponent] = team(name) === team(row.home) ? scores : [...scores].reverse();
      results.push({ id, win: own > opponent, start: row.start, match: `${row.home} — ${row.away}`,
        score: scoreText(scores), scores: [own, opponent], format: sources.find((source) => source.format)?.format,
        sources: sources.map(link) });
    }
  }
  return results.sort((a, b) => b.start - a.start).slice(0, 3);
}

function checkedStandings(standings) {
  const byTeam = Map.groupBy(standings, (row) => team(row.name));
  const checked = new Map();
  for (const [name, rows] of byTeam) {
    const nhl = rows.find((row) => row.source === "NHL");
    const espn = rows.find((row) => row.source === "ESPN");
    if (!nhl || !espn || !["games", "wins", "points", "season"].every((key) => nhl[key] === espn[key])) continue;
    checked.set(name, { ...nhl, share: nhl.points / (2 * nhl.games), sources: [nhl, espn] });
  }
  return checked;
}

function checkedVolleyTable(rows) {
  const byTeam = Map.groupBy(rows.filter((row) => row.kind === "volleyball"), (row) => team(row.name));
  const checked = new Map();
  for (const [name, claims] of byTeam) {
    const league = claims.find((row) => row.source === "Lega Pallavolo");
    const broadcaster = claims.find((row) => row.source === "Volleyball World");
    if (league && broadcaster && league.games === broadcaster.games && league.wins === broadcaster.wins) {
      checked.set(name, { ...league, sources: [league, broadcaster] });
    }
  }
  return checked;
}

function timeLabel(msk) {
  return `${msk.slice(8, 10)}.${msk.slice(5, 7)}, ${msk.slice(11, 16)} МСК`;
}

function analysisFor(index, context, row, sources, sportName, missing, now) {
  const format = sources.find((r) => r.format)?.format;
  const forms = [row.home, row.away].map((name, i) => {
    const exact = formFor(index, row, name, now);
    const extra = context.esportsForm.get(row.url)?.[i] || [];
    return { name, results: extra.length > exact.length ? extra : exact, exact };
  });
  const market = assessMarkets(row, sources.map((source) => ({ ...source, alignment: orientation(row, source) })),
    forms.map(({ name, exact }) => ({ name, results: exact })));
  const [a, b] = forms.map(({ results }) => results.filter((x) => x.win).length);
  const sample = Math.min(...forms.map(({ results }) => results.length));
  const minimum = ["football", "cs2", "dota2", "volleyball"].includes(row.sport) ? 2 : 3;
  const rates = forms.map(({ results }, i) => results.length ? [a, b][i] / results.length : 0);
  const formSide = rates[0] > rates[1] ? 0 : 1;
  const formEnough = sample >= minimum && [a, b][formSide] >= 2 &&
    rates[formSide] - rates[1 - formSide] >= (sample === 2 ? 0.5 : 2 / 3);
  const season = row.league === "nhl" ? forms.map(({ name }) => context.hockey.get(team(name))) : [];
  const hasSeason = season.length === 2 && season.every((team) => team && team.games >= 15) && season[0].season === season[1].season;
  const gap = hasSeason ? season[0].share - season[1].share : 0;
  const seasonSide = gap > 0 ? 0 : 1;
  const wins = [a, b];
  const seasonLead = hasSeason && Math.abs(gap) >= 0.15 && forms.every(({ results }) => results.length === 3) &&
    wins[seasonSide] > 0 && wins[seasonSide] >= wins[1 - seasonSide];
  const volleyTable = row.sport === "volleyball" && /SuperLega/i.test(row.tournament)
    ? forms.map(({ name }) => context.volley.get(team(name))) : [];
  const volleyValid = volleyTable.length === 2 && volleyTable.every((record) => record?.games >= 5);
  const volleyWins = volleyValid ? volleyTable.map((record) => record.wins / record.games) : [0, 0];
  const volleySide = volleyWins[0] > volleyWins[1] ? 0 : 1;
  const volleyLead = volleyValid && volleyWins[volleySide] - volleyWins[1 - volleySide] >= 0.5;
  const tennisRank = row.sport === "tennis" ? forms.map(({ name }) => context.tennis.get(team(name))) : [];
  const rankValid = tennisRank.length === 2 && tennisRank.every(Boolean) && tennisRank[0].tour === tennisRank[1].tour;
  const tennisSide = rankValid && tennisRank[0].points > tennisRank[1].points ? 0 : 1;
  const tennisLead = rankValid && sample >= 3 && wins[tennisSide] > wins[1 - tennisSide] &&
    tennisRank[tennisSide].points >= tennisRank[1 - tennisSide].points * 1.5;
  const h2h = context.tennisPreviews.get(row.url);
  const forecastSide = seasonLead ? seasonSide : formEnough ? formSide : tennisLead ? tennisSide : volleyLead ? volleySide : null;
  const favored = forecastSide === null ? null : forms[forecastSide].name;
  const start = H.toMskIso(new Date(row.start));
  const key = [`Начало ${timeLabel(start)} подтверждено ${sources.map((r) => r.source).join(" и ")}.`];
  if (format) key.push(`Формат ${format} указан в расписании ${sources.filter((r) => r.format === format).map((r) => r.source).join(" и ")}.`);
  for (const { name, results } of forms) {
    if (results.length) key.push(`${name}: побед ${results.filter((x) => x.win).length} из ${results.length} сверенных матчей.`);
  }
  if (hasSeason) {
    season.forEach((record, i) => key.push(`${forms[i].name}: ${record.points} очков за ${record.games} матчей (${Math.round(record.share * 100)}% от возможных).`));
  }
  if (volleyValid) {
    volleyTable.forEach((record, i) => key.push(`${forms[i].name}: ${record.wins} побед из ${record.games} матчей в таблице Суперлиги.`));
  }
  if (rankValid) {
    tennisRank.forEach((record, i) => key.push(`${forms[i].name}: № ${record.rank} в рейтинге ${record.tour}, ${record.points} очков.`));
  }
  const opposition = h2h ? `Очные встречи: преимущество на стороне «${h2h.leader}» (${h2h.wins}:${h2h.losses}).` : "";
  const caveat = row.sport === "hockey" ? "В сравнении формы учтён итог матча с овертаймом и буллитами." :
    esports.has(row.sport) && forms.some(({ results }) => results.length) ? "В форме учтены недавние серии того же формата. Турниры могут отличаться по уровню." : "";
  const records = forms.filter(({ results }) => results.length).map(({ name, results }) =>
    `${name}. Сверенные результаты: ${results.map((r) => `${r.match} (${r.score || r.outcome})`).join("; ")}.`);
  const winnerVerdict = favored ? seasonLead ? `По результатам сезона преимущество на стороне «${favored}». Недавние результаты этому не противоречат. Уверенность средняя.`
    : `По ${formEnough ? "сверенной форме" : tennisLead ? "рейтингу и недавним результатам" : "таблице Суперлиги"} преимущество на стороне «${favored}». Уверенность низкая.`
    : "Подтверждённых данных недостаточно, чтобы выделить наиболее вероятный исход.";
  const links = [...new Map([...sources.map(link), ...forms.flatMap(({ results }) => results.flatMap((x) => x.sources)),
    ...(hasSeason ? season.flatMap((record) => record.sources.map(link)) : []),
    ...(volleyValid ? volleyTable.flatMap((record) => record.sources.map(link)) : []),
    ...(rankValid ? tennisRank.map(link) : []), ...(h2h ? [link(h2h)] : []), ...(market?.sources || [])]
    .map((item) => [item.url, item])).values()];
  const article = {
    sport: sportName, sport_id: row.sport, match: `${row.home} — ${row.away}`, tournament: row.tournament,
    start: timeLabel(start), start_iso: start, format,
    text: [key[0], ...records, opposition, caveat, market?.against, `Для оценки не сверены ${missing}. Эти сведения могут изменить вывод.`].filter(Boolean).join("\n"),
    key_factors: [...key, ...(market?.facts || [])], verdict: market ? market.reason + " Уверенность низкая." : winnerVerdict,
    sources: links, automated: true,
  };
  return { article, wins, sample, hasOutlook: !!favored || !!market, forecastSide, favored, missing, opposition, market, winnerVerdict,
    seasonSide: seasonLead ? seasonSide : null };
}

function selectUpcoming(index, sport, now, until) {
  const upcoming = [];
  for (const group of index.values()) {
    const candidates = group.filter((e) => e.sport === sport && e.status === "scheduled" && e.start > now && e.start < until);
    for (const candidate of candidates) {
      if (upcoming.some(({ evidence }) => evidence.includes(candidate))) continue;
      const evidence = upcomingEvidence(index, candidate, now, until);
      if (evidence.length < 2) continue;
      const row = evidence.find((r) => ["NHL", "Lega Pallavolo", "Strafe"].includes(r.source)) || evidence[0];
      upcoming.push({ row, evidence });
    }
  }
  return upcoming.sort((a, b) => a.row.start - b.row.start);
}

function rankByEvidence(a, b) {
  return b.detail.sample - a.detail.sample ||
    b.evidence.length - a.evidence.length ||
    Math.abs(b.detail.wins[0] - b.detail.wins[1]) - Math.abs(a.detail.wins[0] - a.detail.wins[1]) ||
    a.row.start - b.row.start || a.detail.article.match.localeCompare(b.detail.article.match);
}

function qualifiedLeg(sport, pick, detail) {
  const side = H.normBet(pick.bet).match(/^п([12])$/iu)?.[1];
  if (!side || detail.sample < 3 || !["medium", "high"].includes(pick.data_quality?.level) ||
    (sport === "hockey" && !finalHockey(pick.bet))) return false;
  const index = Number(side) - 1;
  const odds = Number(String(pick.odds).replace(",", "."));
  if (!Number.isFinite(odds) || odds <= 1 || odds > 2) return null;
  if (detail.seasonSide === index) return "season";
  return detail.wins[index] >= 2 && detail.wins[index] - detail.wins[1 - index] >= 2 ? "form" : null;
}

function forecastFrom(detail, row, now) {
  if (row.start <= now + PUBLISH_BUFFER + MINUTE || detail.article.key_factors.length < 3) return null;
  const { article } = detail;
  const fields = { match: article.match, tournament: article.tournament, start: article.start, start_iso: article.start_iso,
    format: article.format, uncertainty: `До матча не сверены ${detail.missing}.`, sources: article.sources };
  if (detail.market) {
    const item = detail.market;
    return { ...fields, bet: item.bet, market: item.market, confidence: 2, reason: item.reason,
      facts: [article.key_factors[0], ...item.facts], against: [item.against],
      data_quality: { level: "low", note: "Сверены счёт и условия расчёта; выборка короткая." }, generated: MARKET_MODEL };
  }
  if (detail.forecastSide === null) return null;
  const season = detail.seasonSide !== null;
  const hockey = row.sport === "hockey";
  return {
    ...fields,
    bet: `П${detail.forecastSide + 1} (победа «${detail.favored}»${hockey ? ", с ОТ" : ""})`,
    confidence: season ? 3 : 2, reason: detail.winnerVerdict,
    facts: article.key_factors, against: detail.opposition ? [detail.opposition] : [],
    data_quality: { level: season ? "medium" : "low", note: season ?
      "Таблица сезона и недавние результаты согласуются." : "Оценка основана на короткой выборке подтверждённых результатов." },
    generated: FORM_MODEL,
  };
}

const legKey = (leg) => JSON.stringify([leg.sport, leg.match, leg.start_iso, leg.bet]);
const matchKey = (leg) => JSON.stringify([leg.sport, leg.match, leg.start_iso]);
const comboKey = (legs) => legs.map(legKey).sort().join("|");

export function selectExpress(previous, legs) {
  const byKey = new Map(legs.map((leg) => [legKey(leg), leg]));
  const existing = new Map(previous.map((entry) => [comboKey(entry.legs || []), entry]));
  const pairs = [];
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i], b = legs[j];
      if (matchKey(a) === matchKey(b)) continue;
      const total = Math.round(Number(a.odds) * Number(b.odds) * 100) / 100;
      if (total < 2 || total > 3.5) continue;
      pairs.push({ legs: [a, b], total, mix: Number(a.sport !== b.sport) });
    }
  }
  pairs.sort((a, b) => b.mix - a.mix || a.total - b.total || comboKey(a.legs).localeCompare(comboKey(b.legs)));
  const used = new Set();
  const result = [];
  for (const pair of pairs) {
    const keys = pair.legs.map(matchKey);
    if (keys.some((key) => used.has(key))) continue;
    const key = comboKey(pair.legs);
    const old = existing.get(key);
    const oldOdds = old?.legs.every((leg) => Number(leg.odds) === Number(byKey.get(legKey(leg))?.odds));
    const id = "verified-" + createHash("sha256").update(JSON.stringify([key, pair.legs.map((leg) => Number(leg.odds)).sort()])).digest("hex").slice(0, 16);
    result.push({
      id: oldOdds ? old.id : id,
      title: "По подтверждённой форме",
      tier: "mid",
      legs: pair.legs,
      total_odds: pair.total,
      reason: pair.legs.every((leg) => leg.basis === "season")
        ? "NHL и ESPN подтверждают перевес обеих выбранных команд по доле очков за сезон. В трёх последних сверенных играх каждая выиграла не меньше соперника."
        : "Для каждого матча сверены три недавних результата обеих сторон. Выбор подкреплён либо преимуществом в двух победах, либо перевесом по очкам сезона без уступки по недавней форме.",
      weak_link: "Выборка короткая. Составы перед стартом и актуальность ранее опубликованных коэффициентов отдельно не подтверждены.",
    });
    keys.forEach((leg) => used.add(leg));
    if (result.length === 3) break;
  }
  return result;
}

export function selectMixedExpress(legs) {
  const groups = Map.groupBy([...new Map(legs.map((leg) => [matchKey(leg), leg])).values()], (leg) => leg.sport);
  for (const group of groups.values()) group.sort((a, b) => Date.parse(a.start_iso) - Date.parse(b.start_iso));
  const result = [];
  const usedSports = new Set();
  while (result.length < 2) {
    const available = [...groups.entries()].filter(([, group]) => group.length);
    const nonHockey = available.filter(([sport]) => sport !== "hockey");
    const preferred = nonHockey.length >= 2 ? nonHockey : available;
    const unused = preferred.filter(([sport]) => !usedSports.has(sport));
    const pool = unused.length >= 2 ? unused : preferred;
    pool.sort((a, b) => b[1].length - a[1].length ||
      Date.parse(a[1][0].start_iso) - Date.parse(b[1][0].start_iso) || a[0].localeCompare(b[0]));
    if (pool.length < 2) break;
    const pair = [pool[0][1].shift(), pool[1][1].shift()];
    pair.forEach((leg) => usedSports.add(leg.sport));
    const id = "mixed-" + createHash("sha256").update(comboKey(pair)).digest("hex").slice(0, 16);
    result.push({ id, title: "Экспресс из разных видов спорта", tier: "mid", forecast_only: true,
      legs: pair, total_odds: null,
      reason: "В каждом событии есть прогноз на исход, основанный на сверенных результатах. Обоснование доступно в карточке прогноза." });
  }
  return result;
}

export function buildUpdate({ current, indexFile, historyFiles, express, rows, standings = [], esportsForm = new Map(),
  tennisPreviews = new Map(), coverage, now }) {
  const at = H.toMskIso(new Date(now));
  const tomorrow = H.mskDateOf(new Date(now + DAY).toISOString());
  const until = Date.parse(`${tomorrow}T23:59:59.999+03:00`) + 1;
  const index = eventIndex(rows);
  const context = { hockey: checkedStandings(standings.filter((row) => !row.kind)), volley: checkedVolleyTable(standings),
    tennis: new Map(standings.filter((row) => row.kind === "tennis" && row.updated <= now && row.updated >= now - 14 * DAY)
      .map((row) => [team(row.name), row])), tennisPreviews, esportsForm };
  const analysis = [];
  const sportsReport = {};
  const exclusions = [];
  const surviving = new Set();
  const expressLegs = [];
  const forecastSports = [];
  const pickKey = (sport, p) => JSON.stringify([sport, p.match, p.bet]);
  const sports = SPORTS.map(([id, name, emoji, missing]) => {
    const upcoming = selectUpcoming(index, id, now, until);
    const old = current.sports.find((s) => s.id === id);
    const events = [];
    const picks = [];
    const generated = [];
    const articles = [];
    const assessed = upcoming.map(({ row, evidence }) => ({
      row, evidence, detail: analysisFor(index, context, row, evidence, name, missing, now),
    }));
    const tier = ({ evidence }) => evidence.find((source) => source.tier)?.tier ?? 6;
    const selected = id === "football" ? assessed.filter(({ detail }) => detail.sample >= 2).sort(rankByEvidence).slice(0, FOOTBALL_LIMIT)
      : id === "cs2" ? assessed.filter(({ evidence }) => evidence.filter((item) => item.format).length >= 2)
        .sort((a, b) => tier(a) - tier(b) || rankByEvidence(a, b)).slice(0, CS2_LIMIT) : assessed;
    for (const { row, evidence, detail } of selected) {
      const { article } = detail;
      const matched = (old?.picks || []).filter((pick) => {
        const target = targetFor(id, pick.match, pick.start_iso, pick.tournament);
        const win = H.normBet(pick.bet).match(/^п([12])$/iu)?.[1];
        const supported = win && detail.wins[Number(win) - 1] > detail.wins[2 - Number(win)];
        const marketSupported = pick.market && detail.market && H.normBet(pick.bet) === H.normBet(detail.market.bet);
        const stillSupported = !pick.generated || (pick.market ? marketSupported : detail.forecastSide === Number(win) - 1);
        return pick.bet && stillSupported && (id !== "football" || marketSupported || supported) && orientation(row, target) === 1 &&
          evidence.every((r) => Math.abs(target.start - r.start) <= 5 * MINUTE);
      });
      if (matched.length) {
        article.match = matched[0].match;
        for (const pick of matched) {
          picks.push(pick);
          surviving.add(pickKey(id, pick));
          const basis = qualifiedLeg(id, pick, detail);
          if (basis) {
            expressLegs.push({ sport: id, match: pick.match, bet: pick.bet, start_iso: pick.start_iso,
              start: pick.start, odds: String(pick.odds).replace(",", "."), confidence: pick.confidence, basis });
          }
        }
      }
      const forecast = matched.length ? null : forecastFrom(detail, row, now);
      if (forecast) {
        generated.push(forecast);
        picks.push(forecast);
      }
      events.push({ match: article.match, tournament: article.tournament, start: article.start, start_iso: article.start_iso,
        format: article.format, sources: evidence.map(link), has_pick: Boolean(matched.length || forecast) });
      articles.push(article);
    }
    for (const pick of old?.picks || []) {
      if (Date.parse(pick.start_iso) > now && !surviving.has(pickKey(id, pick))) exclusions.push({ sport: id, match: pick.match, start: pick.start_iso });
    }
    // Publish detailed analysis for the first verified match in each category and
    // for any additional match with a sourced outlook or an existing forecast.
    analysis.push(...articles.filter((a, i) => i === 0 || id === "football" || id === "cs2" ||
      events[i].has_pick || selected[i].detail.hasOutlook));
    const candidates = [...index.values()].flat().filter((e) => e.sport === id && e.status === "scheduled" && e.start > now && e.start < until);
    const publishers = coverage[id];
    const availability = publishers.length < 2 ? "unavailable" : events.length ? "verified" :
      upcoming.length ? "insufficient_quality" : candidates.length ? "unconfirmed" : "empty";
    const rowsByPublisher = Object.fromEntries([...Map.groupBy(candidates, (row) => row.source)].map(([source, matches]) => [source, matches.length]));
    sportsReport[id] = { publishers, rowsByPublisher, confirmed: upcoming.length, selected: events.length, picks: picks.length,
      generated: generated.length, markets: picks.reduce((types, pick) => {
        const kind = pick.market?.kind || "outcome";
        return { ...types, [kind]: (types[kind] || 0) + 1 };
      }, {}), availability };
    if (generated.length) forecastSports.push({ id, name, picks: generated });
    return { id, name, emoji, picks, events, availability, updated_at: at };
  });
  const pricedExpress = selectExpress(current.express || [], expressLegs);
  const mixedLegs = sports.flatMap((sport) => sport.picks.filter((pick) => pick.generated && Date.parse(pick.start_iso) > now + PUBLISH_BUFFER)
    .map((pick) => ({ sport: sport.id, match: pick.match, bet: pick.bet, start_iso: pick.start_iso,
      start: pick.start, confidence: pick.confidence, odds: null })));
  const mixedExpress = selectMixedExpress(mixedLegs);
  const activeExpress = [...mixedExpress, ...pricedExpress];
  const hasNew = (model) => forecastSports.some((sport) => sport.picks.some((pick) => pick.generated === model));
  const next = { updated_at: at, source: "sports-update", model_version: hasNew(MARKET_MODEL) ? MARKET_MODEL : hasNew(FORM_MODEL) ? FORM_MODEL : current.model_version,
    sports, analysis, express: activeExpress };

  const history = H.mergeMonths(historyFiles);
  const ids = new Set(history.predictions.map((e) => e.id));
  const missingArchive = { ...current, sports: current.sports.map((s) => ({ ...s, picks: s.picks.filter((pick) => {
    const date = pick.start_iso ? H.mskDateOf(pick.start_iso) : H.parseStart(pick.start, current.updated_at).date;
    return !ids.has(H.makeId(s.id, date, pick.match, pick.bet));
  }) })) };
  const archive = H.archive(history, missingArchive, current.updated_at, { modelVersion: current.model_version });
  const archivedPicks = [FORM_MODEL, MARKET_MODEL].flatMap((modelVersion) => H.archive(history, {
    sports: forecastSports.map((sport) => ({ ...sport, picks: sport.picks.filter((pick) => pick.generated === modelVersion) })),
  }, at, { modelVersion, reason: "Пересмотр по сверенным результатам до начала матча" }).added);
  // Existing picks may be omitted from the day's cards when their fixture is
  // unconfirmed. Keep those bets intact in the archive for subsequent settlement.
  const due = H.dueForCheck(history, now).filter((e) => !e.late);
  const results = due.map((e) => resultFor(index, e)).filter(Boolean).filter((r) => {
    const entry = due.find((e) => e.id === r.id);
    return entry.status !== H.STATUS.postponed || r.status !== H.STATUS.postponed;
  });
  const resultReport = H.applyResults(history, results, at);
  const expressIds = new Set(express.expresses.map((item) => item.id));
  const additions = current.express?.filter((item) => !expressIds.has(item.id)) || [];
  const expressUpdate = H.syncExpress({ ...express, expresses: [] }, history, { express: additions }, current.updated_at);
  additions.forEach((item) => expressIds.add(item.id));
  const published = H.syncExpress({ ...express, expresses: [] }, history,
    { express: activeExpress.filter((item) => !expressIds.has(item.id)) }, at);
  expressUpdate.report.added.push(...published.report.added);
  const touched = new Set([...resultReport.updated, ...resultReport.review]);
  const historicalExpress = express.expresses.map((item) => {
    if (item.status !== "pending" || !item.legs.some((leg) => touched.has(leg.hid ||
      H.makeId(leg.sport, H.mskDateOf(leg.start_iso), leg.match, leg.bet)))) return item;
    const updated = structuredClone(item);
    if (H.settleExpress(updated, history)) expressUpdate.report.settled.push(updated.id);
    return updated;
  });
  expressUpdate.store.expresses = [...historicalExpress, ...expressUpdate.store.expresses, ...published.store.expresses];
  const months = H.splitByMonth(history);
  const nextIndex = { ...indexFile, months: Object.keys(months).sort() };
  const descriptions = [
    { id: FORM_MODEL, title: "v5 — сверенная форма и результаты сезона",
      note: "Прогноз на исход по сверенным результатам. Без численной вероятности и автоматически назначенного коэффициента." },
    { id: MARKET_MODEL, title: "v6 — тоталы, форы и рынки счёта",
      note: "Условия проверены на сверенных счетах. Правила расчёта, порог и источник линии указаны в прогнозе." },
  ];
  const newModels = descriptions.filter((model) => hasNew(model.id) && !nextIndex.models?.some((prior) => prior.id === model.id))
    .map((model) => ({ ...model, from: H.mskDateOf(at) }));
  if (newModels.length) {
    nextIndex.models = [...(nextIndex.models || []), ...newModels];
    nextIndex.updated_at = at;
  }
  if (JSON.stringify(nextIndex.months) !== JSON.stringify(indexFile.months)) nextIndex.updated_at = at;
  return { next, nextIndex, months, express: expressUpdate.store,
    report: { sports: sportsReport, exclusions, analysis: analysis.length,
      express: { current: activeExpress.length, mixed: mixedExpress.length, eligibleLegs: expressLegs.map(({ sport, match }) => ({ sport, match })), ...expressUpdate.report },
      history: { archived: archive.added.length, newForecasts: archivedPicks.length, due: due.length, unresolved: due.length - results.length,
        awaitingEvidence: due.filter((entry) => !results.some((r) => r.id === entry.id))
          .map(({ id, sport, match, start_iso }) => ({ id, sport, match, start_iso })),
        checked: results.map(({ id, status, score }) => ({ id, status, score })), ...resultReport } } };
}
