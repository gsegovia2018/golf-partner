// Pure data for the Bag screen's gapping chart: one row per swing club in the
// bag, longest first, with every tracked carry, the measured playing distance,
// the player's own number and the gap to the next club. All distances metres.
import { carriesByClub, typicalCarry } from './shotStats';
import { clubLabel, clubNominal, sanitizeBag } from './clubs';
import { M_TO_YD } from './units';

// Two clubs closer than this play the same distance — the bag has a double.
export const TIGHT_GAP_M = 6;

// -> [{ club, label, carries, measured, mine, estimate, distance, source,
//      gapToNext }]. `distance` is what club recommendations use (same
// precedence as shotStats.recommendClub): your number, else measured, else
// the catalog estimate. `source` is 'mine' | 'measured' | 'estimate'.
// `gapToNext` is null on the shortest club.
export function bagLadder({ bag, shots = [], overrides = null }) {
  const byClub = carriesByClub(shots);
  const rows = sanitizeBag(bag)
    .filter((k) => k !== 'putter')
    .map((club) => {
      const carries = byClub.get(club) ?? [];
      const typical = typicalCarry(carries);
      const measured = Number.isFinite(typical) && typical > 0 ? typical : null;
      const ov = overrides?.[club];
      const mine = Number.isFinite(ov) && ov > 0 ? ov : null;
      const estimate = clubNominal(club);
      let source = 'estimate';
      if (mine != null) source = 'mine';
      else if (measured != null) source = 'measured';
      return {
        club,
        label: clubLabel(club),
        carries,
        measured,
        mine,
        estimate,
        distance: mine ?? measured ?? estimate,
        source,
        gapToNext: null,
      };
    });
  for (let i = 0; i < rows.length - 1; i += 1) {
    rows[i].gapToNext = rows[i].distance - rows[i + 1].distance;
  }
  return rows;
}

// Right edge of the chart's scale: covers every bar and every tracked carry,
// rounded up to the next 25 m so the axis lands on a round number.
export function ladderMax(rows) {
  let max = 0;
  for (const r of rows) {
    max = Math.max(max, r.distance || 0, ...r.carries);
  }
  return Math.max(50, Math.ceil(max / 25) * 25);
}

// Parse a typed distance in display units into whole metres. Empty or 0 →
// 0 (clear your number); anything unreadable or negative → null (reject).
export function parseDistanceInput(text, units) {
  const raw = String(text ?? '').trim().replace(',', '.');
  if (raw === '') return 0;
  const val = Number(raw);
  if (!Number.isFinite(val) || val < 0) return null;
  if (val === 0) return 0;
  return Math.round(units === 'yards' ? val / M_TO_YD : val);
}
