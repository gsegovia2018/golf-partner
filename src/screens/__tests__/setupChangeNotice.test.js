import { setupSignature, describeSetupChange } from '../setupChangeNotice';

const base = () => ({
  players: [{ id: 'a', name: 'Alex' }, { id: 'b', name: 'Bea' }],
  rounds: [{
    id: 'r0', courseId: 'c1', courseName: 'Abama', holes: new Array(18).fill({ par: 4 }),
    pairs: [['a', 'b']], playerHandicaps: { a: 3, b: 12 }, playerTees: { a: 'yellow' }, scoringMode: 'stableford',
  }],
  settings: { scoringMode: 'stableford' },
});

describe('setupChangeNotice', () => {
  it('reports nothing when setup is unchanged', () => {
    const t = base();
    expect(describeSetupChange(setupSignature(t, 0), setupSignature(base(), 0))).toBeNull();
  });

  it('names a team change', () => {
    const next = base(); next.rounds[0].pairs = [['b', 'a']];
    expect(describeSetupChange(setupSignature(base(), 0), setupSignature(next, 0)))
      .toBe('Teams changed on another phone');
  });

  it('names a roster change, including a rename and a reorder', () => {
    const renamed = base(); renamed.players[0].name = 'Alexander';
    expect(describeSetupChange(setupSignature(base(), 0), setupSignature(renamed, 0)))
      .toBe('Players changed on another phone');
    const reordered = base(); reordered.players.reverse();
    expect(describeSetupChange(setupSignature(base(), 0), setupSignature(reordered, 0)))
      .toBe('Players changed on another phone');
  });

  it('joins several changes in one sentence', () => {
    const next = base(); next.players.push({ id: 'c', name: 'Cai' }); next.rounds[0].pairs = [['a', 'b'], ['c']]; next.rounds[0].playerHandicaps.a = 4;
    expect(describeSetupChange(setupSignature(base(), 0), setupSignature(next, 0)))
      .toBe('Players, teams and handicaps changed on another phone');
  });

  it('ignores a scoring mode change — the screen has its own notice for that', () => {
    const next = base(); next.settings.scoringMode = 'bestball'; next.rounds[0].scoringMode = 'bestball';
    expect(describeSetupChange(setupSignature(base(), 0), setupSignature(next, 0))).toBeNull();
  });

  it('tolerates a missing tournament or round', () => {
    expect(setupSignature(null)).toBeNull();
    expect(describeSetupChange(null, setupSignature(base(), 0))).toBeNull();
    expect(describeSetupChange(setupSignature(base(), 3), setupSignature(base(), 3))).toBeNull();
  });
});
