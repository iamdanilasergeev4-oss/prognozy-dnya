const formatter = new Intl.NumberFormat("ru", { maximumFractionDigits: 3 });
const percent = (value) => `${value}%`;
const value = (x) => formatter.format(x);
const scoreNumber = new Intl.NumberFormat("ru", { maximumFractionDigits: 1 });
const displayPercent = (p) => percent(Math.round(p * 100));
const signed = (x) => {
  const n = Math.round(x * 10) / 10 || 0;
  return (n > 0 ? "+" : "") + scoreNumber.format(n);
};

function displayPercentages(probabilities) {
  const values = Object.entries(probabilities).map(([id, p]) => ({ id, n: Math.floor(p * 100), remainder: p * 100 % 1 }));
  const extra = 100 - values.reduce((sum, item) => sum + item.n, 0);
  for (const row of [...values].sort((a, b) => b.remainder - a.remainder).slice(0, extra)) row.n++;
  return Object.fromEntries(values.map(({ id, n }) => [id, n]));
}

export function modelScenarios(targets, tests, event) {
  return targets.map((target) => {
    const display = displayPercentages(target.probabilities);
    const labels = target.id === "outcome"
      ? { home: `Победа «${event.match.split(/\s+[—–]\s+/)[0]}»`, draw: "Ничья",
        away: `Победа «${event.match.split(/\s+[—–]\s+/)[1]}»` }
      : { yes: target.title, no: `Условие «${target.title.toLowerCase()}» не выполнится` };
    const [leader, next] = Object.entries(target.probabilities).sort((a, b) => b[1] - a[1]);
    const metric = tests.find((row) => row.id === target.id);
    return { ...target, display, labels, outcome: leader[0], gap: leader[1] - next[1],
      // Rank by conservative relative test improvement, not by the predicted probability.
      quality: Math.min(-metric.interval.high / metric.baseline.brier,
        ...metric.periods.map((p) => (p.baseline.brier - p.model.brier) / p.baseline.brier)),
      validation: { tested: metric.paired, brier: metric.model.brier, baseline: metric.baseline.brier,
        calibration: metric.model.ece, upperDifference: metric.interval.high, periods: metric.periods.map((p) => p.n) } };
  });
}

export function modelScenarioLine(scenario) {
  const { id, labels, display } = scenario;
  return id === "outcome" ? Object.entries(display).map(([key, n]) => `${labels[key]} ${percent(n)}`).join(", ") + "."
    : `${labels.yes} — ${percent(display.yes)}.`;
}

export function modelConclusion(scenarios, statistic, inputs, limitations) {
  const primary = [...scenarios].sort((a, b) => b.quality - a.quality ||
    a.validation.calibration - b.validation.calibration || a.id.localeCompare(b.id))[0];
  const close = primary.gap <= 0.06;
  const { tested, brier, baseline, calibration, upperDifference, periods } = primary.validation;
  const probability = primary.display[primary.outcome];
  const label = primary.labels[primary.outcome];
  const result = close ? `${primary.title}. Явного преимущества нет. ${modelScenarioLine(primary)}`
    : primary.id === "outcome"
      ? `Наибольшая из трёх оценок — ${label[0].toLowerCase() + label.slice(1)} (${percent(probability)}). Остальные исходы суммарно — ${percent(100 - probability)}.`
      : `${label} — ${percent(probability)}.`;
  const evidence = `Этот показатель выбран по качеству исторической проверки. На ${tested} матчах ошибка Брайера составила ${value(brier)} против ${value(baseline)} у базового подхода. По периодам — ${periods.join(" и ")} матчей.`;
  const caution = `Ошибка калибровки — ${value(calibration * 100)} п. п. ${Math.abs(upperDifference) < 0.001 ?
    "Преимущество на исторических данных небольшое. " : ""}Проверка ретроспективная, оценки на будущих матчах ещё накапливаются.`;
  return { id: primary.id, scenario: result, outcome: primary.outcome,
    probability: close ? null : primary.probabilities[primary.outcome], close, quality: primary.quality,
    statistic, evidence, caution, inputs, limitations };
}

export function describeScoreDistribution(scores, checks, event, statistic, inputs, limitations, includeReferences = true) {
  const side = event.match.split(/\s+[—–]\s+/);
  const units = { football: "голов", basketball: "очков", hockey: "шайб" }[event.sport];
  const labels = { total: "Общий счёт", margin: "Разница счёта (первая минус вторая команда)",
    home: `Счёт «${side[0]}»`, away: `Счёт «${side[1]}»` };
  const format = (id, n) => id === "margin" ? signed(n) : scoreNumber.format(n);
  const bandPercentages = (range) => displayPercentages({ lower: range.lower, center: range.probability, upper: range.upper });
  const expected = ({ id, mean }) => `${labels[id]} (${units}) — в среднем ${format(id, mean)}.`;
  const explain = ({ id, range }) => {
    const band = `от ${format(id, range.low)} до ${format(id, range.high)}`;
    const { lower, center, upper } = bandPercentages(range);
    return `${labels[id]}. Центральный диапазон ${band}, вероятность ${percent(center)}. Ниже — ${percent(lower)}, выше — ${percent(upper)}.`;
  };
  const step = event.sport === "basketball" ? 3 : 1;
  const references = (includeReferences ? scores : []).flatMap(({ id, thresholds, support, range }) => {
    const atLeast = (cut) => support.reduce((sum, [score, mass]) => score >= cut ? sum + mass : sum, 0);
    return thresholds.map(({ value, probability, reference }) => {
      const location = value < range.low ? "ниже центрального диапазона" : value > range.high ?
        "выше центрального диапазона" : "в центральном диапазоне";
      const above = Math.round(probability * 100);
      return `${labels[id]}. ${format(id, value)} или больше — ${percent(above)}, меньше — ${percent(100 - above)}. ` +
        `Граница ${location}. Среди проверяемых порогов её вероятность ближе всего к справочному ориентиру ${displayPercent(reference)}. ` +
        `Для границы ${format(id, value - step)} или больше оценка ${displayPercent(atLeast(value - step))}, для ${format(id, value + step)} или больше — ${displayPercent(atLeast(value + step))}.`;
    });
  });
  const sections = [
    { title: "Ожидаемый результат", lines: scores.map(expected) },
    { title: "Диапазон результатов и сценарии", lines: scores.map(explain) },
    { title: "Справочные пороги", lines: references.length ? [
      "Пороги показывают, как меняется доля результатов при разных границах счёта. Все оценки округлены. При сдвиге порога меняется само условие.",
      ...references,
    ] : [] },
  ].filter(({ lines }) => lines.length);
  // The total covers both teams. If unsupported, use a signed margin, then
  // a team score. Ranking never compares probabilities of different events.
  const primary = ["total", "margin", "home", "away"].map((id) => scores.find((item) => item.id === id)).find(Boolean);
  if (!primary) return { headlines: [], sections, conclusion: null };
  const check = checks.find(({ id }) => id === primary.id);
  const { n, model, baseline, coverage, mass, interval } = check;
  const conclusion = { id: `distribution_${primary.id}`, expected: expected(primary), scenario: explain(primary), probability: primary.range.probability,
    outcome: "range", close: false, quality: -interval.high / baseline, statistic, inputs, limitations,
    evidence: `Диапазон построен для этой встречи. Его историческая проверка охватила ${n} матчей. Ошибка распределения CRPS — ${value(model)} против ${value(baseline)} у базового подхода.`,
    caution: `В исторической проверке в такой диапазон попали ${displayPercent(coverage)} матчей при средней оценке ${displayPercent(mass)}. Реальный счёт может выйти за границы диапазона.`,
  };
  return { headlines: [conclusion.expected, conclusion.scenario], sections, conclusion };
}

export function dailyModelSummary(articles, moscowDate) {
  const eligible = articles.filter((article) => article.start_iso.startsWith(moscowDate) && article.modelConclusion);
  const bySport = Map.groupBy(eligible, (article) => article.sport_id);
  return [...bySport.values()].map((rows) => [...rows].sort((a, b) =>
    Number(a.modelConclusion.close) - Number(b.modelConclusion.close) ||
    b.modelConclusion.quality - a.modelConclusion.quality || a.start_iso.localeCompare(b.start_iso))[0])
    .map(({ sport_id, sport, match, start_iso, modelConclusion }) => ({ sport_id, sport, match, start_iso, modelConclusion }));
}

export function expressHighlights(articles, moscowDate, limit = 6) {
  const eligible = articles.filter((article) => article.start_iso.startsWith(moscowDate) &&
    article.modelConclusion && !article.modelConclusion.close);
  const queues = [...Map.groupBy(eligible, (article) => article.sport_id).values()].map((group) =>
    [...group].sort((a, b) => b.modelConclusion.quality - a.modelConclusion.quality || a.start_iso.localeCompare(b.start_iso)));
  const used = new Set();
  const selected = [];
  while (selected.length < limit && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      if (selected.length === limit) break;
      const article = queue.shift();
      if (!article) continue;
      const sides = article.match.split(/\s+[—–]\s+/).map((side) =>
        `${article.sport_id}:${side.toLowerCase().normalize("NFKC")}`);
      if (sides.length !== 2 || sides.some((key) => used.has(key))) continue;
      sides.forEach((side) => used.add(side));
      const { sport_id, sport, match, start_iso, modelConclusion } = article;
      selected.push({ sport_id, sport, match, start_iso, modelConclusion });
    }
  }
  return selected;
}
