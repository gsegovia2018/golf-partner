import {
  DRILLS, DRILL_FAULTS, drillsForFault, drillsForMain, PROGRESSION,
} from '../drills';
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
    expect(drillsForFault('over_the_top').map((d) => d.id)).toEqual(['pl-palo-atras', 'ott-toalla', 'ott-caja', 'ott-pausa']);
  });

  test('every string is non-empty English', () => {
    DRILLS.forEach((d) => {
      ['id', 'fault', 'title', 'instruction', 'passTarget'].forEach((k) => expect(d[k].trim().length).toBeGreaterThan(2));
      expect(d.instruction).not.toMatch(/[áéíóúñ¿¡]/i);
      expect(d.title).not.toMatch(/[áéíóúñ¿¡]/i);
    });
  });

  test('a fault can borrow a neighbour\'s drill (also), after its own', () => {
    expect(drillsForFault('top_position').map((d) => d.id)).toEqual(['pl-vidrio', 'fb-codo', 'atl-objetivo']);
    expect(drillsForFault('flat_backswing')[0].id).toBe('fb-codo');
  });

  test('D24: the stick behind you and the pane of glass serve the faults they were asked for', () => {
    ['over_the_top', 'flat_backswing', 'flip'].forEach((f) => expect(drillsForFault(f).map((d) => d.id)).toContain('pl-palo-atras'));
    ['top_position', 'steep_backswing', 'across_the_line'].forEach((f) => expect(drillsForFault(f).map((d) => d.id)).toContain('pl-vidrio'));
    expect(DRILLS.find((d) => d.id === 'pl-vidrio').checks).toEqual(['lead_arm_shoulder_plane', 'hands_over_heels']);
  });

  test('D24: each setup check has its own drill, and it leads when that check is the evidence', () => {
    ['hands_under_shoulders', 'waist_bend', 'back_line', 'hand_gap'].forEach((id) => {
      const main = { fault: 'posture', evidence: [{ id }] };
      const first = drillsForMain(main)[0];
      expect(first.checks).toContain(id);
      expect(first.fault).toBe('posture');
    });
    expect(drillsForMain(null)).toEqual([]);
    const ids = drillsForMain({ fault: 'posture', evidence: [{ id: 'hand_gap' }] }).map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('D24: one progression line for every drill: slow with a 7-iron, filmed, then up to speed', () => {
    expect(PROGRESSION).toMatch(/7-iron/);
    expect(PROGRESSION).toMatch(/film/);
  });

  test('unknown fault yields no drills', () => {
    expect(drillsForFault('nope')).toEqual([]);
  });
});
