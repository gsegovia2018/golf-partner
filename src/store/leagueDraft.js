// League create wizard: pure draft helpers (no I/O). The screen keeps the
// text the user typed; these turn it into the values createLeague() takes.
import { DEFAULT_POINTS_TABLE } from './leagueStandings';
import { clampHandicap } from './leagueRules';
import { parseHandicapIndex } from '../lib/handicap';

export const DEFAULT_HANDICAP_CAP = 30;

const pad = (n) => String(n).padStart(2, '0');

// Local calendar date as 'YYYY-MM-DD'.
export function isoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Default season: today until 31 December of this year.
export function defaultSeason(now = new Date()) {
  return { seasonStart: isoDate(now), seasonEnd: `${now.getFullYear()}-12-31` };
}

// 'YYYY-MM-DD' that is a real calendar date, or null.
export function parseIsoDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  const ok = date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
  return ok ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function formatPointsTable(table) {
  return (table ?? []).join(', ');
}

// '500, 300 190' -> [500, 300, 190]. null when empty or not whole numbers >= 0.
export function parsePointsTable(text) {
  const parts = String(text ?? '').split(/[\s,;·]+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 40) return null;
  const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  return nums.every(Number.isFinite) ? nums : null;
}

// '30' | '30,5' | '' -> cents. Empty means no fee. null when not a money amount.
export function parseFeeCents(text) {
  const t = String(text ?? '').trim().replace(',', '.');
  if (t === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}

// A member's starting league handicap: their profile index, clamped to the cap.
// null when the profile has none (the admin fills it in).
export function defaultMemberHandicap(profileHandicap, cap = DEFAULT_HANDICAP_CAP) {
  if (profileHandicap == null || profileHandicap === '') return null;
  const n = Number(profileHandicap);
  if (!Number.isFinite(n)) return null;
  return Math.round(clampHandicap(n, cap) * 10) / 10;
}

// Handicap text field -> number (clamped to the cap) or null when blank/invalid.
export function parseMemberHandicap(text, cap = DEFAULT_HANDICAP_CAP) {
  const r = parseHandicapIndex(text);
  return r.ok ? Math.round(clampHandicap(r.value, cap) * 10) / 10 : null;
}

// Draft -> createLeague() argument. `members` = [{ userId, handicap }] with the
// creator first.
export function buildCreateArgs({
  name, seasonStart, seasonEnd, pointsTable = DEFAULT_POINTS_TABLE, cap = DEFAULT_HANDICAP_CAP,
  feeCents = 0, members = [],
}) {
  return {
    name: String(name ?? '').trim(),
    seasonStart,
    seasonEnd,
    pointsTable,
    cap,
    feeCents,
    members: members.map((m) => ({ userId: m.userId, handicap: m.handicap ?? null })),
  };
}

export function leagueJoinLink(origin, code) {
  return `${origin}/league/${code}`;
}
