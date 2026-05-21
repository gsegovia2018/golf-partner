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

describe('ShotDetailPanel — stroke budget', () => {
  const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
  const par4 = { number: 1, par: 4, strokeIndex: 1 };

  test('under budget → "+" works and caption shows strokes left', () => {
    const onChange = jest.fn();
    const { getByLabelText, getByText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={4}
        detail={{ putts: 2, teePenalties: 0, otherPenalties: 0, sandShots: 0 }}
        onChange={onChange}
      />
    ));
    expect(getByText('2 strokes left to assign')).toBeTruthy();
    fireEvent.press(getByLabelText('Increase Putts'));
    expect(onChange).toHaveBeenCalledWith({ putts: 3 });
  });

  test('at budget → "+" blocked and caption shows all assigned', () => {
    const onChange = jest.fn();
    const { getByLabelText, getByText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={4}
        detail={{ putts: 2, teePenalties: 1, otherPenalties: 0, sandShots: 1 }}
        onChange={onChange}
      />
    ));
    expect(getByText('All 4 strokes assigned')).toBeTruthy();
    fireEvent.press(getByLabelText('Increase Putts'));
    expect(onChange).not.toHaveBeenCalled();
  });

  test('strokes not entered → no caption and "+" works', () => {
    const onChange = jest.fn();
    const { queryByText, getByLabelText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={null}
        detail={{ putts: 2, teePenalties: 0, otherPenalties: 0, sandShots: 0 }}
        onChange={onChange}
      />
    ));
    expect(queryByText(/to assign/)).toBeNull();
    expect(queryByText(/assigned/)).toBeNull();
    fireEvent.press(getByLabelText('Increase Putts'));
    expect(onChange).toHaveBeenCalledWith({ putts: 3 });
  });

  test('singular caption — exactly 1 stroke left', () => {
    const { getByText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={1}
        detail={{ putts: 0, teePenalties: 0, otherPenalties: 0, sandShots: 0 }}
        onChange={() => {}}
      />
    ));
    expect(getByText('1 stroke left to assign')).toBeTruthy();
  });

  test('singular caption — all 1 stroke assigned', () => {
    const { getByText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={1}
        detail={{ putts: 1, teePenalties: 0, otherPenalties: 0, sandShots: 0 }}
        onChange={() => {}}
      />
    ));
    expect(getByText('All 1 stroke assigned')).toBeTruthy();
  });
});
