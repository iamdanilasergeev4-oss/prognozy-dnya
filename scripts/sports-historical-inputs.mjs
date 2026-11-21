import { DAY } from "./sports-research-history.mjs";

const id = (value) => (typeof value === "string" || Number.isSafeInteger(value)) &&
  /^[\w:.-]+$/.test(String(value)) ? String(value) : null;
const pair = (value) => Array.isArray(value) && value.length === 2;
const date = (value) => {
  const start = Date.parse(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(start) &&
    new Date(start).toISOString().slice(0, 10) === value ? start : NaN;
};

function ordered(event) {
  if (event.home < event.away || event.sport === "volleyball") return event;
  return { ...event, home: event.away, away: event.home, score: [...event.score].reverse(),
    ...(event.rosters ? { rosters: [...event.rosters].reverse() } : {}) };
}

function csvLine(line) {
  return [...line.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^",]*))/g)]
    .map((match) => match[1]?.replaceAll('""', '"') ?? match[2]);
}

export function tennisSingles(csv, tour) {
  if (!["ATP", "WTA"].includes(tour)) throw new Error("Unknown tour");
  const [header, ...lines] = csv.replace(/^\ufeff/, "").trimEnd().split(/\r?\n/);
  const fields = csvLine(header);
  const required = ["tourney_id", "tourney_date", "tourney_level", "surface", "match_num",
    "winner_id", "loser_id", "best_of", "score"];
  if (!required.every((field) => fields.includes(field)) || fields.some((field) =>
    /^(winner|loser)(?:_[12]|[12])_/.test(field))) throw new Error("Expected a singles CSV");
  return lines.filter(Boolean).map((line) => {
    const cells = csvLine(line);
    if (cells.length !== fields.length) return null;
    const get = (field) => cells[fields.indexOf(field)];
    const level = get("tourney_level");
    // Team events and entries with unknown tournament duration are excluded.
    if (!(tour === "ATP" ? /^[GMAF]$/ : /^[GPMIF]$/).test(level)) return null;
    const tournament = id(get("tourney_id"));
    const match = id(get("match_num"));
    const start = date(get("tourney_date").replace(/^(\d{4})(\d\d)(\d\d)$/, "$1-$2-$3"));
    const home = id(get("winner_id"));
    const away = id(get("loser_id"));
    const surface = get("surface").toLowerCase();
    const bestOf = Number(get("best_of"));
    if (!tournament || !match || !Number.isFinite(start) || !home || !away || home === away ||
        !["hard", "clay", "grass", "carpet"].includes(surface) || ![3, 5].includes(bestOf)) return null;
    const sets = get("score").trim().split(/\s+/).map((set) => set.match(/^(\d+)-(\d+)(?:\(\d+\))?$/));
    if (sets.some((set) => !set || Number(set[1]) === Number(set[2]))) return null;
    const score = [0, 0];
    const needed = (bestOf + 1) / 2;
    for (const [, a, b] of sets) {
      const high = Math.max(a, b);
      const low = Math.min(a, b);
      const complete = high === 6 && low <= 4 || high === 7 && [5, 6].includes(low) ||
        high >= 8 && high - low === 2;
      if (!complete || Math.max(...score) === needed) return null;
      score[Number(a) > Number(b) ? 0 : 1]++;
    }
    if (score[0] !== needed) return null;
    // tourney_date is the tournament date, not the day of this match.
    return ordered({ id: `${tour}:${tournament}:${match}`, sport: "tennis", tour, level,
      competition: `${tour}:${tournament.replace(/^\d{4}-/, "")}`,
      season: String(new Date(start).getUTCFullYear()), start, available: start + 30 * DAY,
      rules: `singles:${surface}:BO${bestOf}`, surface, home, away, score });
  });
}

export function verifiedResult(row, sport, origin) {
  if (!["cs2", "dota2", "volleyball"].includes(sport) || !row || typeof row !== "object") return null;
  const sourceId = id(row.id);
  const home = id(row.home);
  const away = id(row.away);
  const competition = id(row.competition);
  const season = id(row.season);
  const start = date(row.date);
  const end = date(row.completedDate);
  const startTime = row.startedAt == null ? start : Date.parse(row.startedAt);
  const endTime = row.endedAt == null ? end : Date.parse(row.endedAt);
  const score = row.score;
  if (!sourceId || !home || !away || home === away || !competition || !season ||
      !Number.isFinite(start) || !Number.isFinite(end) || end < start || row.status !== "completed" ||
      !Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime ||
      Math.floor(startTime / DAY) * DAY !== start || Math.floor(endTime / DAY) * DAY !== end ||
      !pair(score) || score.some((n) => !Number.isSafeInteger(n) || n < 0)) return null;
  let rosters;
  let rules;
  if (sport === "volleyball") {
    const [firstYear, lastYear = firstYear] = season.split("-").map(Number);
    const matchYear = new Date(start).getUTCFullYear();
    if (row.unit !== "match" || !Array.isArray(row.sets) || row.sets.length < 3 || row.sets.length > 5 ||
        !/^\d{4}(?:-\d{4})?$/.test(season) || lastYear - firstYear !== Number(season.includes("-")) ||
        matchYear < firstYear || matchYear > lastYear) return null;
    const tally = [0, 0];
    for (const [index, set] of row.sets.entries()) {
      if (tally.includes(3) || !pair(set) || set.some((n) => !Number.isSafeInteger(n) || n < 0)) return null;
      const target = index === 4 ? 15 : 25;
      if (Math.max(...set) !== Math.max(target, Math.min(...set) + 2)) return null;
      tally[set[0] > set[1] ? 0 : 1]++;
    }
    if (Math.max(...tally) !== 3 || tally.some((n, index) => n !== score[index])) return null;
    rules = "BO5";
  } else {
    const bestOf = Number(row.bestOf);
    const winner = Math.max(...score);
    const loser = Math.min(...score);
    if (row.unit !== "series" || (row.patch != null && !id(row.patch)) ||
        (bestOf === 2 && sport === "dota2" ? winner + loser !== 2 :
          ![1, 3, 5].includes(bestOf) || winner !== (bestOf + 1) / 2 || loser >= winner)) return null;
    rules = `BO${bestOf}`;
    if (row.rosters != null) {
      if (!pair(row.rosters) || row.rosters.some((players) => !Array.isArray(players) || players.length !== 5)) return null;
      rosters = row.rosters.map((players) => players.map(id).sort());
      if (rosters.flat().includes(null) || new Set(rosters.flat()).size !== 10) return null;
    }
  }
  return ordered({ id: `${origin}:${sourceId}`, sport, start: startTime, end: endTime, available: endTime + 2 * DAY,
    home: `${origin}:${home}`, away: `${origin}:${away}`, competition: `${origin}:${competition}`,
    season, score, rules,
    patch: sport === "volleyball" ? undefined : id(row.patch), ...(rosters ? { rosters } : {}) });
}
