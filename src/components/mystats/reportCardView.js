// Pure view-model for the Report Card hybrid layout: turns the store's
// card.groups cells into render-ready chapter rows (display delta, good
// direction with polarity applied, per-chapter normalized bar ratio) and
// the collapsed-chapter preview line. No theme, no React — unit-testable.

import { t, formatNumber } from '../../i18n';
import { num } from './msg';
import { cellKey, groupKey, countKey } from './reportKeys';

// "+1.2" / "-0.4" / "0" / "—".
export function fmtDelta(v) {
  if (v == null) return '—';
  if (v > 0) return `+${formatNumber(v)}`;
  return formatNumber(v);
}

// Display delta for a cell: career average when available, else the fixed
// 2.0 benchmark (pph cells only — count/shot cells have deltaVs2 = null).
function displayDelta(cell) {
  return cell.deltaVsAvg ?? cell.deltaVs2;
}

// Signed delta in the "good" direction, regardless of polarity.
function goodOf(cell) {
  const d = displayDelta(cell);
  if (d == null) return null;
  return cell.polarity === 'lower' ? -d : d;
}

const PCT_RE = / %$/;

function valueTextOf(cell) {
  return PCT_RE.test(cell.label) ? `${num(cell.value)}%` : num(cell.value);
}

function subOf(groupKey, cell) {
  if (groupKey === 'course' || groupKey === 'timing') {
    return t('stats.my.report.perHole', { value: formatNumber(Number(cell.value), { decimals: 2 }) });
  }
  if (groupKey === 'distribution') return t('stats.my.report.thisRound', { value: num(cell.value) });
  return t('stats.my.report.thisRound', { value: valueTextOf(cell) });
}

function previewOf(rows) {
  const scored = rows.filter((r) => r.good != null);
  if (scored.length > 0) {
    const best = scored.reduce((a, b) => (b.good > a.good ? b : a));
    const worst = scored.reduce((a, b) => (b.good < a.good ? b : a));
    return t('stats.my.report.preview', {
      best: best.label, bestDelta: fmtDelta(best.delta), worst: worst.label, worstDelta: fmtDelta(worst.delta),
    });
  }
  return rows.slice(0, 2)
    .map((r) => (r.countKey
      ? t(r.countKey, { count: r.count })
      : `${r.valueText} ${r.label.toLowerCase()}`))
    .join(' · ');
}

// One chapter's render model. The delta source is per-cell
// (deltaVsAvg ?? deltaVs2) — a split the player never recorded before
// falls back to the benchmark even when career history exists.
export function buildChapterVM(group, _opts = {}) {
  const rows = group.cells.map((cell) => ({
    label: cellKey(cell.label) ? t(cellKey(cell.label)) : cell.label.replace(PCT_RE, ''),
    valueText: valueTextOf(cell),
    sub: subOf(group.key, cell),
    delta: displayDelta(cell),
    good: goodOf(cell),
    countKey: countKey(cell.label),
    count: Number(cell.value),
  }));
  const max = rows.reduce((m, r) => Math.max(m, r.good != null ? Math.abs(r.good) : 0), 0);
  for (const r of rows) {
    r.ratio = r.good != null && max > 0 ? Math.abs(r.good) / max : 0;
  }
  return {
    key: group.key,
    label: groupKey(group.key) ? t(groupKey(group.key)) : group.label,
    rows,
    preview: previewOf(rows),
    hasDeltas: rows.some((r) => r.good != null),
  };
}

// Sub-line for a bright-spot / cost-you-points tile — same wording the old
// Callout component used.
export function calloutSub(cell) {
  const delta = cell.deltaVsAvg != null ? cell.deltaVsAvg : cell.deltaVs2;
  return t(cell.deltaVsAvg != null ? 'stats.my.report.calloutAvg' : 'stats.my.report.calloutMark', {
    value: num(cell.value), delta: fmtDelta(delta), mark: formatNumber(2, { decimals: 1 }),
  });
}
