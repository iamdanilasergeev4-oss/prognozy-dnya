import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { replayBestOfThree } from "./backtest-archive-sport.mjs";
import { openDotaMap } from "./import-sports-archive.mjs";
import { normalizeIdentity } from "./sports-discovery.mjs";
import { DAY } from "./sports-research-history.mjs";
import { readResearchRuns, verifyResearchObject } from "./sports-research-ledger.mjs";

const openDota = "https://api.opendota.com/api";
const formatSource = "https://blast.tv/dota/news/blast-slam-qualifier-dates-2026";
const pariFormat = "https://ogs.gg/news/og-esports-invited-to-pari-universe";
const events = [
  { id: "19102", name: "BLAST SLAM VIII", first: "2026-09-29", until: "2026-10-12",
    bracket: "https://blast.tv/dota/tournaments/blast-slam-viii/series?view=results" },
  { id: "20395", name: "PARI UNIVERSE by FISSURE", first: "2026-10-22", until: "2026-11-02",
    bracket: pariFormat },
  { id: "20208", name: "BLAST SLAM IX", first: "2026-11-20", until: "2026-11-30",
    bracket: "https://dev.blast.tv/dota/news/blast-slam-ix-the-battle-moves-online" },
];
const detailIds = [9021540875, 9021632842, 9021799787];
const digest = (body) => createHash("sha256").update(body).digest("hex");
const identity = (map) => JSON.stringify([map.competition, map.teams, map.winner, map.start, map.end]);

export function recoverDotaBo3(snapshots) {
  const mapRows = new Map();
  const names = new Map();
  let invalidMaps = 0;
  for (const { rows, captured } of snapshots) {
    for (const raw of rows) {
      const map = openDotaMap(raw);
      if (!map || map.end > captured) {
        invalidMaps++;
        continue;
      }
      if (!mapRows.has(map.id)) mapRows.set(map.id, []);
      mapRows.get(map.id).push({ ...map, captured });
      for (const side of ["radiant", "dire"]) {
        const label = raw[`${side}_name`] ?? raw[`${side}_team_name`];
        if (!label) continue;
        const id = String(raw[`${side}_team_id`]);
        if (!names.has(id)) names.set(id, new Set());
        names.get(id).add(normalizeIdentity(label));
      }
    }
  }

  const rejected = {};
  const reject = (reason) => { rejected[reason] = (rejected[reason] ?? 0) + 1; };
  const conflicted = new Set();
  const linked = [];
  let conflictedMaps = 0;
  for (const rows of mapRows.values()) {
    const claims = rows.filter((row) => row.seriesId && row.reportedSeriesType != null);
    const seriesKey = ({ competition, seriesId }) => `${competition}:${seriesId}`;
    if (rows.some((row) => identity(row) !== identity(rows[0])) ||
        new Set(claims.map((row) => JSON.stringify([seriesKey(row), row.reportedSeriesType]))).size > 1) {
      conflictedMaps++;
      claims.forEach((row) => conflicted.add(seriesKey(row)));
      continue;
    }
    if (!claims.length) continue;
    const patches = [...new Set(rows.map(({ patch }) => patch).filter(Boolean))];
    const lineups = [...new Set(rows.map(({ rosters }) => rosters && JSON.stringify(
      rows[0].teams.map((team) => rosters[team]))).filter(Boolean))];
    linked.push({ ...claims[0], key: seriesKey(claims[0]), captured: Math.min(...claims.map(({ captured }) => captured)),
      patch: patches.length === 1 ? patches[0] : null, rosterKey: lineups.length === 1 ? lineups[0] : null });
  }

  const series = [];
  for (const [id, rows] of Map.groupBy(linked, (map) => map.key)) {
    const first = rows[0];
    const event = events.find(({ id }) => id === first.competition);
    if (!event || rows.some(({ reportedSeriesType }) => reportedSeriesType !== 1)) {
      reject("formatOrTournamentOutsideScope");
      continue;
    }
    if (conflicted.has(id) || rows.some(({ teams }) => teams.some((team, i) => team !== first.teams[i]))) {
      reject("conflictingMapsOrTeams");
      continue;
    }
    const maps = [...rows].sort((a, b) => a.start - b.start);
    const start = maps[0].start;
    const end = maps.at(-1).end;
    if (start < Date.parse(event.first) || end >= Date.parse(event.until) ||
        maps.some((map, index) => index > 0 && maps[index - 1].end > map.start)) {
      reject("invalidDateOrOverlappingMaps");
      continue;
    }
    const score = [0, 0];
    for (const map of maps) score[first.teams.indexOf(map.winner)]++;
    if (![2, 3].includes(maps.length) || Math.max(...score) !== 2 ||
        maps.at(-1).winner !== first.teams[score.indexOf(2)]) {
      reject("incompleteOrImpossibleBo3");
      continue;
    }
    const available = end + 2 * DAY;
    series.push({ id, sport: "dota2", rules: "BO3", competition: event.name, season: "2026",
      home: first.teams[0], away: first.teams[1], score, start, end, available,
      observedAvailable: Math.max(available, ...maps.map(({ captured }) => captured)),
      mapIds: maps.map(({ id }) => id), patch: maps[0].patch && maps.every(({ patch }) => patch === maps[0].patch) ? maps[0].patch : null,
      withConsistentRosters: !!maps[0].rosterKey && maps.every(({ rosterKey }) => rosterKey === maps[0].rosterKey) });
  }
  return { series, names, maps: mapRows.size, linkedMaps: linked.length, invalidMapObservations: invalidMaps, conflictedMaps, rejected };
}

async function loadSnapshots(directory, ledgerDirectory) {
  const receipts = [];
  const snapshots = [];
  const read = async (file, path, detailId) => {
    const body = await readFile(join(directory, file));
    const receipt = JSON.parse(await readFile(join(directory, `${file}.receipt.json`), "utf8"));
    const captured = Date.parse(receipt.capturedAt);
    if (receipt.file !== file || receipt.url !== `${openDota}/${path}` || !Number.isFinite(captured)) {
      throw new Error(`Invalid OpenDota receipt for ${file}`);
    }
    const payload = JSON.parse(body.toString("utf8"));
    if (detailId ? payload.match_id !== detailId : !Array.isArray(payload)) throw new Error(`Invalid OpenDota payload ${file}`);
    receipts.push({ ...receipt, sha256: digest(body) });
    snapshots.push({ captured, rows: detailId ? [payload] : payload });
  };
  for (const { id } of events) await read(`leagues-${id}-matches.json`, `leagues/${id}/matches`);
  for (const id of detailIds) await read(`matches-${id}.json`, `matches/${id}`, id);
  const runs = await readResearchRuns(ledgerDirectory);
  const requests = runs.flatMap(({ requests }) => requests ?? []).filter((request) =>
    request.url === `${openDota}/proMatches` && request.source === "OpenDota" && request.rawHash && Number.isFinite(request.receivedAt));
  for (const [sha256, group] of Map.groupBy(requests, (request) => request.rawHash)) {
    const body = await verifyResearchObject(ledgerDirectory, "raw", sha256);
    const captured = Math.min(...group.map(({ receivedAt }) => receivedAt));
    const rows = JSON.parse(body.toString("utf8"));
    if (!Array.isArray(rows)) throw new Error("Invalid OpenDota ledger payload");
    snapshots.push({ captured, rows });
    receipts.push({ url: `${openDota}/proMatches`, sha256, capturedAt: new Date(captured).toISOString() });
  }
  return { snapshots, receipts };
}

async function checkPreviousReview(path, series, names) {
  const body = await readFile(path);
  const { capturedAt, dota2 } = JSON.parse(body.toString("utf8"));
  if (dota2.competition !== "BLAST SLAM IX" || !Array.isArray(dota2.rows) || !Number.isFinite(Date.parse(capturedAt))) {
    throw new Error("Invalid BLAST SLAM IX review");
  }
  let confirmedScore = 0;
  let scoreConflict = 0;
  let unmatched = 0;
  const confirmedIds = new Set();
  for (const row of dota2.rows) {
    const name = [row.home, row.away].map(normalizeIdentity);
    const matches = series.filter((event) => event.competition === dota2.competition &&
      new Date(event.start).toISOString().slice(0, 10) === row.date && (
        names.get(event.home)?.has(name[0]) && names.get(event.away)?.has(name[1]) ||
        names.get(event.home)?.has(name[1]) && names.get(event.away)?.has(name[0])));
    if (matches.length !== 1) {
      unmatched++;
      continue;
    }
    const [event] = matches;
    const expected = names.get(event.home).has(name[0]) ? event.score : [...event.score].reverse();
    if (expected.every((score, side) => score === row.score[side])) {
      confirmedScore++;
      confirmedIds.add(event.id);
    } else scoreConflict++;
  }
  return { source: dota2.source, sha256: digest(body), capturedAt, rows: dota2.rows.length, confirmedScore, scoreConflict, unmatched, confirmedIds };
}

export async function auditDotaBo3(directory, ledgerDirectory, reviewPath) {
  const { snapshots, receipts } = await loadSnapshots(directory, ledgerDirectory);
  const { series, names, ...imported } = recoverDotaBo3(snapshots);
  const { confirmedIds, ...review } = await checkPreviousReview(reviewPath, series, names);
  if (review.scoreConflict) throw new Error("OpenDota conflicts with a linked series in the saved review");
  // A missing losing map can make a 2–1 look like a 2–0 in a map feed.
  // Require a separate series score for sweeps used in the primary replay.
  const verified = series.flatMap((row) => {
    if (row.mapIds.length === 3) return [row];
    if (!confirmedIds.has(row.id)) return [];
    return [{ ...row, observedAvailable: Math.max(row.observedAvailable, Date.parse(review.capturedAt)) }];
  });
  const fixed = (sample, window, { pool = false, observed = false } = {}) => replayBestOfThree(
    sample.map((row) => ({ ...row, competition: pool ? "Selected pro tournaments" : row.competition,
      available: observed ? row.observedAvailable : row.available })),
    Date.parse(window.first), { until: Date.parse(window.until), auditCoverage: true });
  const all = { first: events[0].first, until: events.at(-1).until };
  const blast = series.filter(({ competition }) => competition.startsWith("BLAST SLAM "));
  return { sources: { receipts, format: [formatSource, pariFormat] }, input: imported, review, archive: {
    series: series.length, playedMaps: series.reduce((sum, row) => sum + row.mapIds.length, 0),
    withVerifiedFinalScore: verified.length, uncorroboratedSweeps: series.length - verified.length,
    stableTeamIds: new Set(series.flatMap(({ home, away }) => [home, away])).size,
    withPatch: series.filter((row) => row.patch).length,
    reportedPatchIds: [...new Set(series.map((row) => row.patch).filter(Boolean))],
    withActualRosters: series.filter((row) => row.withConsistentRosters).length,
    withVerifiedPrematchPatchOrRosters: 0,
  }, periods: events.map((event) => ({ event: event.name, bracket: event.bracket, byTournament: fixed(verified, event),
    pooledSensitivity: fixed(verified, event, { pool: true }),
    assumingTwoWinSweeps: fixed(series, event, { pool: true }),
    byCapture: fixed(verified, event, { pool: true, observed: true }) })),
  byTournament: fixed(verified, all), blastOnly: fixed(blast, all, { pool: true }),
  pooledSensitivity: fixed(verified, all, { pool: true }),
  assumingTwoWinSweeps: fixed(series, all, { pool: true }),
  byCapture: fixed(verified, all, { pool: true, observed: true }),
  retrospectiveDelayDays: 2, candidateMinimumPerTeam: 4, candidateWindowDays: 45, approved: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [archive, ledger, review, output, ...extra] = process.argv.slice(2);
  if (!archive || !ledger || !review || !output || extra.length) {
    throw new Error("Укажите каталог OpenDota, журнал снимков, series-review.json и новый путь отчёта");
  }
  const report = await auditDotaBo3(archive, ledger, review);
  await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(`BO3 с проверенным счётом — ${report.archive.withVerifiedFinalScore}. Парное сравнение — ${report.pooledSensitivity.comparisons.short.paired}.`);
}
