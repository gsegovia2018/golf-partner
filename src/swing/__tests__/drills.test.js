import {
  DRILLS, DRILL_FAULTS, drillsForFault, drillsForMain, PROGRESSION,
} from '../drills';
import { FAULTS } from '../priority';
import { SWING_STRINGS } from '../strings';

describe('drills catalogue (plan 5.6)', () => {
  test('every fault has at least one drill', () => {
    const faults = Object.keys(SWING_STRINGS.fault);
    faults.forEach((f) => expect(drillsForFault(f).length).toBeGreaterThanOrEqual(1));
    FAULTS.forEach((f) => expect(drillsForFault(f).length).toBeGreaterThanOrEqual(1));
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
    expect(DRILLS.find((d) => d.id === 'pl-vidrio').checks).toEqual(['lead_arm_spine', 'hands_over_heels']);
  });

  test('D24: each setup check has its own drill, and it leads when that check is the evidence', () => {
    ['hands_under_shoulders', 'back_line', 'knee_flex'].forEach((id) => {
      const main = { fault: 'posture', evidence: [{ id }] };
      const first = drillsForMain(main)[0];
      expect(first.checks).toContain(id);
      expect(first.fault).toBe('posture');
    });
    expect(drillsForMain(null)).toEqual([]);
    const ids = drillsForMain({ fault: 'posture', evidence: [{ id: 'knee_flex' }] }).map((d) => d.id);
    expect(DRILLS.map((d) => d.id)).not.toEqual(expect.arrayContaining(['su-bisagra']));
    expect(DRILLS.some((d) => d.id === 'su-palmo')).toBe(false);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('checks v2: the new faults and rows have their drills', () => {
    expect(drillsForFault('posture_loss').map((d) => d.id)).toEqual(['pl-columna', 'pl-rodilla']);
    expect(drillsForFault('stuck').map((d) => d.id)).toEqual(['st-salida']);
    expect(drillsForMain({ fault: 'steep_backswing', evidence: [{ id: 'clubhead_plane_takeaway' }] })[0].id).toBe('tk-plano');
    expect(drillsForMain({ fault: 'posture_loss', evidence: [{ id: 'knee_hold' }] })[0].id).toBe('pl-rodilla');
    expect(drillsForMain({ fault: 'over_the_top', evidence: [{ id: 'down_vs_takeaway' }] })[0].id).toBe('pl-palo-atras');
  });

  test('D24: one progression line for every drill: slow with a 7-iron, filmed, then up to speed', () => {
    expect(PROGRESSION).toMatch(/7-iron/);
    expect(PROGRESSION).toMatch(/film/);
  });

  test('unknown fault yields no drills', () => {
    expect(drillsForFault('nope')).toEqual([]);
  });
});
