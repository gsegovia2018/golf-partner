import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import MissWhySheet from '../MissWhySheet';

jest.mock('../../../theme/ThemeContext', () => ({
  useTheme: () => {
    const { light, semantic, typography, fonts, spacing, radius } = jest.requireActual('../../../theme/tokens');
    return {
      theme: {
        ...light, semantic, typography, fonts, spacing, radius, mode: 'light', isDark: false,
      },
    };
  },
}));

const hole = { number: 7, par: 4, strokeIndex: 5 };

function setup(props = {}) {
  const onChange = jest.fn();
  const onClose = jest.fn();
  const onMuteRound = jest.fn();
  const utils = render(
    <MissWhySheet
      visible
      mode="approach"
      hole={hole}
      detail={{ approachMiss: 'right', approachBucket: '100-150' }}
      onChange={onChange}
      onClose={onClose}
      onMuteRound={onMuteRound}
      units="metres"
      {...props}
    />,
  );
  return { ...utils, onChange, onClose, onMuteRound };
}

describe('MissWhySheet', () => {
  test('titles and subline: right, long, bunker', () => {
    const a = setup();
    expect(a.getByText('Why did it miss right?')).toBeTruthy();
    expect(a.getByText('Hole 7 · approach 100-150 metres · all optional')).toBeTruthy();
    a.unmount();
    const b = setup({ detail: { approachMiss: 'long' } });
    expect(b.getByText('Why was it long?')).toBeTruthy();
    b.unmount();
    const c = setup({ detail: { approachBunker: true } });
    expect(c.getByText('Why did it find the bunker?')).toBeTruthy();
    c.unmount();
    const d = setup({ detail: { approachMiss: 'left', approachBunker: true } });
    expect(d.getByText('Why did it miss left, into the bunker?')).toBeTruthy();
  });

  test('band tap writes approachStart and the pill names the shot', () => {
    const { getByText, onChange, rerender } = setup();
    expect(getByText('Where did it start? Tap the band')).toBeTruthy();
    fireEvent.press(getByText('Right'));
    expect(onChange).toHaveBeenCalledWith({ approachStart: 'right' });
    rerender(
      <MissWhySheet
        visible mode="approach" hole={hole} units="metres" onChange={onChange} onClose={jest.fn()}
        detail={{ approachMiss: 'right', approachStart: 'right' }}
      />,
    );
    expect(getByText('Push · right')).toBeTruthy();
  });

  test('left-hander mirrors the name', () => {
    const { getByText } = setup({
      handedness: 'left', detail: { approachMiss: 'right', approachStart: 'center' },
    });
    expect(getByText('Hook · right')).toBeTruthy();
  });

  test('tapping the selected start clears it', () => {
    const { getByText, onChange } = setup({ detail: { approachMiss: 'right', approachStart: 'left' } });
    expect(getByText('Pull-slice · right')).toBeTruthy();
    fireEvent.press(getByText('Left'));
    expect(onChange).toHaveBeenCalledWith({ approachStart: null });
  });

  test('start without a side finish shows "Started …"', () => {
    const { getByText } = setup({ detail: { approachMiss: 'long', approachStart: 'center' } });
    expect(getByText('Started on line · long')).toBeTruthy();
  });

  test('contact is single-select; tapping the selected one clears it', () => {
    const { getByText, onChange } = setup({ detail: { approachMiss: 'right', approachContact: 'fat' } });
    fireEvent.press(getByText('Thin'));
    expect(onChange).toHaveBeenLastCalledWith({ approachContact: 'thin' });
    fireEvent.press(getByText('Heavy'));
    expect(onChange).toHaveBeenLastCalledWith({ approachContact: null });
  });

  test('situations are multi-select and keep OPTIONS order', () => {
    const { getByText, onChange } = setup({
      detail: { approachMiss: 'right', approachSituation: ['wind', 'uphill'] },
    });
    fireEvent.press(getByText('Below feet'));
    expect(onChange).toHaveBeenLastCalledWith({ approachSituation: ['below-feet', 'uphill', 'wind'] });
    fireEvent.press(getByText('Wind'));
    expect(onChange).toHaveBeenLastCalledWith({ approachSituation: ['uphill'] });
  });

  test('chips expose selected state', () => {
    const { getByText } = setup({ detail: { approachMiss: 'right', approachContact: 'fat' } });
    expect(getByText('Heavy').parent.parent.props.accessibilityState).toEqual({ selected: true });
    expect(getByText('Thin').parent.parent.props.accessibilityState).toEqual({ selected: false });
  });

  test('short mode: result chips, no band, own contact and situations', () => {
    const { getByText, queryByText, onChange } = setup({ mode: 'short', detail: {} });
    expect(getByText('Why no up & down?')).toBeTruthy();
    expect(getByText('Hole 7 · short game · all optional')).toBeTruthy();
    expect(queryByText('On line')).toBeNull();
    fireEvent.press(getByText('Ran long'));
    expect(onChange).toHaveBeenLastCalledWith({ shortResult: 'long' });
    fireEvent.press(getByText('Short-sided'));
    expect(onChange).toHaveBeenLastCalledWith({ shortSituation: ['short-sided'] });
    fireEvent.press(getByText('Thin'));
    expect(onChange).toHaveBeenLastCalledWith({ shortContact: 'thin' });
    expect(queryByText('Toe')).toBeNull();
  });

  test('drive: band writes driveStart; a short drive hides it', () => {
    const d = setup({ mode: 'drive', detail: { drive: 'left' } });
    expect(d.getByText('Why did the drive go left?')).toBeTruthy();
    expect(d.getByText('Hole 7 · drive · all optional')).toBeTruthy();
    fireEvent.press(d.getByText('On line'));
    expect(d.onChange).toHaveBeenCalledWith({ driveStart: 'center' });
    expect(d.getByText('Topped')).toBeTruthy();
    d.unmount();
    const s = setup({ mode: 'drive', detail: { drive: 'short', driveStart: 'left' } });
    expect(s.getByText('Why was the drive short?')).toBeTruthy();
    expect(s.queryByText('On line')).toBeNull();
    expect(s.getByText('Topped or thin drives have no start line')).toBeTruthy();
  });

  test('Done closes; Not this round mutes and closes', () => {
    const { getByText, onClose, onMuteRound } = setup();
    fireEvent.press(getByText('Done'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.press(getByText('Not this round'));
    expect(onMuteRound).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
