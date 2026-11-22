const countries = {
  "en.1": ["england", "1-premierleague"], "en.2": ["england", "2-championship"],
  "en.3": ["england", "3-league1"], "en.4": ["england", "4-league2"], "en.5": ["england", "5-nationalleague"],
  "de.2": ["deutschland", "2-bundesliga2"], "de.3": ["deutschland", "3-liga3"],
  "de.4b": ["deutschland", "4-regionalliga-bayern"], "de.4n": ["deutschland", "4-regionalliga-nord"],
  "de.4e": ["deutschland", "4-regionalliga-nordost"], "de.4s": ["deutschland", "4-regionalliga-suedwest"],
  "de.4w": ["deutschland", "4-regionalliga-west"], "es.2": ["espana", "2-liga2"],
};

export function indexedOpenFootballUrl(division, season) {
  const known = countries[division];
  if (!known) return null;
  const [country, file] = known;
  return `https://openfootball.github.io/${country}/${season}_${file}.json`;
}
