import {
  buildSwingLink, mirrorCauseId, clubOfCause, SWING_FAULT_LINKS, SWING_STALE_DAYS,
} from '../coachSwingLink';

const TODAY = '2026-10-16T12:00:00.000Z';
const daysAgo = (d) => new Date(Date.parse(TODAY) - d * 86400000).toISOString();
const cause = (id) => ({ primary: { id: `cause:${id}`, strength: 'likely' }, alsoPossible: [] });
let seq = 0;
const swing = (o = {}) => ({
  id: `s${seq += 1}`, status: 'ready', club: 'driver', createdAt: daysAgo(12), mainFault: 'over_the_top', consequences: [], ...o,
});
const link = (id, swings, extra = {}) => buildSwingLink({ causes: cause(id), swings, profile: { handedness: 'right' }, today: TODAY, ...extra });

describe('states', () => {
  it('linked: a recent fitting swing whose main fault lists the cause', () => {
    const l = link('tee:side:left', [swing()]);
    expect(l).toMatchObject({ state: 'linked', strength: 'consistent', via: 'main', fault: 'over_the_top', cause: 'tee:side:left', cta: null });
    expect(l.swing).toMatchObject({ club: 'driver', fault: 'over_the_top', ageDays: 12 });
    expect(l.msg).toEqual({
      key: 'stats.my.coach.swing.linked.consistent',
      params: {
        club: { key: 'swing.club.driver', params: undefined, lower: true },
        fault: { key: 'swing.fault.over_the_top', params: undefined, lower: true },
        date: '2026-10-04',
      },
    });
  });

  it('stale: the newest fitting swing is older than 60 days, with a record CTA', () => {
    const l = link('tee:side:left', [swing({ createdAt: daysAgo(100) })]);
    expect(l).toMatchObject({ state: 'stale', strength: 'consistent', clubNeeded: 'driver' });
    expect(l.msg.key).toBe('stats.my.coach.swing.stale.consistent');
    expect(l.cta).toMatchObject({ kind: 'record', club: 'driver' });
    expect(l.cta.msg.key).toBe('stats.my.coach.swing.cta.record');
  });

  it('wrongClub: only recent swings are the other club and the cause is club-specific', () => {
    const l = link('tee:side:left', [swing({ club: 'iron', mainFault: 'early_extension' })]);
    expect(l).toMatchObject({ state: 'wrongClub', clubNeeded: 'driver' });
    expect(l.msg.key).toBe('stats.my.coach.swing.wrongClub');
    expect(l.msg.params.lastClub.key).toBe('swing.club.iron');
    expect(l.cta.club).toBe('driver');
  });

  it('none: no swing, cause in the table', () => {
    const l = link('approach:short', []);
    expect(l).toMatchObject({ state: 'none', clubNeeded: 'iron', msg: { key: 'stats.my.coach.swing.none' } });
    expect(l.cta.club).toBe('iron');
    expect(link('approach:short', [{ ...swing(), status: 'pending' }, { ...swing(), status: 'error' }]).state).toBe('none');
  });

  it('notSwing: the cause is not in the table, or there is no cause', () => {
    ['putting:lag', 'penalty:other', 'short:sand'].forEach((id) => {
      expect(link(id, [])).toMatchObject({ state: 'notSwing', msg: null, cta: null });
    });
    expect(buildSwingLink({ causes: { primary: null, alsoPossible: [] }, swings: [], today: TODAY }).state).toBe('notSwing');
    expect(buildSwingLink({ swings: [], today: TODAY }).state).toBe('notSwing');
  });

  it('swingOnly: a recent swing with a fault that the leak does not point at', () => {
    const l = link('approach:short', [swing({ club: 'iron', mainFault: 'tempo_slow' })]);
    expect(l).toMatchObject({ state: 'swingOnly', fault: 'tempo_slow' });
    expect(l.msg.key).toBe('stats.my.coach.swing.swingOnly');
    // no matching leak at all
    expect(buildSwingLink({ causes: null, swings: [swing()], today: TODAY }).state).toBe('swingOnly');
    // a cause outside the table still shows the swing watch row
    expect(link('putting:lag', [swing()]).state).toBe('swingOnly');
    // a clean swing (no main fault) is not a watch row
    expect(link('approach:short', [swing({ club: 'iron', mainFault: null })]).state).toBe('none');
  });

  it('accepts a bare cause and a plain id without the cause: prefix', () => {
    expect(buildSwingLink({ causes: { id: 'tee:side:left' }, swings: [swing()], today: TODAY }).state).toBe('linked');
  });
});

describe('club relevance', () => {
  it('over_the_top is matched: driver for tee causes, iron for approach causes', () => {
    expect(link('tee:side:right', [swing({ club: 'driver' })]).state).toBe('linked');
    expect(link('approach:side:right', [swing({ club: 'iron' })]).state).toBe('linked');
    expect(link('approach:side:right', [swing({ club: 'driver' })]).state).toBe('wrongClub');
    expect(link('tee:side:right', [swing({ club: 'iron' })]).state).toBe('wrongClub');
  });

  it('flip is iron only; tempo_slow is driver only', () => {
    expect(link('approach:short', [swing({ club: 'iron', mainFault: 'flip' })])).toMatchObject({ state: 'linked', strength: 'consistent' });
    expect(link('approach:short', [swing({ club: 'driver', mainFault: 'flip' })]).state).toBe('wrongClub');
    expect(link('tee:distance', [swing({ club: 'driver', mainFault: 'tempo_slow' })]).state).toBe('linked');
    expect(link('tee:distance', [swing({ club: 'iron', mainFault: 'tempo_slow' })]).state).toBe('wrongClub');
  });

  it('both-club rows fit either club', () => {
    expect(link('approach:short', [swing({ club: 'driver', mainFault: 'steep_backswing' })])).toMatchObject({ state: 'linked', strength: 'consistent' });
    expect(link('tee:side:right', [swing({ club: 'iron', mainFault: 'steep_backswing' })]).state).toBe('linked');
  });

  it('driver-first rows: driver is consistent, iron is only possible', () => {
    expect(link('tee:trouble:driver', [swing({ mainFault: 'tempo_fast' })]).strength).toBe('consistent');
    expect(link('tee:trouble:driver', [swing({ club: 'iron', mainFault: 'tempo_fast' })])).toMatchObject({ state: 'linked', strength: 'possible' });
  });

  it('a fitting swing wins over a wrong-club one, and clubOfCause groups the causes', () => {
    const l = link('tee:side:left', [swing({ club: 'iron' }), swing({ club: 'driver', createdAt: daysAgo(30) })]);
    expect(l).toMatchObject({ state: 'linked', swing: { club: 'driver' } });
    expect(['tee:side:left', 'tee:trouble:driver', 'penalty:tee', 'tee:distance'].map(clubOfCause)).toEqual(['driver', 'driver', 'driver', 'driver']);
    expect(['approach:short', 'approach:side:left', 'short:chip'].map(clubOfCause)).toEqual(['iron', 'iron', 'iron']);
    expect(clubOfCause('putting:lag')).toBeNull();
  });
});

describe('left-hander mirror', () => {
  it('mirrors only the side suffix', () => {
    expect(mirrorCauseId('tee:side:right', 'left')).toBe('tee:side:left');
    expect(mirrorCauseId('approach:side:left', 'left')).toBe('approach:side:right');
    expect(mirrorCauseId('tee:side:right', 'right')).toBe('tee:side:right');
    expect(mirrorCauseId('approach:short', 'left')).toBe('approach:short');
  });

  it('a right-hander steep backswing links to a right miss, a left-hander to a left miss', () => {
    const s = swing({ mainFault: 'steep_backswing' });
    expect(link('tee:side:right', [s]).state).toBe('linked');
    expect(link('tee:side:left', [s]).state).toBe('swingOnly');
    const lefty = swing({ mainFault: 'steep_backswing', handedness: 'left' });
    expect(link('tee:side:left', [lefty]).state).toBe('linked');
    expect(link('tee:side:right', [lefty]).state).toBe('swingOnly');
  });

  it('flat backswing: hook side flips for a left-hander', () => {
    const lefty = swing({ mainFault: 'flat_backswing', handedness: 'left' });
    expect(link('approach:side:right', [lefty], { profile: { handedness: 'left' } }).state).toBe('linked');
  });

  it('a row without handedness falls back to the profile', () => {
    const s = swing({ mainFault: 'steep_backswing' });
    expect(buildSwingLink({ causes: cause('tee:side:left'), swings: [s], profile: { handedness: 'left' }, today: TODAY }).state).toBe('linked');
    expect(buildSwingLink({ causes: cause('tee:side:left'), swings: [s], today: TODAY }).state).toBe('swingOnly');
  });

  it('a row own handedness wins over the profile', () => {
    const s = swing({ mainFault: 'steep_backswing', handedness: 'right' });
    expect(buildSwingLink({ causes: cause('tee:side:right'), swings: [s], profile: { handedness: 'left' }, today: TODAY }).state).toBe('linked');
  });
});

describe('60-day staleness with a pinned today', () => {
  it('60 days is still recent, 61 is stale', () => {
    expect(SWING_STALE_DAYS).toBe(60);
    expect(link('tee:side:left', [swing({ createdAt: daysAgo(60) })]).state).toBe('linked');
    expect(link('tee:side:left', [swing({ createdAt: daysAgo(61) })]).state).toBe('stale');
  });

  it('the same swing ages with the pinned today', () => {
    const s = swing({ createdAt: '2026-08-20T10:00:00.000Z' });
    expect(buildSwingLink({ causes: cause('tee:side:left'), swings: [s], today: '2026-10-01T10:00:00.000Z' }).state).toBe('linked');
    expect(buildSwingLink({ causes: cause('tee:side:left'), swings: [s], today: new Date('2026-10-30T10:00:00.000Z') }).state).toBe('stale');
  });

  it('a recent fitting swing beats a stale one, and a stale swing does not make a wrong-club note', () => {
    const l = link('tee:side:left', [swing({ createdAt: daysAgo(200) }), swing({ createdAt: daysAgo(5) })]);
    expect(l).toMatchObject({ state: 'linked', swing: { ageDays: 5 } });
    expect(link('tee:side:left', [swing({ club: 'iron', mainFault: 'early_extension', createdAt: daysAgo(90) })]).state).toBe('none');
  });
});

describe('consequence as a second signal', () => {
  it('a consequence alone is possible', () => {
    const s = swing({ club: 'iron', mainFault: 'posture', consequences: ['flip'] });
    const l = link('short:chip', [s]);
    expect(l).toMatchObject({ state: 'linked', strength: 'possible', via: 'consequence', fault: 'flip', secondSignal: false });
  });

  it('a main match plus a consequence match stays consistent, never above, and adds the note', () => {
    const s = swing({ club: 'iron', mainFault: 'early_extension', consequences: ['flip'] });
    const l = link('approach:short', [s]);
    expect(l).toMatchObject({ state: 'linked', strength: 'consistent', via: 'main', secondSignal: true });
    expect(l.note).toEqual({ key: 'stats.my.coach.swing.secondSignal', params: { fault: { key: 'swing.fault.flip', params: undefined, lower: true } } });
  });

  it('upgrades an allowed-club main match to consistent when a consequence agrees', () => {
    const s = swing({ club: 'iron', mainFault: 'tempo_fast', consequences: ['balance'] });
    expect(link('tee:side:left', [s])).toMatchObject({ strength: 'consistent', secondSignal: true });
  });

  it('a consequence on the wrong club does not link', () => {
    const s = swing({ club: 'driver', mainFault: 'posture', consequences: ['flip'] });
    expect(link('short:chip', [s]).state).toBe('wrongClub');
  });

  it('strength is never likely', () => {
    const states = Object.entries(SWING_FAULT_LINKS).flatMap(([fault, row]) => row.causes.flatMap((c) => (
      ['driver', 'iron'].map((club) => link(c, [swing({ mainFault: fault, club, consequences: Object.keys(SWING_FAULT_LINKS) })]).strength)
    )));
    expect(new Set(states.filter(Boolean))).toEqual(new Set(['consistent']));
  });
});

describe('old rows', () => {
  it('rows without consequences or handedness still work', () => {
    const old = { id: 'o', status: 'ready', club: 'driver', createdAt: daysAgo(3), mainFault: 'over_the_top' };
    expect(link('tee:side:left', [old])).toMatchObject({ state: 'linked', strength: 'consistent', secondSignal: false });
    expect(link('approach:short', [{ ...old, mainFault: 'early_extension', club: undefined }]).state).toBe('linked');
  });
});

describe('why causes (miss reasons, spec §5.5)', () => {
  const ironSwing = (o = {}) => swing({ club: 'iron', ...o });

  it('over the top links the curve-right and start-left why causes (iron on approach, driver off the tee)', () => {
    expect(link('approach:why:swing:curve:right', [ironSwing()])).toMatchObject({ state: 'linked', fault: 'over_the_top', strength: 'consistent' });
    expect(link('approach:why:swing:start:left', [ironSwing()]).state).toBe('linked');
    expect(link('tee:why:swing:curve:right', [swing()]).state).toBe('linked');
    expect(link('tee:why:swing:curve:right', [ironSwing()]).state).toBe('wrongClub');
  });

  it('flat backswing links the mirror image', () => {
    const flat = (o) => ironSwing({ mainFault: 'flat_backswing', ...o });
    expect(link('approach:why:swing:curve:left', [flat()]).state).toBe('linked');
    expect(link('approach:why:swing:start:right', [flat()]).state).toBe('linked');
    expect(link('tee:why:swing:curve:left', [flat({ club: 'driver' })]).state).toBe('linked');
  });

  it('a left-hander mirrors start:left to start:right', () => {
    const lefty = ironSwing({ handedness: 'left' });
    expect(link('approach:why:swing:start:right', [lefty], { profile: { handedness: 'left' } }).state).toBe('linked');
    expect(link('approach:why:swing:start:left', [lefty], { profile: { handedness: 'left' } }).state).toBe('swingOnly');
  });

  it('early extension, flip and head sway link the low point causes', () => {
    expect(link('approach:why:swing:strike:right', [ironSwing({ mainFault: 'early_extension' })]).fault).toBe('early_extension');
    expect(link('approach:why:swing:lowPoint', [ironSwing({ mainFault: 'early_extension' })]).state).toBe('linked');
    expect(link('short:why:swing:lowPoint', [ironSwing({ mainFault: 'early_extension' })]).state).toBe('linked');
    expect(link('approach:why:swing:lowPoint', [ironSwing({ mainFault: 'flip' })]).state).toBe('linked');
    expect(link('short:why:swing:lowPoint', [ironSwing({ mainFault: 'flip' })]).state).toBe('linked');
    expect(link('approach:why:swing:lowPoint', [ironSwing({ mainFault: 'head_sway' })]).state).toBe('linked');
    expect(link('short:why:swing:lowPoint', [ironSwing({ mainFault: 'head_sway' })]).state).toBe('swingOnly');
  });

  it('sideless ids pass mirrorCauseId unchanged; sided ones mirror', () => {
    ['approach:why:swing:lowPoint', 'short:why:swing:lowPoint', 'approach:why:lie', 'tee:why:decision']
      .forEach((id) => expect(mirrorCauseId(id, 'left')).toBe(id));
    expect(mirrorCauseId('approach:why:swing:start:left', 'left')).toBe('approach:why:swing:start:right');
  });

  it('a short-game why cause asks for an iron, not a driver', () => {
    expect(clubOfCause('cause:short:why:swing:lowPoint')).toBe('iron');
    expect(clubOfCause('approach:why:lie')).toBe('iron');
    expect(clubOfCause('tee:why:swing:curve:right')).toBe('driver');
  });

  it('every row of §5.5 is in the table', () => {
    expect(SWING_FAULT_LINKS.over_the_top.causes).toEqual(expect.arrayContaining([
      'approach:why:swing:curve:right', 'tee:why:swing:curve:right', 'approach:why:swing:start:left']));
    expect(SWING_FAULT_LINKS.flat_backswing.causes).toEqual(expect.arrayContaining([
      'approach:why:swing:curve:left', 'tee:why:swing:curve:left', 'approach:why:swing:start:right']));
    expect(SWING_FAULT_LINKS.early_extension.causes).toEqual(expect.arrayContaining([
      'approach:why:swing:strike:right', 'approach:why:swing:lowPoint', 'short:why:swing:lowPoint']));
    expect(SWING_FAULT_LINKS.flip.causes).toEqual(expect.arrayContaining(['approach:why:swing:lowPoint', 'short:why:swing:lowPoint']));
    expect(SWING_FAULT_LINKS.head_sway.causes).toContain('approach:why:swing:lowPoint');
  });
});
