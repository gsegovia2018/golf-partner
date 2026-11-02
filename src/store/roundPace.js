// When a round will end, and whether daylight lasts that long. Pure.
//
// Pace is minutes per hole. The live figure is the time from the round's
// start to the last hole left (hole `ts` on the cards, see roundDuration.js)
// over the holes played. Early in a round it says little, so it is blended
// with a prior — the club's usual pace from earlier rounds, else the
// player's, else DEFAULT_MIN_PER_HOLE — weighted as PRIOR_WEIGHT holes.
//
// Daylight ends at civil dusk (sun 6° below the horizon, ~30 min after
// sunset in Spain): golf stops being playable around then. Computed on the
// phone from the course's coordinates, so it works with no signal.

const MIN = 60 * 1000;
export const DEFAULT_MIN_PER_HOLE = 14.5; // ≈ 4h20 for 18
export const PRIOR_WEIGHT = 3;
const MIN_PACE = 6;
const MAX_PACE = 30;
// Finishing this close to dark counts as a risk too: shown as "light until".
export const TIGHT_MARGIN_MS = 15 * MIN;

const RAD = Math.PI / 180;
const J1970 = 2440587.5;
const J2000 = 2451545;
const OBLIQUITY = 23.4397 * RAD;

// Sunset and civil dusk (ms) on the day of `dateMs` at [lat, lng], or null
// when the sun does not set (polar day/night).
export function sunTimes(dateMs, lat, lng) {
  if (![dateMs, lat, lng].every(Number.isFinite)) return null;
  const lw = -lng * RAD;
  const phi = lat * RAD;
  const jd = dateMs / 86400000 + J1970;
  const n = Math.round(jd - J2000 - 0.0009 - lw / (2 * Math.PI));
  const jApprox = J2000 + 0.0009 + lw / (2 * Math.PI) + n;
  const M = (357.5291 + 0.98560028 * (jApprox - J2000)) * RAD;
  const C = (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * RAD;
  const L = M + C + 102.9372 * RAD + Math.PI;
  const jTransit = jApprox + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const dec = Math.asin(Math.sin(L) * Math.sin(OBLIQUITY));
  const setAt = (altDeg) => {
    const cosW = (Math.sin(altDeg * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
    if (cosW < -1 || cosW > 1) return null;
    const w = Math.acos(cosW);
    const jSet = jTransit + w / (2 * Math.PI);
    return Math.round((jSet - J1970) * 86400000);
  };
  const sunset = setAt(-0.833);
  const dusk = setAt(-6);
  return sunset == null || dusk == null ? null : { sunset, dusk };
}

function median(xs) {
  const v = xs.filter((x) => Number.isFinite(x) && x >= MIN_PACE && x <= MAX_PACE).sort((a, b) => a - b);
  if (v.length < 2) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// The pace to expect before this round says anything: the club's median
// from `history` ([{ course, minPerHole }]), else everyone's, else the default.
export function priorPace(history, courseName) {
  const key = normalizeCourse(courseName);
  const club = median((history ?? []).filter((h) => key && normalizeCourse(h.course) === key).map((h) => h.minPerHole));
  if (club != null) return { minPerHole: club, source: 'club' };
  const all = median((history ?? []).map((h) => h.minPerHole));
  if (all != null) return { minPerHole: all, source: 'usual' };
  return { minPerHole: DEFAULT_MIN_PER_HOLE, source: 'default' };
}

export function normalizeCourse(name) {
  return String(name ?? '').trim().toLowerCase();
}

// Hole numbers still to play, in playing order: the round's holes after the
// last one scored (wrapping, for a round started on the 10th), unscored only.
export function holesToPlay(holeNumbers, scored) {
  const nums = [...holeNumbers].sort((a, b) => a - b);
  const done = new Set(scored);
  const last = nums.filter((h) => done.has(h)).pop();
  const i = last == null ? 0 : nums.indexOf(last) + 1;
  return [...nums.slice(i), ...nums.slice(0, i)].filter((h) => !done.has(h));
}

// The projection, or null when the round is over or has no holes.
//   startAt   — the round's start (ms), or null before it starts
//   lastAt    — when the last hole was left (ms), or null
//   played    — holes scored so far
//   remaining — hole numbers still to play, in order (holesToPlay)
//   prior     — minutes per hole to expect (priorPace)
//   dusk      — end of daylight (ms), or null when unknown
// → { finishAt, minPerHole, level: 'ok' | 'tight' | 'risk', darkHole, darkAfter, dusk }
//   darkHole: the first hole that would end after dusk (risk only);
//   darkAfter: how many of `remaining` end before it.
export function projectRound({
  now, startAt = null, lastAt = null, played = 0, remaining = [], prior = DEFAULT_MIN_PER_HOLE, dusk = null,
}) {
  if (!remaining.length) return null;
  let pace = prior;
  if (played > 0 && Number.isFinite(startAt) && Number.isFinite(lastAt) && lastAt > startAt) {
    const live = (lastAt - startAt) / MIN / played;
    if (live >= MIN_PACE && live <= MAX_PACE) {
      pace = (played * live + PRIOR_WEIGHT * prior) / (played + PRIOR_WEIGHT);
    }
  }
  const step = pace * MIN;
  // The hole in progress began when the last one was left (or at the start);
  // once it runs past a normal hole, the clock is the better anchor.
  const from = played > 0 && Number.isFinite(lastAt) ? lastAt : (Number.isFinite(startAt) ? startAt : now);
  const base = Math.max(from, now - step);
  const ends = remaining.map((_, i) => base + (i + 1) * step);
  const finishAt = ends[ends.length - 1];

  let level = 'ok';
  let darkHole = null;
  let darkAfter = null;
  if (Number.isFinite(dusk)) {
    const i = ends.findIndex((t) => t > dusk);
    if (i >= 0) { level = 'risk'; darkHole = remaining[i]; darkAfter = i; }
    else if (dusk - finishAt < TIGHT_MARGIN_MS) level = 'tight';
  }
  return { finishAt, minPerHole: pace, level, darkHole, darkAfter, dusk: Number.isFinite(dusk) ? dusk : null };
}

// "19:06" in the phone's local time.
export function clockLabel(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
