// Miss reasons vocabulary (spec 2026-10-17-miss-reasons-design.md §3, §5.1).
// Pure: no I/O, no language. Messages are descriptors (statsMsg `msg`); the
// screen renders and joins them. Empty means "not answered", never "no reason".
//
// MISS_REASON_KEYS   { drive, approach, short } → the three detail keys of each type
// OPTIONS            the choices per question, in display order (the order is a
//                    UI contract: never reorder approachSituation)
// clearedReasonPatch(shotType)      → { key: null } for that type's three keys
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
// Not here yet (PR2): classifyMiss, isBlockedApproach, missReasonStats.

import { msg } from './statsMsg';

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

export function clearedReasonPatch(shotType) {
  const patch = {};
  for (const key of MISS_REASON_KEYS[shotType] || []) patch[key] = null;
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
