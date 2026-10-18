// Miss reasons vocabulary (spec 2026-10-17-miss-reasons-design.md §3, §5.1).
// Pure: no I/O, no language. Messages are descriptors (statsMsg `msg`); the
// screen renders and joins them. Empty means "not answered", never "no reason".
//
// MISS_REASON_KEYS   { drive, approach, short } → the three detail keys of each type
// OPTIONS            the choices per question, in display order (the order is a
//                    UI contract: never reorder approachSituation)
// clearedReasonPatch(shotType, { keepSituation }) → { key: null } for that type's three keys
//                                   (the situation key left out with keepSituation)
// situations(detail, key)           → array; null / non-array → []
// hasReason(shotType, detail)       → true when any of the type's keys is set
// flightOf({ start, finish })       → { start, curve, family } | null
//   start   'left'|'center'|'right' (absolute, golfer's view); anything else → null
//   finish  the recorded outcome side (approachMiss / drive). Not left/right →
//           { start, curve: null, family: null }
//   curve   'left'|'right'|'none'; family 'start'|'curve'|null. Derived, never stored.
// shotName(flight, handedness)      → 'push'|'pull'|'slice'|'hook'|'pull-slice'|
//                                     'push-hook'|null (mirrored for 'left')
// summaryOf(shotType, detail, handedness) → [descriptor] for the summary chip:
//   shot name (or start alone), contact, [short: shortResult first], situations.
//   Keys: shots.why.{name,start,contact,shortResult,situation}.<value>
//
// isBlockedApproach(detail)         → true when approachSituation includes 'blocked'
// classifyMiss(shotType, detail)    → { family, sub, side } | null (untagged). Flat shape:
//   family 'forced'|'lie'|'decision'|'swing'; sub / side null unless family is 'swing'.
//   First match wins: forced (blocked, approach only) > lie (above-feet, below-feet,
//   uphill, downhill, bad-lie, wind; short game bad-lie, short-sided) > decision
//   (decision; short game wrong-shot) > swing. Swing sub: 'lowPoint' (contact
//   fat/thin/top/sky — beats flight, decision 14), else 'start'|'curve' from
//   flightOf (side = finish side), else 'strike' (toe/heel/shank; side = finish
//   side when left/right, else null). Short game swing is lowPoint (fat/thin)
//   only; shortResult alone is not a family → null.
// missReasonStats(rounds, playerId) → { approach: { byBucket: {[bucket]: Row}, all: Row },
//   tee: Row, short: Row }; rounds are raw rounds (round.shotDetails[playerId]).
//   Row = { misses, tagged, untagged, blocked, families: {forced,lie,decision,swing},
//   subs: { start:{left,right}, curve:{left,right}, strike:{left,right}, lowPoint },
//   lies: { [situation]: count } } (every lie situation on a lie-family miss, so a
//   shot below the feet in the wind counts in both; the strategy cards read the dominant one).
//   Approach = par !== 3, approachBucket set, approachResult 'miss'; tee = par >= 4
//   and drive left|right|short; short = green missed, not saved, strokes > par.

import { msg } from './statsMsg';
import { isGIR, recoveryOutcomeFromState } from './scoring';
import { APPROACH_BUCKETS } from '../components/scorecard/constants';

export const MISS_REASON_KEYS = {
  drive: ['driveStart', 'driveContact', 'driveSituation'],
  approach: ['approachStart', 'approachContact', 'approachSituation'],
  short: ['shortResult', 'shortContact', 'shortSituation'],
};

export const OPTIONS = {
  start: ['left', 'center', 'right'],
  driveContact: ['top', 'sky', 'toe', 'heel'],
  driveSituation: ['wind', 'decision'],
  approachContact: ['fat', 'thin', 'toe', 'shank'],
  approachSituation: ['above-feet', 'below-feet', 'uphill', 'downhill', 'blocked', 'bad-lie', 'wind', 'decision'],
  shortResult: ['short', 'long'],
  shortContact: ['fat', 'thin'],
  shortSituation: ['bad-lie', 'short-sided', 'wrong-shot'],
};

// `keepSituation` leaves the situation key out: a lie is a fact about the
// shot, so it survives a finish that is no longer a miss.
export function clearedReasonPatch(shotType, { keepSituation = false } = {}) {
  const patch = {};
  const situationKey = FIELDS[shotType]?.situation;
  for (const key of MISS_REASON_KEYS[shotType] || []) {
    if (keepSituation && key === situationKey) continue;
    patch[key] = null;
  }
  return patch;
}

export function situations(detail, key) {
  const value = detail ? detail[key] : null;
  return Array.isArray(value) ? value : [];
}

export function hasReason(shotType, detail) {
  if (!detail) return false;
  return (MISS_REASON_KEYS[shotType] || []).some((key) => {
    const value = detail[key];
    return Array.isArray(value) ? value.length > 0 : value != null;
  });
}

const isSide = (v) => v === 'left' || v === 'right';

export function flightOf({ start, finish } = {}) {
  if (!OPTIONS.start.includes(start)) return null;
  if (!isSide(finish)) return { start, curve: null, family: null };
  if (start === finish) return { start, curve: 'none', family: 'start' };
  return { start, curve: finish, family: 'curve' };
}

const flip = (side) => (side === 'left' ? 'right' : side === 'right' ? 'left' : side);

export function shotName(flight, handedness = 'right') {
  if (!flight || !flight.family) return null;
  const mirror = handedness === 'left';
  const start = mirror ? flip(flight.start) : flight.start;
  const curve = mirror ? flip(flight.curve) : flight.curve;
  if (flight.family === 'start') return start === 'right' ? 'push' : 'pull';
  if (start === 'center') return curve === 'right' ? 'slice' : 'hook';
  return start === 'left' ? 'pull-slice' : 'push-hook';
}

const FIELDS = {
  drive: { start: 'driveStart', contact: 'driveContact', situation: 'driveSituation', finish: 'drive' },
  approach: {
    start: 'approachStart', contact: 'approachContact', situation: 'approachSituation', finish: 'approachMiss',
  },
  short: { result: 'shortResult', contact: 'shortContact', situation: 'shortSituation' },
};

export function summaryOf(shotType, detail, handedness = 'right') {
  const f = FIELDS[shotType];
  if (!f || !detail) return [];
  const out = [];
  if (f.result && detail[f.result]) out.push(msg(`shots.why.shortResult.${detail[f.result]}`));
  // A short drive (a top) has no start line: the sheet hides the band, so a
  // start kept from an earlier left/right pick stays out of the summary too.
  if (f.start && !(shotType === 'drive' && detail.drive === 'short')) {
    const name = shotName(flightOf({ start: detail[f.start], finish: detail[f.finish] }), handedness);
    if (name) out.push(msg(`shots.why.name.${name}`));
    else if (detail[f.start]) out.push(msg(`shots.why.start.${detail[f.start]}`));
  }
  if (detail[f.contact]) out.push(msg(`shots.why.contact.${detail[f.contact]}`));
  for (const s of situations(detail, f.situation)) out.push(msg(`shots.why.situation.${s}`));
  return out;
}

export function isBlockedApproach(detail) {
  return situations(detail, 'approachSituation').includes('blocked');
}

export const APPROACH_LIES = ['above-feet', 'below-feet', 'uphill', 'downhill', 'bad-lie', 'wind'];
const LIE = {
  drive: ['wind'],
  approach: APPROACH_LIES,
  short: ['bad-lie', 'short-sided'],
};
const DECISION = { drive: 'decision', approach: 'decision', short: 'wrong-shot' };
const LOW_POINT = { drive: ['top', 'sky'], approach: ['fat', 'thin'], short: ['fat', 'thin'] };
const STRIKE = ['toe', 'heel', 'shank'];

export function classifyMiss(shotType, detail) {
  const f = FIELDS[shotType];
  if (!f || !detail) return null;
  const sits = situations(detail, f.situation);
  const make = (family, sub = null, side = null) => ({ family, sub, side });
  if (shotType === 'approach' && sits.includes('blocked')) return make('forced');
  if (sits.some((s) => LIE[shotType].includes(s))) return make('lie');
  if (sits.includes(DECISION[shotType])) return make('decision');
  const contact = detail[f.contact];
  if (LOW_POINT[shotType].includes(contact)) return make('swing', 'lowPoint');
  if (shotType === 'short') return null;
  const finish = detail[f.finish];
  const flight = flightOf({ start: detail[f.start], finish });
  if (flight && flight.family) return make('swing', flight.family, finish);
  if (STRIKE.includes(contact)) return make('swing', 'strike', isSide(finish) ? finish : null);
  return null;
}

const emptyRow = () => ({
  misses: 0,
  tagged: 0,
  untagged: 0,
  blocked: 0,
  families: { forced: 0, lie: 0, decision: 0, swing: 0 },
  subs: {
    start: { left: 0, right: 0 },
    curve: { left: 0, right: 0 },
    strike: { left: 0, right: 0 },
    lowPoint: 0,
  },
  lies: {},
  // approach rows only: per lie, the approaches played from it and the greens hit
  encounters: {},
});

function addEncounter(row, detail) {
  const lies = situations(detail, 'approachSituation').filter((x) => APPROACH_LIES.includes(x));
  lies.forEach((x) => {
    const e = row.encounters[x] ?? (row.encounters[x] = { shots: 0, greens: 0 });
    e.shots += 1;
    if (detail.approachResult === 'green') e.greens += 1;
  });
}

function addMiss(row, shotType, detail) {
  row.misses += 1;
  if (shotType === 'approach' && isBlockedApproach(detail)) row.blocked += 1;
  const c = classifyMiss(shotType, detail);
  if (!c) { row.untagged += 1; return; }
  row.tagged += 1;
  row.families[c.family] += 1;
  if (c.family === 'lie') {
    situations(detail, FIELDS[shotType].situation).filter((x) => LIE[shotType].includes(x))
      .forEach((x) => { row.lies[x] = (row.lies[x] ?? 0) + 1; });
  }
  if (c.family !== 'swing') return;
  if (c.sub === 'lowPoint') row.subs.lowPoint += 1;
  else if (c.side) row.subs[c.sub][c.side] += 1;
}

export function missReasonStats(rounds, playerId) {
  const byBucket = {};
  APPROACH_BUCKETS.forEach((b) => { byBucket[b] = emptyRow(); });
  const all = emptyRow();
  const tee = emptyRow();
  const short = emptyRow();
  (rounds || []).forEach((round) => {
    const byHole = round?.shotDetails?.[playerId];
    if (!byHole) return;
    (round.holes || []).forEach((hole) => {
      const d = byHole[hole.number];
      if (!d) return;
      if (hole.par !== 3 && d.approachBucket && d.approachResult === 'miss') {
        if (byBucket[d.approachBucket]) addMiss(byBucket[d.approachBucket], 'approach', d);
        addMiss(all, 'approach', d);
      }
      if (hole.par !== 3 && d.approachBucket
        && (d.approachResult === 'green' || d.approachResult === 'miss')) {
        if (byBucket[d.approachBucket]) addEncounter(byBucket[d.approachBucket], d);
        addEncounter(all, d);
      }
      if (hole.par >= 4 && (d.drive === 'left' || d.drive === 'right' || d.drive === 'short')) {
        addMiss(tee, 'drive', d);
      }
      const strokes = round.scores?.[playerId]?.[hole.number];
      const greenMissed = d.approachResult === 'miss'
        || isGIR({ strokes, putts: d.putts, par: hole.par }) === false;
      if (!greenMissed || !(strokes > hole.par)) return;
      const outcome = d.recoveryOutcome ?? recoveryOutcomeFromState({
        strokes, putts: d.putts, sandShots: d.sandShots ?? 0, par: hole.par,
      });
      if (outcome === 'up-and-down' || outcome === 'sand-save') return;
      addMiss(short, 'short', d);
    });
  });
  return { approach: { byBucket, all }, tee, short };
}
