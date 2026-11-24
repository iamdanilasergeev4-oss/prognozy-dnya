(function (root) {
  "use strict";

  const teams = {
    "Newcastle United": "Ньюкасл Юнайтед", Arsenal: "Арсенал", Fulham: "Фулхэм", Everton: "Эвертон",
    Brentford: "Брентфорд", "Manchester United": "Манчестер Юнайтед",
    "Bristol City": "Бристоль Сити", "Bristol City FC": "Бристоль Сити", Wrexham: "Рексем", "Wrexham AFC": "Рексем",
    Portsmouth: "Портсмут", "Portsmouth FC": "Портсмут", "West Ham United": "Вест Хэм Юнайтед",
    "West Ham United FC": "Вест Хэм Юнайтед",
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
    "Oklahoma City Thunder": "Оклахома-Сити Тандер", "Washington Wizards": "Вашингтон Уизардс",
    "Utah Jazz": "Юта Джаз", "Dallas Mavericks": "Даллас Маверикс", "Chicago Bulls": "Чикаго Буллз",
    "Denver Nuggets": "Денвер Наггетс", "Golden State Warriors": "Голден Стэйт Уорриорз",
    "Charlotte Hornets": "Шарлотт Хорнетс", "Cleveland Cavaliers": "Кливленд Кавальерс",
    "Phoenix Suns": "Финикс Санз", "Los Angeles Lakers": "Лос-Анджелес Лейкерс",
    "Alexander Zverev": "Александр Зверев", "Daniil Medvedev": "Даниил Медведев",
    "Arthur Fils": "Артюр Фис", "Ben Shelton": "Бен Шелтон", "Rafael Jodar": "Рафаэль Ходар",
    "Frances Tiafoe": "Фрэнсис Тиафо", "Carlos Alcaraz": "Карлос Алькарас", "Flavio Cobolli": "Флавио Коболли",
    "Leyre Romero Gormaz": "Лейре Ромеро Гормас", "Lucia Bronzetti": "Лючия Бронцетти",
    "Berta Bonardi": "Берта Бонарди", "Carole Monnet": "Кароль Монне",
    "Despina Papamichail": "Деспина Папамихаил", "Julia Riera": "Хулия Риера",
    "Martina Trevisan": "Мартина Тревизан", "Ayana Akli": "Айана Акли",
    "Нишеш Басавареддy": "Нишеш Басаваредди",
    "Netzhoppers KW": "Нетцхопперс", "TV Rottenburg": "Роттенбург", "Allianz Milano": "Аллианц Милано",
    "Itas Trentino": "Итас Трентино", "Gas Sales Bluenergy Piacenza": "Пьяченца",
    "Sir Susa Scai Perugia": "Перуджа", "Pallavolo Padova": "Падова", "Vero Volley Monza": "Монца",
    "Cucine Lube Civitanova": "Кучине Любе Чивитанова", "Tinet Prata di Pordenone": "Прата-ди-Порденоне",
    "Valsa Group Modena": "Модена", "Cisterna Volley": "Чистерна",
    "Energa Trefl Gdańsk": "Трефль Гданьск", "Trefl Gdańsk": "Трефль Гданьск",
    "NEONET Norwid Częstochowa": "Норвид Ченстохова", "Norwid Czestochowa": "Норвид Ченстохова",
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
    "Premier League": "Английская Премьер-лига", Championship: "Чемпионшип", "English League Championship": "Чемпионшип", LaLiga: "Ла Лига",
    "Brazil Serie A": "Бразилия, Серия А", "Brasileirão Série A": "Бразилия, Серия А",
    "Serie A": "Италия, Серия А", "División Profesional": "Высшая лига Боливии",
    NBA: "НБА", "National Basketball Association": "НБА", NHL: "НХЛ", "National Hockey League": "НХЛ",
    "IEB+ Argentina Open": "Открытый чемпионат Аргентины", "Buenos Aires": "Буэнос-Айрес",
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

  const tournamentParts = [
    [/Winline Basket Cup/gi, "Баскетбольный кубок Винлайн"], [/Liga Endesa \(ACB\)/gi, "Лига Эндеса (АКБ)"],
    [/League One/gi, "Лига 1"], [/\bJ1\b/g, "Джей-1"],
    [/ATP Challenger/gi, "Челленджер АТП"], [/ATP Finals/gi, "Итоговый турнир АТП"],
    [/\bATP\b/g, "АТП"], [/\bWTA\b/g, "ВТА"],
    [/PlusLiga/gi, "ПлюсЛига"], [/Serie A1/gi, "Серия А1"], [/Tauron Liga/gi, "Таурон Лига"],
    [/SuperLega/gi, "Суперлига"], [/\bSerie A\b/gi, "Серия А"],
  ];
  function tournament(value, sport) {
    const label = String(value || "");
    if (isEsports(sport)) return label;
    return tournamentParts.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement),
      Object.hasOwn(tournaments, label) ? tournaments[label] : label);
  }

  root.SportsRu = { text, tournament };
})(typeof window !== "undefined" ? window : globalThis);
