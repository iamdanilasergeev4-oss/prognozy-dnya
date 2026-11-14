#!/usr/bin/env python3
"""
Ежедневное обновление прогнозов.

1. Для каждого вида спорта ищет свежие прогнозы через Tavily (бесплатно 1000 запросов/мес).
2. Отдаёт найденные страницы нейросети (любой OpenAI-совместимый API: Gemini, Groq и т.д.),
   которая выбирает топ-5 ставок, опираясь только на найденные источники.
3. Сохраняет результат в data/predictions.json.

Без сторонних библиотек — только стандартный Python 3.9+.

Переменные окружения:
  TAVILY_API_KEY  — ключ Tavily (https://app.tavily.com)
  LLM_API_KEY     — ключ нейросети
  LLM_BASE_URL    — адрес API (по умолчанию Gemini)
  LLM_MODEL       — модель (по умолчанию gemini-2.5-flash)
"""

import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(ROOT, "data", "predictions.json")

TAVILY_KEY = os.environ.get("TAVILY_API_KEY", "")
LLM_KEY = os.environ.get("LLM_API_KEY", "")
LLM_BASE_URL = os.environ.get(
    "LLM_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai"
).rstrip("/")
LLM_MODEL = os.environ.get("LLM_MODEL", "gemini-2.5-flash")

# Сколько текста каждой страницы отдавать нейросети (меньше — для Groq с жёсткими лимитами)
PAGE_CHARS = int(os.environ.get("PAGE_CHARS", "2500"))
RESULTS_PER_QUERY = int(os.environ.get("RESULTS_PER_QUERY", "6"))

MSK = dt.timezone(dt.timedelta(hours=3))

MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля",
             "августа", "сентября", "октября", "ноября", "декабря"]

# Виды спорта и поисковые запросы ({en} / {ru} — сегодняшняя дата)
SPORTS = [
    {"id": "football", "name": "Футбол", "emoji": "⚽",
     "queries": ["football predictions betting tips {en}",
                 "прогнозы на футбол {ru}"]},
    {"id": "basketball", "name": "Баскетбол", "emoji": "🏀",
     "queries": ["basketball predictions betting tips {en} NBA Euroleague",
                 "прогнозы на баскетбол {ru}"]},
    {"id": "tennis", "name": "Теннис", "emoji": "🎾",
     "queries": ["tennis predictions betting tips {en}",
                 "прогнозы на теннис {ru}"]},
    {"id": "volleyball", "name": "Волейбол", "emoji": "🏐",
     "queries": ["volleyball predictions betting tips {en}",
                 "прогнозы на волейбол {ru}"]},
    {"id": "cs2", "name": "CS2", "emoji": "🔫",
     "queries": ["CS2 match predictions betting tips {en}",
                 "прогнозы на CS2 {ru}"]},
    {"id": "dota2", "name": "Dota 2", "emoji": "🐉",
     "queries": ["Dota 2 match predictions betting tips {en}",
                 "прогнозы на Dota 2 {ru}"]},
]


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def http_post_json(url, payload, headers, timeout=90):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in headers.items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def with_retries(fn, attempts=3, delay=20):
    last = None
    for i in range(attempts):
        try:
            return fn()
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "ignore")[:300]
            last = RuntimeError(f"HTTP {e.code}: {body}")
            if e.code in (400, 401, 403, 404):
                break  # повтор не поможет
        except Exception as e:  # noqa: BLE001
            last = e
        log(f"  попытка {i + 1} не удалась: {last}")
        time.sleep(delay * (i + 1))
    raise last


# ---------- Поиск ----------

def tavily_search(query):
    payload = {
        "query": query,
        "search_depth": "basic",      # 1 кредит за запрос
        "max_results": RESULTS_PER_QUERY,
        "include_raw_content": True,
        "time_range": "week",
    }
    res = with_retries(lambda: http_post_json(
        "https://api.tavily.com/search", payload,
        {"Authorization": f"Bearer {TAVILY_KEY}"}))
    return res.get("results", [])


def collect_sources(sport, now):
    date_en = now.strftime("%B %d %Y").replace(" 0", " ")
    date_ru = f"{now.day} {MONTHS_RU[now.month - 1]} {now.year}"
    seen, sources = set(), []
    for q in sport["queries"]:
        query = q.format(en=date_en, ru=date_ru)
        log(f"  поиск: {query}")
        try:
            results = tavily_search(query)
        except Exception as e:  # noqa: BLE001
            log(f"  поиск не удался: {e}")
            continue
        for r in results:
            url = r.get("url", "")
            if not url or url in seen:
                continue
            seen.add(url)
            text = (r.get("raw_content") or r.get("content") or "").strip()
            text = re.sub(r"\s+", " ", text)[:PAGE_CHARS]
            if len(text) < 200:
                continue
            sources.append({"title": (r.get("title") or url)[:150], "url": url, "text": text})
    return sources


# ---------- Нейросеть ----------

PROMPT = """Ты — аналитик ставок. Сегодня {today} (время московское).
Ниже — тексты страниц с прогнозами на {sport}, найденные в интернете. Каждая страница пронумерована.

Задача: выбрать до 5 лучших ставок на матчи, которые пройдут сегодня или завтра ({today} – {tomorrow}).
Правила:
- Используй ТОЛЬКО информацию из страниц ниже. Ничего не выдумывай: ни матчей, ни коэффициентов.
- Выше ставь прогнозы, которые совпадают в нескольких источниках (консенсус).
- Пропускай матчи, которые уже прошли, и прогнозы без понятной ставки.
- Если подходящих ставок меньше 5 — верни меньше. Если нет ни одной — пустой список.
- Пиши по-русски, кратко.

Верни ТОЛЬКО JSON без пояснений, в формате:
{{"picks": [
  {{"match": "Команда А — Команда Б",
    "tournament": "турнир/лига или пусто",
    "start": "дата и время начала по МСК, если известно, иначе пусто",
    "bet": "сама ставка, напр. «П1», «ТБ 2.5», «Обе забьют — да»",
    "odds": "коэффициент числом, если указан, иначе пусто",
    "confidence": число от 1 до 5 (5 — совпадает во многих источниках),
    "reason": "1–2 предложения обоснования",
    "sources": [номера страниц, где встречается этот прогноз]
  }}
]}}

СТРАНИЦЫ:
{pages}
"""


def ask_llm(prompt):
    payload = {
        "model": LLM_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
    }
    res = with_retries(lambda: http_post_json(
        f"{LLM_BASE_URL}/chat/completions", payload,
        {"Authorization": f"Bearer {LLM_KEY}"}, timeout=180))
    return res["choices"][0]["message"]["content"]


def parse_json(text):
    text = re.sub(r"```(?:json)?", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("в ответе нет JSON")
    return json.loads(text[start:end + 1])


def clean_pick(p, sources):
    def s(key, limit=200):
        v = p.get(key, "")
        return str(v).strip()[:limit] if v is not None else ""

    try:
        conf = max(1, min(5, int(float(p.get("confidence", 3)))))
    except (TypeError, ValueError):
        conf = 3
    links = []
    for idx in p.get("sources", []) or []:
        try:
            i = int(idx) - 1
        except (TypeError, ValueError):
            continue
        if 0 <= i < len(sources) and sources[i]["url"] not in [l["url"] for l in links]:
            links.append({"title": sources[i]["title"], "url": sources[i]["url"]})
    pick = {
        "match": s("match", 120), "tournament": s("tournament", 100),
        "start": s("start", 60), "bet": s("bet", 100), "odds": s("odds", 10),
        "confidence": conf, "reason": s("reason", 400), "sources": links[:5],
    }
    if not pick["match"] or not pick["bet"] or not links:
        return None  # без источника не публикуем
    return pick


def build_sport(sport, now):
    sources = collect_sources(sport, now)
    log(f"  найдено страниц: {len(sources)}")
    if not sources:
        raise RuntimeError("не найдено ни одного источника")
    pages = "\n\n".join(
        f"[{i}] {src['title']} ({src['url']})\n{src['text']}"
        for i, src in enumerate(sources, 1))
    tomorrow = now + dt.timedelta(days=1)
    prompt = PROMPT.format(
        today=now.strftime("%d.%m.%Y"), tomorrow=tomorrow.strftime("%d.%m.%Y"),
        sport=sport["name"], pages=pages)
    data = parse_json(ask_llm(prompt))
    picks = [p for p in (clean_pick(x, sources) for x in data.get("picks", [])) if p]
    picks.sort(key=lambda p: -p["confidence"])
    return picks[:5]


def main():
    if not TAVILY_KEY or not LLM_KEY:
        sys.exit("Нужны переменные окружения TAVILY_API_KEY и LLM_API_KEY")

    try:
        with open(DATA_FILE, encoding="utf-8") as f:
            old = {s["id"]: s for s in json.load(f).get("sports", [])}
    except Exception:  # noqa: BLE001
        old = {}

    now = dt.datetime.now(MSK)
    out = {"updated_at": now.isoformat(timespec="minutes"), "sports": []}
    ok = 0
    for sport in SPORTS:
        log(f"== {sport['name']}")
        entry = {"id": sport["id"], "name": sport["name"], "emoji": sport["emoji"]}
        try:
            entry["picks"] = build_sport(sport, now)
            entry["updated_at"] = out["updated_at"]
            ok += 1
            log(f"  готово: {len(entry['picks'])} ставок")
        except Exception as e:  # noqa: BLE001
            log(f"  ОШИБКА: {e} — оставляю вчерашние данные")
            prev = old.get(sport["id"], {})
            entry["picks"] = prev.get("picks", [])
            entry["updated_at"] = prev.get("updated_at")
            entry["stale"] = True
            entry["error"] = str(e)[:300]
        out["sports"].append(entry)
        time.sleep(5)  # бережём лимиты бесплатных API

    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    log(f"Сохранено. Обновлено видов спорта: {ok}/{len(SPORTS)}")


if __name__ == "__main__":
    main()
