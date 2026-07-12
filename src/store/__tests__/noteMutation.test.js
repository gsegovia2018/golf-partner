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

  // Notes-shape parity fix (task 13.1): get_game_tournament never emits an
  // empty notes.hole/notes.round bucket, so a locally-authored note must not
  // inject one either — otherwise a device that just wrote a note locally
  // disagrees with the same tournament refetched from the server.
  test('a fresh round-only note has no hole key at all', () => {
    const t = { rounds: [{ id: 'r1' }] };

    applyToTournament(t, {
      type: 'note.set', roundId: 'r1', scope: 'round', text: 'Windy back nine',
    });

    expect(t.rounds[0].notes).toEqual({ round: 'Windy back nine' });
    expect(t.rounds[0].notes).not.toHaveProperty('hole');
  });

  test('a fresh hole note has no empty round key', () => {
    const t = { rounds: [{ id: 'r1' }] };

    applyToTournament(t, {
      type: 'note.set', roundId: 'r1', scope: 'hole', hole: 5, text: 'Fairway bunker',
    });

    expect(t.rounds[0].notes).toEqual({ hole: { 5: 'Fairway bunker' } });
    expect(t.rounds[0].notes).not.toHaveProperty('round');
  });
});
