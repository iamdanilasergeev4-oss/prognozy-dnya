(function (root) {
  "use strict";

  const teams = {
    "Newcastle United": "Ньюкасл Юнайтед", Arsenal: "Арсенал", Fulham: "Фулхэм", Everton: "Эвертон",
    "Hull City": "Халл Сити", Liverpool: "Ливерпуль", Sevilla: "Севилья", "Real Betis": "Бетис",
    Alaves: "Алавес", Getafe: "Хетафе", Elche: "Эльче", Malaga: "Малага",
    Chapecoense: "Шапекоэнсе", Cruzeiro: "Крузейро", Remo: "Ремо", "Vasco da Gama": "Васко да Гама",
    Mirassol: "Мирасол", Palmeiras: "Палмейрас", Bahia: "Баия", Coritiba: "Коритиба",
    Gremio: "Гремио", Santos: "Сантос", Internacional: "Интернасьонал", Vitoria: "Витория",
    Parma: "Парма", "AS Roma": "Рома", Bologna: "Болонья", Atalanta: "Аталанта",
    Sassuolo: "Сассуоло", Udinese: "Удинезе", "Real Tomayapo": "Реал Томаяпо",
    "Nacional Potosi": "Насьональ Потоси", "Real Potosi": "Реал Потоси", "Real Oruro": "Реал Оруро",
    "Independiente Petrolero": "Индепендьенте Петролеро", Blooming: "Блуминг",
    Kasimpasa: "Касымпаша", Alanyaspor: "Аланьяспор",
    Juventus: "Ювентус", Venezia: "Венеция", Genoa: "Дженоа", Napoli: "Наполи", Torino: "Торино",
    "Philadelphia 76ers": "Филадельфия Севенти Сиксерс", "Milwaukee Bucks": "Милуоки Бакс",
    "Orlando Magic": "Орландо Мэджик", "Brooklyn Nets": "Бруклин Нетс", "Indiana Pacers": "Индиана Пэйсерс",
    "Miami Heat": "Майами Хит", "Atlanta Hawks": "Атланта Хокс", "New York Knicks": "Нью-Йорк Никс",
    "Portland Trail Blazers": "Портленд Трэйл Блэйзерс", "Minnesota Timberwolves": "Миннесота Тимбервулвз",
    "Toronto Raptors": "Торонто Рэпторс", "Memphis Grizzlies": "Мемфис Гриззлис",
    "San Antonio Spurs": "Сан-Антонио Спёрс", "New Orleans Pelicans": "Нью-Орлеан Пеликанс",
    "Sacramento Kings": "Сакраменто Кингз", "Boston Celtics": "Бостон Селтикс",
    "Alexander Zverev": "Александр Зверев", "Daniil Medvedev": "Даниил Медведев",
    "Arthur Fils": "Артюр Фис", "Ben Shelton": "Бен Шелтон", "Rafael Jodar": "Рафаэль Ходар",
    "Frances Tiafoe": "Фрэнсис Тиафо", "Carlos Alcaraz": "Карлос Алькарас", "Flavio Cobolli": "Флавио Коболли",
    "Leyre Romero Gormaz": "Лейре Ромеро Гормас", "Lucia Bronzetti": "Лючия Бронцетти",
    "Netzhoppers KW": "Нетцхопперс", "TV Rottenburg": "Роттенбург", "Allianz Milano": "Аллианц Милано",
    "Itas Trentino": "Итас Трентино", "Gas Sales Bluenergy Piacenza": "Пьяченца",
    "Sir Susa Scai Perugia": "Перуджа", "Pallavolo Padova": "Падова", "Vero Volley Monza": "Монца",
    "Cucine Lube Civitanova": "Кучине Любе Чивитанова", "Tinet Prata di Pordenone": "Прата-ди-Порденоне",
    "Valsa Group Modena": "Модена", "Cisterna Volley": "Чистерна",
    "Carolina Hurricanes": "Каролина", "Edmonton Oilers": "Эдмонтон", "Seattle Kraken": "Сиэтл",
    "Tampa Bay Lightning": "Тампа-Бэй", "Florida Panthers": "Флорида", "Philadelphia Flyers": "Филадельфия",
    "Nashville Predators": "Нэшвилл", "Pittsburgh Penguins": "Питтсбург", "Minnesota Wild": "Миннесота",
    "San Jose Sharks": "Сан-Хосе", "Vegas Golden Knights": "Вегас", "St. Louis Blues": "Сент-Луис",
    "Ottawa Senators": "Оттава", "Boston Bruins": "Бостон", "Detroit Red Wings": "Детройт",
    "Los Angeles Kings": "Лос-Анджелес", "Washington Capitals": "Вашингтон", "Buffalo Sabres": "Баффало",
    "New Jersey Devils": "Нью-Джерси", "Montreal Canadiens": "Монреаль", "Montréal Canadiens": "Монреаль",
    "New York Rangers": "Рейнджерс", "Winnipeg Jets": "Виннипег", "Toronto Maple Leafs": "Торонто",
    "Calgary Flames": "Калгари", "New York Islanders": "Айлендерс", "Columbus Blue Jackets": "Коламбус",
    "Anaheim Ducks": "Анахайм", "Chicago Blackhawks": "Чикаго", "Dallas Stars": "Даллас",
    "Vancouver Canucks": "Ванкувер", "Utah Mammoth": "Юта",
  };
  const tournaments = {
    "Premier League": "Английская Премьер-лига", LaLiga: "Ла Лига",
    "Brazil Serie A": "Бразилия, Серия А", "Brasileirão Série A": "Бразилия, Серия А",
    "Serie A": "Италия, Серия А", "División Profesional": "Высшая лига Боливии",
    NBA: "НБА", "National Basketball Association": "НБА", NHL: "НХЛ",
    "Nitto ATP Finals": "Итоговый турнир ATP", "LP Open by IND": "Открытый турнир LP",
    Bundesliga: "Бундеслига", SuperLega: "Итальянская Суперлига",
    "Super Lig": "Турецкая Суперлига", "Turkish Super Lig": "Турецкая Суперлига", "Super League": "Суперлига",
  };

  const names = new Map(Object.entries(teams).map(([name, ru]) => [name.toLowerCase(), ru]));
  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const knownNames = [...names.keys()].sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
  const namePattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${knownNames})(?![\\p{L}\\p{N}])`, "giu");
  const isEsports = (sport) => sport === "cs2" || sport === "dota2";
  const text = (value, sport) => isEsports(sport) ? String(value || "") :
    String(value || "").replace(namePattern, (name) => names.get(name.toLowerCase()) || name);

  function tournament(value, sport) {
    return !isEsports(sport) && Object.hasOwn(tournaments, value) ? tournaments[value] : String(value || "");
  }

  root.SportsRu = { text, tournament };
})(typeof window !== "undefined" ? window : globalThis);
