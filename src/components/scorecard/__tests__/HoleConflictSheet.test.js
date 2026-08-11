import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import HoleConflictSheet from '../HoleConflictSheet';

const rows = [
  {
    playerId: 'p1', hole: 3, playerName: 'Marcos', currentValue: 5,
    candidates: [
      { value: 5, ts: 100, authorId: 'me', authorName: 'You' },
      { value: 6, ts: 90, authorId: 'juan', authorName: 'Juan' },
    ],
  },
  {
    playerId: 'p2', hole: 7, playerName: 'Vielo', currentValue: null,
    candidates: [
      { value: null, ts: 100, authorId: 'me', authorName: 'You' },
      { value: 4, ts: 90, authorId: 'ana', authorName: 'Ana' },
    ],
    blankAuthors: ['Ana'],
  },
];

// BottomSheet and the sheet itself tolerate a missing ThemeProvider (see
// BottomSheet.js) — bare render is fine, mirroring FinishConflictSheet's test.
const mount = (props = {}) => render(
  <HoleConflictSheet
    visible
    title="Scores don't match on hole 3"
    subtitle="Tap the correct one."
    rows={rows}
    localAuthorId="me"
    onPick={jest.fn()}
    onClose={jest.fn()}
    primaryLabel="Continue anyway"
    onPrimary={jest.fn()}
    {...props}
  />,
);

it('renders player name and "Hole N" for each row', () => {
  const { getByText } = mount();
  expect(getByText('Hole 3')).toBeTruthy();
  expect(getByText('Marcos')).toBeTruthy();
  expect(getByText('Hole 7')).toBeTruthy();
  expect(getByText('Vielo')).toBeTruthy();
});

it('shows "You" for the local author\'s chip and the author name for others', () => {
  const { getAllByText } = mount();
  expect(getAllByText('You').length).toBeGreaterThan(0);
  expect(getAllByText('Juan').length).toBeGreaterThan(0);
  expect(getAllByText('Ana').length).toBeGreaterThan(0);
});

it('tapping a candidate calls onPick with playerId, hole, value', () => {
  const onPick = jest.fn();
  const { getByLabelText } = mount({ onPick });
  fireEvent.press(getByLabelText('Use 6 strokes for Marcos on hole 3'));
  expect(onPick).toHaveBeenCalledWith('p1', 3, 6);
});

it('renders the primary button label and calls onPrimary on press', () => {
  const onPrimary = jest.fn();
  const { getByLabelText } = mount({ onPrimary });
  fireEvent.press(getByLabelText('Continue anyway'));
  expect(onPrimary).toHaveBeenCalled();
});

it('renders the secondary button only when provided, and calls onSecondary on press', () => {
  const onSecondary = jest.fn();
  const withoutSecondary = mount();
  expect(withoutSecondary.queryByLabelText('Fix scores')).toBeNull();

  const withSecondary = mount({ secondaryLabel: 'Fix scores', onSecondary });
  fireEvent.press(withSecondary.getByLabelText('Fix scores'));
  expect(onSecondary).toHaveBeenCalled();
});

it('renders the "No score from …" note when blankAuthors is non-empty', () => {
  const { getByText } = mount();
  expect(getByText('No score from Ana')).toBeTruthy();
});

it('shows the passed title when there are no rows', () => {
  const { getByText } = mount({ rows: [], title: 'All scores agreed' });
  expect(getByText('All scores agreed')).toBeTruthy();
});
