// Compare two analysed swings (plan 6, D7): a row per check with each swing's value and a
// Change that is judged by meaning, not by sign. Pure; the screen only draws what this returns.

import { CHECKPOINT_KEYS } from './phases';
import { CHECK_KEY, homeOf } from './checkpointChecks';
import { valueText } from './highlights';
import { SWING_STRINGS } from './strings';

const RANK = { green: 0, yellow: 1, red: 2 };
const TEMPO_TARGET = 3; // 3:1 backswing to downswing

// Every numeric check is the size of a deviation (a loss, a drift, a distance), so smaller is
// better, with the exceptions below. Tempo is best at 3:1 (judge the distance from it). Finish
// balance counts how many of two things held (more is better). Below `eps` it is noise.
const SCORE = {
  tempo: { of: (v) => Math.abs(v - TEMPO_TARGET), eps: 0.1 },
  finish_balance: { of: (v) => -v, eps: 0.5 },
  // Signed readings: the size of the miss either way, or the distance from the middle of the band.
  hands_under_shoulders: { of: Math.abs, eps: 1 },
  hands_over_heels: { of: Math.abs, eps: 1 },
  knee_flex: { of: (v) => Math.abs(v - 22.5), eps: 1 },
  shaft_plane: { of: Math.abs, eps: 1 },
  clubhead_plane_takeaway: { of: Math.abs, eps: 1 },
  spine_hold: { of: Math.abs, eps: 1 },
  knee_hold: { of: Math.abs, eps: 1 },
  lead_arm_spine: { of: Math.abs, eps: 1 },
  through_vs_halfway: { of: Math.abs, eps: 1 },
  // Above the plane counts three times what under it does (green to 4 cm above, to 12 cm under).
  clubhead_plane_down: { of: (v) => (v > 0 ? 3 * v : -v), eps: 1 },
  // The shaft line at the ball: how far it lands outside the toes .. ball zone (the row's `miss`),
  // either way; a row without it (written before checks v2) falls back to the distance from the ball.
  butt_extension: { of: (v, c) => c?.miss ?? Math.abs(v), eps: 1 },
  shaft_through_ball: { of: (v, c) => c?.miss ?? Math.abs(v), eps: 1 },
}; // down_vs_takeaway: smaller is better, the default
const DEFAULT_SCORE = { of: (v) => v, eps: 1 };
// Posture tilt is an angle with no better direction, only a band: inside one band the swings are the same.
const BAND_ONLY = new Set(['posture_address']);

const known = (c) => c && c.status !== 'unknown' && c.value != null;

/**
 * 'better' | 'worse' | 'same' | 'unclear' for check `a` read against `b` (a is the swing the
 * golfer is judging, b the one it is measured against). A band change decides first; within
 * the same band the numbers decide.
 */
export function changeOf(a, b) {
  if (!a || !b || a.status === 'unknown' || b.status === 'unknown') return 'unclear';
  if (a.status !== b.status) return RANK[a.status] < RANK[b.status] ? 'better' : 'worse';
  if (!known(a) || !known(b) || BAND_ONLY.has(a.id)) return 'same';
  const { of, eps } = SCORE[a.id] ?? DEFAULT_SCORE;
  const d = of(a.value, a) - of(b.value, b);
  if (Math.abs(d) < eps) return 'same';
  return d < 0 ? 'better' : 'worse';
}

const cell = (c) => {
  if (!c || c.status === 'unknown') return { status: 'unknown', text: '—' };
  return { status: c.status, text: valueText(c) || '—' };
};

/** "−3 cm" (a minus b) when both are measured in the same unit, else ''. */
function deltaText(a, b) {
  if (!known(a) || !known(b) || a.unit !== b.unit) return '';
  const d = Math.round((a.value - b.value) * 10) / 10;
  if (d === 0) return '';
  const unit = valueText({ ...a, value: 0 }).replace(/^0/, '');
  return `${d > 0 ? '+' : '−'}${Math.abs(d)}${unit}`;
}

/**
 * @param {object} a  analysis of the swing being judged (shown left)
 * @param {object} b  analysis of the swing it is measured against (shown right)
 * @returns {{ groups, counts, verdict, sentence, faultA, faultB }}
 */
export function compareAnalyses(a, b) {
  const T = SWING_STRINGS.compare;
  const byKey = (an) => new Map((an?.checks ?? []).map((c) => [CHECK_KEY(c), c]));
  const ka = byKey(a);
  const kb = byKey(b);
  const all = new Map([...(a?.checks ?? []), ...(b?.checks ?? [])].map((c) => [CHECK_KEY(c), c]));
  const rows = [...all].map(([key, c]) => {
    const ca = ka.get(key);
    const cb = kb.get(key);
    const change = changeOf(ca, cb);
    return {
      key,
      id: c.id,
      label: ca?.label ?? cb?.label,
      home: homeOf(c),
      a: cell(ca),
      b: cell(cb),
      change,
      delta: change === 'better' || change === 'worse' ? deltaText(ca, cb) : '',
    };
  });
  const groups = CHECKPOINT_KEYS
    .map((k) => ({ cp: k, name: SWING_STRINGS.checkpoint[k], rows: rows.filter((r) => r.home === k) }))
    .filter((g) => g.rows.length);
  const count = (k) => rows.filter((r) => r.change === k).length;
  const counts = { better: count('better'), same: count('same'), worse: count('worse'), unclear: count('unclear') };

  const faultA = a?.main?.fault ?? null;
  const faultB = b?.main?.fault ?? null;
  const nameOf = (f) => SWING_STRINGS.fault[f] ?? f;
  const verdict = counts.better > counts.worse
    ? (faultA && faultA === faultB ? T.verdict.betterNotFixed : T.verdict.better)
    : counts.worse > counts.better ? T.verdict.worse : T.verdict.same;

  // The biggest like-for-like move in the main fault's own evidence, else any measured delta.
  const evidence = new Set((a?.main?.evidence ?? []).map((e) => e.id));
  const moves = rows.filter((r) => r.delta && (r.change === 'better' || r.change === 'worse'));
  const lead = moves.find((r) => evidence.has(r.id)) ?? moves[0] ?? null;
  const move = lead ? T.move(lead.label.toLowerCase(), lead.a.text, lead.b.text, lead.change) : '';
  let head;
  if (faultA && faultA === faultB) head = T.stillFault(nameOf(faultA));
  else if (faultA && faultB) head = T.faultMoved(nameOf(faultB), nameOf(faultA));
  else if (faultA) head = T.newFault(nameOf(faultA));
  else if (faultB) head = T.faultGone(nameOf(faultB));
  else head = T.noFault;
  return { groups, counts, verdict, sentence: [head, move].filter(Boolean).join(' '), faultA, faultB };
}
