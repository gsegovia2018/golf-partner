// Pure local-date helpers for the in-app date picker. Dates travel as
// 'YYYY-MM-DD' strings and times as 'HH:MM'; everything is computed on local
// calendar fields (never UTC) so a day never shifts across a timezone.

const pad = (n) => String(n).padStart(2, '0');

export function toIso(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

// 'YYYY-MM-DD' -> { y, m, d } (m is 1-12), or null when it is not a real date.
export function parseIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  const ok = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
  return ok ? { y, m: mo, d } : null;
}

export function todayIso(now = new Date()) {
  return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function addDays(iso, n) {
  const p = parseIso(iso);
  if (!p) return null;
  const d = new Date(p.y, p.m - 1, p.d + n);
  return toIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function lastDayOfMonth(iso) {
  const p = parseIso(iso);
  if (!p) return null;
  return toIso(p.y, p.m, new Date(p.y, p.m, 0).getDate());
}

// Next Saturday on or after `iso`.
export function nearestSaturday(iso) {
  const p = parseIso(iso);
  if (!p) return null;
  const dow = new Date(p.y, p.m - 1, p.d).getDay();
  return addDays(iso, (6 - dow + 7) % 7);
}

// Missing bounds are open-ended. ISO strings compare correctly as text.
export function inBounds(iso, min, max) {
  if (!parseIso(iso)) return false;
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
}

export function clampIso(iso, min, max) {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

// Months are { y, m } with m 1-12.
export function addMonths({ y, m }, n) {
  const d = new Date(y, m - 1 + n, 1);
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
}

// Monday-first grid: leading nulls, then every day of the month as ISO.
export function monthGrid({ y, m }) {
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const days = new Date(y, m, 0).getDate();
  const cells = Array(lead).fill(null);
  for (let d = 1; d <= days; d += 1) cells.push(toIso(y, m, d));
  return cells;
}

// 'HH:MM' moved by `delta` minutes, wrapping around midnight.
export function stepTime(text, delta) {
  const t = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim());
  const base = t ? Number(t[1]) * 60 + Number(t[2]) : 0;
  const total = (((base + delta) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

export function monthTitle({ y, m }) {
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// "Sat 10 Oct 2026" (en-GB, short weekday).
export function formatLabel(iso) {
  const p = parseIso(iso);
  if (!p) return '';
  return new Date(p.y, p.m - 1, p.d)
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    .replace(',', '');
}
