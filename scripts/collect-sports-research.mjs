import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildShadowReport } from "./sports-shadow.mjs";
import { calendarJobs, europeanSeason, germanLeagues } from "./sports-discovery.mjs";
import { parseOpenLiga } from "./sports-research-sources.mjs";
import { openDotaMap } from "./import-sports-archive.mjs";
import { compareHistory, makeHistorySnapshot, mergeHistory } from "./sports-history-analysis.mjs";
import { DAY, loadSeasonArchives, readResearchSnapshots } from "./sports-research-history.mjs";
import { copyResearchStore, readResearchRuns, researchMarkdown, researchReport, sports, storeResearchObject,
  verifyResearchObject, verifyResearchStore } from "./sports-research-ledger.mjs";
import { withResearchLock } from "./sports-research-lock.mjs";

const base = fileURLToPath(new URL("../.sports-update/", import.meta.url));
const liveRoot = process.env.SPORTS_RESEARCH_STORE ? resolve(process.env.SPORTS_RESEARCH_STORE) : join(base, "daily-research-v1");
const replayRoot = join(base, "daily-research-replay-v1");
const openLiga = "https://api.openligadb.de";
const openDota = "https://api.opendota.com/api/proMatches";
const headers = { "user-agent": "PrognozyDnya-Research/2.2 (+https://github.com/iamdanilasergeev4-oss/prognozy-dnya/issues)" };
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const allowedClaims = new Set(["scheduled", "finished", "cancelled", "postponed", "other"]);
const filterClaims = (rows, capturedAt) => rows.filter((row) => {
  const valid = row && sports.includes(row.sport) && typeof row.source === "string" && row.source &&
    typeof row.id === "string" && row.id && URL.parse(row.url)?.protocol === "https:" &&
    typeof row.tournament === "string" && row.tournament && typeof row.home === "string" && row.home &&
    typeof row.away === "string" && row.away && row.home !== row.away && Number.isFinite(row.start) &&
    allowedClaims.has(row.status) && (row.score == null || Array.isArray(row.score) && row.score.length === 2 &&
      row.score.every((value) => Number.isSafeInteger(value) && value >= 0));
  return valid && (row.status !== "finished" || row.start < capturedAt);
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failureKind = (error) => {
  if (error.http === 429) return "rate_limit";
  if ([401, 403].includes(error.http)) return "access";
  if (error.name === "TimeoutError") return "timeout";
  if (error.http) return error.http >= 500 ? "server" : "http";
  if (error instanceof SyntaxError) return "payload";
  return "transport";
};

export function datasource(root, previous, requests, clock = Date.now, fetcher = fetch, manual = false) {
  const past = new Map();
  const lastGood = new Map();
  const hosts = new Map();
  for (const run of [...previous].sort((a, b) => (a.at ?? 0) - (b.at ?? 0))) for (const row of run.requests ?? []) {
    if (!Number.isFinite(row.startedAt) || !row.url?.startsWith("https:") || row.status === "backoff") continue;
    if (row.status !== "cached") past.set(row.url, row);
    if (["ok", "cached"].includes(row.status) && row.rawHash) lastGood.set(row.url, row);
  }
  async function fromHost(url, operation) {
    if (!manual) return operation();
    const host = new URL(url).hostname;
    if (!hosts.has(host)) hosts.set(host, { slots: [Promise.resolve(), Promise.resolve()], next: 0, nextStart: 0, blockedUntil: 0 });
    const state = hosts.get(host);
    const slot = state.next++ % state.slots.length;
    const result = state.slots[slot].then(async () => {
      if (state.blockedUntil > clock()) {
        throw Object.assign(new Error("HTTP 429: Retry-After"), { http: 429, retry: state.blockedUntil - clock() });
      }
      const start = Math.max(clock(), state.nextStart);
      state.nextStart = start + 180;
      if (start > clock()) await delay(start - clock());
      if (state.blockedUntil > clock()) {
        throw Object.assign(new Error("HTTP 429: Retry-After"), { http: 429, retry: state.blockedUntil - clock() });
      }
      try {
        return await operation();
      } catch (error) {
        if (error.http === 429) state.blockedUntil = clock() + (error.retry || 60_000);
        throw error;
      }
    });
    state.slots[slot] = result.catch(() => {});
    return result;
  }
  return async (url, { source, sport, text = false, revision, minAge = 6 * 3_600_000, schedule = false }) => {
    const old = past.get(url);
    const good = lastGood.get(url);
    const record = { source, sport, url, startedAt: clock(), schedule, ...(revision ? { revision } : {}) };
    const cached = !schedule && good?.rawHash && (revision ? good.revision === revision : clock() - good.receivedAt < minAge);
    const hardBackoff = ["rate_limit", "access", "http"].includes(old?.kind) || old?.status === "restricted" ||
      old?.serverRetryAt > clock() || /^HTTP (?:429|404)\b/.test(old?.error ?? "");
    if (!cached && old?.nextAttemptAt > clock() && (!schedule || hardBackoff)) {
      requests.push({ ...record, status: "backoff", kind: old.kind || "previous_failure", error: old.error,
        nextAttemptAt: old.nextAttemptAt, failures: old.failures });
      throw Object.assign(new Error("Source backoff"), { kind: old.kind || "previous_failure" });
    }
    const attempts = [];
    try {
      let body;
      if (cached) {
        body = await verifyResearchObject(root, "raw", good.rawHash);
        record.receivedAt = good.receivedAt;
      } else {
        for (let i = 0; ; i++) {
          try {
            body = await fromHost(url, async () => {
              const reply = await fetcher(url, { headers, redirect: "error", signal: AbortSignal.timeout(9000) });
              if (!reply.ok) {
                const wait = reply.headers.get("retry-after");
                const retry = /^\d+$/.test(wait ?? "") ? Number(wait) * 1000 : Math.max(0, Date.parse(wait) - clock()) || 0;
                throw Object.assign(new Error("HTTP " + reply.status), { http: reply.status, retry });
              }
              return Buffer.from(await reply.arrayBuffer());
            });
            attempts.push({ status: "ok" });
            break;
          } catch (error) {
            const kind = failureKind(error);
            attempts.push({ status: "error", kind, error: error.message, http: error.http });
            if (!manual || !schedule || i >= 1 || !["timeout", "transport", "server"].includes(kind) || error.retry > 1500) throw error;
            await delay(Math.max(600, error.retry || 0));
          }
        }
        record.receivedAt = clock();
      }
      const result = text ? body.toString("utf8") : JSON.parse(body.toString("utf8"));
      record.rawHash = await storeResearchObject(root, "raw", body);
      const saved = { ...record, status: cached ? "cached" : "ok", attempts };
      requests.push(saved);
      if (!cached) past.set(url, saved);
      lastGood.set(url, saved);
      return result;
    } catch (error) {
      const kind = failureKind(error);
      const failures = (old?.failures ?? 0) + 1;
      const cooldown = manual && !["rate_limit", "access", "http"].includes(kind) ? 60_000 :
        Math.min(7 * DAY, 15 * 60_000 * 2 ** Math.min(failures, 10));
      const failed = { ...record, status: kind === "access" ? "restricted" : "error", kind, http: error.http,
        attempts, error: error.message, failures, nextAttemptAt: clock() + Math.max(cooldown, error.retry || 0),
        ...(error.retry > 0 ? { serverRetryAt: clock() + error.retry } : {}) };
      requests.push(failed);
      past.set(url, failed);
      throw Object.assign(error, { kind });
    }
  };
}

export function seasonCacheAge(prior, now) {
  const latestCapture = prior.findLast((run) => (run.requests ?? []).some((request) =>
    request.source === "OpenLigaDB" && ["ok", "cached"].includes(request.status) &&
    request.url?.includes("/getmatchdata/")));
  return !latestCapture || now - latestCapture.at >= DAY ? 0 : 7 * DAY;
}

async function acquire(root, prior, startedAt, claimFiles, collectSite) {
  const requests = [];
  const get = datasource(root, prior, requests, Date.now, fetch, Boolean(collectSite));
  const site = collectSite ? await collectSite(get) : null;
  const season = europeanSeason(startedAt).slice(0, 4);
  const minAge = collectSite ? 0 : seasonCacheAge(prior, startedAt);
  const until = startedAt + 2 * DAY;
  const rows = [];
  const historicalRows = [];
  const supplemental = { rows, historicalRows, maps: [], requests: [] };
  for (const [competition, shortcut, label] of germanLeagues) {
    const url = `${openLiga}/getmatchdata/${shortcut}/${season}`;
    try {
      const options = { source: "OpenLigaDB", sport: "football", schedule: Boolean(collectSite) };
      const data = await get(url, { ...options, minAge });
      const seasonRequest = requests.at(-1);
      if (!Array.isArray(data)) throw new Error("Ожидался список матчей сезона");
      let feed = data;
      if (seasonRequest.status === "cached") {
        const groups = new Map();
        for (const row of data) {
          const start = Date.parse(row.matchDateTimeUTC);
          const group = row.group?.groupOrderID;
          if (Number.isSafeInteger(group) && start >= startedAt - 3 * DAY && start <= until &&
              (!groups.has(group) || start >= groups.get(group))) groups.set(group, start);
        }
        const group = [...groups].sort((a, b) => Math.abs(a[1] - startedAt) - Math.abs(b[1] - startedAt))[0]?.[0];
        if (group != null) {
          const revision = await get(`${openLiga}/getlastchangedate/${shortcut}/${season}/${group}`,
            { ...options, minAge: 30 * 60_000 });
          if (typeof revision !== "string" || !Number.isFinite(Date.parse(revision))) throw new Error("Invalid revision");
          const latest = await get(`${url}/${group}`, { ...options, revision });
          if (!Array.isArray(latest)) throw new Error("Ожидался список матчей тура");
          feed = [...data.filter((row) => row.group?.groupOrderID !== group), ...latest];
        }
      }
      const context = { competition, shortcut, season, label, url, now: startedAt, until, lookback: 366 * DAY };
      const parsed = parseOpenLiga(feed, context);
      rows.push(...parsed.filter((row) => row.start >= startedAt - 30 * DAY));
      historicalRows.push(...parsed.filter((row) => row.score));
      supplemental.requests.push({ source: "OpenLigaDB", sport: "football", url, competition, status: "ok", results: parsed.length });
    } catch (error) {
      supplemental.requests.push({ source: "OpenLigaDB", sport: "football", url, competition, status: "error", error: error.message });
    }
  }
  try {
    const data = await get(openDota, { source: "OpenDota", sport: "dota2", minAge: 60 * 60_000 });
    if (!Array.isArray(data)) throw new Error("Ожидался список карт");
    supplemental.maps = data.flatMap((row) => {
      const map = openDotaMap(row);
      return map && map.end <= Date.now() ? [{ ...map, started: map.start, tournament: row.league_name,
        radiant: row.radiant_name, dire: row.dire_name }] : [];
    });
  } catch (error) {
    supplemental.requests.push({ source: "OpenDota", sport: "dota2", url: openDota, status: "error", error: error.message });
  }
  const claimsByCapture = new Map();
  for (const file of claimFiles) {
    try {
      const body = await readFile(file);
      const data = JSON.parse(body.toString("utf8"));
      const capturedAt = Date.parse(data.capturedAt);
      if (typeof data.rights !== "string" || !data.rights.trim() || !Array.isArray(data.rows) ||
          !Number.isFinite(capturedAt) || capturedAt > startedAt) throw new Error("Неверный манифест разрешённых наблюдений");
      const accepted = filterClaims(data.rows, capturedAt);
      const fresh = capturedAt >= startedAt - 2 * DAY;
      const rawHash = await storeResearchObject(root, "raw", body);
      for (const row of accepted.filter((row) => fresh || row.status === "finished")) {
        const key = JSON.stringify([row.source, row.sport, row.id]);
        const priorClaim = claimsByCapture.get(key);
        if (!priorClaim || priorClaim.at < capturedAt) claimsByCapture.set(key, { at: capturedAt, rows: [row] });
        else if (priorClaim.at === capturedAt) priorClaim.rows.push(row);
      }
      requests.push({ source: "local-authorized-claims", status: fresh ? "ok" : "stale_schedule", receivedAt: capturedAt,
        rawHash, rejected: data.rows.length - accepted.length });
    } catch (error) {
      requests.push({ source: "local-authorized-claims", status: "error", file, error: error.message });
    }
  }
  const claims = [...(site?.rows ?? []), ...[...claimsByCapture.values()].flatMap((entry) => entry.rows)];
  const fetchFootball = (url, text) => get(url, { source: "openfootball", sport: "football", text });
  const empty = Object.fromEntries(sports.map((sport) => [sport, { publishers: site?.coverage[sport] ?? [] }]));
  const checkpoint = await buildShadowReport({ rows: claims, now: startedAt, until, checkedAt: new Date(startedAt).toISOString(),
    clock: Date.now, fetchData: fetchFootball, legacyReport: empty, requestErrors: site?.errors ?? [], supplemental, improve: true });
  const archive = await loadSeasonArchives({ events: [...checkpoint.assessed, ...calendarJobs(startedAt)
    .map(({ competition }) => ({ sport: "football", competition }))], now: startedAt, fetchData: fetchFootball });
  const at = Date.now();
  const normalized = makeHistorySnapshot({ rows: claims, supplemental, archives: archive.results,
    archiveRequests: archive.requests, now: startedAt, until, observedAt: at });
  const snapshots = [...prior.filter((run) => run.normalized).map((run) => run.normalized), normalized];
  const diagnostics = compareHistory(checkpoint, snapshots, at);
  if (site) site.rows.push(...rows.filter((row) => row.status === "scheduled"));
  return { at, diagnostics, snapshots, normalized, site,
    requests: [...requests, ...supplemental.requests.filter((row) => row.status !== "ok"), ...archive.requests] };
}

async function storeRun(root, { at, diagnostics, normalized, requests }, mode, runKey, slot, retryAt) {
  const features = [];
  const forecasts = [];
  for (const event of diagnostics.forecastEvidence) {
    for (const candidate of event.candidates ?? [event]) {
      const { version, probabilities, matches, evidence = [] } = candidate;
      const feature = { version, event: event.id, asOf: at, matches, evidence: evidence.map(({ id, observedAt, start }) =>
        ({ id, observedAt: observedAt ?? null, start })) };
      features.push(feature);
      forecasts.push({ id: event.id, sport: event.sport, competition: event.competition, start: event.start,
        home: event.home, away: event.away, rules: event.rules, version, probabilities,
        sources: event.sources, featureIndex: features.length - 1 });
    }
  }
  const featuresHash = await storeResearchObject(root, "features", features);
  const normalizedHash = await storeResearchObject(root, "normalized", normalized);
  return storeResearchObject(root, "runs", { schema: 1, mode, runKey, slot, retryAt, at, requests, normalizedHash, featuresHash, normalized,
    calendarLeads: diagnostics.calendar,
    events: diagnostics.assessed, results: normalized.results, forecasts, history: diagnostics.savedHistory });
}

export function decideResearchSlot(prior, slot, now) {
  if (!slot) return { collect: true };
  const attempts = prior.filter((run) => run.slot === slot || run.runKey === slot).sort((a, b) => a.at - b.at);
  const last = attempts.at(-1);
  if (last && !last.retryAt) return { collect: false, retry: false };
  if (last && last.retryAt > now) return { collect: false, retry: true };
  return { collect: true, key: `${slot}-${attempts.length + 1}` };
}

export async function captureManualResearch(root, startedAt, collectSite) {
  return withResearchLock(root, async () => {
    const prior = (await readResearchRuns(root)).sort((a, b) => a.at - b.at);
    const run = await acquire(root, prior, startedAt, [], collectSite);
    const snapshot = await storeRun(root, run, "prospective");
    return { ...run, snapshot, history: mergeHistory(run.snapshots.flatMap((entry) => entry.results), run.at).history };
  });
}

async function main([command, ...args]) {
  if (command === "collect") {
    const slot = process.env.SPORTS_RESEARCH_RUN_KEY;
    if (slot && !/^[a-zA-Z0-9_.-]{1,64}$/.test(slot)) throw new Error("Некорректный идентификатор прогона");
    await withResearchLock(liveRoot, async () => {
      const prior = (await readResearchRuns(liveRoot)).sort((a, b) => a.at - b.at);
      const decision = decideResearchSlot(prior, slot, Date.now());
      if (!decision.collect) {
        if (decision.retry) process.exitCode = 3;
        return;
      }
      const run = await acquire(liveRoot, prior, Date.now(), args);
      const network = run.requests.filter((request) => Number.isFinite(request.startedAt));
      const transient = network.filter((request) => ["error", "backoff"].includes(request.status) &&
        Number.isFinite(request.nextAttemptAt));
      const retryAt = transient.length && !network.some((request) => request.status === "ok") ?
        Math.min(...transient.map((request) => request.nextAttemptAt)) : null;
      await storeRun(liveRoot, run, "prospective", decision.key, slot, retryAt);
      if (retryAt) process.exitCode = 3;
    });
    console.log(JSON.stringify(researchReport(await readResearchRuns(liveRoot), Date.now()), null, 2));
  } else if (command === "replay" && args.length === 3) {
    const [file, directory, cutoff] = args;
    const at = Date.parse(cutoff);
    const checkpoint = await json(file);
    if (!Number.isFinite(at) || !(Date.parse(checkpoint.checkedAt) <= at)) throw new Error("Некорректная дата повтора");
    const snapshots = await readResearchSnapshots(directory, at);
    const diagnostics = compareHistory(checkpoint, snapshots, at);
    const normalized = { at, results: snapshots.flatMap((row) => row.results), maps: snapshots.flatMap((row) => row.maps), requests: [] };
    await storeRun(replayRoot, { at, diagnostics, normalized, requests: diagnostics.requests }, "replay");
    console.log(JSON.stringify(researchReport(await readResearchRuns(replayRoot), at), null, 2));
  } else if (command === "report" && args.every((arg) => ["replay", "--markdown"].includes(arg))) {
    const data = researchReport(await readResearchRuns(args.includes("replay") ? replayRoot : liveRoot), Date.now());
    console.log(args.includes("--markdown") ? researchMarkdown(data) : JSON.stringify(data, null, 2));
  } else if (command === "verify" && args.length === 0) {
    console.log(JSON.stringify(await verifyResearchStore(liveRoot), null, 2));
  } else if (["backup", "restore"].includes(command) && args.length === 1) {
    const other = resolve(args[0]);
    if (other === liveRoot) throw new Error("Укажите отдельный каталог");
    const [source, destination] = command === "backup" ? [liveRoot, other] : [other, liveRoot];
    console.log(JSON.stringify(await copyResearchStore(source, destination), null, 2));
  } else {
    throw new Error("Использование: collect | report | replay | verify | backup <dir> | restore <dir>");
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main(process.argv.slice(2));
}
