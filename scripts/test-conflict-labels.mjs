import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToLabel } from '../src/store/conflictLabels.js';

const blob = {
  id: 't1',
  rounds: [
    { id: 'r1' },
    { id: 'r2' },
  ],
  players: [
    { id: 'p1', name: 'Carlos' },
    { id: 'p2', name: 'Ana' },
  ],
};

function entry(path) {
  return {
    path,
    localTs: 1, remoteTs: 2,
    winnerValue: null, losingValue: null,
    tournamentId: 't1', detectedAt: 0,
  };
}

test('score path with known player + round', () => {
  assert.equal(
    pathToLabel(entry('rounds.r2.scores.p1.h5'), blob),
    'Ronda 2 · Hoyo 5 · Carlos',
  );
});

test('score path with unknown player', () => {
  assert.equal(
    pathToLabel(entry('rounds.r1.scores.p9.h3'), blob),
    'Ronda 1 · Hoyo 3 · —',
  );
});

test('round notes path', () => {
  assert.equal(
    pathToLabel(entry('rounds.r1.notes.round'), blob),
    'Ronda 1 · Notas',
  );
});

test('hole note path', () => {
  assert.equal(
    pathToLabel(entry('rounds.r2.notes.hole.7'), blob),
    'Ronda 2 · Nota hoyo 7',
  );
});

test('pairs path', () => {
  assert.equal(
    pathToLabel(entry('rounds.r1.pairs'), blob),
    'Ronda 1 · Parejas',
  );
});

test('handicap path', () => {
  assert.equal(
    pathToLabel(entry('rounds.r1.playerHandicaps.p2'), blob),
    'Ronda 1 · Handicap · Ana',
  );
});

test('players array path', () => {
  assert.equal(pathToLabel(entry('players'), blob), 'Jugadores');
});

test('unknown round falls back to em-dash', () => {
  assert.equal(
    pathToLabel(entry('rounds.rXX.scores.p1.h1'), blob),
    'Ronda — · Hoyo 1 · Carlos',
  );
});

test('unknown path falls back to raw path', () => {
  assert.equal(
    pathToLabel(entry('some.unrelated.key'), blob),
    'some.unrelated.key',
  );
});

test('null blob: still resolves hole/round numbers but not names', () => {
  assert.equal(
    pathToLabel(entry('rounds.r1.scores.p1.h5'), null),
    'Ronda — · Hoyo 5 · —',
  );
});
