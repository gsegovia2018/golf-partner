import { applyToTournament, metaPathFor } from '../mutate';

describe('round.setBestBallValues mutation', () => {
  test('stamps both per-round value paths', () => {
    expect(metaPathFor({ type: 'round.setBestBallValues', roundId: 'r1' }))
      .toEqual(['rounds.r1.bestBallValue', 'rounds.r1.worstBallValue']);
  });

  test('sets both values on the target round only', () => {
    const t = { rounds: [{ id: 'r1' }, { id: 'r2' }] };
    applyToTournament(t, {
      type: 'round.setBestBallValues', roundId: 'r2', bestBallValue: 3, worstBallValue: 2,
    });
    expect(t.rounds[1].bestBallValue).toBe(3);
    expect(t.rounds[1].worstBallValue).toBe(2);
    expect(t.rounds[0].bestBallValue).toBeUndefined();
  });

  test('unknown round is a no-op', () => {
    const t = { rounds: [{ id: 'r1' }] };
    applyToTournament(t, {
      type: 'round.setBestBallValues', roundId: 'nope', bestBallValue: 3, worstBallValue: 2,
    });
    expect(t.rounds[0].bestBallValue).toBeUndefined();
  });
});

describe('tournament.setTeamSettings mutation', () => {
  test('stamps both settings paths', () => {
    expect(metaPathFor({ type: 'tournament.setTeamSettings' }))
      .toEqual(['settings.fixedTeams', 'settings.manualTeams']);
  });

  test('merges booleans into settings without touching other keys', () => {
    const t = { settings: { scoringMode: 'bestball', bestBallValue: 2 } };
    applyToTournament(t, { type: 'tournament.setTeamSettings', fixedTeams: true, manualTeams: false });
    expect(t.settings).toEqual({
      scoringMode: 'bestball', bestBallValue: 2, fixedTeams: true, manualTeams: false,
    });
  });

  test('coerces truthy/falsy inputs to booleans and tolerates missing settings', () => {
    const t = {};
    applyToTournament(t, { type: 'tournament.setTeamSettings', fixedTeams: 1, manualTeams: undefined });
    expect(t.settings).toEqual({ fixedTeams: true, manualTeams: false });
  });
});
