import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import { ShotDetailPanel } from '../../components/scorecard/ShotDetailPanel';

describe('ShotDetailPanel — outcome chips', () => {
  const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
  const par4 = { number: 1, par: 4, strokeIndex: 1 };

  test('GIR hit → outcome chips hidden', () => {
    const { queryByText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={4}
        detail={{ putts: 2, sandShots: 0, recoveryOutcome: null }}
        onChange={() => {}}
      />
    ));
    expect(queryByText('Up & Down')).toBeNull();
    expect(queryByText('Sand Save')).toBeNull();
  });

  test('Missed GIR + 1 putt + no sand → Up & Down auto-selected', () => {
    const { getByText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={5}
        detail={{ putts: 1, sandShots: 0, recoveryOutcome: null }}
        onChange={() => {}}
      />
    ));
    const chip = getByText('Up & Down').parent;
    expect(chip.props.accessibilityState?.selected).toBe(true);
  });

  test('Tapping an auto-selected chip writes recoveryOutcome="none"', () => {
    const onChange = jest.fn();
    const { getByText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={5}
        detail={{ putts: 1, sandShots: 1, recoveryOutcome: null }}
        onChange={onChange}
      />
    ));
    fireEvent.press(getByText('Sand Save'));
    expect(onChange).toHaveBeenCalledWith({ recoveryOutcome: 'none' });
  });
});
