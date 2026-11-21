const competitionKey = ({ competition, season }) => JSON.stringify([competition, season]);

function goalDistribution(mean) {
  const probabilities = [Math.exp(-mean)];
  for (let count = 1; count <= 15; count++) probabilities.push(probabilities.at(-1) * mean / count);
  return probabilities;
}

function outcomes(homeMean, awayMean) {
  const homeGoals = goalDistribution(homeMean);
  const awayGoals = goalDistribution(awayMean);
  const probabilities = { home: 0, draw: 0, away: 0 };
  for (const [home, a] of homeGoals.entries()) {
    for (const [away, b] of awayGoals.entries()) probabilities[home > away ? "home" : home < away ? "away" : "draw"] += a * b;
  }
  const total = Object.values(probabilities).reduce((sum, p) => sum + p, 0);
  return Object.fromEntries(Object.entries(probabilities).map(([key, p]) => [key, p / total]));
}

export function createFootballScoreModel() {
  const leagues = new Map();
  const used = new Set();
  function observe(event) {
    if (event.sport !== "football" || used.has(event.id)) return;
    const key = competitionKey(event);
    const group = leagues.get(key) || { teams: new Map(), matches: 0, goals: [0, 0], latest: -Infinity };
    if (event.start < group.latest) throw new Error("Результаты для модели счёта должны идти по времени");
    const add = (team, scored, conceded) => {
      const current = group.teams.get(team) || { played: 0, scored: 0, conceded: 0 };
      group.teams.set(team, { played: current.played + 1, scored: current.scored + scored, conceded: current.conceded + conceded });
    };
    add(event.home, event.score[0], event.score[1]);
    add(event.away, event.score[1], event.score[0]);
    if (event.homeField === true) {
      group.matches++;
      group.goals[0] += event.score[0];
      group.goals[1] += event.score[1];
    }
    group.latest = event.start;
    leagues.set(key, group);
    used.add(event.id);
  }

  function predict(event) {
    const group = leagues.get(competitionKey(event));
    if (event.sport !== "football" || !group || group.latest >= event.start || group.matches < 12) return null;
    const [home, away] = [event.home, event.away].map((team) => group.teams.get(team));
    if ([home, away].some((team) => !team || team.played < 4)) return null;
    const homeMean = (group.goals[0] + 12 * 1.45) / (group.matches + 12);
    const awayMean = (group.goals[1] + 12 * 1.15) / (group.matches + 12);
    const average = (homeMean + awayMean) / 2;
    const ratio = (team, stat) => (team[stat] + 6 * average) / ((team.played + 6) * average);
    const clamp = (value) => Math.max(0.1, Math.min(6, value));
    const host = event.homeField === true ? homeMean : average;
    const visitor = event.homeField === true ? awayMean : average;
    return outcomes(clamp(host * ratio(home, "scored") * ratio(away, "conceded")),
      clamp(visitor * ratio(away, "scored") * ratio(home, "conceded")));
  }

  return { observe, predict };
}
