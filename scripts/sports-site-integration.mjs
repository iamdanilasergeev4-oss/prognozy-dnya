export const integratedVersion = "sports-intelligence-2";

export function isUpcoming(event, now) {
  return Date.parse(event.start_iso) > now && (!event.status || event.status === "scheduled");
}

export function siteFixtureKey(sport, article) {
  const start = Date.parse(article.start_iso);
  const match = String(article.match ?? "").normalize("NFKC").toLowerCase().trim().replace(/\s+[—–-]\s+/g, " — ");
  return Number.isFinite(start) && match ? JSON.stringify([sport, match, start]) : null;
}

export function integrateSite(baseline, scheduled, model, { snapshotAt } = {}) {
  const knownSports = new Set(baseline.sports.map(({ id }) => id));
  const since = Date.parse(model.updated_at);
  const upcoming = (event) => snapshotAt || isUpcoming(event, since);
  const scheduleBySport = new Map(scheduled.sports.map((sport) => [sport.id, sport]));
  const scheduledKeys = new Set(scheduled.sports.flatMap((sport) =>
    (sport.events ?? []).filter(upcoming).map((event) => siteFixtureKey(sport.id, event)).filter(Boolean)));
  const projected = new Map();
  for (const article of model.analysis) {
    if (!knownSports.has(article.sport_id)) continue;
    const key = siteFixtureKey(article.sport_id, article);
    if (key && upcoming(article) && (snapshotAt || scheduledKeys.has(key))) projected.set(key, article);
  }
  const activePicks = (sport) => (sport.picks ?? []).filter((pick) =>
    upcoming(pick) && (snapshotAt || scheduledKeys.has(siteFixtureKey(sport.id, pick))));
  const existingAnalysis = snapshotAt ? baseline.analysis ?? [] : (scheduled.analysis ?? []).filter((article) =>
    upcoming(article) && scheduledKeys.has(siteFixtureKey(article.sport_id, article)));
  const sports = baseline.sports.map((sport) => {
    const verified = scheduleBySport.get(sport.id);
    const picks = activePicks(sport);
    const pickKeys = new Set(picks.map((pick) => siteFixtureKey(sport.id, pick)).filter(Boolean));
    const events = snapshotAt ? verified?.events ?? sport.events ?? [] : verified?.events ?? [];
    return { ...sport, picks, events: events.filter(upcoming).map((event) => ({
      ...event, has_pick: pickKeys.has(siteFixtureKey(sport.id, event)),
    })),
      availability: verified?.availability ?? sport.availability,
      forecasts: [...projected.values()].filter((article) => article.sport_id === sport.id) };
  });
  return {
    ...baseline, updated_at: model.updated_at, analysis_engine: integratedVersion,
    ...(snapshotAt ? { review_snapshot_at: snapshotAt } : {}),
    sports,
    analysis: [...projected.values(), ...existingAnalysis.filter((article) =>
      !projected.has(siteFixtureKey(article.sport_id, article)))],
    dailySummary: (model.dailySummary ?? []).filter((article) => projected.has(siteFixtureKey(article.sport_id, article))),
    modelJournal: model.modelJournal,
    express: (baseline.express ?? []).filter((item) => snapshotAt || item.legs.every((leg) =>
      sports.find((sport) => sport.id === leg.sport)?.picks.some((pick) =>
        pick.match === leg.match && pick.start_iso === leg.start_iso && pick.bet === leg.bet))),
  };
}
