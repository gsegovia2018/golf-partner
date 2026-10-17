import React from 'react';
import { render, act, fireEvent, within } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import ShotScorecard from '../ShotScorecard';
import { scorecardModel } from '../../../store/scorecardView';
import { weekendFixture } from '../../../store/__tests__/fixtures/gameStatsFixture';

const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));

async function show(card, mode) {
  const utils = render(<ThemeProvider><ShotScorecard card={card} mode={mode} /></ThemeProvider>);
  await flush();
  return utils;
}

const round0 = () => weekendFixture().rounds[0];
const roster = () => weekendFixture().players;

test('several players: my shot rows open under my score, a tap closes them', async () => {
  const card = scorecardModel({ round: round0(), players: roster(), meId: 'fx-me' });
  const { getAllByTestId, queryAllByText, getAllByText } = await show(card);
  expect(getAllByText('putts')).toHaveLength(2);
  expect(getAllByText('green')).toHaveLength(2);
  fireEvent.press(getAllByTestId('card-name-fx-me')[0]);
  expect(queryAllByText('putts')).toHaveLength(0);
});

test('a player without shots: plain label, no button, never opens', async () => {
  const card = scorecardModel({ round: round0(), players: roster(), meId: 'fx-jav' });
  const { getAllByTestId, queryAllByText } = await show(card);
  const jav = getAllByTestId('card-name-fx-jav')[0];
  expect(jav.props.accessibilityState).toBeUndefined();
  // Marcos logged shots but isn't me: closed until tapped.
  expect(queryAllByText('putts')).toHaveLength(0);
  fireEvent.press(getAllByTestId('card-name-fx-me')[0]);
  expect(queryAllByText('putts')).toHaveLength(2);
});

test('handicap strokes are dots in the score cell; a penalty is a corner dot', async () => {
  const card = scorecardModel({ round: round0(), players: roster(), meId: 'fx-me' });
  const { getAllByTestId, queryAllByTestId, getByTestId } = await show(card);
  // Nacho, playing 31: two strokes on SI 1–13 (hole 4 is SI 1), one elsewhere.
  expect(getAllByTestId('card-fx-nac-hcp-4')).toHaveLength(2);
  expect(getAllByTestId('card-fx-nac-hcp-7')).toHaveLength(1);
  // Javier, playing 9: no stroke on SI 15 (hole 3).
  expect(queryAllByTestId('card-fx-jav-hcp-3')).toHaveLength(0);
  expect(getByTestId('card-fx-me-penalty-12')).toBeTruthy();
});

test('match play points read untinted hole results', async () => {
  const card = scorecardModel({ round: round0(), players: roster().slice(0, 2), meId: 'fx-me', mode: 'matchplay' });
  const { getByTestId } = await show(card, 'points');
  const out = within(getByTestId('ledger-out'));
  expect(['0', '1']).toContain(out.getByTestId('card-fx-me-cell-1').props.children);
});

test('one player: score and shot rows always shown, a totals line, no name buttons', async () => {
  const card = scorecardModel({ round: round0(), players: roster().slice(0, 1), meId: 'fx-me' });
  const { getByTestId, getAllByText, queryAllByTestId } = await show(card);
  expect(getAllByText('Strokes')).toHaveLength(2);
  expect(getAllByText('Putts')).toHaveLength(2);
  expect(queryAllByTestId(/^card-name-/)).toHaveLength(0);
  expect(getByTestId('ledger-total').props.children).toBe('102 strokes · +30 · 36 putts');
});

test('a tagged green miss draws a why dot and puts the summary in the label', async () => {
  const round = round0();
  Object.assign(round.shotDetails['fx-me'][1], {
    approachResult: 'miss', approachMiss: 'right', approachStart: 'right', approachContact: 'fat',
  });
  const card = scorecardModel({ round, players: roster().slice(0, 1), meId: 'fx-me' });
  const { getByTestId, queryByTestId, getByLabelText } = await show(card);
  expect(getByTestId('ledger-why-1')).toBeTruthy();
  expect(queryByTestId('ledger-why-2')).toBeNull();
  expect(getByLabelText(/Hole 1: green missed, Why: .+ · .+/)).toBeTruthy();
});
