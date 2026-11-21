export const MODEL_VERSION = "elo-outcomes-1";
const DAY = 86_400_000;

// Separate models by competition and rules. Format/surface is part of the
// cohort when known. Unknown values never borrow ratings from a known cohort.
const profiles = {
  football: { k: 24, draw: true },
  basketball: { k: 22, margin: 16 },
  tennis: { k: 24, margin: 2 },
  volleyball: { k: 24, margin: 2 },
  hockey: { k: 20, margin: 3 },
  cs2: { k: 24, margin: 2 },
  dota2: { k: 20, draw: true, margin: 2 },
};

const cohort = (event) => JSON.stringify([event.sport, event.competition, event.season, event.rules || "unknown", event.patch || null]);
const outcome = ([a, b]) => a > b ? "home" : a < b ? "away" : "draw";
const logistic = (difference) => 1 / (1 + 10 ** (-difference / 400));
const rating = () => ({ elo: 1500, games: 0, last: 0 });

function finishedSeries(sport, rules, score) {
  const [winner, loser] = [...score].sort((a, b) => b - a);
  if (sport === "cs2" || sport === "dota2") {
    const games = Number(rules?.slice(2));
    if (games === 2 && sport === "dota2") return winner + loser === 2;
    return [1, 3, 5].includes(games) && winner === (games + 1) / 2 && winner > loser;
  }
  if (sport === "tennis") return [2, 3].includes(winner) && winner > loser;
  if (sport === "volleyball") return winner === 3 && winner > loser;
  return true;
}

export function createOutcomeModel() {
  const groups = new Map();
  const updated = new Set();

  function state(event) {
    const key = cohort(event);
    if (!groups.has(key)) groups.set(key, { teams: new Map(), total: 0, draws: 0, latest: -Infinity });
    return groups.get(key);
  }

  function forecast(event, group, home, away) {
    const profile = profiles[event.sport];
    const drawAllowed = event.sport === "dota2" ? event.rules === "BO2" : profile.draw;
    const draw = drawAllowed ? (group.draws + 2) / (group.total + 8) : 0;
    const strength = logistic(home.elo - away.elo + (event.sport === "football" && event.homeField === true ? 55 : 0));
    return { home: (1 - draw) * strength, ...(drawAllowed ? { draw } : {}), away: (1 - draw) * (1 - strength) };
  }

  function predict(event, asOf = event.start) {
    if (!profiles[event.sport] || !event.season || !event.competition || asOf > event.start) return null;
    if (["cs2", "dota2"].includes(event.sport) &&
      (!event.patch || !(event.sport === "cs2" ? /^BO[135]$/ : /^BO[1235]$/).test(event.rules || ""))) return null;
    const group = groups.get(cohort(event));
    if (!group || group.latest >= asOf) return null;
    const home = group.teams.get(event.home);
    const away = group.teams.get(event.away);
    if ([home, away].some((record) => !record || record.games < 4 || record.last >= asOf || asOf - record.last > 60 * DAY)) return null;
    return { probabilities: forecast(event, group, home, away), matches: [home.games, away.games],
      ratings: [home.elo, away.elo].map(Math.round), version: MODEL_VERSION, reliability: "unvalidated" };
  }

  function observe(event) {
    const profile = profiles[event.sport];
    if (!profile || !event.id || updated.has(event.id) || !event.competition || !event.season ||
        !event.home || !event.away || event.home === event.away || !Number.isFinite(event.start) ||
        !Array.isArray(event.score) || event.score.length !== 2 ||
        event.score.some((value) => !Number.isSafeInteger(value) || value < 0) ||
        !finishedSeries(event.sport, event.rules, event.score) ||
        ["cs2", "dota2"].includes(event.sport) && !event.patch) return false;
    const result = outcome(event.score);
    if (result === "draw" && !(event.sport === "football" || event.sport === "dota2" && event.rules === "BO2")) return false;
    const group = state(event);
    const home = group.teams.get(event.home) || rating();
    const away = group.teams.get(event.away) || rating();
    if (event.start < group.latest) return false;
    const probability = forecast(event, group, home, away);
    const expected = probability.home + (probability.draw || 0) / 2;
    const actual = ({ home: 1, draw: 0.5, away: 0 })[result];
    const margin = profile.margin ? 1 + 0.3 * Math.min(1, Math.abs(event.score[0] - event.score[1]) / profile.margin) : 1;
    const adjustment = profile.k * margin * (actual - expected);
    group.teams.set(event.home, { elo: home.elo + adjustment, games: home.games + 1, last: event.start });
    group.teams.set(event.away, { elo: away.elo - adjustment, games: away.games + 1, last: event.start });
    group.total++;
    group.latest = event.start;
    if (result === "draw") group.draws++;
    updated.add(event.id);
    return true;
  }

  return { predict, observe };
}
