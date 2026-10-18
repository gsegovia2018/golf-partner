// Aim tips (spec 2026-10-18-aim-tips-design.md): one line on the hole that
// turns the player's own miss pattern into where to aim, plus the trouble on
// the hole when the course is mapped. Pure: stats and a hazard list in, a tip
// descriptor (or null) out; no language is read here (docs/i18n.md).
//
// Stats read: approachMissByDistance.buckets[bucket] (rates over
// directionKnown, turned back into counts), approachTendency (byDirection
// counts, directionKnown) and driveImpact.buckets.left/right (holes).

import { msg } from './statsMsg';
import { hazardSide, haversineMeters } from '../lib/geo';

export const AIM_MIN = { bucketMisses: 8, pooledMisses: 10, driveMisses: 10, ratio: 2 };

const HAZARD_GREEN_M = 30;
const HAZARD_DRIVE_M = 30;
const OPPOSITE = { left: 'right', right: 'left' };

// A side wins when it holds at least `ratio` times the other side.
const dominantSide = (left, right) => {
  if (left > 0 && left >= AIM_MIN.ratio * right) return 'left';
  if (right > 0 && right >= AIM_MIN.ratio * left) return 'right';
  return null;
};

// { left, right, short, long, total, scope } for the approach, or null when
// neither the bucket row nor the pooled tendency has enough misses.
function approachCounts(stats, bucket) {
  const row = bucket ? stats?.approachMissByDistance?.buckets?.[bucket] : null;
  const known = row?.directionKnown ?? 0;
  if (row && known >= AIM_MIN.bucketMisses) {
    const c = (rate) => Math.round(((rate ?? 0) * known) / 100);
    return {
      left: c(row.leftRate), right: c(row.rightRate), short: c(row.shortRate), long: c(row.longRate),
      total: known, scope: 'bucket',
    };
  }
  const t = stats?.approachTendency;
  if (t && (t.directionKnown ?? 0) >= AIM_MIN.pooledMisses) {
    const d = t.byDirection ?? {};
    return {
      left: d.left ?? 0, right: d.right ?? 0, short: d.short ?? 0, long: d.long ?? 0,
      total: t.directionKnown, scope: 'all',
    };
  }
  return null;
}

function approachBias(stats, bucket) {
  const c = approachCounts(stats, bucket);
  if (!c) return null;
  const side = dominantSide(c.left, c.right);
  const sideCount = side ? c[side] : 0;
  const largest = Math.max(c.left, c.right, c.short, c.long);
  let length = null;
  if (c.short >= AIM_MIN.ratio * c.long && c.short > 0 && c.short === largest) length = 'short';
  else if (c.long >= AIM_MIN.ratio * c.short && c.long > 0 && c.long === largest) length = 'long';
  const lengthCount = length ? c[length] : 0;
  if (!side && !length) return null;
  // One tip, never two: the larger share wins, a tie keeps the side.
  if (side && sideCount >= lengthCount) {
    return { kind: 'side', miss: side, count: sideCount, total: c.total, scope: c.scope };
  }
  return { kind: 'club', miss: length, count: lengthCount, total: c.total, scope: c.scope };
}

function teeBias(stats) {
  const b = stats?.driveImpact?.buckets;
  const left = b?.left?.holes ?? 0;
  const right = b?.right?.holes ?? 0;
  if (left + right < AIM_MIN.driveMisses) return null;
  const side = dominantSide(left, right);
  if (!side) return null;
  return { kind: 'side', miss: side, count: side === 'left' ? left : right, total: left + right, scope: 'all' };
}

// Water outranks bunker. Returns { kind, left, right } for the top kind.
function trouble(hazards) {
  const list = (hazards ?? []).filter((h) => h && (h.side === 'left' || h.side === 'right'));
  const kind = list.some((h) => h.kind === 'water') ? 'water' : list.length ? 'bunker' : null;
  if (!kind) return null;
  const of = list.filter((h) => h.kind === kind);
  return { kind, left: of.some((h) => h.side === 'left'), right: of.some((h) => h.side === 'right') };
}

export function aimTip({ shot, par, bucket = null, stats, hazards, handedness } = {}) {
  void handedness; // display only: the tip is stated as left/right of the target
  if (!stats) return null;
  let bias = null;
  if (shot === 'approach') bias = approachBias(stats, bucket);
  else if (shot === 'tee' && par >= 4) bias = teeBias(stats);
  if (!bias) return null;

  let aim;
  let hazard = null;
  if (bias.kind === 'club') {
    aim = bias.miss === 'short' ? 'club-up' : 'club-down';
  } else {
    const away = OPPOSITE[bias.miss];
    aim = shot === 'tee' ? `${away}-edge` : `${away}-half`;
    const tr = trouble(hazards);
    if (tr) {
      if (tr.left && tr.right) {
        aim = 'middle';
        hazard = { kind: tr.kind, side: 'both' };
      } else if (tr[away]) {
        aim = 'middle';
        hazard = { kind: tr.kind, side: away };
      } else {
        hazard = { kind: tr.kind, side: bias.miss };
      }
    }
  }

  const whyKey = `stats.aim.why.${shot}.${bias.miss}${shot === 'approach' && bias.scope === 'all' ? '.all' : ''}`;
  return {
    shot,
    kind: bias.kind,
    miss: bias.miss,
    aim,
    evidence: { count: bias.count, total: bias.total, scope: bias.scope },
    hazard,
    msg: msg(`stats.aim.title.${aim}`),
    detail: msg(whyKey, { count: bias.count, total: bias.total, bucket: bias.scope === 'bucket' ? bucket : null }),
    hazardMsg: hazard ? msg(`stats.aim.hazard.${hazard.kind}.${hazard.side}`) : null,
  };
}

const nearestM = (poly, point) => poly.reduce((m, v) => Math.min(m, haversineMeters(point, v)), Infinity);

// The `hazards` input of aimTip, from the hole's geometry ({ hazards: [{ kind,
// poly }] }). Approach: water/bunker within 30 m of the green, side on the
// line from -> green. Tee: those whose reach (nearest edge from the tee) is
// within the typical drive +/- 30 m, side on the tee -> green line.
export function aimHazards({ shot, holeGeometry, from, greenCentre, driveDistance } = {}) {
  const all = holeGeometry?.hazards;
  if (!all?.length || !from || !greenCentre) return [];
  if (shot === 'tee' && !(driveDistance > 0)) return [];
  const out = [];
  for (const hz of all) {
    if ((hz.kind !== 'water' && hz.kind !== 'bunker') || !hz.poly?.length) continue;
    const reach = nearestM(hz.poly, from);
    if (shot === 'approach') {
      if (nearestM(hz.poly, greenCentre) > HAZARD_GREEN_M) continue;
    } else if (shot === 'tee') {
      if (Math.abs(reach - driveDistance) > HAZARD_DRIVE_M) continue;
    } else {
      continue;
    }
    out.push({ kind: hz.kind, side: hazardSide(hz, from, greenCentre), reach });
  }
  return out;
}
