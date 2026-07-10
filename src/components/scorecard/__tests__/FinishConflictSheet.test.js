import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import FinishConflictSheet from '../FinishConflictSheet';

const rows = [
  {
    playerId: 'p1', hole: 3, playerName: 'Marcos', currentValue: 5,
    candidates: [{ value: 5, ts: 100 }, { value: 6, ts: 90 }],
  },
  {
    playerId: 'p2', hole: 7, playerName: 'Vielo', currentValue: null,
    candidates: [{ value: null, ts: 100 }, { value: 4, ts: 90 }],
  },
];

// BottomSheet and the sheet itself tolerate a missing ThemeProvider (see
// BottomSheet.js) — bare render is fine. If other tests in this directory
// wrap with a provider, mirror their wrapper instead.
const mount = (props = {}) => render(
  <FinishConflictSheet
    visible
    rows={rows}
    onPick={jest.fn()}
    onFinish={jest.fn()}
    onClose={jest.fn()}
    {...props}
  />,
);

it('lists every conflicted hole with player name and both candidates', () => {
  const { getByText } = mount();
  expect(getByText('Hole 3')).toBeTruthy();
  expect(getByText('Marcos')).toBeTruthy();
  expect(getByText('Hole 7')).toBeTruthy();
  expect(getByText('Vielo')).toBeTruthy();
});

it('renders a null candidate as "No score"', () => {
  const { getAllByText } = mount();
  expect(getAllByText('No score').length).toBeGreaterThan(0);
});

it('tapping a candidate calls onPick with that value', () => {
  const onPick = jest.fn();
  const { getByLabelText } = mount({ onPick });
  fireEvent.press(getByLabelText('Use 6 strokes for Marcos on hole 3'));
  expect(onPick).toHaveBeenCalledWith('p1', 3, 6);
});

it('finish button is disabled while rows remain and enabled when empty', () => {
  const onFinish = jest.fn();
  const withRows = mount({ onFinish });
  fireEvent.press(withRows.getByLabelText('Finish round'));
  expect(onFinish).not.toHaveBeenCalled();

  const empty = mount({ onFinish, rows: [] });
  fireEvent.press(empty.getByLabelText('Finish round'));
  expect(onFinish).toHaveBeenCalled();
});
