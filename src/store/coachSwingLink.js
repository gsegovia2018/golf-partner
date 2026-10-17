// Coach v2 swing link (spec §5, with the §12 decisions). Says whether the
// golfer's analysed swing is consistent with the top on-course cause, and what
// the coach should do about it. Pure: no language, no clock (the caller pins
// `today`), no I/O, no network. Swing data stays on the phone; this reads only
// the swingStore index rows.
//
// buildSwingLink({ causes, swings, profile, today }) → SwingLink
//   causes   causesForLeak(...) result ({ primary, alsoPossible }) for the top
//            leak; only `primary` is linked. A bare Cause or null also works.
//   swings   getSwings() rows (any status; only 'ready' count)
//   profile  getSwingProfile() (handedness fallback for rows without one)
//   today    Date | ISO string | ms; defaults to now
//
// SwingLink { state, cause, strength, swing, fault, via, secondSignal, clubNeeded, cta, msg, note }
//   state        'linked' | 'stale' | 'wrongClub' | 'none' | 'notSwing' | 'swingOnly'
//   cause        the cause id the link is about ('tee:side:left', no `cause:` prefix) or null
//   strength     'consistent' | 'possible' | null. Never 'likely': the analyzer
//                sees one swing on a mat, not the round.
//   swing        { id, createdAt, club, fault, ageDays } of the swing the line is about, or null
//   fault        the fault id that matched the cause (main fault, or the
//                matching consequence when via is 'consequence'), or null
//   via          'main' | 'consequence' | null (what matched the cause)
//   secondSignal true when a consequence also matches (main-fault match + consequence)
//   clubNeeded   'driver' | 'iron' | null (the club the coach asks to record)
//   cta          { kind: 'record', club, msg } or null (the screen gates it on swing availability)
//   msg          descriptor of the swing sentence, or null (notSwing)
//   note         descriptor of the second-signal sentence, or null
//
// Message keys (prefix stats.my.coach.swing., params). Fault and club are
// lower-cased descriptors of existing keys (swing.fault.<id>, swing.club.<club>);
// `date` is an ISO day 'YYYY-MM-DD' for the screen to format.
//   linked.consistent | linked.possible   { club, fault, date }
//   stale.consistent  | stale.possible    { club, fault, date }
//   wrongClub                             { lastClub, club }
//   none                                  { club }
//   swingOnly                             { club, fault, date }
//   secondSignal                          { fault }   (note)
//   cta.record                            { club }

import { msg, lower } from './statsMsg';

export const SWING_STALE_DAYS = 60;
const DAY_MS = 86400000;
const P = 'stats.my.coach.swing.';

// §5.1, right-hander. `clubs` is how the row treats the swing's club:
//   matched      the club must be the cause's own (driver ↔ tee, iron ↔ approach)
//   both         any club
//   iron|driver  that club only
//   driverFirst  driver fits, iron is allowed but only 'possible'
export const SWING_FAULT_LINKS = {
  over_the_top: {
    clubs: 'matched',
    causes: [
      'tee:side:right', 'tee:side:left', 'tee:trouble:driver', 'approach:side:left', 'approach:side:right',
      'approach:why:swing:curve:right', 'tee:why:swing:curve:right', 'approach:why:swing:start:left',
    ],
  },
  steep_backswing: { clubs: 'both', causes: ['tee:side:right', 'approach:side:right', 'approach:short'] },
  top_position: { clubs: 'both', causes: ['tee:side:right', 'approach:side:right', 'approach:short'] },
  flat_backswing: {
    clubs: 'both',
    causes: [
      'tee:side:left', 'approach:side:left',
      'approach:why:swing:curve:left', 'tee:why:swing:curve:left', 'approach:why:swing:start:right',
    ],
  },
  early_extension: {
    clubs: 'both',
    causes: [
      'approach:short', 'approach:distance', 'short:chip', 'tee:side:right',
      'approach:why:swing:strike:right', 'approach:why:swing:lowPoint', 'short:why:swing:lowPoint',
    ],
  },
  flip: {
    clubs: 'iron',
    causes: ['approach:short', 'approach:distance', 'short:chip', 'approach:why:swing:lowPoint', 'short:why:swing:lowPoint'],
  },
  head_sway: {
    clubs: 'both',
    causes: ['approach:short', 'approach:distance', 'tee:side:left', 'tee:side:right', 'approach:why:swing:lowPoint'],
  },
  posture: { clubs: 'both', causes: ['approach:short', 'tee:distance', 'approach:distance'] },
  tempo_fast: { clubs: 'driverFirst', causes: ['tee:trouble:driver', 'tee:side:left', 'tee:side:right', 'penalty:tee'] },
  tempo_slow: { clubs: 'driver', causes: ['tee:distance'] },
  balance: { clubs: 'driverFirst', causes: ['tee:side:left', 'tee:side:right', 'tee:distance'] },
};

const stripPrefix = (id) => String(id ?? '').replace(/^cause:/, '');

/** Mirror left|right in a cause id for a left-hander: tee:side:right ↔ tee:side:left. */
export function mirrorCauseId(id, handedness) {
  if (handedness !== 'left') return id;
  return id.replace(/:(left|right)$/, (_, s) => `:${s === 'left' ? 'right' : 'left'}`);
}

/** The club a cause is about: 'driver' (tee), 'iron' (approach, chip) or null (not club-specific). */
export function clubOfCause(causeId) {
  const id = stripPrefix(causeId);
  if (id.startsWith('tee:') || id.startsWith('penalty:tee')) return 'driver';
  if (id.startsWith('approach:') || id === 'short:chip' || id.startsWith('short:why:')) return 'iron';
  return null;
}

const listsCause = (fault, causeId, handedness) => {
  const row = SWING_FAULT_LINKS[fault];
  return !!row && row.causes.some((c) => mirrorCauseId(c, handedness) === causeId);
};

const inTable = (causeId) => Object.keys(SWING_FAULT_LINKS).some((f) => listsCause(f, causeId, 'right'));

// 'fit' | 'allowed' | 'no'
function clubFit(rule, causeId, club) {
  switch (rule) {
    case 'both': return 'fit';
    case 'iron': return club === 'iron' ? 'fit' : 'no';
    case 'driver': return club === 'driver' ? 'fit' : 'no';
    case 'driverFirst': return club === 'driver' ? 'fit' : 'allowed';
    default: return clubOfCause(causeId) === club ? 'fit' : 'no'; // matched
  }
}

const toMs = (d) => {
  if (d instanceof Date) return d.getTime();
  if (typeof d === 'number') return d;
  const ms = Date.parse(d);
  return Number.isNaN(ms) ? Date.now() : ms;
};

const day = (iso) => String(iso ?? '').slice(0, 10);

function describe(row, ageDays) {
  return { id: row.id, createdAt: row.createdAt, club: row.club ?? 'iron', fault: row.mainFault ?? null, ageDays };
}

// How one swing relates to the cause: null when it does not; { fit: 'no' } when
// it does but the club is wrong. Old rows have no consequences / handedness.
function relate(row, causeId, profileHand) {
  const hand = row.handedness ?? profileHand;
  const club = row.club ?? 'iron';
  const consequences = (Array.isArray(row.consequences) ? row.consequences : []).filter((f) => listsCause(f, causeId, hand));
  const mainHit = !!row.mainFault && listsCause(row.mainFault, causeId, hand);
  if (!mainHit && !consequences.length) return null;
  const fault = mainHit ? row.mainFault : consequences[0];
  const fit = clubFit(SWING_FAULT_LINKS[fault].clubs, causeId, club);
  if (fit === 'no') return { fit };
  const second = mainHit && consequences.length > 0;
  // consistent: main fault with the right club; an allowed club needs a second signal. Consequence-only is possible.
  const strength = mainHit && (fit === 'fit' || second) ? 'consistent' : 'possible';
  return { fit, strength, via: mainHit ? 'main' : 'consequence', secondSignal: second, fault, consequences };
}

const RANK = { consistent: 2, possible: 1 };

export function buildSwingLink({ causes, swings = [], profile = null, today = null } = {}) {
  const cause = causes && Object.prototype.hasOwnProperty.call(causes, 'primary') ? causes.primary : causes;
  const causeId = cause?.id ? stripPrefix(cause.id) : null;
  const nowMs = toMs(today ?? Date.now());
  const profileHand = profile?.handedness ?? 'right';
  const ready = (swings ?? [])
    .filter((s) => s && s.status === 'ready')
    .map((s) => ({ row: s, ageDays: Math.floor((nowMs - toMs(s.createdAt)) / DAY_MS) }))
    .sort((a, b) => a.ageDays - b.ageDays); // newest first
  const recent = ready.filter((x) => x.ageDays <= SWING_STALE_DAYS);

  const base = {
    state: 'notSwing', cause: causeId, strength: null, swing: null, fault: null, via: null,
    secondSignal: false, clubNeeded: null, cta: null, msg: null, note: null,
  };
  const club = (c) => lower(msg(`swing.club.${c}`));
  const faultMsg = (f) => lower(msg(`swing.fault.${f}`));
  const record = (c) => ({ kind: 'record', club: c, msg: msg(`${P}cta.record`, { club: club(c) }) });

  // A recent swing with a main fault that the leak does not point at.
  const swingOnly = () => {
    const x = recent.find((r) => r.row.mainFault);
    if (!x) return null;
    return {
      ...base, state: 'swingOnly', swing: describe(x.row, x.ageDays), fault: x.row.mainFault,
      msg: msg(`${P}swingOnly`, { club: club(x.row.club ?? 'iron'), fault: faultMsg(x.row.mainFault), date: day(x.row.createdAt) }),
    };
  };

  if (!causeId || !inTable(causeId)) return swingOnly() ?? base;

  const clubNeeded = clubOfCause(causeId) ?? 'driver';
  const related = ready
    .map((x) => ({ ...x, rel: relate(x.row, causeId, profileHand) }))
    .filter((x) => x.rel && x.rel.fit !== 'no');
  // list is newest first, so equal strengths keep the newest
  const best = (list) => list.reduce((b, x) => (!b || RANK[x.rel.strength] > RANK[b.rel.strength] ? x : b), null);

  const build = (x, state) => {
    const { rel, row, ageDays } = x;
    const params = { club: club(row.club ?? 'iron'), fault: faultMsg(rel.fault), date: day(row.createdAt) };
    const out = {
      ...base, state, strength: rel.strength, swing: describe(row, ageDays), fault: rel.fault, via: rel.via,
      secondSignal: rel.secondSignal, msg: msg(`${P}${state}.${rel.strength}`, params),
      note: rel.secondSignal ? msg(`${P}secondSignal`, { fault: faultMsg(rel.consequences[0]) }) : null,
    };
    if (state === 'stale') { out.clubNeeded = clubNeeded; out.cta = record(clubNeeded); }
    return out;
  };

  const fresh = best(related.filter((x) => x.ageDays <= SWING_STALE_DAYS));
  if (fresh) return build(fresh, 'linked');
  const old = related.find((x) => x.ageDays > SWING_STALE_DAYS);
  if (old) return build(old, 'stale');

  const specific = clubOfCause(causeId);
  if (specific && recent.length && !recent.some((x) => (x.row.club ?? 'iron') === specific)) {
    const last = recent[0].row;
    return {
      ...base, state: 'wrongClub', swing: describe(last, recent[0].ageDays), clubNeeded: specific, cta: record(specific),
      msg: msg(`${P}wrongClub`, { lastClub: club(last.club ?? 'iron'), club: club(specific) }),
    };
  }
  const only = swingOnly();
  if (only) return only;
  return { ...base, state: 'none', clubNeeded, cta: record(clubNeeded), msg: msg(`${P}none`, { club: club(clubNeeded) }) };
}
