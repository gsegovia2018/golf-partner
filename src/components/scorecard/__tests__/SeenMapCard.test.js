import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SeenMapCard } from '../ShotProposals';

const proposal = { id: 'p1', start: 1000, end: 61000, toGreen: 140, club: null, sound: null };

test('confirming a club in the wheel adds the shot with it, in one tap', () => {
  const onAdd = jest.fn();
  const { getByTestId, getByText } = render(
    <SeenMapCard proposal={proposal} onAdd={onAdd} onDismiss={jest.fn()} onPlusOne={jest.fn()} missing={0} />,
  );
  fireEvent.press(getByTestId('seen-club'));
  fireEvent.press(getByText(/^Add · /));
  expect(onAdd).toHaveBeenCalledTimes(1);
  expect(onAdd.mock.calls[0][0]).toMatchObject({ id: 'p1', club: expect.any(String) });
});

test('Add on the card still adds without opening the wheel', () => {
  const onAdd = jest.fn();
  const { getByText } = render(
    <SeenMapCard proposal={{ ...proposal, club: 'd' }} onAdd={onAdd} onDismiss={jest.fn()} onPlusOne={jest.fn()} missing={0} />,
  );
  fireEvent.press(getByText('Add'));
  expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', club: 'd' }));
});
