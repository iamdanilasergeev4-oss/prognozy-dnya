export function sourceOrigin(source) {
  if (source.origin) return source.origin;
  if (source.title === "365Scores" || source.title === "ESPN" || source.title === "TheSportsDB" ||
    ["Strafe", "Ensigame", "GosuGamers"].includes(source.title)) return null;
  return source.title === "OpenLigaDB" ? "OpenLigaDB" : null;
}

export function isOfficial(event, source) {
  const url = URL.parse(source.url);
  if (url?.protocol !== "https:") return false;
  const host = url.hostname;
  const dfbPath = { deu2: /\/datencenter\/2-bundesliga\/|\/competitions\/3\/seasons\//,
    deu3: /\/datencenter\/3-liga\/|\/competitions\/4\/seasons\// };
  return event.sport === "hockey" && event.competition === "nhl" && source.title === "NHL" && host === "www.nhl.com" ||
    event.sport === "volleyball" && event.competition === "superlega" && source.title === "Lega Pallavolo" && host === "www.legavolley.it" ||
    event.sport === "football" && source.title === "DFB Datencenter" && host === "datencenter.dfb.de" &&
      Boolean(dfbPath[event.competition]?.test(url.pathname));
}

export function evidenceTier(event, sources = event.sources) {
  if (event.status === "conflict" || ["context_conflict", "time_conflict", "status_conflict", "duplicate_source_ids", "home_away_conflict"]
    .includes(event.verificationReason)) return "conflicting";
  if (!sources.length || event.verificationReason === "ambiguous_competition") return "insufficient";
  const official = sources.filter((source) => isOfficial(event, source));
  // A community editor may have transcribed the federation calendar.
  // Credit the DFB authority without treating the mirror as independent.
  if (official.some((source) => source.title === "DFB Datencenter")) return "official";
  const origins = new Set(sources.map((source) => isOfficial(event, source) ? sourceOrigin(source) || source.title : sourceOrigin(source)).filter(Boolean));
  if (origins.size > 1) return "independent";
  if (official.length) return "official";
  const publishers = new Set(sources.map((source) => source.title));
  // Multiple publishers without two established distinct origins are tracked
  // separately. Neither two domains nor a mirror prove independence.
  if (publishers.size > 1 && sources.some((source) => !sourceOrigin(source))) return "corroborated_unknown_origin";
  return "secondary";
}

export const researchConfirmed = (tier) => ["independent", "official", "corroborated_unknown_origin"].includes(tier);

const seriesSports = new Set(["cs2", "dota2"]);
export function tournamentContext(event) {
  const formatOf = (source) => source.researchFormat || source.format;
  const formats = new Set(event.sources.map(formatOf).filter(Boolean));
  const surfaces = new Set(event.sources.map((source) => source.surface).filter(Boolean));
  if (seriesSports.has(event.sport)) {
    const supported = event.sport === "cs2" ? /^BO[135]$/ : /^BO[1235]$/;
    const [format = event.rules] = formats;
    return { season: event.season || String(new Date(event.start).getUTCFullYear()),
      rules: formats.size <= 1 && supported.test(format) ? format : null,
      rulesEvidence: event.sources.filter((source) => formatOf(source) === format && format).map((source) => source.title) };
  }
  if (event.sport === "volleyball" && event.competition === "superlega") {
    const year = new Date(event.start).getUTCFullYear() - Number(new Date(event.start).getUTCMonth() < 6);
    const season = `${year}-${String(year + 1).slice(-2)}`;
    return { season: !event.season || [season, String(year)].includes(event.season) ? season : null, rules: "BO5" };
  }
  if (event.sport === "tennis" && event.competition === "nitto atp finals" && event.date >= "2026-11-15" && event.date <= "2026-11-22" &&
      !event.match.includes("/")) {
    return { season: event.season || "2026", rules: "indoor-hard", contextSource:
      "https://www.nittoatpfinals.com/en/news/nitto-atp-finals-2026-history-draw-schedule" };
  }
  return { season: event.season, rules: event.sport === "tennis" && surfaces.size === 1 ? [...surfaces][0] : event.rules };
}

export function validSeries(score, format, sport) {
  if (!score) return false;
  const [winner, loser] = [...score].sort((a, b) => b - a);
  if (sport === "dota2" && format === "BO2") return winner + loser === 2 && winner <= 2;
  const length = Number(format?.slice(2));
  return [1, 3, 5].includes(length) && winner === (length + 1) / 2 && winner > loser;
}
