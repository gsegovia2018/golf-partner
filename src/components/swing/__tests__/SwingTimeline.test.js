import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import SwingTimeline from '../SwingTimeline';

const wrap = (el) => render(<ThemeProvider>{el}</ThemeProvider>);

describe('SwingTimeline keys', () => {
  test('defaults to all ten checkpoints', () => {
    const r = wrap(<SwingTimeline current="impact" frameLine="frame 1" />);
    expect(r.getAllByRole('button').filter((b) => /^(Address|Takeaway|Lead arm|Top|Transition|Shaft down|Impact|Shaft through|Trail arm|Finish)(,|$)/.test(b.props.accessibilityLabel))).toHaveLength(10);
  });

  test('shows only the keys given, naming Address / Top / Impact / Finish', () => {
    const keys = ['address', 'leadArm', 'top', 'shaftDown', 'impact', 'shaftThrough', 'finish'];
    const r = wrap(<SwingTimeline current="impact" keys={keys} frameLine="frame 1" />);
    expect(r.queryByLabelText(/^Takeaway/)).toBeNull();
    expect(r.getByLabelText(/^Shaft through/)).toBeTruthy();
    ['Address', 'Top', 'Impact', 'Finish'].forEach((n) => expect(r.getAllByText(n).length).toBeGreaterThan(0));
  });
});
