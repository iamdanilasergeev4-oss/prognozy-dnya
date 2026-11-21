import { calendarJobs, discover, sourceRegistry } from "./sports-discovery.mjs";
import { createOutcomeModel, MODEL_VERSION } from "./sports-models.mjs";

export async function buildShadowReport({ rows, now, until, checkedAt, fetchData, legacyReport, requestErrors, clock = () => now }) {
  const jobs = calendarJobs(now);
  const calendar = [];
  const requests = [];
  // Requests stay bounded and the GitHub raw host is queried sequentially.
  for (const job of jobs) {
    try {
      const entries = job.parse(await fetchData(job.url));
      calendar.push(...entries);
      requests.push({ source: "openfootball", competition: job.competition, url: job.url, count: entries.length, status: "ok" });
    } catch (error) {
      requests.push({ source: "openfootball", competition: job.competition, url: job.url, status: "error", error: error.message });
    }
  }
  const { events, results, competitions } = discover(rows, { now, until });
  const model = createOutcomeModel();
  const sourceIds = new Map();
  const identity = (event, source, side) => JSON.stringify([event.sport, event.competition, event.season, source.title, side]);
  for (const event of [...events, ...results]) {
    for (const source of event.sources) {
      for (const [index, side] of [event.home, event.away].entries()) {
        const id = source.participantIds?.[index];
        if (id == null) continue;
        const key = identity(event, source, side);
        if (!sourceIds.has(key)) sourceIds.set(key, new Set());
        sourceIds.get(key).add(String(id));
      }
    }
  }
  const ambiguous = (event) => event.sources.some((source) => [event.home, event.away]
    .some((side) => sourceIds.get(identity(event, source, side))?.size > 1));
  const training = results.filter((event) => !ambiguous(event) && model.observe(event));
  const forecastAt = clock();
  const createdAt = new Date(forecastAt).toISOString();
  const forecasts = [];
  const assessed = events.map((event) => {
    const contextVerified = !["cs2", "dota2"].includes(event.sport) || Boolean(event.patch && event.rules);
    const resolved = !ambiguous(event);
    const beforeDeadline = event.start > forecastAt + 10 * 60_000;
    const predict = event.status === "confirmed" && resolved && contextVerified && beforeDeadline ? model.predict(event, forecastAt) : null;
    if (predict) {
      forecasts.push({ ...event, ...predict, createdAt, dataAsOf: checkedAt,
        explanation: `Рейтинг учитывает результаты соперников. У участников ${predict.matches.join(" и ")} сверенных матчей.
Для этого турнира точность модели ещё не подтверждена.`,
        evidence: training.filter((row) => row.sport === event.sport && row.competition === event.competition &&
          row.season === event.season && row.rules === event.rules && row.patch === event.patch) });
    }
    return { ...event, analysisStatus: predict ? "model_available" : event.status !== "confirmed" ? "schedule_needs_verification" :
      !resolved ? "identity_needs_verification" :
      !contextVerified ? "format_or_patch_unverified" : !beforeDeadline ? "too_close_to_start" : "insufficient_results_or_context",
    dataQuality: { verifiedSchedule: event.status === "confirmed", publishers: event.sources.length,
      resolvedSeason: Boolean(event.season), identityConflict: !resolved,
      verifiedEsportsContext: ["cs2", "dota2"].includes(event.sport) ? contextVerified : null } };
  });
  const discovered = new Set(competitions.filter((competition) => competition.sport === "football").map((competition) => competition.competition));
  const confirmed = new Set(competitions.filter((competition) => competition.sport === "football" && competition.confirmed)
    .map((competition) => competition.competition));
  const known = jobs.map((job) => job.competition);
  const coverage = { scope: known, scheduleDetected: known.filter((id) => discovered.has(id)).length,
    confirmedSchedule: known.filter((id) => confirmed.has(id)).length, dateOnlyLeadCount: calendar.length,
    denominator: known.length, observedAt: checkedAt, windowEnd: new Date(until).toISOString() };
  return { checkedAt, modelVersion: MODEL_VERSION, mode: "shadow", coverage, assessed, calendar, forecastCount: forecasts.length,
    forecastEvidence: forecasts, trainingResults: training.length, competitions, sources: sourceRegistry, requests, requestErrors,
    sports: Object.fromEntries(Object.entries(legacyReport).map(([sport, legacy]) => {
      const group = assessed.filter((event) => event.sport === sport);
      return [sport, { detected: group.length, confirmed: group.filter((event) => event.status === "confirmed").length,
        forecast: group.filter((event) => event.analysisStatus === "model_available").length, legacy }];
    })) };
}
