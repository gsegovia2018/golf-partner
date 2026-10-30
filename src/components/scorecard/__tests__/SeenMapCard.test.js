import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { SeenMapCard } from '../ShotProposals';

// Default bag order: Driver, Madera 3, Madera 5, Híbrido 4, Hierro 5, Hierro 6,
// Hierro 7, Hierro 8, … — rows 44 high.
const proposal = { id: 'p1', start: 1000, end: 61000, toGreen: 140, club: '7i', sound: null };
const card = (p, onAdd = jest.fn()) => render(
  <SeenMapCard proposal={p} onAdd={onAdd} onDismiss={jest.fn()} onPlusOne={jest.fn()} missing={0} />,
);

test('Add names the suggested club, and adds with it in one tap', () => {
  const onAdd = jest.fn();
  const { getByText } = card(proposal, onAdd);
  fireEvent.press(getByText('Add · 7 Iron'));
  expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', club: '7i' }));
});

test('scrolling the wheel to another club changes what Add adds', () => {
  const onAdd = jest.fn();
  const { getByTestId, getByText } = card(proposal, onAdd);
  act(() => {
    fireEvent.scroll(getByTestId('inline-club-wheel-scroll'), { nativeEvent: { contentOffset: { y: 44 * 7 } } });
  });
  fireEvent.press(getByText('Add · 8 Iron'));
  expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ club: '8i' }));
});

test('without a suggestion the wheel opens mid-bag and Add still names a club', () => {
  const { getByTestId } = card({ ...proposal, club: null });
  expect(getByTestId('seen-add')).toHaveTextContent(/^Add · /);
});
