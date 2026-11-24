function esportsCompetition(name) {
  return name.replace(/^20\d{2} /, "").replace(/ 20\d{2}$/, "")
    .replace(/^blast slam ix$/, "blast slam season 9");
}

const esportsAliases = {
  "1win": "1w team", aurora: "aurora gaming", "spirit academy": "team spirit academy",
};
const volleyballAliases = {
  "pallavolo modena": "modena volley", "valsa group modena": "modena volley", "trentino volley": "itas trentino",
  "gas sales bluenergy piacenza": "pallavolo piacenza",
  "sir susa scai perugia": "volley perugia", "pallavolo padova": "padova volley",
  "vero volley monza": "volley monza", "cucine lube civitanova": "lube civitanova",
  "tinet prata di pordenone": "prata di pordenone",
};
const germanTeams = {
  "hertha berlin": "hertha bsc", "fc kaiserslautern": "1 fc kaiserslautern", kaiserslautern: "1 fc kaiserslautern",
  karlsruher: "karlsruher sc", "vfl osnabruck": "vfl osnabrück", "osnabrück": "vfl osnabrück",
  "stuttgart ii": "vfb stuttgart ii", "fc ingolstadt": "fc ingolstadt 04",
  "sg dynamo dresden": "dynamo dresden", "fc energie cottbus": "energie cottbus",
  "f c hansa rostock": "hansa rostock", "fc hansa rostock": "hansa rostock",
  "sv werder bremen ii": "werder bremen ii", "bsv kickers emden": "kickers emden",
  "1 fc frankfurt o": "1 fc frankfurt", "1 fc frankfurt oder": "1 fc frankfurt",
};
const germanCompetitions = {
  "bundesliga 2": "2. Bundesliga", "2 bundesliga": "2. Bundesliga",
  "3 liga regular season": "3. Liga", "3 liga": "3. Liga",
  "regionalliga north": "Regionalliga Nord", "regionalliga nordost": "Regionalliga Nordost",
  "regionalliga bayern": "Regionalliga Bayern",
  "nofv oberliga süd": "NOFV Oberliga Süd",
};

// These editions were checked against the WTA tournament pages. Scope the
// city labels to the edition so they do not match other tours in those cities.
const wtaEditions = [
  { from: "2026-11-21", through: "2026-11-30", names: /^(?:buenos aires(?: 125)?(?: qualifications)?|ieb\+? argentina open)$/,
    title: "IEB+ Argentina Open", url: "https://www.wtatennis.com/tournaments/2052/buenos-aires-125/2026" },
  { from: "2026-11-14", through: "2026-11-23", names: /^(?:colina(?: 125)?(?: qualifications| round of 16| semi finals| quarter finals| final)?|lp open by ind)$/,
    title: "LP Open by IND", url: "https://www.wtatennis.com/tournaments/2076/colina-125/2026/" },
];
const wtaPlayerNames = {
  "irene burillo escorihuela": "Irene Burillo",
  "victoria kasintseva": "Victoria Jimenez Kasintseva",
};

const families = {
  "cct eu": /^cct europe series \d+/,
  "cct csa": /^cct challengers south america series \d+/,
  "epl a": /^european pro league asia season \d+/,
  epl: /^european pro league series \d+/,
  nodwin: /^nodwin clutch series \d+/,
  cf: /^crossfire season \d+/,
  mcr: /^tipsport mčr(?: |$)/,
  mlpxxix: /^master league portugal xix(?: |$)/,
};

const footballLeagues = [
  ["mex-mx", "Mexico", /^liga mx (?:apertura|clausura)$/, /^liga mx$/],
  ["bra-a", "Brazil", /^brasileir[aã]o s[eé]rie a$/, /^brazil serie a$/],
  ["bra-b", "Brazil", /^brasileir[aã]o s[eé]rie b(?: promotion playoffs)?$/, /^brazil serie b$/],
  ["bol-pro", "Bolivia", /^divisi[oó]n profesional$/, /^bolivian liga profesional$/],
  ["ita-b", "Italy", /^serie b$/, /^italian serie b$/],
  ["gre-sl", "Greece", /^super league$/, /^greek super league$/],
  ["swe-all", "Sweden", /^allsvenskan$/, /^swedish allsvenskan$/],
  ["tur-sl", "Turkey", /^super lig$/, /^turkish super lig$/],
  ["nor-eli", "Norway", /^eliteserien$/, /^norwegian eliteserien$/],
  ["ned-2", "Netherlands", /^eerste divisie$/, /^keuken kampioen divisie$/],
  ["rus-pl", "Russia", /^premier liga$/, /^russian premier$/],
  ["chi-1", "Chile", /^first division$/, /^chilean primera$/],
  ["dan-sl", "Denmark", /^superliga$/, /^danish superliga$/],
  ["bel-pro", "Belgium", /^jupiler pro league$/, /^belgian pro league$/],
  ["por-cup", "Portugal", /^ta[cç]a de portugal \d+(?:st|nd|rd|th) round$/, /^ta[cç]a de portugal \d+(?:st|nd|rd|th) round$/],
  ["fifa-u17", null, /^u17 world cup$/, /^fifa u 17 world cup(?: group [a-z])?$/],
  ["nwslease", null, /^nwsl final$/, /^nwsl championship$/],
  ["mls", null, /^mls(?: \d+(?:st|nd|rd|th) round)?$/, /^mls$/],
];

function footballCompetition(row, label) {
  const entry = footballLeagues.find(([, country, left, right]) =>
    (row.source === "365Scores" && (!country || row.sourceCountry === country) && left.test(label)) ||
    (row.source === "ESPN" && right.test(label)));
  return entry?.[0];
}

export function reconcileClaims(rows, normalize) {
  const adapted = rows.map((row) => {
    const league = normalize(row.tournament);
    if (row.sport === "football") {
      const german = (row.country === "DE" || row.source === "ESPN" && league === "2 bundesliga") && germanCompetitions[league];
      if (german) {
        const side = (name) => germanTeams[normalize(name)] || name;
        return { ...row, country: "DE", tournament: german, displayTournament: row.tournament, home: side(row.home), away: side(row.away),
          displayMatch: `${row.home} — ${row.away}` };
      }
      const leagueIdentity = footballCompetition(row, league);
      return leagueIdentity ? { ...row, leagueIdentity } : row;
    }
    if (["cs2", "dota2"].includes(row.sport)) {
      const side = (name) => row.sport === "dota2" && esportsAliases[normalize(name)] || name;
      return { ...row, tournament: esportsCompetition(league), displayTournament: row.tournament,
        home: side(row.home), away: side(row.away), displayMatch: `${row.home} — ${row.away}` };
    }
    if (row.sport === "volleyball" && ["superlega", "italian volleyball league", "superlega credo banca"].includes(league)) {
      const side = (name) => volleyballAliases[normalize(name)] || name;
      return { ...row, tournament: "SuperLega", displayTournament: row.tournament, home: side(row.home), away: side(row.away),
        displayMatch: `${row.home} — ${row.away}` };
    }
    if (row.sport === "tennis" && ["nitto atp finals", "atp finals"].includes(league)) {
      return { ...row, tournament: "Nitto ATP Finals", displayTournament: row.tournament };
    }
    if (row.sport === "tennis" && ["365Scores", "ESPN"].includes(row.source) && Number.isFinite(row.start)) {
      const day = new Date(row.start).toISOString().slice(0, 10);
      const edition = wtaEditions.find((item) => day >= item.from && day <= item.through && item.names.test(league));
      if (edition) return { ...row, tournament: edition.title, displayTournament: row.tournament,
        home: wtaPlayerNames[normalize(row.home)] ?? row.home, away: wtaPlayerNames[normalize(row.away)] ?? row.away,
        season: row.season ?? "2026", surface: row.surface ?? "outdoor-clay", contextSource: edition.url };
    }
    return row;
  });
  const key = (row) => JSON.stringify([row.sport, ...[normalize(row.home), normalize(row.away)].sort()]);
  const byPair = Map.groupBy(adapted.filter((row) => ["cs2", "dota2"].includes(row.sport)), key);
  return adapted.map((claim) => {
    const family = claim.source === "Ensigame" && families[claim.tournament];
    if (!family) return claim;
    const possible = new Set(byPair.get(key(claim)).filter((row) => row.source !== claim.source &&
      Math.abs(row.start - claim.start) <= 15 * 60_000 && family.test(row.tournament)).map((row) => row.tournament));
    if (possible.size !== 1) return claim;
    return { ...claim, tournament: [...possible][0] };
  });
}
