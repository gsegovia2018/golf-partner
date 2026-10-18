import { changeOf, compareAnalyses } from '../compare';

const chk = (id, status, value = null, unit = null, extra = {}) => ({
  id, label: `L ${id}`, status, value: status === 'unknown' ? null : value, unit, ...extra,
});
const swing = (checks, fault = null) => ({ checks, main: fault ? { fault, evidence: checks.map((c) => ({ id: c.id })) } : null });

describe('changeOf: judged by meaning, not by sign', () => {
  test('a smaller loss is better, a bigger one worse, within the same band', () => {
    expect(changeOf(chk('spine_loss', 'red', 7, '°'), chk('spine_loss', 'red', 9, '°'))).toBe('better');
    expect(changeOf(chk('spine_loss', 'red', 11, '°'), chk('spine_loss', 'red', 9, '°'))).toBe('worse');
    expect(changeOf(chk('hip_drift', 'yellow', 5, 'cm'), chk('hip_drift', 'yellow', 5, 'cm'))).toBe('same');
  });

  test('a band change decides before the numbers do', () => {
    expect(changeOf(chk('head_drift', 'green', 4, 'cm'), chk('head_drift', 'yellow', 3, 'cm'))).toBe('better');
    expect(changeOf(chk('head_drift', 'red', 20, 'cm'), chk('head_drift', 'yellow', 30, 'cm'))).toBe('worse');
  });

  test('tempo is judged by its distance from 3:1, finish balance by how many of two held', () => {
    expect(changeOf(chk('tempo', 'yellow', 2.6, ':1'), chk('tempo', 'yellow', 2.0, ':1'))).toBe('better');
    expect(changeOf(chk('tempo', 'yellow', 3.6, ':1'), chk('tempo', 'yellow', 2.9, ':1'))).toBe('worse');
    expect(changeOf(chk('finish_balance', 'yellow', 2, 'of 2'), chk('finish_balance', 'yellow', 1, 'of 2'))).toBe('better');
  });

  test('angles with no better direction stay the same inside a band', () => {
    expect(changeOf(chk('posture_address', 'green', 32, '°'), chk('posture_address', 'green', 38, '°'))).toBe('same');
    expect(changeOf(chk('posture_address', 'green', 30, '°'), chk('posture_address', 'yellow', 43, '°'))).toBe('better');
    // the plane at P6: above counts three times what under does
    expect(changeOf(chk('clubhead_plane_down', 'green', -10, 'cm'), chk('clubhead_plane_down', 'green', 4, 'cm'))).toBe('better');
  });

  test('unknown on either side, or a check missing from one swing, is unclear', () => {
    expect(changeOf(chk('spine_loss', 'unknown'), chk('spine_loss', 'red', 9, '°'))).toBe('unclear');
    expect(changeOf(chk('spine_loss', 'red', 9, '°'), undefined)).toBe('unclear');
  });
});

describe('compareAnalyses', () => {
  const newer = swing([
    chk('spine_loss', 'red', 7, '°'),
    chk('hands_height_impact', 'yellow', 4, 'cm'),
    chk('hip_drift', 'red', 12, 'cm'),
    chk('tempo', 'yellow', 2.6, ':1'),
    chk('spine_hold', 'unknown', null, null, { cp: 'shaftDown', position: 'shaftDown' }),
  ], 'early_extension');
  const older = swing([
    chk('spine_loss', 'red', 9, '°'),
    chk('hands_height_impact', 'yellow', 7, 'cm'),
    chk('hip_drift', 'red', 12, 'cm'),
    chk('tempo', 'yellow', 2.0, ':1'),
    chk('spine_hold', 'yellow', 3, '°', { cp: 'shaftDown', position: 'shaftDown' }),
  ], 'early_extension');

  test('counts, verdict, sentence and the deltas', () => {
    const r = compareAnalyses(newer, older);
    expect(r.counts).toEqual({ better: 3, same: 1, worse: 0, unclear: 1 });
    expect(r.verdict).toBe('Better, not fixed.');
    expect(r.sentence).toMatch(/^Still early extension\./);
    expect(r.sentence).toMatch(/l spine_loss, 7° against 9°/);
    const rows = r.groups.flatMap((g) => g.rows);
    expect(rows.find((x) => x.id === 'spine_loss')).toMatchObject({ change: 'better', delta: '−2°', a: { text: '7°' }, b: { text: '9°' } });
    expect(rows.find((x) => x.id === 'hands_height_impact').delta).toBe('−3 cm');
    expect(rows.find((x) => x.id === 'spine_hold')).toMatchObject({ change: 'unclear', delta: '', a: { text: '—' } });
  });

  test('rows are grouped by checkpoint in timeline order', () => {
    const r = compareAnalyses(newer, older);
    expect(r.groups.map((g) => g.cp)).toEqual(['shaftDown', 'impact']);
    const addr = (v) => chk('posture_address', 'green', v, '°', { position: 'address' });
    const wide = compareAnalyses(swing([addr(32), ...newer.checks]), swing([addr(30), ...older.checks]));
    expect(wide.groups.map((g) => g.cp)).toEqual(['address', 'shaftDown', 'impact']);
  });

  test('swapping the swings flips better and worse', () => {
    const r = compareAnalyses(older, newer);
    expect(r.counts).toMatchObject({ better: 0, worse: 3 });
    expect(r.verdict).toBe('Worse.');
  });

  test('the sentence follows the main fault across the two swings', () => {
    const a = swing([chk('spine_loss', 'red', 7, '°')], 'over_the_top');
    const b = swing([chk('spine_loss', 'red', 7, '°')], 'early_extension');
    expect(compareAnalyses(a, b).sentence).toMatch(/^The main fault moved from early extension to over the top\./);
    expect(compareAnalyses(swing([]), swing([])).sentence).toBe('No clear main fault in either swing.');
    expect(compareAnalyses(swing([]), swing([])).verdict).toBe('About the same.');
  });
});
