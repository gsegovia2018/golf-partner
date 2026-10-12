import { DRILLS, DRILL_FAULTS, drillsForFault } from '../drills';
import { FAULTS } from '../priority';
import { SWING_STRINGS } from '../strings';

describe('drills catalogue (plan 5.6)', () => {
  test('every fault has at least one drill', () => {
    const faults = Object.keys(SWING_STRINGS.fault);
    faults.forEach((f) => expect(drillsForFault(f).length).toBeGreaterThanOrEqual(1));
    FAULTS.forEach((f) => expect(drillsForFault(f.id).length).toBeGreaterThanOrEqual(1));
    expect(DRILL_FAULTS.sort()).toEqual(faults.sort());
  });

  test('ids are unique and stable', () => {
    const ids = DRILLS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(drillsForFault('early_extension').map((d) => d.id)).toEqual(['ee-silla', 'ee-pared', 'ee-palo-talones']);
    expect(drillsForFault('over_the_top').map((d) => d.id)).toEqual(['ott-toalla', 'ott-caja', 'ott-pausa']);
  });

  test('every string is non-empty English', () => {
    DRILLS.forEach((d) => {
      ['id', 'fault', 'title', 'instruction', 'passTarget'].forEach((k) => expect(d[k].trim().length).toBeGreaterThan(2));
      expect(d.instruction).not.toMatch(/[áéíóúñ¿¡]/i);
      expect(d.title).not.toMatch(/[áéíóúñ¿¡]/i);
    });
  });

  test('a fault can borrow a neighbour\'s drill (also), after its own', () => {
    expect(drillsForFault('top_position').map((d) => d.id)).toEqual(['fb-codo', 'atl-objetivo']);
    expect(drillsForFault('flat_backswing')[0].id).toBe('fb-codo');
  });

  test('unknown fault yields no drills', () => {
    expect(drillsForFault('nope')).toEqual([]);
  });
});
