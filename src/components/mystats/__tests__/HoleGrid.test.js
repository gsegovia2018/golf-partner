import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { light, semantic } from '../../../theme/tokens';
import HoleGrid, { holeCellColors, holeA11yLabel, mixHex } from '../HoleGrid';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

jest.mock('react-native-reanimated', () => {
  const Reanimated = jest.requireActual('react-native-reanimated/mock');
  return {
    ...Reanimated,
    useReducedMotion: () => true,
  };
});

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const hole = (holeNumber, avgVsPar, extra = {}) => ({
  holeNumber,
  par: 4,
  strokeIndex: holeNumber,
  timesPlayed: 6,
  avgStrokes: 4 + avgVsPar,
  avgVsPar,
  avgPoints: 2,
  bestStrokes: 4,
  avgPutts: 1.8,
  penalties: 0,
  ...extra,
});

// Default ThemeProvider mode in tests is light.
const lightTheme = {
  ...light,
  destructive: semantic.destructive.light,
  isDark: false,
};

describe('mixHex', () => {
  test('blends two hex colors linearly', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#e7d7b4', '#ef4444', 0)).toBe('#e7d7b4');
    expect(mixHex('#e7d7b4', '#ef4444', 1)).toBe('#ef4444');
  });
});

describe('holeCellColors buckets', () => {
  test('under par ⇒ deep accent green', () => {
    expect(holeCellColors(lightTheme, -0.4).bg).toBe(light.accent.primary);
  });

  test('≤ 0.75 ⇒ mid green', () => {
    expect(holeCellColors(lightTheme, 0.5).bg).toBe('#7fb59f');
    expect(holeCellColors(lightTheme, 0.75).bg).toBe('#7fb59f');
  });

  test('≤ 1.5 ⇒ sand with ink text', () => {
    const c = holeCellColors(lightTheme, 1.5);
    expect(c.bg).toBe('#e7d7b4');
    expect(c.fg).not.toBe('#ffffff');
  });

  test('≤ 2.25 ⇒ destructive-over-sand mid tone', () => {
    expect(holeCellColors(lightTheme, 2.0).bg)
      .toBe(mixHex('#e7d7b4', semantic.destructive.light, 0.6));
  });

  test('> 2.25 ⇒ full destructive', () => {
    expect(holeCellColors(lightTheme, 2.6).bg).toBe(semantic.destructive.light);
  });
});

describe('holeA11yLabel', () => {
  test('speaks over/under/level par and highlight roles', () => {
    expect(holeA11yLabel(hole(2, 2.5, { avgStrokes: 6.5 })))
      .toBe('Hole 2, par 4, average 6.5, 2.5 over par');
    expect(holeA11yLabel(hole(7, -0.4, { avgStrokes: 3.6 }), { isBest: true }))
      .toBe('Hole 7, par 4, average 3.6, 0.4 under par, best hole');
    expect(holeA11yLabel(hole(5, 0), { isNemesis: true }))
      .toBe('Hole 5, par 4, average 4, level par, nemesis hole');
  });
});

describe('HoleGrid', () => {
  const holes = [hole(1, 0.5), hole(2, 1.8), hole(3, -0.2, { avgPutts: null })];
  const highlights = {
    nemesis: { holeNumber: 2, avgVsPar: 1.8, timesPlayed: 6 },
    best: { holeNumber: 3, avgVsPar: -0.2, timesPlayed: 6 },
  };

  test('renders one accessible cell per hole with the spec label', () => {
    const { getByLabelText } = render(wrap(
      <HoleGrid holes={holes} highlights={highlights} />
    ));
    expect(getByLabelText('Hole 1, par 4, average 4.5, 0.5 over par')).toBeTruthy();
    expect(getByLabelText('Hole 2, par 4, average 5.8, 1.8 over par, nemesis hole')).toBeTruthy();
    expect(getByLabelText('Hole 3, par 4, average 3.8, 0.2 under par, best hole')).toBeTruthy();
  });

  test('nemesis and best cells carry their corner dots', () => {
    const { getByTestId } = render(wrap(
      <HoleGrid holes={holes} highlights={highlights} />
    ));
    expect(getByTestId('hole-dot-nemesis')).toBeTruthy();
    expect(getByTestId('hole-dot-best')).toBeTruthy();
  });

  test('defaults the detail panel to the nemesis hole', () => {
    const { getByTestId, queryByTestId } = render(wrap(
      <HoleGrid holes={holes} highlights={highlights} />
    ));
    expect(getByTestId('hole-panel-2')).toBeTruthy();
    expect(queryByTestId('hole-panel-1')).toBeNull();
  });

  test('defaults to the first hole without highlights', () => {
    const { getByTestId } = render(wrap(
      <HoleGrid holes={holes} highlights={null} />
    ));
    expect(getByTestId('hole-panel-1')).toBeTruthy();
  });

  test('tapping a cell swaps the detail panel to that hole', () => {
    const { getByTestId, queryByTestId } = render(wrap(
      <HoleGrid holes={holes} highlights={highlights} />
    ));
    fireEvent.press(getByTestId('hole-cell-3'));
    expect(getByTestId('hole-panel-3')).toBeTruthy();
    expect(queryByTestId('hole-panel-2')).toBeNull();
    // Hole 3 never logged putts — the putts column shows an em-dash.
    expect(getByTestId('hole-panel-putts').props.children).toBe('—');
  });

  test('selected cell gets the ink outline, others stay transparent', () => {
    const { getByTestId } = render(wrap(
      <HoleGrid holes={holes} highlights={highlights} />
    ));
    const flatten = (style) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
    expect(flatten(getByTestId('hole-cell-2').props.style).borderColor)
      .toBe(lightTheme.text.primary);
    expect(flatten(getByTestId('hole-cell-1').props.style).borderColor)
      .toBe('transparent');
  });

  test('renders nothing without holes', () => {
    const { toJSON } = render(wrap(<HoleGrid holes={[]} highlights={null} />));
    expect(toJSON()).toBeNull();
  });
});
