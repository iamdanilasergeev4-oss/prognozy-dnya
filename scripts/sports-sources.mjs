const SCORES = "https://webws.365scores.com/web/games/";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports";
const VOLLEY = "https://www.legavolley.it/calendario/?lang=en";
const ENSIGAME = "https://ensigame.com/matches";
const NHL_STANDINGS = "https://api-web.nhle.com/v1/standings/now";
const ESPN_NHL_STANDINGS = "https://site.api.espn.com/apis/v2/sports/hockey/nhl/standings";
const LEGA_TABLE = "https://www.legavolley.it/classifica/?lang=en";
const WORLD_TABLE = "https://it.volleyballworld.com/volleyball/competitions/superlega/standings/";
const scoreSports = { 1: "football", 2: "basketball", 3: "tennis", 4: "hockey", 8: "volleyball" };
const countryCodes = { England: "GB", Germany: "DE", Spain: "ES" };
const espnFeeds = {
  football: ["soccer/all"],
  basketball: ["basketball/nba", "basketball/wnba", "basketball/euroleague"],
  tennis: ["tennis/atp", "tennis/wta"],
  hockey: ["hockey/nhl"],
  volleyball: ["volleyball/womens-college-volleyball"],
};

const nonnegative = (value) => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value));
const score = (home, away) => nonnegative(home) && nonnegative(away) ? [Number(home), Number(away)] : null;
const states = {
  scheduled: /^(scheduled|not started|ns|upcoming|status_scheduled)$/,
  finished: /^(ended|just ended|final(?:\/ot|\/so)?|status_(?:final(?:_ot|_so)?|full_time)|finished|ft|aot|ap)$/,
  postponed: /^(postponed|pst|status_postponed)$/,
  cancelled: /^(cancelled|canceled|canc|status_canceled|status_cancelled)$/,
};

function state(value) {
  return Object.keys(states).find((key) => states[key].test(String(value ?? "").trim().toLowerCase())) || "other";
}

function list(value) {
  if (!Array.isArray(value)) throw new Error("Неизвестный формат списка событий");
  return value;
}

function event(source, sport, id, home, away, start, tournament, status, url, options = {}) {
  if (!id || !home || !away || !tournament || !Number.isFinite(start)) return null;
  if ([home, away].some((name) => /^(?:tbd|tba|bye|unknown|winner|loser)(?:\b|$)/i.test(name))) return null;
  if (sport === "football" && source === "365Scores" && tournament === "Saudi League" && options.sourceCountry === "Saudi Arabia") {
    const labels = { "Abha Club": "Abha", "Al Shabab Riyadh": "Al Shabab", "Al Riyadh SC": "Al Riyadh",
      "Al Faysaly": "Al Faisaly", "Diriyah": "Al Diriyah" };
    home = labels[home] || home;
    away = labels[away] || away;
  }
  if (sport === "dota2" && /^(EPL SEA|EPL World Series Southeast Asia)$/i.test(tournament)) {
    if (home === "Direborn Esports") home = "Direborn";
    if (away === "Direborn Esports") away = "Direborn";
  }
  return { source, sport, id: String(id), home, away, start, tournament, status, url, ...options };
}

export function parseScores(data, day, feedUrl = SCORES) {
  const games = list(data.games);
  const countries = new Map(Array.isArray(data.countries) ? data.countries.map((row) => [row?.id, row?.name]) : []);
  const competitions = new Map(Array.isArray(data.competitions)
    ? data.competitions.map((row) => [row?.id, countries.get(row?.countryId)]) : []);
  if (!games.some((g) => g.startTime?.slice(0, 10) === day)) {
    throw new Error("Лента вернула другую дату");
  }
  return games.filter((g) => scoreSports[g.sportId] && g.startTime?.slice(0, 10) === day).map((g) => {
    const home = g.homeCompetitor;
    const away = g.awayCompetitor;
    const status = state(g.statusText);
    return event("365Scores", scoreSports[g.sportId], g.id, home?.name, away?.name, Date.parse(g.startTime),
      g.competitionDisplayName, status, feedUrl, {
        score: status === "finished" ? score(home?.score, away?.score) : null,
        extra: /\/OT|\/SO|after extra time|penalt/i.test(g.statusText || ""),
        league: g.sportId === 4 && g.competitionDisplayName === "NHL" ? "nhl" : null,
        country: g.sportId === 1 ? countryCodes[competitions.get(g.competitionId)] || null : null,
        sourceCountry: g.sportId === 1 ? competitions.get(g.competitionId) || null : null,
        sourceCompetitionId: g.competitionId,
        participantIds: [home?.id, away?.id],
      });
  }).filter(Boolean);
}

function parseEspnLines(competition, home, away, url) {
  const odds = Array.isArray(competition.odds) && competition.odds.find((item) => item?.provider?.name === "DraftKings");
  if (!odds) return null;
  const line = (value, prefix = "") => {
    if (typeof value !== "string" || !new RegExp(`^${prefix}[+-]?\\d+(?:\\.[05])?$`, "i").test(value)) return null;
    const result = Number(value.slice(prefix.length));
    return Number.isFinite(result) && Number.isInteger(result * 2) ? result : null;
  };
  const over = line(odds.total?.over?.close?.line, "o");
  const under = line(odds.total?.under?.close?.line, "u");
  const total = over !== null && over > 0 && over === under && over === odds.overUnder ? over : null;
  const homeLine = line(odds.pointSpread?.home?.close?.line);
  const awayLine = line(odds.pointSpread?.away?.close?.line);
  const handicap = homeLine !== null && awayLine !== null && homeLine === -awayLine &&
    String(odds.homeTeamOdds?.team?.id || home?.id) === String(home?.id) &&
    String(odds.awayTeamOdds?.team?.id || away?.id) === String(away?.id) ? [homeLine, awayLine] : null;
  return total !== null || handicap ? { total, handicap, source: "DraftKings через ESPN", url } : null;
}

export function parseEspn(data, sport, feed, url) {
  return list(data.events).flatMap((e) => {
    const singlesMainDraw = sport === "tennis" ? new Set(list(e.groupings)
      .filter((g) => g.grouping?.slug === "womens-singles")
      .flatMap((g) => list(g.competitions)).filter((match) =>
        /^(?:Round [1-9]|Quarterfinal|Semifinal|Final)$/.test(match.round?.displayName))) : null;
    const competitions = sport === "tennis"
      ? list(e.groupings).flatMap((g) => list(g.competitions))
      : list(e.competitions);
    return competitions.filter((c) => c.timeValid !== false).map((c) => {
      const home = c.competitors?.find((p) => p.homeAway === "home");
      const away = c.competitors?.find((p) => p.homeAway === "away");
      const college = ["basketball/mens-college-basketball", "basketball/womens-college-basketball"].includes(feed);
      const name = (p) => college && p?.team?.location ?
        p.team.location + (feed.includes("/womens-") ? " (W)" : "") :
        p?.team?.displayName || p?.athlete?.displayName || p?.roster?.displayName;
      const type = c.status?.type;
      const status = state(type?.name);
      const sets = (p) => Array.isArray(p?.linescores) && p.linescores.length && p.linescores.every((s) => typeof s.winner === "boolean")
        ? p.linescores.filter((s) => s.winner).length : null;
      const completedSets = sport === "tennis" && home?.linescores?.length === away?.linescores?.length &&
        home?.linescores?.every((set, i) => {
          const a = set.value, b = away.linescores[i].value;
          const hi = Math.max(a,b), lo = Math.min(a,b);
          return Number.isInteger(a) && Number.isInteger(b) && lo >= 0 &&
            ((hi === 6 && lo <= 4) || (hi === 7 && (lo === 5 || lo === 6))) &&
            set.winner === (a > b) && away.linescores[i].winner === (b > a);
        });
      const total = sport === "tennis" ? (completedSets ? score(sets(home), sets(away)) : null) : score(home?.score, away?.score);
      const regularHockey = sport === "hockey" && c.status?.period === 3;
      const gameUrl = e.links?.find((l) => /^https:\/\/(?:www\.)?espn\.com\//.test(l.href))?.href || url;
      const finalsSingles = sport === "tennis" && e.name === "Nitto ATP Finals" && home?.athlete && away?.athlete;
      const seasonYear = Number(e.season?.year);
      return event("ESPN", sport, c.id, name(home), name(away), Date.parse(c.startDate || c.date),
        sport === "tennis" ? e.name : c.altGameNote || data.leagues?.[0]?.name, status, gameUrl, {
          score: status === "finished" && type?.completed === true &&
            !(sport === "tennis" && /\b(?:retired|ret\.?|walkover|w\/o)\b/i.test((c.notes || []).map((n) => n.text).join(" "))) ? total : null,
          regulation: regularHockey ? total : null,
          extra: /overtime|shootout|penalt|extra time/i.test(type?.detail || "") || (sport === "hockey" && c.status?.period > 3),
          league: feed === "hockey/nhl" ? "nhl" : null,
          season: Number.isInteger(seasonYear) && seasonYear >= 1900
            ? String(seasonYear) : null,
          domesticLeague: sport === "football" && /^(English Premier League|LALIGA|Bundesliga|Serie A|Ligue 1|Eredivisie|Portuguese Primeira Liga)$/.test(c.altGameNote)
            ? c.altGameNote : null,
          participantIds: [home?.id, away?.id], neutralSite: c.neutralSite,
          ...(status === "scheduled" && ["football", "basketball", "hockey", "volleyball"].includes(sport) ? {
            records: [home, away].map((side) => Object.fromEntries((side?.records || [])
              .filter((r) => ["total", "home", "road"].includes(r.type) && /^\d+-\d+(?:-\d+)?$/.test(r.summary))
              .map((r) => [r.type, r.summary]))),
          } : {}),
          ...(singlesMainDraw?.has(c) ? { tennisMainDraw: true } : {}),
          format: finalsSingles ? "BO3" : null,
          markets: status === "scheduled" && ["football", "basketball", "hockey"].includes(sport)
            ? parseEspnLines(c, home, away, gameUrl) : null,
        });
    });
  }).filter(Boolean);
}

export function parseNhl(data) {
  return list(data.gameWeek).flatMap((day) => list(day.games)).map((g) => {
    const status = ({ FUT: "scheduled", FINAL: "finished", OFF: "finished" })[g.gameState] || "other";
    const schedule = ({ PPD: "postponed", CNCL: "cancelled" })[g.gameScheduleState] || status;
    const name = (t) => t?.placeName?.default && t?.commonName?.default && `${t.placeName.default} ${t.commonName.default}`;
    const total = schedule === "finished" ? score(g.homeTeam?.score, g.awayTeam?.score) : null;
    const period = g.gameOutcome?.lastPeriodType || g.periodDescriptor?.periodType;
    const season = /^\d{8}$/.test(String(g.season)) ? String(g.season).slice(-4) : null;
    return event("NHL", "hockey", g.id, name(g.homeTeam), name(g.awayTeam), Date.parse(g.startTimeUTC),
      "NHL", schedule, `https://www.nhl.com${g.gameCenterLink || "/scores/"}`, {
        score: total, regulation: period === "REG" ? total : null, extra: ["OT", "SO"].includes(period), league: "nhl", season,
      });
  }).filter(Boolean);
}

function standing(source, name, games, wins, points, season, url) {
  if (!name || ![games, wins, points].every(nonnegative) || !nonnegative(season) || !Number(games) ||
      Number(wins) > Number(games) || Number(points) > Number(games) * 2) return null;
  return { source, name, games: Number(games), wins: Number(wins), points: Number(points), season: Number(season), url };
}

export function parseNhlStandings(data) {
  return list(data.standings).map((row) => standing("NHL", row.teamName?.default, row.gamesPlayed, row.wins, row.points,
    /^\d{8}$/.test(String(row.seasonId)) ? String(row.seasonId).slice(-4) : null, NHL_STANDINGS)).filter(Boolean);
}

export function parseEspnNhlStandings(data) {
  return list(data.children).flatMap((section) => list(section.standings?.entries)).map((row) => {
    const stat = (key) => row.stats?.find(({ name }) => name === key)?.value;
    return standing("ESPN", row.team?.displayName, stat("gamesPlayed"), stat("wins"), stat("points"),
      data.season?.year, ESPN_NHL_STANDINGS);
  }).filter(Boolean);
}

export function parseTennisRankings(data, tour, url) {
  const ranking = list(data.rankings).find((row) => row.type === tour);
  if (!ranking || !Number.isFinite(Date.parse(ranking.update))) throw new Error("Не удалось определить дату рейтинга");
  return list(ranking.ranks).flatMap((row) => {
    const name = row.athlete?.displayName;
    if (!name || !nonnegative(row.current) || !nonnegative(row.points) || row.current < 1 || row.points < 1) return [];
    return [{ kind: "tennis", name, rank: Number(row.current), points: Number(row.points), tour: tour.toUpperCase(),
      updated: Date.parse(ranking.update), source: "ESPN", url }];
  });
}

export function parseVolleyTable(html, source) {
  const rows = html.split(/<tr\b/i).slice(1);
  const output = rows.flatMap((row) => {
    let name, games, wins;
    if (source === "Lega Pallavolo") {
      const named = row.match(/<span class="pos">\d+<\/span>(?:\s|&nbsp;)+([^<]+)<\/td>/);
      if (!named) return [];
      name = named[1].trim();
      const cells = [...row.slice(named.index + named[0].length).matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)]
        .map((m) => m[1].replace(/<[^>]*>/g, "").trim());
      [, games, wins] = cells;
    } else {
      name = row.match(/<a class=vbw-mu__team__name-link[^>]*data-text-fit-width[^>]*>([^<]+)<\/a>/)?.[1]?.trim();
      games = row.match(/headers="matches total\d+">\s*(\d+)/)?.[1];
      wins = row.match(/headers="matches won\d+">\s*(\d+)/)?.[1];
    }
    if (!name || !nonnegative(games) || !nonnegative(wins) || Number(wins) > Number(games)) return [];
    return [{ kind: "volleyball", name, games: Number(games), wins: Number(wins), source,
      url: source === "Lega Pallavolo" ? LEGA_TABLE : WORLD_TABLE }];
  });
  if (!output.length) throw new Error("Не найдена таблица Суперлиги");
  return output;
}

export function parseAtpHeadToHead(html, row, url) {
  const info = html.match(/<h3>What is the head-to-head record between ([^<]+?) and ([^<]+?)\?<\/h3>\s*<p>([^<]+?) leads (\d+)[–-](\d+)/i);
  if (!info) return null;
  const [, a, b, leader, wins, losses] = info;
  if (![a, b].includes(row.home) || ![a, b].includes(row.away) || ![a, b].includes(leader.trim())) return null;
  return { leader: leader.trim(), wins: Number(wins), losses: Number(losses), source: "Итоговый турнир ATP", url };
}

export function parseSportsDb(data) {
  return list(data.events === null ? [] : data.events).filter((g) => g.strSport === "Volleyball").map((g) => {
    const status = state(g.strStatus);
    const time = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(g.strTimestamp || "") ? g.strTimestamp + "Z" : g.strTimestamp;
    return event("TheSportsDB", "volleyball", g.idEvent, g.strHomeTeam, g.strAwayTeam, Date.parse(time),
      g.strLeague, status, `https://www.thesportsdb.com/event/${g.idEvent}`, {
        score: status === "finished" ? score(g.intHomeScore, g.intAwayScore) : null,
      });
  }).filter(Boolean);
}

const italyTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

function italianStart(date) {
  const parts = date.match(/(\d\d)\/(\d\d)\/(\d{4})[\s\S]*?(\d\d):(\d\d)/);
  if (!parts || parts[4] === "00" && parts[5] === "00") return NaN;
  const [, day, month, year, hour, minute] = parts;
  const local = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:00Z`);
  const label = `${day}/${month}/${year}, ${hour}:${minute}`;
  return [local - 3600e3, local - 7200e3].find((time) => italyTime.format(time) === label) ?? NaN;
}

export function parseLega(html) {
  const rows = [...html.matchAll(/<tr class="tab-gara">([\s\S]*?)<\/tr>/g)];
  if (!rows.length) throw new Error("Таблица Lega Pallavolo недоступна");
  const clean = (html) => html.replace(/<[^>]*>/g, " ").replaceAll("&nbsp;", " ").trim();
  return rows.map(([, row]) => {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => clean(m[1]));
    if (cells.length < 5) return null;
    const [id, date, home, result, away] = cells;
    const parsed = result.match(/^([0-3])\s*-\s*([0-3])$/);
    const final = parsed && ((parsed[1] === "3") !== (parsed[2] === "3"));
    return event("Lega Pallavolo", "volleyball", `${id}-${date}`, home, away, italianStart(date),
      "SuperLega", final ? "finished" : parsed?.[1] === "0" && parsed?.[2] === "0" ? "scheduled" : "other", VOLLEY,
      { format: "BO5", score: final ? score(parsed[1], parsed[2]) : null });
  }).filter(Boolean);
}

function readEmbeddedObject(text, key) {
  const start = text.indexOf(`"${key}":{`);
  if (start < 0) throw new Error("Данные расписания отсутствуют в разметке");
  const from = start + key.length + 3;
  let depth = 0;
  let quoted = false;
  for (let i = from; i < text.length; i++) {
    if (quoted && text[i] === "\\") { i++; continue; }
    if (text[i] === '"') quoted = !quoted;
    if (quoted) continue;
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return JSON.parse(text.slice(from, i + 1));
  }
  throw new Error("Неполные данные расписания");
}

export function parseGosu(html, sport, slug, mode) {
  const text = [...html.matchAll(/self\.__next_f\.push\((\[1,".*?"\])\)<\/script>/g)]
    .map((m) => JSON.parse(m[1])[1]).join("");
  const payload = readEmbeddedObject(text, "defaultMatches");
  return list(payload.matches).filter((g) => g.gameUrlSafeName === slug).map((g) => event(
    "GosuGamers", sport, g.matchId, g.team1Name, g.team2Name, g.startingAt, g.parentName, mode,
    `https://www.gosugamers.net/${slug}/tournaments/${g.parentId}-${g.parentUrlSafeName}/matches/${g.matchId}-${g.matchUrlSafeName}`,
    { score: mode === "finished" ? score(g.team1Score, g.team2Score) : null },
  )).filter(Boolean);
}

export function parseStrafe(html, sport, slug) {
  const json = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!json) throw new Error("Данные расписания Strafe отсутствуют в разметке");
  const props = JSON.parse(json).props.pageProps;
  return [...list(props.initialMatches), ...list(props.initialLiveMatches)].map((g) => {
    const home = g.competitors?.find((p) => p.side_enum === "HOME");
    const away = g.competitors?.find((p) => p.side_enum === "AWAY");
    const status = state(g.status);
    return event("Strafe", sport, g.id, home?.competitor?.name, away?.competitor?.name, Date.parse(g.start_time),
      g.tournament?.name, status, `https://www.strafe.com/match/${g.slug}/`, {
        score: status === "finished" ? score(home?.score, away?.score) : null,
        format: g.format?.match(/^Best of ([1357])$/i)?.[1] ? `BO${g.format.at(-1)}` : null,
          researchFormat: g.format?.match(/^(?:Best of\s+|BO)([1235])$/i)?.[1],
      });
  }).filter(Boolean);
}

export function parseEnsi(html, sport = "cs2") {
  const rows = [...html.matchAll(/<div class="hub-row" data-row-id="(\d+)"\s+data-day-at="([^"]+)"[^>]*>\s*<div class="w5-mc" data-state="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  if (!rows.length && !html.includes('class="w5-hub__day"')) throw new Error("Расписание Ensigame недоступно");
  return rows.map(([, id, start, currentStatus, body]) => {
    const matchLink = body.match(/href="(https:\/\/ensigame\.com\/matches\/(?:cs-2|dota-2)\/[^"]+)"/)?.[1];
    const url = matchLink?.includes(sport === "cs2" ? "/cs-2/" : "/dota-2/") ? matchLink : null;
    const names = ensiNames(body);
    const tournament = body.match(/class="w5-mc__tournament">([^<]+)<\/span>/)?.[1];
    const format = body.match(/class="w5-mc__format">bo([1357])<\/span>/i)?.[1];
    const tier = body.match(/class="[^"]*\bw5-mc__tier" title="Tier ([1-5])"/)?.[1];
    if (names.length !== 2 || !url) return null;
    const status = state(currentStatus);
    const scores = [...body.matchAll(/class="w5-mc__score">\s*(\d+)\s*<\/span>/g)].map((m) => m[1]);
    return event("Ensigame", sport, id, names[0], names[1], Date.parse(start),
      tournament, status, url, { format: format ? `BO${format}` : null, tier: tier ? Number(tier) : null,
        researchFormat: body.match(/class="w5-mc__format">bo([1235])<\/span>/i)?.[1],
        score: status === "finished" ? score(...scores) : null });
  }).filter(Boolean);
}

function ensiNames(body) {
  return [...body.matchAll(/class="w5-mc__name"\s+title="([^"]+)"/g)].map((m) =>
    m[1].replaceAll("&amp;", "&").replaceAll("&#039;", "'").trim());
}

export function parseEnsiResult(html, row) {
  const docs = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const match = docs.find((item) => item["@type"] === "SportsEvent" && item.url === row.url);
  const start = Date.parse(match?.startDate);
  if (!Number.isFinite(start) || start > row.start || row.start - start > 4 * 3600_000) {
    throw new Error("Не подтверждено время начала завершённой серии");
  }
  return { ...row, start, tournament: match.organizer?.name || row.tournament };
}

export function parseEnsiForm(html) {
  return [...html.matchAll(/<a class="w5-mc__link"\s+href="(https:\/\/ensigame\.com\/matches\/(?:cs-2|dota-2)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .flatMap(([, url, body]) => {
      if (!/class="w5-mc__note">\s*Ended\s*<\/span>/.test(body)) return [];
      const names = ensiNames(body);
      const scores = [...body.matchAll(/class="w5-mc__score">\s*(\d+)\s*<\/span>/g)].map((m) => Number(m[1]));
      const ended = Date.parse(body.match(/<time datetime="([^"]+)"/)?.[1]);
      const format = body.match(/class="w5-mc__format">bo([1357])<\/span>/i)?.[1];
      if (names.length !== 2 || scores.length !== 2 || scores[0] === scores[1] || !Number.isFinite(ended) || !format) return [];
      if (Math.max(...scores) !== (Number(format) + 1) / 2) return [];
      return [{ url, names, scores, ended, winner: names[scores[0] > scores[1] ? 0 : 1], format: `BO${format}` }];
    });
}

export function parseStrafeForm(html) {
  const json = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!json) throw new Error("Недавние результаты Strafe недоступны");
  const recent = JSON.parse(json).props.pageProps.recentMatches;
  return [list(recent?.home), list(recent?.away)].map((team) => team.flatMap((series) => {
    const winners = series.competitors?.filter((p) => p.result_enum === "WIN") || [];
    const names = (series.competitors || []).map((p) => p.competitor?.name);
    const length = typeof series.format === "string" && series.format.match(/^(?:Best of\s+|BO)([12357])$/i)?.[1];
    return names.length === 2 && names.every(Boolean) && winners.length === 1 ?
      [{ names, winner: winners[0].competitor.name, format: length ? `BO${length}` : undefined }] : [];
  }));
}

export function sourceJobs(days, scheduleDays, footballDays = []) {
  const jobs = [];
  function add(source, sports, url, parse, day, html = false, standings = false, resultIndex = false, historicalOnly = false) {
    jobs.push({ source, sports, url, parse, day, html, standings, resultIndex, historicalOnly });
  }
  const physical = Object.values(scoreSports);
  for (const day of [...new Set([...days, ...footballDays])].sort()) {
    const footballOnly = !days.includes(day);
    const european = day.split("-").reverse().join("/");
    const args = new URLSearchParams({
      appTypeId: "5", langId: "1", timezoneName: "Etc/UTC", userCountryId: "1",
      startDate: european, endDate: european, sports: footballOnly ? "1,8" : "1,2,3,4,8",
    });
    const scoresUrl = `${SCORES}?${args}`;
    add("365Scores", footballOnly ? ["football", "volleyball"] : physical, scoresUrl, (data) => parseScores(data, day, scoresUrl), day);
    for (const [sport, feeds] of Object.entries(espnFeeds)) {
      if (footballOnly && sport !== "football") continue;
      for (const feed of feeds) {
        const url = `${ESPN}/${feed}/scoreboard?dates=${day.replaceAll("-", "")}&limit=1000`;
        add("ESPN", [sport], url, (data) => parseEspn(data, sport, feed, url), day);
      }
    }
    if (scheduleDays.includes(day)) {
      add("TheSportsDB", ["volleyball"],
        `https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=${day}&s=Volleyball`, parseSportsDb, day);
    }
  }
  // Dedicated boards cover fixtures omitted by the all-soccer and pro basketball boards.
  for (const day of scheduleDays) {
    for (const feed of ["soccer/eng.1", "soccer/eng.2", "soccer/uefa.champions", "soccer/uefa.europa",
      "soccer/uefa.europa.conf", "basketball/mens-college-basketball", "basketball/womens-college-basketball"]) {
      const sport = feed.startsWith("soccer/") ? "football" : "basketball";
      const group = feed.endsWith("college-basketball") ? "&groups=50" : "";
      const url = `${ESPN}/${feed}/scoreboard?dates=${day.replaceAll("-", "")}&limit=1000${group}`;
      add("ESPN", [sport], url, (data) => parseEspn(data, sport, feed, url), day);
    }
  }
  for (const day of [days[0], scheduleDays[0]]) {
    add("NHL", ["hockey"], `https://api-web.nhle.com/v1/schedule/${day}`, parseNhl, null, false, false, false, day !== scheduleDays[0]);
  }
  add("NHL", ["hockey"], NHL_STANDINGS, parseNhlStandings, null, false, true);
  add("ESPN", ["hockey"], ESPN_NHL_STANDINGS, parseEspnNhlStandings, null, false, true);
  for (const tour of ["atp", "wta"]) {
    const url = `${ESPN}/tennis/${tour}/rankings`;
    add("ESPN", ["tennis"], url, (data) => parseTennisRankings(data, tour, url), null, false, true);
  }
  add("Lega Pallavolo", ["volleyball"], LEGA_TABLE, (html) => parseVolleyTable(html, "Lega Pallavolo"), null, true, true);
  add("Volleyball World", ["volleyball"], WORLD_TABLE, (html) => parseVolleyTable(html, "Volleyball World"), null, true, true);
  add("Lega Pallavolo", ["volleyball"], VOLLEY, parseLega, null, true);
  for (const [sport, gosu, strafe] of [["cs2", "counterstrike", "csgo"], ["dota2", "dota2", "dota2"]]) {
    for (const [suffix, mode] of [["", "scheduled"], ["/results", "finished"]]) {
      add("GosuGamers", [sport], `https://www.gosugamers.net/${gosu}/matches${suffix}`,
        (html) => parseGosu(html, sport, gosu, mode), null, true, false, false, mode === "finished");
    }
    for (const suffix of ["", "completed/"]) {
      add("Strafe", [sport], `https://www.strafe.com/calendar/${strafe}/${suffix}`,
        (html) => parseStrafe(html, sport, strafe), null, true, false, false, Boolean(suffix));
    }
  }
  for (const [sport, slug] of [["cs2", "cs-2"], ["dota2", "dota-2"]]) {
    add("Ensigame", [sport], `${ENSIGAME}/${slug}`, (html) => parseEnsi(html, sport), null, true);
    for (const page of ["", "/page/2"]) add("Ensigame", [sport], `${ENSIGAME}/${slug}/results${page}`,
      (html) => parseEnsi(html, sport), null, true, false, true);
  }
  return jobs;
}
