import React from 'react';
import { Animated } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { CelebrationToast } from '../CelebrationToast';
import { ThemeProvider } from '../../../theme/ThemeContext';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

const PLAYERS = [{ id: 'p1', name: 'Marcos Specker' }, { id: 'p2', name: 'Noé' }];

// ThemeProvider reads its persisted preference from AsyncStorage in a
// useEffect; flush that pending promise (inside act) after every render so
// its follow-up setState doesn't land outside act().
const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));

async function renderToast(celebration) {
  const utils = render(
    <ThemeProvider>
      <CelebrationToast
        celebration={celebration}
        celebrationAnim={new Animated.Value(1)}
        players={PLAYERS}
      />
    </ThemeProvider>,
  );
  await flush();
  return utils;
}

describe('CelebrationToast', () => {
  it('renders the label, first name, hole and delta for a birdie', async () => {
    const r = await renderToast({ playerId: 'p1', holeNumber: 7, label: 'BIRDIE', delta: -1 });
    expect(r.queryByText('BIRDIE')).toBeTruthy();
    // First name only — surnames make the toast wrap on narrow phones.
    expect(r.queryByText('Marcos · Hole 7')).toBeTruthy();
    expect(r.queryByText('−1')).toBeTruthy();
  });

  it('shows a positive delta for a noelada', async () => {
    const r = await renderToast({ playerId: 'p2', holeNumber: 7, label: 'NOELADA', delta: 3 });
    expect(r.queryByText('NOELADA')).toBeTruthy();
    expect(r.queryByText('Noé · Hole 7')).toBeTruthy();
    expect(r.queryByText('+3')).toBeTruthy();
  });

  it('omits the delta rather than rendering NaN when it is absent', async () => {
    const r = await renderToast({ playerId: 'p1', holeNumber: 7, label: 'BIRDIE' });
    expect(r.queryByText('BIRDIE')).toBeTruthy();
    expect(r.queryByText('NaN')).toBeNull();
    expect(r.queryByText('−1')).toBeNull();
  });

  it('renders nothing without a label', async () => {
    const r = await renderToast({ playerId: null, holeNumber: null, label: null });
    expect(r.toJSON()).toBeNull();
  });

  it('omits the subtitle when the player is unknown', async () => {
    const r = await renderToast({ playerId: 'ghost', holeNumber: 4, label: 'BIRDIE', delta: -1 });
    expect(r.queryByText('BIRDIE')).toBeTruthy();
    expect(r.queryByText(/Hole 4/)).toBeNull();
  });
});
