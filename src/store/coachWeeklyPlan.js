// Coach v2 weekly plan (spec §4, with the §12 decisions). Pure: no language,
// no clock (the caller pins `today`), no I/O. Copy is language-neutral: every
// text is a descriptor { key, params } (statsMsg) the screen renders.
//
// buildWeeklyPlan({ diagnosis, causes, secondCauses, focus, verdict, swingLink,
//                   minutesPerWeek, roundsSinceCommit, previousPlan, lastRound, today })
//   diagnosis       buildDiagnosis(stats) result
//   causes          causesForLeak(top-or-focus leak, stats) result ({ primary, alsoPossible }); optional
//   secondCauses    same for the second leak (tie partner); optional
//   focus           the committed v2 focus record or null
//   verdict         focusVerdict(focus, stats) or null (its `level` drives the plan)
//   swingLink       buildSwingLink(...) result or null (state 'linked' adds the swing drill)
//   minutesPerWeek  30 | 60 | 90 | 120 (default 60; any number is accepted)
//   roundsSinceCommit  fallback for the level when there is no verdict
//   previousPlan    the plan (or its `signature`) built before the latest round, for re-plan detection
//   lastRound       { course, date } of the latest round; only used to word the re-planned note
//   today           accepted for caller symmetry and determinism pins; the plan has no calendar week (§12.3)
//
// Plan { minutes, mode, level, readyToMove, sessions, courseTask, logAsk, split, swing,
//        collectReason, replan, signature }
//   mode      'focus' | 'tie' (no focus, top two leaks too close: 45/45) | 'collect' (no leak)
//   level     1-3, from verdict.level or focusLevel(roundsSinceCommit); 1 without a focus
//   readyToMove  true when the verdict is improving at level 3 ("end this focus")
//   sessions  Session[]: { id: 'plan:<kind>[:<part>]', kind, part, parts, minutes, roles, title, why, drills }
//             roles = block roles in the session ('focus'|'second'|'keep'|'swing'|'collect'),
//             drills = [{ drillId, source: 'coach'|'swing', level, passTarget, minutes, role, fault? }]
//   split     minutes per kind { range, shortGame, putting, course }
//   swing     { drillId, fault } when the swing drill joined the range session, else null
//   replan    null, or { changes: descriptor[], note: descriptor|null }
//   signature compact record to store and pass back as `previousPlan`
//
// Sizing (§12.2): blocks take 55 % focus / 25 % second / 10 % keep (45/45 on a
// tie). The sum of the drill minutes never exceeds the budget: a drill that
// would overflow is skipped and a shorter one tried. Blocks are packed into
// sessions by kind; a block under 10 min folds into the focus block; what the
// drills leave of the budget is topped up with more drills (keep block, then
// second leak, then focus). A session is at most 45 min: a bigger block splits
// into several sessions of the same kind (`part` 1.., `parts`). At 30 min or
// less the week is one session plus the on-course task; the swing drill
// (10 min) needs a budget above 30. A drill pool can run out, then the plan is
// shorter than the budget.
//
// Message keys (prefix stats.my.coach.plan.) + params:
//   area.<offTheTee|approach|aroundGreen|putting|penalties>   (no params)
//   session.<range|shortGame|putting|course>                  { minutes, count }
//   why.focus | why.second | why.keep | why.swing             { area, bucket|null }
//   why.tie                                                   { area, bucket|null }  (focus block of a tie)
//   why.collect.insufficient | why.collect.noLeak             {}
//   course.<putting.lag|putting.short|putting.general|approach.short|approach.bunker|
//           approach.distance|tee.trouble|tee.distance|short.sand|short.chip|
//           penalty.tee|penalty.other>                        { bucket|null }
//   course.approach.side | course.tee.side                     { bucket|null, side }
//   course.area.<category> (leak without a cause)             { bucket|null }
//   course.collect                                            {}
//   log.possible {rounds} | log.insufficient {area} | log.collect {}
//   replanned {course, date, what}   date is an ISO day for the screen to format
//   changed.topLeak {area} | changed.cause {area} | changed.second {area} |
//   changed.keep {area} | changed.level {level} | changed.tieStarted | changed.tieEnded |
//   changed.swingAdded | changed.swingRemoved | changed.collect | changed.leakFound
//   changed.and {a, b}   (nests when more than two changes)
// `area` params are msg('...area.<category>'); `side` is lower(msg('stats.my.fan.left|right')).

import { msg, lower } from './statsMsg';
import { DRILLS, drillsForCause } from './coachDrills';
import { focusLevel, isV2Focus, MAX_LEVEL } from './coachFocus';
import { drillsForMain } from '../swing/drills';

const P = 'stats.my.coach.plan.';
export const SESSION_KINDS = ['range', 'shortGame', 'putting', 'course'];
export const MIN_DRILL_MINUTES = 10;
export const SWING_DRILL_MINUTES = 10;
export const SESSION_MAX_MINUTES = 45;
const SINGLE_SESSION_MAX = 30;
const SHARE = { focus: 0.55, second: 0.25, keep: 0.1, tie: 0.45 };
const CATEGORY_AREA = {
  offTheTee: 'offTheTee', approach: 'approach', aroundGreen: 'shortGame', putting: 'putting', penalties: 'penalties',
};
const COLLECT_DRILLS = ['putt-mixed-ladder', 'putt-clock-2m', 'putt-lag-ladder', 'putt-gate-short', 'putt-tap-in-pressure'];
const DRILL_BY_ID = Object.fromEntries(DRILLS.map((d) => [d.id, d]));

const areaMsg = (category) => msg(`${P}area.${category}`);

function entry(drill, role, level) {
  const lv = Math.min(3, Math.max(1, level));
  return {
    drillId: drill.id, source: 'coach', level: lv,
    passTarget: drill.levels?.[lv - 1]?.passTarget ?? drill.passTarget,
    minutes: drill.minutes, role,
  };
}

// Drills for a block: cause-matched when there is a cause, else the area's
// (bucket match first, then generic, then the rest).
function poolFor({ causeId, category, bucket }) {
  if (causeId) {
    const byCause = drillsForCause(causeId);
    if (byCause.length) return byCause;
  }
  const area = CATEGORY_AREA[category];
  const inArea = DRILLS.filter((d) => d.area === area);
  const hit = bucket ? inArea.filter((d) => d.bucket === bucket) : [];
  const generic = inArea.filter((d) => d.bucket == null && !hit.includes(d));
  return [...hit, ...generic, ...inArea.filter((d) => !hit.includes(d) && !generic.includes(d))];
}

// The cause's on-course task for the next round, tied to the cause (§4.2 block 4).
export function courseTaskFor({ causeId, category, bucket }) {
  const b = bucket ?? null;
  if (causeId) {
    const rest = causeId.replace(/^cause:/, '');
    const side = /:side:(left|right)$/.exec(rest);
    if (side) {
      const base = rest.startsWith('tee') ? 'tee.side' : 'approach.side';
      return msg(`${P}course.${base}`, { bucket: b, side: lower(msg(`stats.my.fan.${side[1]}`)) });
    }
    const key = rest.startsWith('tee:trouble') ? 'tee.trouble' : rest.replace(/:/g, '.');
    return msg(`${P}course.${key}`, { bucket: b });
  }
  return msg(`${P}course.area.${category}`, { bucket: b });
}

// Drills of `kind` from the pool that fit in `room` minutes and in the block's
// target; one that would overflow is skipped and a shorter one tried.
function pack(pool, kind, used, target, level, role, room = Infinity) {
  const out = [];
  let sum = 0;
  const cap = Math.min(target, room);
  pool.filter((d) => d.kind === kind && !used.has(d.id)).forEach((d) => {
    if (sum + d.minutes > cap) return;
    out.push(entry(d, role, level));
    used.add(d.id);
    sum += d.minutes;
  });
  return out;
}

const sum = (list) => list.reduce((a, d) => a + d.minutes, 0);

// One kind's drills as sessions of at most SESSION_MAX_MINUTES, in order.
// `describe(roles)` gives the session's why.
function sessionsOf(kind, drills, describe) {
  const chunks = [];
  drills.forEach((d) => {
    const last = chunks[chunks.length - 1];
    if (last && sum(last) + d.minutes <= SESSION_MAX_MINUTES) last.push(d);
    else chunks.push([d]);
  });
  return chunks.map((list, i) => {
    const minutes = sum(list);
    const roles = [...new Set(list.map((d) => d.role))];
    return {
      id: i === 0 ? `plan:${kind}` : `plan:${kind}:${i + 1}`, kind, part: i + 1, parts: chunks.length,
      minutes, roles,
      title: msg(`${P}session.${kind}`, { minutes, count: list.length }),
      why: describe(roles[0]), drills: list,
    };
  });
}

function chainOf(leak, causePrimary) {
  return { leakId: leak.id, category: leak.category, bucket: leak.bucket ?? null, causeId: causePrimary?.id ?? null };
}

function strongestKeep(diagnosis, skip) {
  const ok = (diagnosis?.categories ?? [])
    .filter((c) => c.confidence !== 'insufficient' && c.strokesPerRound > 0 && !skip.includes(c.category));
  ok.sort((a, b) => b.strokesPerRound - a.strokesPerRound);
  return ok[0]?.category ?? null;
}

const toIsoDay = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ?? null);

function andChain(list) {
  return list.reduce((acc, cur) => (acc ? msg(`${P}changed.and`, { a: acc, b: lower(cur) }) : cur), null);
}

function detectReplan(prev, sig, lastRound) {
  if (!prev) return null;
  const changes = [];
  if (sig.collect !== prev.collect) changes.push(msg(`${P}changed.${sig.collect ? 'collect' : 'leakFound'}`));
  if (!sig.collect) {
    if (sig.focusCategory !== prev.focusCategory || sig.focusLeakId !== prev.focusLeakId) {
      changes.push(msg(`${P}changed.topLeak`, { area: areaMsg(sig.focusCategory) }));
    } else if (sig.causeId !== prev.causeId && sig.causeId) {
      changes.push(msg(`${P}changed.cause`, { area: areaMsg(sig.focusCategory) }));
    }
    if (sig.tie !== prev.tie) changes.push(msg(`${P}changed.${sig.tie ? 'tieStarted' : 'tieEnded'}`));
    if (sig.secondCategory !== prev.secondCategory && sig.secondCategory) {
      changes.push(msg(`${P}changed.second`, { area: areaMsg(sig.secondCategory) }));
    }
    if (sig.keepCategory !== prev.keepCategory && sig.keepCategory) {
      changes.push(msg(`${P}changed.keep`, { area: areaMsg(sig.keepCategory) }));
    }
    if (sig.level !== prev.level) changes.push(msg(`${P}changed.level`, { level: sig.level }));
    if (!!sig.swingDrillId !== !!prev.swingDrillId) {
      changes.push(msg(`${P}changed.${sig.swingDrillId ? 'swingAdded' : 'swingRemoved'}`));
    }
  }
  if (changes.length === 0) return null;
  const note = lastRound
    ? msg(`${P}replanned`, { course: lastRound.course ?? null, date: toIsoDay(lastRound.date), what: andChain(changes) })
    : null;
  return { changes, note };
}

export function buildWeeklyPlan({
  diagnosis, causes, secondCauses, focus, verdict, swingLink, minutesPerWeek,
  roundsSinceCommit, previousPlan, lastRound,
} = {}) {
  const M = Number.isFinite(minutesPerWeek) && minutesPerWeek > 0 ? Math.round(minutesPerWeek) : 60;
  const committed = isV2Focus(focus) ? focus : null;
  const top = diagnosis?.top ?? null;
  const prev = previousPlan?.signature ?? previousPlan ?? null;

  // Level: from the verdict / focusLevel; 1 without a focus (§4.3, §12).
  let level = 1;
  if (committed) {
    level = verdict?.level ?? focusLevel(roundsSinceCommit ?? verdict?.roundsSince ?? 0, verdict?.state);
    level = Math.min(MAX_LEVEL, Math.max(1, level));
  }

  // ── Collect plan: nothing to fix yet ──
  if (!committed && !top) {
    const collectReason = (diagnosis?.insufficient?.length ?? 0) > 0 ? 'insufficient' : 'noLeak';
    const used = new Set();
    const pool = COLLECT_DRILLS.map((id) => DRILL_BY_ID[id]).filter(Boolean);
    const drills = pack(pool, 'putting', used, M, 1, 'collect');
    const sessions = sessionsOf('putting', drills, () => msg(`${P}why.collect.${collectReason}`));
    const signature = {
      collect: true, focusLeakId: null, focusCategory: null, causeId: null, secondCategory: null,
      keepCategory: null, level: 1, tie: false, swingDrillId: null,
    };
    return {
      minutes: M, mode: 'collect', level: 1, readyToMove: false, sessions,
      courseTask: msg(`${P}course.collect`),
      logAsk: msg(`${P}log.collect`),
      split: splitOf(sessions), swing: null, collectReason,
      replan: detectReplan(prev, signature, lastRound), signature,
    };
  }

  // ── Focus chain and second leak ──
  const focusChain = committed
    ? { leakId: committed.leakId, category: committed.category, bucket: committed.bucket ?? null,
        causeId: committed.causeId ?? causes?.primary?.id ?? null }
    : chainOf(top, causes?.primary);
  const tie = !committed && diagnosis?.tie ? diagnosis.tie : null;
  const secondLeak = tie
    ?? (diagnosis?.leaks ?? []).find((l) => l.category !== focusChain.category && l.id !== focusChain.leakId)
    ?? null;
  const secondChain = secondLeak ? chainOf(secondLeak, secondCauses?.primary) : null;
  const single = M <= SINGLE_SESSION_MAX;
  const swingOn = !single && swingLink?.state === 'linked' && swingLink.fault
    ? drillsForMain({ fault: swingLink.fault })[0] ?? null
    : null;
  const keepCategory = single || swingOn
    ? null
    : strongestKeep(diagnosis, [focusChain.category, secondChain?.category]);
  const keepChain = keepCategory ? { leakId: null, category: keepCategory, bucket: null, causeId: null } : null;

  const share = {
    focus: tie ? SHARE.tie : SHARE.focus,
    second: tie ? SHARE.tie : SHARE.second,
    keep: SHARE.keep,
  };
  const blocks = [{ role: tie ? 'tie' : 'focus', chain: focusChain, target: M * share.focus, level }];
  if (!single && secondChain) blocks.push({ role: 'second', chain: secondChain, target: M * share.second, level: 1 });
  if (keepChain) blocks.push({ role: 'keep', chain: keepChain, target: M * share.keep, level: 1 });
  if (single) blocks[0].target = M;

  // Kind per block. A block under the drill minimum folds into a surviving
  // block of the same kind, else into the focus block (§12.2).
  const used = new Set();
  const withKind = blocks.map((b) => {
    const pool = poolFor(b.chain);
    return { ...b, pool, kind: pool[0]?.kind ?? 'course' };
  });
  const focusBlock = withKind[0];
  const kept = withKind.filter((b) => b === focusBlock || b.target >= MIN_DRILL_MINUTES);
  withKind.filter((b) => !kept.includes(b)).forEach((b) => {
    const host = kept.find((k) => k.kind === b.kind) ?? focusBlock;
    host.target += b.target;
  });
  const focusKind = focusBlock.kind;

  // Swing drill joins the range session (§4.2 block 3); its minutes are
  // reserved first, the entry is appended after the block drills.
  const swingEntry = swingOn ? {
    drillId: swingOn.id, source: 'swing', level: null, passTarget: null,
    minutes: SWING_DRILL_MINUTES, role: 'swing', fault: swingLink.fault,
  } : null;
  let left = M - (swingEntry ? SWING_DRILL_MINUTES : 0);

  const byKind = {};
  kept.forEach((b) => {
    byKind[b.kind] = byKind[b.kind] ?? { kind: b.kind, drills: [] };
    const drills = pack(b.pool, b.kind, used, b.target, b.level, b.role, left);
    byKind[b.kind].drills.push(...drills);
    left -= sum(drills);
  });

  // Top up the leftover: keep block first, then the second leak, then focus.
  // No block grows past the focus block (it stays the biggest, §12.2).
  const roleMinutes = (role) => Object.values(byKind).reduce((a, k) => a + sum(k.drills.filter((d) => d.role === role)), 0);
  const topUpOrder = ['keep', 'second', 'tie', 'focus'];
  [...kept].sort((x, y) => topUpOrder.indexOf(x.role) - topUpOrder.indexOf(y.role)).forEach((b) => {
    const own = ['focus', 'tie'].includes(b.role);
    const room = own ? left : Math.min(left, roleMinutes(focusBlock.role) - roleMinutes(b.role));
    const drills = pack(b.pool, b.kind, used, room, b.level, b.role, room);
    byKind[b.kind].drills.push(...drills);
    left -= sum(drills);
  });

  let swing = null;
  if (swingEntry) {
    byKind.range = byKind.range ?? { kind: 'range', drills: [] };
    byKind.range.drills.push(swingEntry);
    swing = { drillId: swingOn.id, fault: swingLink.fault };
  }

  const order = [focusKind, ...SESSION_KINDS.filter((k) => k !== focusKind)];
  const sessions = order.filter((k) => byKind[k]?.drills.length).flatMap((k) => sessionsOf(k, byKind[k].drills, (role) => {
    const lead = withKind.find((b) => b.role === role) ?? withKind[0];
    return msg(`${P}why.${role}`, { area: areaMsg(lead.chain.category), bucket: lead.chain.bucket ?? null });
  }));

  const strength = (causes?.primary ?? null)?.strength;
  const insufficientFirst = diagnosis?.insufficient?.[0]?.category;
  let logAsk = null;
  if (!committed && strength === 'possible') logAsk = msg(`${P}log.possible`, { rounds: 2 });
  else if (insufficientFirst) logAsk = msg(`${P}log.insufficient`, { area: areaMsg(insufficientFirst) });

  const signature = {
    collect: false, focusLeakId: focusChain.leakId, focusCategory: focusChain.category,
    causeId: focusChain.causeId, secondCategory: secondChain?.category ?? null,
    keepCategory, level, tie: !!tie, swingDrillId: swing?.drillId ?? null,
  };

  return {
    minutes: M, mode: tie ? 'tie' : 'focus', level,
    readyToMove: !!committed && verdict?.state === 'improving' && level >= MAX_LEVEL,
    sessions, courseTask: courseTaskFor(focusChain), logAsk,
    split: splitOf(sessions), swing, collectReason: null,
    replan: detectReplan(prev, signature, lastRound), signature,
  };
}

function splitOf(sessions) {
  const split = { range: 0, shortGame: 0, putting: 0, course: 0 };
  sessions.forEach((s) => { split[s.kind] += s.minutes; });
  return split;
}
