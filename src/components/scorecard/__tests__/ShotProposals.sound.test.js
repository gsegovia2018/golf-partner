import React from 'react';
import { render } from '@testing-library/react-native';
import { SoundEvidence } from '../ShotProposals';

test('a shot: strike heard and my swing', () => {
  const { getByTestId, getByText } = render(<SoundEvidence level="shot" />);
  expect(getByTestId('seen-sound-shot')).toBeTruthy();
  expect(getByText('Strike heard')).toBeTruthy();
  expect(getByText('Your swing')).toBeTruthy();
});

test('heard: strike, but not my swing', () => {
  const { getByText, queryByText } = render(<SoundEvidence level="heard" />);
  expect(getByText('Strike heard')).toBeTruthy();
  expect(getByText('No swing from you')).toBeTruthy();
  expect(queryByText('Your swing')).toBeNull();
});

test('quiet: no strike heard', () => {
  const { getByText, queryByText } = render(<SoundEvidence level="quiet" />);
  expect(getByText('No strike heard')).toBeTruthy();
  expect(queryByText('Strike heard')).toBeNull();
});

test('no sound data: nothing', () => {
  expect(render(<SoundEvidence level={null} />).toJSON()).toBeNull();
});
