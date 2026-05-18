import { wizardSteps, isStepValid } from '../setupWizard';

describe('wizardSteps', () => {
  test('solo game omits the scoring step', () => {
    expect(wizardSteps('game', 1)).toEqual(['players', 'course', 'review']);
  });
  test('multiplayer game includes the scoring step', () => {
    expect(wizardSteps('game', 2)).toEqual(['players', 'course', 'scoring', 'review']);
  });
  test('solo tournament uses the rounds step and omits scoring', () => {
    expect(wizardSteps('tournament', 1)).toEqual(['players', 'rounds', 'review']);
  });
  test('multiplayer tournament uses rounds and includes scoring', () => {
    expect(wizardSteps('tournament', 3)).toEqual(['players', 'rounds', 'scoring', 'review']);
  });
});

describe('isStepValid', () => {
  test('players step needs at least one player', () => {
    expect(isStepValid('players', { players: [], rounds: [] })).toBe(false);
    expect(isStepValid('players', { players: [{ id: 'a' }], rounds: [] })).toBe(true);
  });
  test('course step needs the round to have a course name', () => {
    expect(isStepValid('course', { players: [], rounds: [{ courseName: '' }] })).toBe(false);
    expect(isStepValid('course', { players: [], rounds: [{ courseName: 'Pebble' }] })).toBe(true);
  });
  test('rounds step is invalid when any round lacks a course', () => {
    expect(isStepValid('rounds', {
      players: [], rounds: [{ courseName: 'A' }, { courseName: '  ' }],
    })).toBe(false);
    expect(isStepValid('rounds', {
      players: [], rounds: [{ courseName: 'A' }, { courseName: 'B' }],
    })).toBe(true);
  });
  test('scoring and review steps are always valid', () => {
    expect(isStepValid('scoring', { players: [], rounds: [] })).toBe(true);
    expect(isStepValid('review', { players: [], rounds: [] })).toBe(true);
  });
});

describe('official kind', () => {
  test('official steps are roster, rounds, format, review', () => {
    expect(wizardSteps('official', 0)).toEqual(['roster', 'rounds', 'format', 'review']);
    expect(wizardSteps('official', 8)).toEqual(['roster', 'rounds', 'format', 'review']);
  });

  test('roster step needs at least one roster entry', () => {
    expect(isStepValid('roster', { roster: [], rounds: [] })).toBe(false);
    expect(isStepValid('roster', { roster: [{ displayName: 'Ann' }], rounds: [] })).toBe(true);
  });

  test('a roster entry with a blank name is invalid', () => {
    expect(isStepValid('roster', { roster: [{ displayName: '  ' }], rounds: [] })).toBe(false);
  });

  test('format step is always valid', () => {
    expect(isStepValid('format', { roster: [], rounds: [] })).toBe(true);
  });
});
