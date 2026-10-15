// League create wizard: pure draft helpers (no I/O). The screen keeps the
// text the user typed; these turn it into the values createLeague() takes.
import { DEFAULT_POINTS_TABLE } from './leagueStandings';
import { clampHandicap } from './leagueRules';
import { parseHandicapIndex } from '../lib/handicap';

export const DEFAULT_HANDICAP_CAP = 30;
// Season points every counting card earns at least (the server's default too).
export const DEFAULT_PARTICIPATION_POINTS = 10;

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

export const POINTS_TABLE_MAX_PLACES = 40;

// Each place of the points-table sheet is a text field. Returns the numbers
// when every field is a whole number >= 0 (1 to 40 places, the same rules as
// parsePointsTable), else { table: null, badIndex } with the first bad field
// (-1 when the list itself is empty or too long).
export function checkPointsDrafts(drafts) {
  const list = drafts ?? [];
  if (list.length === 0 || list.length > POINTS_TABLE_MAX_PLACES) return { table: null, badIndex: -1 };
  const badIndex = list.findIndex((d) => !/^\d+$/.test(String(d ?? '').trim()));
  if (badIndex >= 0) return { table: null, badIndex };
  return { table: list.map((d) => Number(String(d).trim())), badIndex: -1 };
}

// Entry fee as a whole-euro stepper: feeText is what parseFeeCents reads.
// Steps by 5 EUR, never below 0; '' at 0. Returns null when feeText is invalid.
export const FEE_STEP_EUROS = 5;
export function stepFeeText(feeText, direction) {
  const cents = parseFeeCents(feeText);
  if (cents == null) return null;
  const next = Math.max(0, Math.floor(cents / 100) + direction * FEE_STEP_EUROS);
  return next === 0 ? '' : String(next);
}

// Calendar months ('YYYY-MM') a season touches, first to last. [] when either
// date is missing or the end comes before the start.
export function seasonMonthKeys(startIso, endIso) {
  if (!startIso || !endIso || startIso > endIso) return [];
  const [sy, sm] = startIso.split('-').map(Number);
  const [ey, em] = endIso.split('-').map(Number);
  const keys = [];
  for (let i = sy * 12 + (sm - 1); i <= ey * 12 + (em - 1); i += 1) {
    keys.push(`${Math.floor(i / 12)}-${pad((i % 12) + 1)}`);
  }
  return keys;
}

// Medal play (strokes against par) is scored by the server
// (20261020000000) but the screens don't show it yet: the wizard offers it
// once this is true (plan 2026-10-15-league-medal-play.md, PR B).
export const MEDAL_FORMATS_ENABLED = false;

const STABLEFORD_FORMAT = {
  key: 'stableford', icon: 'target', section: 'points',
  labelKey: 'league.format.stableford', subtitleKey: 'league.format.stablefordSub',
};
const MEDAL_FORMATS = [
  {
    key: 'medal_net', icon: 'flag', section: 'strokes',
    labelKey: 'league.format.medalNet', subtitleKey: 'league.format.medalNetSub',
  },
  {
    key: 'medal_gross', icon: 'flag', section: 'strokes',
    labelKey: 'league.format.medalGross', subtitleKey: 'league.format.medalGrossSub',
  },
];

// The formats the wizard offers (leagues.format keys).
export function leagueFormats(medalEnabled = MEDAL_FORMATS_ENABLED) {
  return medalEnabled ? [STABLEFORD_FORMAT, ...MEDAL_FORMATS] : [STABLEFORD_FORMAT];
}
export const LEAGUE_FORMATS = leagueFormats();
export const LEAGUE_FORMAT_SECTIONS = [
  { section: 'points', labelKey: 'league.format.points' },
  { section: 'strokes', labelKey: 'league.format.strokes' },
];
export const DEFAULT_LEAGUE_FORMAT = 'stableford';

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
// creator first, then [{ name, handicap }] for people not in the app.
// `format` is a leagues.format key (DEFAULT_LEAGUE_FORMAT when not given).
export function buildCreateArgs({
  name, seasonStart, seasonEnd, pointsTable = DEFAULT_POINTS_TABLE, cap = DEFAULT_HANDICAP_CAP,
  feeCents = 0, participationPoints = DEFAULT_PARTICIPATION_POINTS, members = [],
  format = DEFAULT_LEAGUE_FORMAT,
}) {
  return {
    name: String(name ?? '').trim(),
    seasonStart,
    seasonEnd,
    pointsTable,
    cap,
    feeCents,
    participationPoints,
    format,
    members: members.map((m) => (m.userId
      ? { userId: m.userId, handicap: m.handicap ?? null }
      : { name: String(m.name ?? '').trim(), handicap: m.handicap ?? null })),
  };
}

export function leagueJoinLink(origin, code) {
  return `${origin}/league/${code}`;
}
