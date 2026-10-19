import { nameKey } from './data.js';
import { describe, linearFit, pearson } from './stats.js';

export const LIMITS = { fileBytes: 5 * 1024 * 1024, cells: 250000, rows: 20000, columns: 512, drawn: 3000, individualGroups: 20 };
export function sample(points, cap = LIMITS.drawn) {
  if (points.length <= cap) return points;
  return Array.from({ length: cap }, (_, i) => points[Math.floor(i * (points.length - 1) / (cap - 1))]);
}
export function extent(points, axis) {
  let min = Infinity, max = -Infinity, positiveMin = Infinity, positiveMax = -Infinity;
  for (const p of points) {
    const v = p[axis]; min = Math.min(min, v); max = Math.max(max, v);
    if (v > 0) { positiveMin = Math.min(positiveMin, v); positiveMax = Math.max(positiveMax, v); }
  }
  return { linear: min === Infinity ? [] : [min, max], log: positiveMin === Infinity ? [] : [positiveMin, positiveMax] };
}
function chartPayload(points, extra) {
  let xNonPositive = 0, yNonPositive = 0, eitherNonPositive = 0;
  for (const p of points) { if (p.x <= 0) xNonPositive++; if (p.y <= 0) yNonPositive++; if (p.x <= 0 || p.y <= 0) eitherNonPositive++; }
  return { ...extra, points: sample(points), total: points.length, xRanges: extent(points, 'x'), yRanges: extent(points, 'y'), xNonPositive, yNonPositive, eitherNonPositive };
}
function summaries(records, by) {
  const buckets = new Map();
  for (const r of records) {
    const key = by === 'group' ? r.group : r.category;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r.y);
  }
  return [...buckets].map(([label, values]) => ({ label, ...describe(values) }));
}
export function createModel(a, b, names = ['First CSV', 'Second CSV']) {
  const canonical = new Map();
  for (const d of [a, b]) for (const s of d.series) if (!canonical.has(nameKey(s.group))) canonical.set(nameKey(s.group), s.group);
  const groups = [...canonical.values()].sort((x, y) => x.localeCompare(y));
  const groupSlots = Object.fromEntries(groups.map((g, i) => [g, i]));
  const flatten = d => d.series.flatMap(s => s.points.map(([x, y]) => ({ group: canonical.get(nameKey(s.group)), category: d.xTickLabels?.[x] ?? String(x), x, y })));
  const original = [flatten(a), flatten(b)];
  const bIndex = new Map(original[1].map(r => [JSON.stringify([nameKey(r.group), r.category]), r.y]));
  const paired = original[0].flatMap(r => {
    const x = bIndex.get(JSON.stringify([nameKey(r.group), r.category]));
    return x === undefined ? [] : [{ group: r.group, category: r.category, x, y: r.y }];
  });
  const labels = [a.valueHeader || names[0], b.valueHeader || names[1]];
  let filterKey = null, filtered, tables = new Map();
  function filter(query = '') {
    const key = nameKey(query);
    if (filterKey === key) return;
    filterKey = key; tables = new Map();
    const keep = r => nameKey(r.group).includes(key);
    filtered = [...original.map(rs => rs.filter(keep)), paired.filter(keep)];
  }
  function view({ query = '', overview = 'auto', hiddenBySource = [] } = {}) {
    filter(query);
    const visible = filtered.map((rows, i) => {
      const excluded = new Set(hiddenBySource[i] ?? []);
      return rows.filter(r => !excluded.has(r.group));
    });
    const [ra, rb, rp] = visible;
    const selectedGroups = new Set([...ra, ...rb].map(r => r.group)).size;
    const aggregate = overview === 'overview' || selectedGroups > LIMITS.individualGroups;
    const fit = { n: rp.length, r: pearson(rp), ...linearFit(rp) };
    const line = (records, i, ticks) => {
      const useMeans = overview === 'overview' || new Set(records.map(r => r.group)).size > LIMITS.individualGroups;
      const buckets = new Map();
      for (const r of records) { if (!buckets.has(r.x)) buckets.set(r.x, { sum: 0, n: 0, category: r.category }); const v = buckets.get(r.x); v.sum += r.y; v.n++; }
      const meanPoints = [...buckets].map(([x, v]) => ({ x, y: v.sum / v.n, n: v.n, group: 'Category mean', category: v.category }));
      const points = useMeans ? meanPoints : records;
      return chartPayload(points, { title: labels[i], xLabel: '', yLabel: labels[i], xTickLabels: ticks, connectGroups: true, aggregate: useMeans, meanPoints, sourceTotal: records.length, groupSlots });
    };
    const chartInputs = [line(ra, 0, a.xTickLabels), line(rb, 1, b.xTickLabels), chartPayload(rp, { title: `${labels[0]} vs. ${labels[1]}`, xLabel: labels[1], yLabel: labels[0], showTrend: true, statsOverride: fit, groupSlots })];
    chartInputs.forEach((chart, i) => {
      chart.groupNames = [...new Set(filtered[i].map(r => r.group))].sort((x, y) => x.localeCompare(y));
      chart.hiddenGroups = [...(hiddenBySource[i] ?? [])];
      chart.hiddenObservations = filtered[i].length - visible[i].length;
    });
    return {
      names, labels, groups: selectedGroups, aggregate, counts: visible.map(r => r.length), unfilteredCounts: [...original.map(r => r.length), paired.length],
      stats: [describe(ra.map(r => r.y)), describe(rb.map(r => r.y))], fit,
      charts: chartInputs,
      warnings: [...a.warnings.map(w => `${names[0]}: ${w}`), ...b.warnings.map(w => `${names[1]}: ${w}`)].slice(0, 60),
    };
  }
  function table({ source = 0, mode = 'detail', sort = 'group', query = '', excludedGroups = [] } = {}) {
    filter(query);
    const excluded = new Set(excludedGroups);
    const cacheKey = JSON.stringify([source, mode, sort, [...excluded].sort()]);
    if (!tables.has(cacheKey)) {
      const pairedSource = source === 2;
      const records = (filtered[source] ?? []).filter(r => !excluded.has(r.group));
      const columns = mode === 'detail' ? ['Group', 'Category', ...(pairedSource ? [labels[1], labels[0]] : [labels[source]])] : [mode === 'group' ? 'Group' : 'Category', 'n', 'Mean', 'Median', 'Sample SD', 'Min', 'Max'];
      let rows;
      if (mode === 'detail') {
        const sorted = [...records];
        if (sort === 'value' || sort === 'value-desc') sorted.sort((a, b) => (a.y - b.y) * (sort === 'value' ? 1 : -1));
        else if (sort === 'category') sorted.sort((a, b) => a.category.localeCompare(b.category) || a.group.localeCompare(b.group));
        else sorted.sort((a, b) => a.group.localeCompare(b.group) || a.x - b.x);
        rows = sorted.map(r => [r.group, r.category, ...(pairedSource ? [r.x, r.y] : [r.y])]);
      } else {
        const values = summaries(records, mode);
        if (sort === 'value' || sort === 'value-desc') values.sort((a, b) => (a.mean - b.mean) * (sort === 'value' ? 1 : -1));
        else if (mode === 'group' || sort === 'category') values.sort((a, b) => a.label.localeCompare(b.label));
        rows = values.map(s => [s.label, s.n, s.mean, s.median, s.sd, s.min, s.max]);
      }
      tables.set(cacheKey, { columns, rows, note: pairedSource && mode !== 'detail' ? `Summaries describe ${labels[0]} (Y) within matched pairs.` : '' });
      if (tables.size > 8) tables.delete(tables.keys().next().value);
    }
    return tables.get(cacheKey);
  }
  return { view, table, page(options = {}) {
    const t = table(options), size = [25, 50, 100].includes(Number(options.size)) ? Number(options.size) : 50;
    const pages = Math.max(1, Math.ceil(t.rows.length / size));
    const page = Math.max(0, Math.min(Number(options.page) || 0, pages - 1));
    return { ...t, rows: t.rows.slice(page * size, (page + 1) * size), total: t.rows.length, page, pages, size };
  } };
}

export function generatedPair(count, edge = false) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const a = [`Daily steps,${days.join(',')}`], b = [`Sleep (hours),${days.join(',')}`];
  for (let i = 0; i < count; i++) {
    const person = `Person ${String(i + 1).padStart(5, '0')}`;
    const steps = days.map((_, d) => edge && d === 0 ? 0 : Math.round(5200 + 2500 * Math.sin(i * 1.37 + d) + (i % 17) * 130));
    const sleep = steps.map((s, d) => edge && d === 1 ? -1 : Number((8.6 - s / 5200 + Math.sin(i * 0.71 + d) * 0.8).toFixed(3)));
    a.push([person, ...steps].join(',')); b.push([person.toLowerCase(), ...sleep].join(','));
  }
  return [a.join('\n'), b.join('\n')];
}
