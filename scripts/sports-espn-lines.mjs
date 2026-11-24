import { normalizeIdentity } from "./sports-discovery.mjs";

export const espnOddsLeagues = {
  eng1: { route: "soccer/eng.1", slug: "eng.1", scope: "regulation" },
  eng2: { route: "soccer/eng.2", slug: "eng.2", scope: "regulation" },
  nba: { route: "basketball/nba", slug: "nba", scope: "overtime" },
  nhl: { route: "hockey/nhl", slug: "nhl", scope: "overtime_shootout" },
};
const ruleLinks = {
  regulation: "https://sportsbook.draftkings.com/help/sport-rules/soccer",
  overtime: "https://sportsbook.draftkings.com/help/sport-rules/basketball",
  overtime_shootout: "https://sportsbook.draftkings.com/help/sport-rules/hockey",
};

function selection(display, side, type) {
  if (!/^[+-]\d{3,5}$/.test(display?.odds ?? "")) return null;
  const americanPrice = Number(display.odds);
  if (Math.abs(americanPrice) < 100) return null;
  const point = type === "outcome" ? null : type === "handicap"
    ? (/^[+-]?\d+(?:\.5)?$/.test(display.line) ? Number(display.line) : NaN)
    : (new RegExp(`^${side[0]}(\\d+(?:\\.5)?)$`, "i").exec(display.line)?.[1] ?? NaN);
  if (type !== "outcome" && !Number.isFinite(Number(point))) return null;
  return { selection: side, americanPrice, price: americanPrice > 0 ? 1 + americanPrice / 100 : 1 - 100 / americanPrice,
    point: point == null ? null : Number(point) };
}

export function importEspnScoreboardLines(body, receipt, events) {
  const league = espnOddsLeagues[receipt.competition];
  const received = Date.parse(receipt.receivedAt);
  const url = URL.parse(receipt.url);
  if (!league || receipt.status !== 200 || !Number.isFinite(received) ||
      url?.origin !== "https://site.api.espn.com" ||
      url.pathname !== `/apis/site/v2/sports/${league.route}/scoreboard` || !/^\d{8}$/.test(url.searchParams.get("dates")) ||
      !body?.leagues?.some(({ slug }) => slug === league.slug) || !Array.isArray(body?.events)) {
    throw new Error("Некорректный снимок ESPN");
  }
  const byId = Map.groupBy(body.events, ({ id }) => String(id));
  return events.filter((event) => event.competition === receipt.competition && event.start > received).flatMap((event) => {
    const claims = (event.sources ?? []).filter((row) => row.title === "ESPN" && row.reportedStatus === "scheduled" &&
      row.reportedStart === event.start);
    if (claims.length !== 1) return [];
    const id = String(claims[0].id);
    const rows = byId.get(id) ?? [];
    if (rows.length !== 1 || rows[0].competitions?.length !== 1 || Date.parse(rows[0].date) !== event.start) return [];
    const [game] = rows[0].competitions;
    if (String(game.id) !== id || game.status?.type?.name !== "STATUS_SCHEDULED" ||
        Date.parse(game.date) !== event.start || game.competitors?.length !== 2) return [];
    if (["home", "away"].some((side) => {
      const competitors = game.competitors.filter((row) => row.homeAway === side);
      return competitors.length !== 1 || normalizeIdentity(competitors[0].team?.displayName) !== normalizeIdentity(event[side]);
    })) return [];
    const prices = game.odds?.filter(({ provider }) => String(provider?.id) === "100" && provider?.name === "DraftKings") ?? [];
    if (prices.length !== 1) return [];
    const [market] = prices;
    const soccer = league.scope === "regulation";
    return [
      ["outcome", market.moneyline, soccer ? ["home", "draw", "away"] : ["home", "away"]],
      ["total", market.total, ["over", "under"]],
      ...(!soccer ? [["handicap", market.pointSpread, ["home", "away"]]] : []),
    ].flatMap(([type, values, sides]) => {
      const outcomes = sides.map((side) => selection(values?.[side]?.close, side, type));
      if (outcomes.includes(null) || type === "total" && (outcomes[0].point <= 0 || outcomes[0].point !== outcomes[1].point) ||
          type === "handicap" && outcomes[0].point !== -outcomes[1].point) return [];
      return [{ type, event, outcomes, bookmaker: "DraftKings", source: "ESPN", sourceUrl: url.href,
        rulesUrl: ruleLinks[league.scope], scope: league.scope, receivedAt: new Date(received).toISOString(),
        updatedAt: null, publishedAt: null, observationOnly: true, providerEventId: id }];
    });
  });
}
