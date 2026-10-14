import {
  canRemoveRoundFromEditor,
  roundRemovalConfirmation,
} from '../editTournamentRoundDeletion';

const players = [{ id: 'p1' }, { id: 'p2' }];
const holes = [{ number: 1 }, { number: 2 }];

function completeRound(id = 'r1') {
  return {
    id,
    holes,
    scores: {
      p1: { 1: 4, 2: 5 },
      p2: { 1: 5, 2: 6 },
    },
  };
}

describe('edit tournament round deletion helpers', () => {
  test('allows deleting a completed round when another round remains', () => {
    const tournament = { players, rounds: [completeRound('r1'), completeRound('r2')] };

    expect(canRemoveRoundFromEditor(tournament, 0)).toBe(true);
  });

  test('blocks deleting the only round individually', () => {
    const tournament = { players, rounds: [completeRound('r1')] };

    expect(canRemoveRoundFromEditor(tournament, 0)).toBe(false);
  });

  test('uses history-round confirmation copy for completed rounds', () => {
    const round = completeRound('r1');

    expect(roundRemovalConfirmation({
      round,
      roundIndex: 0,
      players,
      tournament: { rounds: [round, completeRound('r2')] },
    })).toEqual({
      titleKey: 'setup.edit.delHistory.title',
      messageKey: 'setup.edit.delHistory.message',
      confirmKey: 'setup.edit.delHistory.confirm',
      params: { n: 1, count: 4 },
    });
  });

  test('uses history-round confirmation copy for archived rounds', () => {
    const round = { id: 'r1', holes, scores: {} };

    expect(roundRemovalConfirmation({
      round,
      roundIndex: 0,
      players,
      tournament: { finishedAt: 123, rounds: [round, completeRound('r2')] },
    }).confirmKey).toBe('setup.edit.delHistory.confirm');
  });

  test('keeps entered-score warning for partial rounds', () => {
    const round = { id: 'r1', holes, scores: { p1: { 1: 4 } } };

    expect(roundRemovalConfirmation({
      round,
      roundIndex: 0,
      players,
      tournament: { rounds: [round, completeRound('r2')] },
    })).toEqual({
      titleKey: 'setup.edit.delScores.title',
      messageKey: 'setup.edit.delScores.message',
      confirmKey: 'setup.edit.delScores.confirm',
      params: { n: 1, count: 1 },
    });
  });
});
