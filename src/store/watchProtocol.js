// Wear OS companion protocol (v1). Pure: the phone -> watch state builder and
// the watch -> phone command validator/decider. The hook (hooks/useWatchBridge)
// gathers inputs and runs the effects; this file decides nothing about React.
// Contract: docs/superpowers/plans/2026-10-11-wear-os-watch-companion.md

export const WATCH_PROTOCOL_VERSION = 1;

export const WATCH_DRIVE_LIES = ['fairway', 'rough', 'sand', 'trouble'];
export const WATCH_STROKES_MAX = 15;
const PATCH_RANGES = {
  putts: [0, 10], sandShots: [0, 9], otherPenalties: [0, 9], teePenalties: [0, 9],
};
// Enumerated patch keys -> allowed values (null clears). Mirrors the options
// of the phone's ShotDetailPanel; `teeClub` has no 'driver' (driver is null).
const PATCH_ENUMS = {
  drive: ['left', 'fairway', 'right', 'short', 'super'],
  teeClub: ['wood', 'hybrid', 'iron'],
  driveDistBucket: ['0-150', '150-180', '180-210', '210-240', '240+'],
  recoveryOutcome: ['up-and-down', 'sand-save', 'none'],
  firstPuttBucket: ['0-1', '1-2', '2-3', '3-6', '6+'],
  approachBucket: ['0-50', '50-100', '100-150', '150-200', '200+'],
  approachResult: ['green', 'miss'],
  approachMiss: ['long', 'short', 'left', 'right'],
};
// The watch-visible subset of a hole's shot detail (see state.mine).
export const WATCH_SHOT_FIELDS = [
  'putts', 'drive', 'teeClub', 'driveDistBucket', 'teePenalties', 'otherPenalties', 'sandShots',
  'recoveryOutcome', 'firstPuttBucket', 'approachBucket', 'approachResult', 'approachMiss',
  'approachBunker',
];

const isInt = (n) => Number.isInteger(n);
const inRange = (n, lo, hi) => isInt(n) && n >= lo && n <= hi;

// `units` is the app setting ('meters' | 'yards'); the wire says 'm' | 'yd'.
const wireUnits = (units) => (units === 'yards' || units === 'yd' ? 'yd' : 'm');

// `ack` is the id of the last watch command the phone finished processing
// (applied or rejected), or null: the watch ends its optimistic overlay for a
// command when it sees that command's id here, not on any newer rev.
// `lastReject` is the most recent watch command the phone refused,
// `{ id, reason, hole }` (reason from decideWatchCommand, or 'refused' when the
// scorecard turned the write or move down), or null; it outlives later
// commands, so a reject is not lost when the state that carried it is coalesced.
export function watchStateOf({
  rev, ack, lastReject, round, courseName, holeNumber, holeCount, par, si, extraShots,
  green, phoneDistances, units, me, track, blocked, course, mine,
}) {
  if (!round) {
    return {
      v: WATCH_PROTOCOL_VERSION, rev, ack: ack ?? null, lastReject: lastReject ?? null, active: false, roundId: null, courseName: null, blocked: null,
    };
  }
  return {
    v: WATCH_PROTOCOL_VERSION,
    rev,
    ack: ack ?? null,
    lastReject: lastReject ?? null,
    roundId: round.id,
    courseName: courseName ?? null,
    active: true,
    blocked: blocked ?? null,
    units: wireUnits(units),
    hole: {
      number: holeNumber,
      count: holeCount,
      par,
      si: si ?? null,
      extraShots: extraShots ?? 0,
      green: green ?? null,
      phone: phoneDistances ?? null,
    },
    course: course ?? null,
    mine: mine ?? {},
    me: {
      playerId: me.playerId,
      name: me.name ?? '',
      strokes: me.strokes ?? null,
      points: me.points ?? null,
      totalPoints: me.totalPoints ?? 0,
      thru: me.thru ?? 0,
      putts: me.putts ?? null,
      driveLie: me.driveLie ?? null,
      sandShots: me.sandShots ?? 0,
      penalties: me.otherPenalties ?? 0,
    },
    // A group missing from settings is on, as ShotDetailPanel treats it.
    track: {
      putting: track?.putting !== false,
      teeShot: track?.teeShot !== false,
      approach: track?.approach !== false,
      shortGame: track?.shortGame !== false,
      penalties: track?.penalties !== false,
    },
  };
}

function parsePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
  const keys = Object.keys(patch);
  if (!keys.length) return null;
  const out = {};
  for (const key of keys) {
    const value = patch[key];
    if (key === 'driveLie') {
      if (value !== null && !WATCH_DRIVE_LIES.includes(value)) return null;
    } else if (key === 'approachBunker') {
      if (typeof value !== 'boolean') return null;
    } else if (PATCH_ENUMS[key]) {
      if (value !== null && !PATCH_ENUMS[key].includes(value)) return null;
    } else if (PATCH_RANGES[key]) {
      if (!inRange(value, ...PATCH_RANGES[key])) return null;
    } else {
      return null; // unknown key: never write what we do not know
    }
    out[key] = value;
  }
  return out;
}

// Raw message string (or already-parsed object) -> a validated command, or
// null for anything malformed. Range checks that need the round (`to` within
// the hole count) are left to decideWatchCommand.
export function parseWatchCommand(json) {
  let raw = json;
  if (typeof json === 'string') {
    try { raw = JSON.parse(json); } catch { return null; }
  }
  if (!raw || typeof raw !== 'object' || raw.v !== WATCH_PROTOCOL_VERSION) return null;
  if (typeof raw.id !== 'string' || !raw.id || typeof raw.roundId !== 'string' || !raw.roundId) return null;
  if (!isInt(raw.baseRev)) return null;
  const head = { id: raw.id, roundId: raw.roundId, baseRev: raw.baseRev, type: raw.type };
  if (raw.type === 'hole') {
    return isInt(raw.to) && raw.to >= 1 ? { ...head, to: raw.to } : null;
  }
  if (raw.type !== 'strokes' && raw.type !== 'shot') return null;
  if (!isInt(raw.hole) || raw.hole < 1) return null;
  if (raw.type === 'strokes') {
    if (raw.value !== null && !inRange(raw.value, 1, WATCH_STROKES_MAX)) return null;
    return { ...head, hole: raw.hole, value: raw.value };
  }
  const patch = parsePatch(raw.patch);
  return patch ? { ...head, hole: raw.hole, patch } : null;
}

// What the phone does with a validated command. A reject still republishes
// state (the hook does that after every command), so the watch learns the truth.
// `holeRev` is the rev since which the phone has stood on `currentHole` by its
// own doing (Infinity while a phone-side move has not been published yet): a
// `hole` command built on an older state never saw that move, so replaying it
// would drag the pager back to where the watch thought it was.
export function decideWatchCommand(cmd, {
  roundId, currentHole, blocked, holeCount, holeRev = 0,
}) {
  if (!cmd) return { kind: 'reject', reason: 'invalid' };
  if (cmd.roundId !== roundId) return { kind: 'reject', reason: 'round' };
  if (blocked) return { kind: 'reject', reason: 'blocked' };
  if (cmd.type === 'hole') {
    if (cmd.baseRev < holeRev) return { kind: 'reject', reason: 'stale' };
    if (cmd.to < 1 || cmd.to > holeCount) return { kind: 'reject', reason: 'range' };
    if (cmd.to === currentHole) return { kind: 'reject', reason: 'same-hole' };
    return { kind: 'hole', to: cmd.to };
  }
  if (cmd.hole !== currentHole) return { kind: 'reject', reason: 'hole' };
  if (cmd.type === 'strokes') return { kind: 'strokes', hole: cmd.hole, value: cmd.value };
  return { kind: 'shot', hole: cmd.hole, patch: cmd.patch };
}
