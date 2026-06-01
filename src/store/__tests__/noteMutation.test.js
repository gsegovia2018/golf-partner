import { applyToTournament } from '../mutate';

describe('note.set mutation', () => {
  test('adding a hole note preserves a legacy string round note', () => {
    const t = {
      rounds: [{ id: 'r1', notes: 'Legacy round note' }],
    };

    applyToTournament(t, {
      type: 'note.set',
      roundId: 'r1',
      scope: 'hole',
      hole: 7,
      text: 'Fairway bunker',
    });

    expect(t.rounds[0].notes).toEqual({
      round: 'Legacy round note',
      hole: { 7: 'Fairway bunker' },
    });
  });

  test('updating the round note preserves existing hole notes', () => {
    const t = {
      rounds: [{ id: 'r1', notes: { hole: { 3: 'Lost ball' } } }],
    };

    applyToTournament(t, {
      type: 'note.set',
      roundId: 'r1',
      scope: 'round',
      text: 'Windy back nine',
    });

    expect(t.rounds[0].notes).toEqual({
      round: 'Windy back nine',
      hole: { 3: 'Lost ball' },
    });
  });
});
