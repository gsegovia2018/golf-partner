import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { ScorecardStatus } from '../ScorecardChrome';
import { makeScorecardStyles } from '../styles';
import { ThemeProvider, useTheme } from '../../../theme/ThemeContext';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

// The screen hands the chrome its memoised styles and theme; do the same.
function Status(props) {
  const { theme } = useTheme();
  return <ScorecardStatus s={makeScorecardStyles(theme)} theme={theme} {...props} />;
}

// ThemeProvider reads its persisted preference in an effect; flush it in act().
const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));
async function renderStatus(props) {
  const r = render(<ThemeProvider><Status {...props} /></ThemeProvider>);
  await flush();
  return r;
}

// The loading and load-failed screens were two inline early returns in
// ScorecardScreen; they now share ScorecardStatus.
describe('ScorecardStatus', () => {
  it('shows the spinner copy while loading, with a working back button', async () => {
    const onBack = jest.fn();
    const r = await renderStatus({ onBack, error: false, onRetry: jest.fn() });
    expect(r.queryByText('Loading round…')).toBeTruthy();
    expect(r.queryByText('Retry')).toBeNull();
    fireEvent.press(r.getByLabelText('Back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('shows the error copy and retries on tap', async () => {
    const onRetry = jest.fn();
    const r = await renderStatus({ onBack: jest.fn(), error: true, onRetry });
    expect(r.queryByText("Couldn't load this round")).toBeTruthy();
    expect(r.queryByText('Loading round…')).toBeNull();
    fireEvent.press(r.getByText('Retry'));
    expect(onRetry).toHaveBeenCalled();
  });
});
