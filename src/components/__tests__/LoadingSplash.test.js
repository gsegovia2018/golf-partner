import React from 'react';
import { render } from '@testing-library/react-native';
import LoadingSplash from '../LoadingSplash';

describe('LoadingSplash', () => {
  it.each(['putt', 'green', 'swing', 'water'])('renders the %s scene with the wordmark', (scene) => {
    const { getByTestId, getByText } = render(<LoadingSplash scene={scene} />);
    expect(getByTestId(`splash-scene-${scene}`)).toBeTruthy();
    expect(getByText('GOLF PARTNER')).toBeTruthy();
  });

  it('keeps the scene it drew for every later mount in the same launch', () => {
    const first = render(<LoadingSplash />);
    const pick = ['putt', 'green', 'swing', 'water'].find((s) => first.queryByTestId(`splash-scene-${s}`));
    expect(pick).toBeDefined();
    first.unmount();
    for (let i = 0; i < 5; i++) {
      const again = render(<LoadingSplash />);
      expect(again.queryByTestId(`splash-scene-${pick}`)).toBeTruthy();
      again.unmount();
    }
  });
});
