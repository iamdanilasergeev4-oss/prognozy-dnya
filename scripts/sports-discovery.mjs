const DAY = 86_400_000;
const dayInMoscow = (time) => new Date(time + 3 * 3_600_000).toISOString().slice(0, 10);
export const normalizeIdentity = (value) => String(value || "").normalize("NFKC").toLowerCase()
  .replace(/[\s\p{P}]+/gu, " ").trim();

// Only competition-specific equivalents. Reserve, youth and academy suffixes
// remain part of participant names.
const competitions = [
  ["eng1", "professional_major", "GB", ["Premier League", "English Premier League"]],
  ["eng2", "professional_mid", "GB", ["Championship", "English League Championship", "EFL Championship"]],
  ["eng3", "lower_division", "GB", ["League One", "English League One", "EFL League One"]],
  ["eng4", "lower_division", "GB", ["League Two", "English League Two", "EFL League Two"]],
  ["deu2", "professional_mid", "DE", ["2. Bundesliga", "German 2. Bundesliga", "2 Bundesliga"]],
  ["deu3", "lower_division", "DE", ["3. Liga", "German 3. Liga"]],
  ["esp2", "professional_mid", "ES", ["Segunda División", "Spanish LALIGA 2", "LaLiga 2", "LaLiga Hypermotion"]],
];
export const germanLeagues = [
  ["deu2", "bl2", "2. Bundesliga", "professional_mid"],
  ["deu3", "bl3", "3. Liga", "lower_division"],
  ["deu4b", "regio-bayern", "Regionalliga Bayern", "regional"],
  ["deu4n", "rln", "Regionalliga Nord", "regional"],
  ["deu4e", "rlno", "Regionalliga Nordost", "regional"],
  ["deu5n", "nofvon", "NOFV Oberliga Nord", "regional"],
  ["deu5s", "nofvos", "NOFV Oberliga Süd", "regional"],
];
const extraNames = germanLeagues.slice(2).map(([id, , name, level]) => [id, level, "DE", [name, `German ${name}`]]);

export const sourceRegistry = [{
  name: "openfootball", address: "https://github.com/openfootball/football.json",
  type: ["calendar dates", "season scores"], sports: ["football"], countries: ["GB", "DE", "ES"],
  license: "CC0-1.0", update: "upstream dependent", reliability: "calendar leads only",
}, {
  name: "OpenLigaDB", address: "https://www.openligadb.de/en/terms-of-use",
  type: ["calendar", "scores"], sports: ["football"], countries: ["DE"],
  license: "ODbL-1.0", reliability: "community; independent confirmation required",
}, {
  name: "OpenDota", address: "https://docs.opendota.com/",
  type: ["completed maps"], sports: ["dota2"], reliability: "map statistics, not a series fixture feed",
}];

const paths = { eng1: "en.1", eng2: "en.2", eng3: "en.3", eng4: "en.4",
  deu2: "de.2", deu3: "de.3", esp2: "es.2" };
const entries = (items) => items.flatMap(([id, level, country, names]) =>
  names.map((name) => [normalizeIdentity(name), { id, level, country }]));
const scopedNames = new Map(entries(competitions));
const regionalNames = new Map(entries(extraNames));

export function competitionOf(row, regional = false) {
  const tournament = normalizeIdentity(row.tournament);
  if (regional && row.leagueIdentity) return { id: row.leagueIdentity, level: "unknown", country: null };
  const known = scopedNames.get(tournament) || (regional && regionalNames.get(tournament));
  if (row.sport === "football" && known &&
      (row.country === known.country || !row.country && /^(?:english|efl|german|spanish) /.test(tournament))) return known;
  if (row.sport === "hockey" && (row.league === "nhl" || ["nhl", "national hockey league"].includes(tournament))) {
    return { id: "nhl", level: "professional_major", country: null };
  }
  if (row.sport === "basketball" && ["nba", "national basketball association"].includes(tournament)) {
    return { id: "nba", level: "professional_major", country: null };
  }
  return { id: [row.country, tournament].filter(Boolean).join("/"), level: "unknown", country: row.country || null };
}

export function europeanSeason(time) {
  const date = new Date(time);
  const first = date.getUTCFullYear() - Number(date.getUTCMonth() < 6);
  return `${first}-${String(first + 1).slice(-2)}`;
}

export function calendarJobs(now) {
  const season = europeanSeason(now);
  const days = new Set([dayInMoscow(now), dayInMoscow(now + DAY)]);
  return competitions.map(([competition, level, country]) => {
    const filename = paths[competition];
    const url = ["de.2", "de.3"].includes(filename)
      ? `https://openfootball.github.io/deutschland/openliga_${season}_${filename}.json`
      : indexedOpenFootballUrl(filename, season);
    return { competition, url, parse(data) {
      if (!Array.isArray(data.matches)) throw new Error("Неизвестный формат календаря openfootball");
      return data.matches.filter((match) => days.has(match.date) && !match.score?.ft && !Array.isArray(match.score) &&
        normalizeIdentity(match.team1) && normalizeIdentity(match.team2) &&
        normalizeIdentity(match.team1) !== normalizeIdentity(match.team2))
        .map((match) => ({ sport: "football", competition, tier: level, country, season,
          date: match.date, start: null, home: match.team1, away: match.team2, status: "date_only",
          sources: [{ title: "openfootball", url }] }));
    } };
  });
}

function dateOf(row) {
  return dayInMoscow(row.start);
}

function pairKey(row) {
  return [normalizeIdentity(row.home), normalizeIdentity(row.away)].sort().join("|");
}

function claimSeason(row) {
  const season = row.season == null ? null : String(row.season);
  if (row.sport !== "football" || row.country !== "DE" || !season) return season;
  const expected = europeanSeason(row.start);
  const first = expected.slice(0, 4);
  const next = String(Number(first) + 1);
  return [first, expected, `${first}-${next}`, `${first}/${next}`, `${first}/${expected.slice(-2)}`].includes(season) ?
    expected : season;
}

export function discover(rows, { now, until, improved = false }) {
  const valid = rows.filter((row) => row.id && row.source && row.sport &&
    Number.isFinite(row.start) && normalizeIdentity(row.home) && normalizeIdentity(row.away) &&
    normalizeIdentity(row.home) !== normalizeIdentity(row.away) && normalizeIdentity(row.tournament) &&
    /^https:\/\//i.test(row.url || ""));
  const claims = improved ? reconcileClaims(valid, normalizeIdentity).map((row) => ({ ...row, season: claimSeason(row) })) : valid;
  const competitionFor = (row) => competitionOf(row, improved);
  const indexedPairs = Map.groupBy(claims, (row) => JSON.stringify([row.sport, pairKey(row)]));
  const grouped = Map.groupBy(claims, (row) => JSON.stringify([row.sport, competitionFor(row).id, pairKey(row)]));
  const events = [];
  const results = [];
  const researchResults = [];
  const byCompetition = new Map();
  for (const group of grouped.values()) {
    const sorted = group.sort((a, b) => a.start - b.start);
    while (sorted.length) {
      const first = sorted.shift();
      if (first.start >= until) break;
      const near = sorted.filter((row) => row.start - first.start <= 15 * 60_000);
      sorted.splice(0, near.length);
      const cluster = [first, ...near];
      const bySource = Map.groupBy(cluster, (row) => row.source);
      const ambiguous = [...bySource.values()].some((claims) => new Set(claims.map((row) =>
        JSON.stringify([row.id, row.start, row.status, row.format, row.score, row.season, row.patch, row.surface,
          row.participantIds]))).size > 1);
      const claims = [...bySource.values()].map(([row]) => row);
      const home = normalizeIdentity(first.home);
      const away = normalizeIdentity(first.away);
      const scoreInOrder = (row) => normalizeIdentity(row.home) === home ? row.score : row.score?.slice().reverse();
      const aligned = claims.every((row) => normalizeIdentity(row.home) === home);
      const consistent = (field) => new Set(claims.map((row) => row[field]).filter(Boolean)).size < 2;
      const explicitSeason = claims.find((row) => row.season)?.season;
      const consistentContext = ["format", "surface", "season", "patch"].every(consistent);
      const format = claims[0].format && claims.every((row) => row.format === claims[0].format) ? claims[0].format : null;
      const patch = claims[0].patch && claims.every((row) => row.patch === claims[0].patch) ? claims[0].patch : null;
      const surface = claims[0].surface && claims.every((row) => row.surface === claims[0].surface) ? claims[0].surface : null;
      const competition = competitionFor(first);
      const season = europeanSeason(first.start);
      const scopedSeason = first.sport === "football" && competition.level !== "unknown";
      const generic = !competition.country && /^(?:premier league|championship|regional league|division \d+|a league|league \d+)$/i
        .test(competition.id);
      const matchingStatus = claims.every((row) => row.status === first.status);
      const matchingTime = first.sport !== "tennis" || cluster.at(-1).start - first.start <= 300_000;
      const matchingSides = !improved || first.sport !== "football" || aligned;
      const confirmed = !ambiguous && !generic && claims.length >= 2 && consistentContext && matchingStatus && matchingTime && matchingSides;
      const related = indexedPairs.get(JSON.stringify([first.sport, pairKey(first)]))
        .filter((row) => row.source !== first.source && Math.abs(row.start - first.start) <= 3 * 3_600_000);
      const competingDate = improved && first.sport === "football" && explicitSeason &&
        group.some((row) => row.source !== first.source && row.season === explicitSeason &&
          row.start !== first.start && Math.abs(row.start - first.start) <= 2 * DAY);
      const verificationReason = confirmed ? null : ambiguous ? "duplicate_source_ids" : !consistentContext ? "context_conflict" :
        !matchingStatus ? "status_conflict" : !matchingSides ? "home_away_conflict" : !matchingTime ? "time_conflict" : generic ? "ambiguous_competition" :
        competingDate || related.some((row) => competitionFor(row).id === competition.id) ? "time_conflict" :
        related.length ? "competition_mismatch" : "single_publisher";
      const event = { id: JSON.stringify([first.sport, competition.id, pairKey(first), first.start]),
        sport: first.sport, competition: competition.id, tournament: first.tournament, tier: competition.level,
        country: competition.country, season: scopedSeason
          ? !explicitSeason || [season, season.slice(0, 4)].includes(explicitSeason) ? season : null
          : explicitSeason || null,
        start: first.start, date: dateOf(first), home, away, match: first.displayMatch || `${first.home} — ${first.away}`,
        rules: ["cs2", "dota2"].includes(first.sport) ? format : surface,
        homeField: first.sport === "football" && aligned && claims.every((row) => row.homeField === true),
        patch, contextSource: claims.find((row) => row.contextSource)?.contextSource,
        sources: claims.map((row) => ({ title: row.source, id: row.id, url: row.url, origin: row.origin,
          reportedStart: row.start, reportedStatus: row.status, format: row.format, surface: row.surface,
          researchFormat: row.researchFormat ? `BO${row.researchFormat}` : null,
          reportedScore: scoreInOrder(row), extra: row.extra,
          sourceCompetitionId: row.sourceCompetitionId, participantIds: normalizeIdentity(row.home) === home
            ? row.participantIds : row.participantIds?.slice().reverse() })),
        verificationReason,
        status: confirmed ? "confirmed" : ambiguous || !consistentContext || !matchingStatus || !matchingSides
          ? "conflict" : "unconfirmed",
      };
      if (cluster.every((row) => row.start > now) && cluster.some((row) => row.status === "scheduled")) {
        events.push(event);
        const key = JSON.stringify([event.sport, competition.id]);
        const record = byCompetition.get(key) || { sport: event.sport, competition: competition.id, tier: event.tier, confirmed: 0, detected: 0 };
        record.detected++;
        record.confirmed += Number(confirmed);
        byCompetition.set(key, record);
      }
      const score = scoreInOrder(first);
      // The start time alone does not prove when a result became available.
      // Keep a full day of separation from the latest claimed start.
      if (confirmed && cluster.at(-1).start + DAY < now && event.season && first.status === "finished" &&
          score && claims.every((row) => !row.extra || first.sport !== "football") &&
          claims.every((row) => JSON.stringify(scoreInOrder(row)) === JSON.stringify(score))) {
        results.push({ ...event, score });
      }
      const scored = claims.find((row) => row.score);
      const researchScore = scored && scoreInOrder(scored);
      if (first.status === "finished" && cluster.at(-1).start + DAY < now && researchScore &&
          !ambiguous && matchingStatus && matchingTime && consistentContext && matchingSides &&
          claims.every((row) => (!row.extra || first.sport !== "football") &&
            (!row.score || JSON.stringify(scoreInOrder(row)) === JSON.stringify(researchScore)))) {
        researchResults.push({ ...event, score: researchScore });
      }
    }
  }
  return { events, results: results.sort((a, b) => a.start - b.start), researchResults, competitions: [...byCompetition.values()] };
}
import { reconcileClaims } from "./sports-reconciliation.mjs";
import { indexedOpenFootballUrl } from "./sports-openfootball.mjs";
