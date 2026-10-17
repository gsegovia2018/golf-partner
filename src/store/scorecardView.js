// Pure model for the shot scorecard (components/scorecard/ShotScorecard): one
// round, a score row per player and, for players who logged shots, putts /
// tee shot / green per hole. Used by the finished-round cards on the game
// screen and by Game Stats (Tarjeta, Jugadores' hole-by-hole ledger).
// No React, no t().
import { getPlayingHandicap, calcExtraShots, matchPlayEffectiveHandicaps } from './tournamentStore';
import { holeCountOf } from './scoring';
import { holePoints } from '../components/scorecard/scoreModel';
import { playersMeFirst } from '../lib/playerOrder';
import { hasReason, summaryOf } from './missReasons';

const FAIRWAY_DRIVES = new Set(['fairway', 'super']);
// Modes whose per-hole points are hole results, not Stableford points: the
// heat scale doesn't read them, so they show untinted.
const RESULT_POINT_MODES = new Set(['matchplay', 'pairsmatchplay', 'sindicato']);

// Why a green was missed: the approach's summary when it missed and is tagged,
// else the drive's when it missed and is tagged, else null (a hit green never
// carries a reason).
function whyOf(d, par) {
  if (!d) return null;
  const approachMissed = d.approachResult === 'miss' || d.approachMiss != null || d.approachBunker === true;
  if (approachMissed && hasReason('approach', d)) return summaryOf('approach', d);
  const driveMissed = par !== 3 && d.drive != null && !FAIRWAY_DRIVES.has(d.drive);
  if (driveMissed && hasReason('drive', d)) return summaryOf('drive', d);
  return null;
}

// Gross result of one hole against par, the scorecard's classes.
export function grossResult(par, strokes) {
  if (!par || !strokes) return null;
  const vs = strokes - par;
  if (vs <= -2) return 'eagle';
  if (vs === -1) return 'birdie';
  if (vs === 0) return 'par';
  if (vs === 1) return 'bogey';
  return 'double';
}

// Three-letter row label, the scorecard convention ("MAR", "JAV").
export function rowLabel(player) {
  const name = player?.name?.trim() ?? '';
  return name ? name.slice(0, 3).toUpperCase() : '—';
}

const sumOf = (list, key) => {
  const vals = list.map((c) => c[key]).filter((v) => v != null);
  return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
};

// Totals of one nine for one row: the same shape the ledger always had.
function block(key, cells) {
  const drives = cells.filter((c) => c.drive != null);
  const girs = cells.filter((c) => c.gir != null);
  return {
    key,
    cells,
    par: cells.reduce((s, c) => s + c.par, 0),
    strokes: sumOf(cells, 'strokes'),
    points: sumOf(cells, 'points'),
    putts: sumOf(cells, 'putts'),
    fairways: { hit: drives.filter((c) => FAIRWAY_DRIVES.has(c.drive)).length, of: drives.length },
    gir: { hit: girs.filter((c) => c.gir).length, of: girs.length },
  };
}

// The card for one round.
// - `players`: the rows (a scramble round passes its team units).
// - `mode`: the round's engine mode; points per hole follow it.
// - `handicaps`: optional { id: playing handicap } override (scramble teams);
//   otherwise match play modes use the per-duel difference and the rest the
//   round's playing handicaps — so the stroke dots show the strokes the
//   scoring really grants.
// Rows come in roster order with `meId` first. An 18-hole round splits into
// out / in nines, a 9-hole round is one 'tot' block.
export function scorecardModel({ round, players, meId = null, mode = 'stableford', handicaps = null }) {
  const holes = round?.holes ?? [];
  const list = (players ?? []).filter(Boolean);
  const base = handicaps ?? matchPlayEffectiveHandicaps(mode, round, list) ?? {};
  const hcps = Object.fromEntries(list.map((p) => [p.id, base[p.id] ?? getPlayingHandicap(round, p)]));
  const holeCount = holeCountOf(round);
  const scores = round?.scores ?? {};
  const pointsByHole = new Map(holes.map((h) => [
    h.number, holePoints({ mode, hole: h, players: list, scores, handicaps: hcps, round }),
  ]));
  const tinted = !RESULT_POINT_MODES.has(mode);

  const rows = playersMeFirst(list, meId).map((player) => {
    const details = round?.shotDetails?.[player.id] ?? {};
    const cells = holes.map((hole) => {
      const raw = scores[player.id]?.[hole.number];
      const strokes = raw ? raw : null;
      const d = details[hole.number] ?? null;
      const putts = d?.putts ?? null;
      return {
        number: hole.number,
        par: hole.par,
        strokes,
        points: strokes == null ? null : (pointsByHole.get(hole.number)?.[player.id] ?? null),
        gross: strokes == null ? null : grossResult(hole.par, strokes),
        extra: calcExtraShots(hcps[player.id] ?? 0, hole.strokeIndex, holeCount),
        putts,
        drive: hole.par !== 3 ? (d?.drive ?? null) : null,
        penalties: d?.teePenalties ?? 0,
        gir: strokes != null && putts != null ? strokes - putts <= hole.par - 2 : null,
        why: whyOf(d, hole.par),
      };
    });
    const nines = cells.length > 9
      ? [block('out', cells.slice(0, 9)), block('in', cells.slice(9))]
      : [block('tot', cells)];
    const played = cells.filter((c) => c.strokes != null);
    const strokes = sumOf(played, 'strokes');
    return {
      id: player.id,
      player,
      label: rowLabel(player),
      isMe: player.id === meId,
      nines,
      hasShots: cells.some((c) => c.putts != null || c.drive != null || c.penalties > 0),
      total: {
        holes: played.length,
        strokes,
        toPar: strokes == null ? null : strokes - played.reduce((s, c) => s + c.par, 0),
        points: sumOf(played, 'points'),
        putts: sumOf(cells, 'putts'),
      },
    };
  });

  const solo = rows.length === 1;
  return {
    solo,
    pointsTinted: tinted,
    nines: rows[0]?.nines.map((n) => ({ key: n.key, par: n.par, holes: n.cells.map((c) => ({ number: c.number, par: c.par })) }))
      ?? [],
    rows: rows.map((r) => ({ ...r, canExpand: !solo && r.hasShots })),
  };
}

// Rows open when the card first shows: mine, if I logged shots.
export function initialExpanded(card) {
  return (card?.rows ?? []).filter((r) => r.isMe && r.canExpand).map((r) => r.id);
}

// Toggle one row in the expanded list; a row without shots never opens.
export function toggleExpanded(card, expanded, id) {
  const row = (card?.rows ?? []).find((r) => r.id === id);
  if (!row?.canExpand) return expanded;
  return expanded.includes(id) ? expanded.filter((x) => x !== id) : [...expanded, id];
}

// A game played by one player: Game Stats drops its tabs for one page.
export function isSoloGame(tournament) {
  return (tournament?.players ?? []).length === 1;
}
