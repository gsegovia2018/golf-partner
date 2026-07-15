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

  test('Missed GIR + 1-putt par save + no sand → Up & Down auto-selected', () => {
    const { getByText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={4}
        detail={{ putts: 1, sandShots: 0, recoveryOutcome: null }}
        onChange={() => {}}
      />
    ));
    const chip = getByText('Up & Down').parent;
    expect(chip.props.accessibilityState?.selected).toBe(true);
  });

  test('1-putt bogey → no chip auto-selected (save requires par or better)', () => {
    const { getByText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={5}
        detail={{ putts: 1, sandShots: 0, recoveryOutcome: null }}
        onChange={() => {}}
      />
    ));
    const chip = getByText('Up & Down').parent;
    expect(chip.props.accessibilityState?.selected).toBe(false);
  });

  test('Tapping an auto-selected chip writes recoveryOutcome="none"', () => {
    const onChange = jest.fn();
    const { getByText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={4}
        detail={{ putts: 1, sandShots: 1, recoveryOutcome: null }}
        onChange={onChange}
      />
    ));
    fireEvent.press(getByText('Sand Save'));
    expect(onChange).toHaveBeenCalledWith({ recoveryOutcome: 'none' });
  });
});

describe('ShotDetailPanel — approach capture', () => {
  const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
  const par3 = { number: 1, par: 3, strokeIndex: 1 };
  const par4 = { number: 1, par: 4, strokeIndex: 1 };
  const par5 = { number: 1, par: 5, strokeIndex: 1 };

  test('does not ask for tee residual distance', () => {
    const { queryByText, queryByLabelText } = render(wrap(
      <ShotDetailPanel
        hole={par5}
        strokes={5}
        detail={{ putts: 2 }}
        onChange={() => {}}
      />
    ));

    expect(queryByText('After tee')).toBeNull();
    expect(queryByLabelText('After tee 200+')).toBeNull();
  });

  test('labels approach distance as Approach and only shows the metres hint', () => {
    const { getByLabelText, getByText, getAllByText, queryByText, unmount } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={4}
        detail={{ putts: 0 }}
        onChange={() => {}}
      />
    ));
    expect(queryByText('How many were:')).toBeNull();
    expect(getByText('Approach')).toBeTruthy();
    expect(queryByText('Approach shot distance')).toBeNull();
    expect(getByLabelText('Open Approach info')).toBeTruthy();
    expect(getByLabelText('Open Sand shots info')).toBeTruthy();
    // Drive distance also uses a "metres" hint, so both rows match.
    expect(getAllByText('metres').length).toBeGreaterThan(0);
    expect(queryByText('2nd shot · metres')).toBeNull();

    unmount();

    const par5Render = render(wrap(
      <ShotDetailPanel
        hole={par5}
        strokes={5}
        detail={{ putts: 0 }}
        onChange={() => {}}
      />
    ));
    expect(par5Render.getByText('Approach')).toBeTruthy();
    expect(par5Render.queryByText('Approach shot distance')).toBeNull();
    expect(par5Render.getAllByText('metres').length).toBeGreaterThan(0);
    expect(par5Render.queryByText('3rd shot · metres')).toBeNull();
  });

  test('approach info explains to log the shot aimed at the green', () => {
    const { getByLabelText, getByText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={4}
        detail={{ putts: 2 }}
        onChange={() => {}}
      />
    ));

    fireEvent.press(getByLabelText('Open Approach info'));

    expect(getByText(/shot you intended to hit into the green/i)).toBeTruthy();
    expect(getByText(/after a punch-out, lay-up, or penalty/i)).toBeTruthy();
  });

  test('labels par-3 approach bucket as hole distance and stores it in approachBucket', () => {
    const onChange = jest.fn();
    const { getByText, queryByText, getByLabelText } = render(wrap(
      <ShotDetailPanel
        hole={par3}
        strokes={3}
        detail={{ putts: 2 }}
        onChange={onChange}
      />
    ));

    expect(getByText('Hole distance')).toBeTruthy();
    expect(queryByText('Approach shot distance')).toBeNull();

    fireEvent.press(getByLabelText('Hole distance 100-150'));
    expect(onChange).toHaveBeenCalledWith({ approachBucket: '100-150' });
  });

  test('captures whether the logged approach hit or missed the green', () => {
    const onChange = jest.fn();
    const { getByText } = render(wrap(
      <ShotDetailPanel
        hole={par5}
        strokes={5}
        detail={{ putts: 2, approachBucket: '100-150' }}
        onChange={onChange}
      />
    ));

    fireEvent.press(getByText('On green'));
    expect(onChange).toHaveBeenCalledWith({ approachResult: 'green' });

    fireEvent.press(getByText('Missed green'));
    expect(onChange).toHaveBeenCalledWith({ approachResult: 'miss' });
  });

  test('clearing approach distance also clears approach result', () => {
    const onChange = jest.fn();
    const { getByLabelText } = render(wrap(
      <ShotDetailPanel
        hole={par5}
        strokes={5}
        detail={{ putts: 2, approachBucket: '100-150', approachResult: 'green' }}
        onChange={onChange}
      />
    ));

    fireEvent.press(getByLabelText('Approach 100-150'));
    expect(onChange).toHaveBeenCalledWith({ approachBucket: null, approachResult: null, approachLie: null });
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
