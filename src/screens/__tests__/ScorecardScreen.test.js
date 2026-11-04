import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { clearedReasonPatch } from '../../store/missReasons';
import { ThemeProvider } from '../../theme/ThemeContext';
import { ShotDetailPanel } from '../../components/scorecard/ShotDetailPanel';

// ThemeProvider reads its persisted preference from AsyncStorage in a
// useEffect, and ShotDetailPanel's ShotDetailExplainer rows do the same for
// their dismissed state; flush those pending promises (inside act) after
// every render so their follow-up setState doesn't land outside act().
const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));

describe('ShotDetailPanel — outcome chips', () => {
  const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
  const par4 = { number: 1, par: 4, strokeIndex: 1 };
  const panel = async (detail, strokes, onChange = () => {}) => {
    const r = render(wrap(<ShotDetailPanel hole={par4} strokes={strokes} detail={detail} onChange={onChange} />));
    await flush();
    return r;
  };
  const selected = (r, label) => r.getByText(label).parent.props.accessibilityState?.selected;

  test('GIR hit → neither the chip question nor the outcome chips', async () => {
    const r = await panel({ putts: 2, sandShots: 0 }, 4);
    expect(r.queryByText('Chip inside 20 m?')).toBeNull();
    expect(r.queryByText('Up & Down')).toBeNull();
    expect(r.queryByText('Sand Save')).toBeNull();
  });

  test('missed green, unanswered → the question, no outcome chips yet', async () => {
    const r = await panel({ putts: 1, sandShots: 0 }, 4);
    expect(r.getByText('Chip inside 20 m?')).toBeTruthy();
    expect(r.queryByText('Up & Down')).toBeNull();
  });

  test('answering writes chipNear; tapping the answer again clears it', async () => {
    const onChange = jest.fn();
    const r = await panel({ putts: 1, sandShots: 0 }, 4, onChange);
    fireEvent.press(r.getByText('Yes'));
    expect(onChange).toHaveBeenLastCalledWith({ chipNear: true });
    fireEvent.press(r.getByText('No'));
    expect(onChange).toHaveBeenLastCalledWith({ chipNear: false });
    const yes = await panel({ putts: 1, sandShots: 0, chipNear: true }, 4, onChange);
    fireEvent.press(yes.getAllByText('Yes').pop());
    expect(onChange).toHaveBeenLastCalledWith({ chipNear: null });
  });

  test('"No" (played from far away) hides the outcome chips', async () => {
    const r = await panel({ putts: 1, sandShots: 0, chipNear: false }, 4);
    expect(r.getByLabelText('Chip inside 20 m? No').props.accessibilityState?.selected).toBe(true);
    expect(r.queryByText('Up & Down')).toBeNull();
  });

  test('near chip + 1 putt → Up & Down auto-selected, even for a bogey', async () => {
    expect(selected(await panel({ putts: 1, sandShots: 0, chipNear: true }, 4), 'Up & Down')).toBe(true);
    expect(selected(await panel({ putts: 1, sandShots: 0, chipNear: true }, 5), 'Up & Down')).toBe(true);
  });

  test('near chip + 2 putts → no chip auto-selected', async () => {
    expect(selected(await panel({ putts: 2, sandShots: 0, chipNear: true }, 5), 'Up & Down')).toBe(false);
  });

  test('Tapping an auto-selected chip writes recoveryOutcome="none"', async () => {
    const onChange = jest.fn();
    const r = await panel({ putts: 1, sandShots: 1, chipNear: true }, 4, onChange);
    fireEvent.press(r.getByText('Sand Save'));
    expect(onChange).toHaveBeenCalledWith({ recoveryOutcome: 'none' });
  });
});

describe('ShotDetailPanel — approach capture', () => {
  const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
  const par3 = { number: 1, par: 3, strokeIndex: 1 };
  const par4 = { number: 1, par: 4, strokeIndex: 1 };
  const par5 = { number: 1, par: 5, strokeIndex: 1 };

  test('does not ask for tee residual distance', async () => {
    const { queryByText, queryByLabelText } = render(wrap(
      <ShotDetailPanel
        hole={par5}
        strokes={5}
        detail={{ putts: 2 }}
        onChange={() => {}}
      />
    ));
    await flush();

    expect(queryByText('After tee')).toBeNull();
    expect(queryByLabelText('After tee 200+')).toBeNull();
  });

  test('labels approach distance as Approach and only shows the metres hint', async () => {
    const { getByLabelText, getByText, getAllByText, queryByText, unmount } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={4}
        detail={{ putts: 0 }}
        onChange={() => {}}
      />
    ));
    await flush();
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
    await flush();
    expect(par5Render.getByText('Approach')).toBeTruthy();
    expect(par5Render.queryByText('Approach shot distance')).toBeNull();
    expect(par5Render.getAllByText('metres').length).toBeGreaterThan(0);
    expect(par5Render.queryByText('3rd shot · metres')).toBeNull();
  });

  test('approach info explains to log the shot aimed at the green', async () => {
    const { getByLabelText, getByText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={4}
        detail={{ putts: 2 }}
        onChange={() => {}}
      />
    ));
    await flush();

    fireEvent.press(getByLabelText('Open Approach info'));

    expect(getByText(/shot you intended to hit into the green/i)).toBeTruthy();
    expect(getByText(/after a punch-out, lay-up, or penalty/i)).toBeTruthy();
  });

  test('labels par-3 approach bucket as hole distance and stores it in approachBucket', async () => {
    const onChange = jest.fn();
    const { getByText, queryByText, getByLabelText } = render(wrap(
      <ShotDetailPanel
        hole={par3}
        strokes={3}
        detail={{ putts: 2 }}
        onChange={onChange}
      />
    ));
    await flush();

    expect(getByText('Hole distance')).toBeTruthy();
    expect(queryByText('Approach shot distance')).toBeNull();

    fireEvent.press(getByLabelText('Hole distance 100-150'));
    expect(onChange).toHaveBeenCalledWith({ approachBucket: '100-150' });
  });

  test('captures where the logged approach finished via the icon grid', async () => {
    const onChange = jest.fn();
    const { getByLabelText } = render(wrap(
      <ShotDetailPanel
        hole={par5}
        strokes={5}
        detail={{ putts: 2, approachBucket: '100-150' }}
        onChange={onChange}
      />
    ));
    await flush();

    fireEvent.press(getByLabelText('Approach finish On green'));
    expect(onChange).toHaveBeenCalledWith({
      approachResult: 'green', approachMiss: null, approachBunker: false,
      ...clearedReasonPatch('approach', { keepSituation: true }),
    });

    fireEvent.press(getByLabelText('Approach finish Right'));
    expect(onChange).toHaveBeenCalledWith({ approachMiss: 'right', approachResult: 'miss' });
  });

  test('clearing approach distance also clears approach result', async () => {
    const onChange = jest.fn();
    const { getByLabelText } = render(wrap(
      <ShotDetailPanel
        hole={par5}
        strokes={5}
        detail={{ putts: 2, approachBucket: '100-150', approachResult: 'green' }}
        onChange={onChange}
      />
    ));
    await flush();

    fireEvent.press(getByLabelText('Approach 100-150'));
    expect(onChange).toHaveBeenCalledWith({
      approachBucket: null, approachResult: null, approachMiss: null, approachBunker: false, approachLie: null,
      ...clearedReasonPatch('approach'),
    });
  });
});

describe('ShotDetailPanel — stroke budget', () => {
  const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
  const par4 = { number: 1, par: 4, strokeIndex: 1 };

  test('under budget → "+" works and caption shows strokes left', async () => {
    const onChange = jest.fn();
    const { getByLabelText, getByText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={4}
        detail={{ putts: 2, teePenalties: 0, otherPenalties: 0, sandShots: 0 }}
        onChange={onChange}
      />
    ));
    await flush();
    expect(getByText('2 other shots')).toBeTruthy();
    fireEvent.press(getByLabelText('Increase Putts'));
    expect(onChange).toHaveBeenCalledWith({ putts: 3 });
  });

  test('at budget → "+" blocked and caption shows all assigned', async () => {
    const onChange = jest.fn();
    const { getByLabelText, getByText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={4}
        detail={{ putts: 2, teePenalties: 1, otherPenalties: 0, sandShots: 1 }}
        onChange={onChange}
      />
    ));
    await flush();
    expect(getByText('All 4 strokes assigned')).toBeTruthy();
    fireEvent.press(getByLabelText('Increase Putts'));
    expect(onChange).not.toHaveBeenCalled();
  });

  test('strokes not entered → no caption and "+" works', async () => {
    const onChange = jest.fn();
    const { queryByText, getByLabelText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={null}
        detail={{ putts: 2, teePenalties: 0, otherPenalties: 0, sandShots: 0 }}
        onChange={onChange}
      />
    ));
    await flush();
    expect(queryByText(/to assign/)).toBeNull();
    expect(queryByText(/assigned/)).toBeNull();
    fireEvent.press(getByLabelText('Increase Putts'));
    expect(onChange).toHaveBeenCalledWith({ putts: 3 });
  });

  test('singular caption — exactly 1 stroke left', async () => {
    const { getByText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={1}
        detail={{ putts: 0, teePenalties: 0, otherPenalties: 0, sandShots: 0 }}
        onChange={() => {}}
      />
    ));
    await flush();
    expect(getByText('1 other shot')).toBeTruthy();
  });

  test('singular caption — all 1 stroke assigned', async () => {
    const { getByText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={1}
        detail={{ putts: 1, teePenalties: 0, otherPenalties: 0, sandShots: 0 }}
        onChange={() => {}}
      />
    ));
    await flush();
    expect(getByText('All 1 stroke assigned')).toBeTruthy();
  });
});
