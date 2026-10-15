import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import LeagueFormatField from '../LeagueFormatField';

describe('LeagueFormatField', () => {
  test('disabled it shows the format as plain text, not a button', () => {
    const { getByText, queryByRole, queryByLabelText } = render(
      <ThemeProvider><LeagueFormatField value="stableford" onChange={jest.fn()} disabled /></ThemeProvider>,
    );
    expect(getByText('Stableford, net')).toBeTruthy();
    expect(getByText(/Most points wins/)).toBeTruthy();
    expect(queryByRole('button')).toBeNull();
    expect(queryByLabelText(/League format/)).toBeNull();
  });

  test('enabled it is a picker offering Stableford and both medal formats', () => {
    const onChange = jest.fn();
    const { getByRole, getByText } = render(
      <ThemeProvider><LeagueFormatField value="stableford" onChange={onChange} /></ThemeProvider>,
    );
    fireEvent.press(getByRole('button'));
    expect(getByText('Medal play, net')).toBeTruthy();
    expect(getByText('Medal play, gross')).toBeTruthy();
    fireEvent.press(getByText('Medal play, gross'));
    expect(onChange).toHaveBeenCalledWith('medal_gross');
  });
});
