const DAY = 86_400_000;
export const SPARSE_MODEL_VERSION = "shrunk-results-1";

export function comparisonGroup(event) {
  if (event.sport === "cs2" && /^cct europe series \d+$/.test(event.competition)) return "cct europe";
  return event.competition;
}

const key = (event, team) => JSON.stringify([event.sport, comparisonGroup(event), event.rules || null, team]);
const days = { football: 420, basketball: 90, hockey: 90, tennis: 365, volleyball: 420, cs2: 60, dota2: 60 };
const minPerSide = { football: 3, basketball: 3, hockey: 3, tennis: 3, volleyball: 3, cs2: 3, dota2: 3 };

export function createSparseModel() {
  const teams = new Map();
  const cohorts = new Map();
  const ids = new Set();
  const cohort = (e) => JSON.stringify([e.sport, comparisonGroup(e), e.rules || null]);
  const drawAllowed = (e) => e.sport === "football" || e.sport === "dota2" && e.rules === "BO2";

  function observe(event) {
    if (!event.id || ids.has(event.id) || !days[event.sport] || !event.season ||
        !Array.isArray(event.score) || event.score.length !== 2 || event.score.some((n) => !Number.isSafeInteger(n) || n < 0) ||
        !Number.isFinite(event.start) || event.home === event.away) return false;
    const draw = event.score[0] === event.score[1];
    if (draw && !drawAllowed(event)) return false;
    ids.add(event.id);
    for (const [side, team] of [event.home, event.away].entries()) {
      const id = key(event, team);
      if (!teams.has(id)) teams.set(id, []);
      teams.get(id).push({ event, win: event.score[side] > event.score[1 - side], draw });
    }
    const group = cohort(event);
    if (!cohorts.has(group)) cohorts.set(group, []);
    cohorts.get(group).push(event);
    return true;
  }

  function history(event, asOf) {
    const available = (past) => past.start < asOf && (past.observedAt == null || past.observedAt <= asOf) &&
      past.start >= asOf - (days[event.sport] || 0) * DAY;
    const results = [event.home, event.away].map((team) => (teams.get(key(event, team)) || [])
      .filter((row) => available(row.event))
      .sort((a, b) => b.event.start - a.event.start).slice(0, 24));
    return { results, league: (cohorts.get(cohort(event)) || []).filter(available) };
  }

  function predict(event, asOf = event.start) {
    if (!event.season || !event.competition || asOf > event.start ||
        (["cs2", "dota2", "tennis"].includes(event.sport) && !event.rules)) return null;
    const { results, league } = history(event, asOf);
    if (results.some((group) => group.length < minPerSide[event.sport]) ||
        new Set(results.flat().map(({ event: past }) => past.id)).size < 5) return null;
    const score = (group) => {
      let points = 3;
      let weight = 6;
      for (const row of group) {
        const previousSeason = row.event.season !== event.season;
        const w = (previousSeason ? 0.4 : 1) * Math.exp(-(asOf - row.event.start) / (days[event.sport] * DAY / 2));
        weight += w;
        points += w * (row.win ? 1 : row.draw ? 0.5 : 0);
      }
      return points / weight;
    };
    const [a, b] = results.map(score);
    const logit = (value) => Math.log(value / (1 - value));
    const strength = 1 / (1 + Math.exp(-(logit(a) - logit(b) + Number(event.sport === "football" && event.homeField) * 0.22)));
    const draw = drawAllowed(event) ? (2 + league.filter(({ score }) => score[0] === score[1]).length) / (8 + league.length) : 0;
    return { probabilities: { home: (1 - draw) * strength, ...(drawAllowed(event) ? { draw } : {}), away: (1 - draw) * (1 - strength) },
      matches: results.map((group) => group.length), version: SPARSE_MODEL_VERSION, reliability: "unvalidated",
      evidence: [...new Map(results.flat().map(({ event: past }) => [past.id, past])).values()] };
  }

  return { observe, predict, history };
}
