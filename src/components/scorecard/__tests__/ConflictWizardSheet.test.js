import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import ConflictWizardSheet from '../ConflictWizardSheet';

const rows = [
  {
    playerId: 'p1', hole: 3, par: 4, playerName: 'Marcos', currentValue: 5,
    candidates: [
      { value: 5, ts: 0, authorId: 'me', authorName: 'You' },
      { value: 6, ts: 0, authorId: 'juan', authorName: 'Juan' },
    ],
  },
  {
    playerId: 'p2', hole: 7, par: 3, playerName: 'Vielo', currentValue: null,
    candidates: [
      { value: null, ts: 0, authorId: 'me', authorName: 'You' },
      { value: 4, ts: 0, authorId: 'ana', authorName: 'Ana' },
    ],
    blankAuthors: ['Ana'],
  },
];

// BottomSheet and the wizard both tolerate a missing ThemeProvider (see
// BottomSheet.js) — bare render is fine, mirroring the sheets this replaced.
const mount = (props = {}) => render(
  <ConflictWizardSheet
    visible
    rows={rows}
    localAuthorIds={['me']}
    onPick={jest.fn()}
    onClose={jest.fn()}
    primaryLabel="Done"
    onPrimary={jest.fn()}
    {...props}
  />,
);

it('shows only the first conflict, with hole, par, player and progress', () => {
  const { getByText, queryByText } = mount();
  expect(getByText("Marcos's score")).toBeTruthy();
  expect(getByText('Hole 3 · Par 4 · two phones disagree')).toBeTruthy();
  expect(getByText('1 of 2')).toBeTruthy();
  expect(queryByText("Vielo's score")).toBeNull();
});

it('omits the par segment when the hole has no par', () => {
  const { getByText } = mount({ rows: [{ ...rows[0], par: null }] });
  expect(getByText('Hole 3 · two phones disagree')).toBeTruthy();
});

it('labels a local author "You wrote" and any other author by name', () => {
  const { getByText } = mount();
  expect(getByText('You wrote')).toBeTruthy();
  expect(getByText('Juan wrote')).toBeTruthy();
});

it('labels an unknown author with the name the row carries', () => {
  const { getByText } = mount({
    rows: [{
      ...rows[0],
      candidates: [
        { value: 5, ts: 0, authorId: 'me', authorName: 'You' },
        { value: 6, ts: 0, authorId: 'ghost', authorName: 'Another phone' },
      ],
    }],
  });
  expect(getByText('Another phone wrote')).toBeTruthy();
});

it('renders a null candidate as "No score"', () => {
  const { getByText } = mount({ rows: [rows[1]] });
  expect(getByText('No score')).toBeTruthy();
});

it('tapping a candidate calls onPick with playerId, hole, value', () => {
  const onPick = jest.fn();
  const { getByLabelText } = mount({ onPick });
  fireEvent.press(getByLabelText('Use 6 strokes for Marcos on hole 3'));
  expect(onPick).toHaveBeenCalledWith('p1', 3, 6);
});

it('advances to the next row when the settled row leaves the live list', () => {
  const { getByText, rerender } = mount();
  expect(getByText('1 of 2')).toBeTruthy();
  rerender(
    <ConflictWizardSheet
      visible
      rows={[rows[1]]}
      localAuthorIds={['me']}
      onPick={jest.fn()}
      onClose={jest.fn()}
      primaryLabel="Done"
      onPrimary={jest.fn()}
    />,
  );
  expect(getByText("Vielo's score")).toBeTruthy();
  expect(getByText('2 of 2')).toBeTruthy();
});

it('"Decide later" skips to the next row, and the last skip lands on the undecided state', () => {
  const { getByLabelText, getByText, queryByLabelText } = mount();
  fireEvent.press(getByLabelText('Decide later'));
  expect(getByText("Vielo's score")).toBeTruthy();

  fireEvent.press(getByLabelText('Decide later'));
  expect(getByText('Left for later')).toBeTruthy();
  expect(getByText("2 left undecided — they'll stay flagged on the scorecard.")).toBeTruthy();
  // No primary while conflicts are still pending unless the caller allows it.
  expect(queryByLabelText('Done')).toBeNull();
  // "Review again" puts every deferred row back in the queue.
  fireEvent.press(getByLabelText('Review again'));
  expect(getByText("Marcos's score")).toBeTruthy();
});

it('manual entry steps from the first non-null candidate and resolves with that value', () => {
  const onPick = jest.fn();
  const { getByLabelText } = mount({ onPick });
  fireEvent.press(getByLabelText('Enter a different score'));
  fireEvent.press(getByLabelText("Increase Marcos's score"));
  fireEvent.press(getByLabelText('Use 6 strokes'));
  expect(onPick).toHaveBeenCalledWith('p1', 3, 6);
});

it('shows the done state and fires onPrimary once no rows remain', () => {
  const onPrimary = jest.fn();
  const { getByText, getByLabelText } = mount({ rows: [], onPrimary });
  expect(getByText('All scores agreed')).toBeTruthy();
  fireEvent.press(getByLabelText('Done'));
  expect(onPrimary).toHaveBeenCalled();
});

it('uses the caller-supplied done subtitle when given', () => {
  const { getByText } = mount({ rows: [], doneSubtitle: 'You can finish the round.' });
  expect(getByText('You can finish the round.')).toBeTruthy();
});

it('renders the secondary ghost action only in the done state', () => {
  const onSecondary = jest.fn();
  expect(mount({ secondaryLabel: 'Fix scores', onSecondary }).queryByLabelText('Fix scores')).toBeNull();

  const done = mount({ rows: [], secondaryLabel: 'Fix scores', onSecondary });
  fireEvent.press(done.getByLabelText('Fix scores'));
  expect(onSecondary).toHaveBeenCalled();
});

it('renders the primary while rows remain only when allowPrimaryWhilePending', () => {
  expect(mount().queryByLabelText('Done')).toBeNull();

  const onPrimary = jest.fn();
  const escape = mount({ allowPrimaryWhilePending: true, primaryLabel: 'Continue anyway', onPrimary });
  fireEvent.press(escape.getByLabelText('Continue anyway'));
  expect(onPrimary).toHaveBeenCalled();
});

it('renders the "No score from …" note when blankAuthors is non-empty', () => {
  const { getByText } = mount({ rows: [rows[1]] });
  expect(getByText('No score from Ana')).toBeTruthy();
});
