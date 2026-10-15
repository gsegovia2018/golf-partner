import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import LeagueFormatField from '../LeagueFormatField';

describe('LeagueFormatField', () => {
  test('with a single format it shows it as plain text, not a button', () => {
    const { getByText, queryByRole, queryByLabelText } = render(
      <ThemeProvider><LeagueFormatField value="stableford" onChange={jest.fn()} /></ThemeProvider>,
    );
    expect(getByText('Stableford, net')).toBeTruthy();
    expect(getByText(/Most points wins/)).toBeTruthy();
    expect(queryByRole('button')).toBeNull();
    expect(queryByLabelText(/League format/)).toBeNull();
  });
});
