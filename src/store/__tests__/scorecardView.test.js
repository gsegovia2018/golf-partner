import { weekendFixture } from './fixtures/gameStatsFixture';
import {
  scorecardModel, initialExpanded, toggleExpanded, isSoloGame, rowLabel, grossResult,
} from '../scorecardView';

const round0 = () => weekendFixture().rounds[0];
const roster = () => weekendFixture().players;

describe('scorecardModel', () => {
  test('rows in roster order with me first, three-letter labels, out / in nines', () => {
    const card = scorecardModel({ round: round0(), players: roster(), meId: 'fx-alv' });
    expect(card.rows.map((r) => r.id)).toEqual(['fx-alv', 'fx-me', 'fx-jav', 'fx-nac']);
    expect(card.rows.map((r) => r.label)).toEqual(['ÁLV', 'MAR', 'JAV', 'NAC']);
    expect(card.rows[0].isMe).toBe(true);
    expect(card.solo).toBe(false);
    expect(card.nines.map((n) => [n.key, n.par, n.holes.length])).toEqual([['out', 36, 9], ['in', 36, 9]]);
  });

  test('only players who logged shots can open; a solo card never needs to', () => {
    const card = scorecardModel({ round: round0(), players: roster(), meId: 'fx-me' });
    expect(card.rows.map((r) => [r.id, r.hasShots, r.canExpand])).toEqual([
      ['fx-me', true, true], ['fx-jav', false, false], ['fx-alv', false, false], ['fx-nac', false, false],
    ]);
    const solo = scorecardModel({ round: round0(), players: roster().slice(0, 1), meId: 'fx-me' });
    expect(solo.solo).toBe(true);
    expect(solo.rows[0]).toMatchObject({ hasShots: true, canExpand: false });
  });

  test('cells carry strokes, gross result, points, handicap strokes and shots; totals per nine', () => {
    const card = scorecardModel({ round: round0(), players: roster(), meId: 'fx-me' });
    const [out, back] = card.rows[0].nines;
    // Hole 1: 4 on a par 4, handicap 16 → a stroke on SI 7 → 3 points.
    expect(out.cells[0]).toMatchObject({
      strokes: 4, gross: 'par', points: 3, extra: 1, putts: 1, drive: 'right', gir: false,
    });
    expect(out.strokes).toBe(52);
    expect(back.strokes).toBe(50);
    expect(out.putts).toBe(18);
    expect(back.cells.find((c) => c.number === 12).penalties).toBe(1);
    expect(card.rows[0].total).toMatchObject({ holes: 18, strokes: 102, toPar: 30, putts: 36 });
    expect(card.pointsTinted).toBe(true);
  });

  test('match play: points are holes won (untinted) and dots follow the duel difference', () => {
    const round = round0();
    const players = roster().slice(0, 2); // Marcos 16, Javier 9 → Marcos gets 7
    const card = scorecardModel({ round, players, meId: 'fx-me', mode: 'matchplay' });
    expect(card.pointsTinted).toBe(false);
    const me = card.rows[0].nines.flatMap((n) => n.cells);
    const jav = card.rows[1].nines.flatMap((n) => n.cells);
    expect(me.filter((c) => c.extra > 0)).toHaveLength(7);
    expect(jav.every((c) => c.extra === 0)).toBe(true);
    // A hole goes to one player or nobody (halved): never to both.
    me.forEach((c, i) => expect([0, 1]).toContain(c.points + jav[i].points));
    expect(me.some((c) => c.points === 1)).toBe(true);
  });

  test('a handicap override (scramble team units) drives the dots and the points', () => {
    const round = round0();
    const unit = { id: 'fx-me', name: 'Marcos & Javier' };
    const card = scorecardModel({ round, players: [unit], meId: 'fx-me', mode: 'scramblepairs', handicaps: { 'fx-me': 0 } });
    const cells = card.rows[0].nines.flatMap((n) => n.cells);
    expect(cells.every((c) => c.extra === 0)).toBe(true);
    expect(cells[0].points).toBe(2); // a gross par with no strokes
    expect(card.rows[0].label).toBe('MAR');
  });

  test('a 9-hole round is one tot block; unplayed holes are null and left out of totals', () => {
    const round = { ...round0(), holes: round0().holes.slice(0, 9), scores: { 'fx-jav': { 1: 5, 3: 3 } }, shotDetails: {} };
    const card = scorecardModel({ round, players: roster().slice(1, 2) });
    expect(card.nines.map((n) => n.key)).toEqual(['tot']);
    const row = card.rows[0];
    expect(row.nines[0].cells[1]).toMatchObject({ strokes: null, points: null, gross: null });
    expect(row.total).toMatchObject({ holes: 2, strokes: 8, toPar: 1 });
  });
});

describe('why (miss reasons)', () => {
  const withDetails = (patch) => {
    const round = round0();
    Object.entries(patch).forEach(([hole, d]) => { Object.assign(round.shotDetails['fx-me'][hole], d); });
    return scorecardModel({ round, players: roster(), meId: 'fx-me' }).rows[0].nines.flatMap((n) => n.cells);
  };

  test('a tagged missed approach gives the approach summary', () => {
    const cells = withDetails({ 1: { approachResult: 'miss', approachMiss: 'right', approachStart: 'right', approachContact: 'fat' } });
    expect(cells[0].why).toEqual([
      { key: 'shots.why.name.push', params: undefined },
      { key: 'shots.why.contact.fat', params: undefined },
    ]);
  });

  test('falls back to the drive when the approach has no tag', () => {
    const cells = withDetails({ 2: { approachResult: 'miss', approachMiss: 'left', driveStart: 'left', driveContact: 'toe' } });
    expect(cells[1].why.map((m) => m.key)).toEqual(['shots.why.name.pull', 'shots.why.contact.toe']);
  });

  test('null when untagged, and when the drive was found', () => {
    const cells = withDetails({ 4: { approachResult: 'miss', approachMiss: 'long' } });
    expect(cells[0].why).toBeNull();
    expect(cells[3].why).toBeNull();
    expect(withDetails({ 5: { driveContact: 'top' } })[4].why).toBeNull();
  });
});

describe('expansion', () => {
  test('mine starts open when I logged shots; toggling ignores rows without shots', () => {
    const card = scorecardModel({ round: round0(), players: roster(), meId: 'fx-me' });
    expect(initialExpanded(card)).toEqual(['fx-me']);
    expect(toggleExpanded(card, ['fx-me'], 'fx-me')).toEqual([]);
    expect(toggleExpanded(card, [], 'fx-me')).toEqual(['fx-me']);
    expect(toggleExpanded(card, [], 'fx-jav')).toEqual([]);
    const other = scorecardModel({ round: round0(), players: roster(), meId: 'fx-jav' });
    expect(initialExpanded(other)).toEqual([]);
  });
});

describe('helpers', () => {
  test('isSoloGame: exactly one player', () => {
    const t = weekendFixture();
    expect(isSoloGame(t)).toBe(false);
    expect(isSoloGame({ ...t, players: t.players.slice(0, 1) })).toBe(true);
    expect(isSoloGame(null)).toBe(false);
  });

  test('rowLabel and grossResult', () => {
    expect(rowLabel({ name: '  ana belén' })).toBe('ANA');
    expect(rowLabel({ name: '' })).toBe('—');
    expect(grossResult(4, 3)).toBe('birdie');
    expect(grossResult(4, null)).toBeNull();
  });
});
