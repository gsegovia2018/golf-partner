import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { SGBar } from '../SGBars';

jest.mock('../../../theme/ThemeContext', () => ({
  useTheme: () => {
    const { light, semantic, typography, fonts, spacing, radius } = jest.requireActual('../../../theme/tokens');
    return {
      theme: {
        ...light,
        semantic,
        scoreColor: (level) => semantic.score[level].light,
        typography,
        fonts,
        spacing,
        radius,
        mode: 'light',
        isDark: false,
      },
    };
  },
}));

const { semantic } = jest.requireActual('../../../theme/tokens');
const GOOD = semantic.score.good.light;
const POOR = semantic.score.poor.light;

// The bar View sits after the zero-line View inside the track.
function barStyle(getByTestId) {
  const track = getByTestId('sg-bar-track');
  const bar = track.children[track.children.length - 1];
  return StyleSheet.flatten(bar.props.style);
}

describe('SGBar', () => {
  it('renders label, track and formatted positive value', () => {
    const { getByTestId, getByText } = render(<SGBar label="Putting" value={0.75} />);
    expect(getByTestId('sg-bar-row')).toBeTruthy();
    expect(getByTestId('sg-bar-track')).toBeTruthy();
    expect(getByText('Putting')).toBeTruthy();
    expect(getByTestId('sg-bar-value').props.children.join('')).toBe('+0.75');
  });

  it('anchors positive bars at the center, extending right, in good color', () => {
    const { getByTestId } = render(<SGBar label="Approach" value={0.75} />);
    const style = barStyle(getByTestId);
    expect(style.left).toBe('50%');
    expect(style.right).toBeUndefined();
    // 0.75 / 1.5 * 50% = 25% of the track
    expect(style.width).toBe('25%');
    expect(style.backgroundColor).toBe(GOOD);
    expect(style.transformOrigin).toBe('left center');
  });

  it('anchors negative bars at the center, extending left, in poor color', () => {
    const { getByTestId } = render(<SGBar label="Off the tee" value={-1.5} />);
    const style = barStyle(getByTestId);
    expect(style.right).toBe('50%');
    expect(style.left).toBeUndefined();
    expect(style.width).toBe('50%');
    expect(style.backgroundColor).toBe(POOR);
    expect(style.transformOrigin).toBe('right center');
    expect(StyleSheet.flatten(getByTestId('sg-bar-value').props.style).color).toBe(POOR);
  });

  it('clamps the bar at ±1.5 but shows the real value', () => {
    const { getByTestId } = render(<SGBar label="Approach" value={3.2} />);
    expect(barStyle(getByTestId).width).toBe('50%');
    expect(getByTestId('sg-bar-value').props.children.join('')).toBe('+3.20');
  });

  it('renders a zero value with no visible bar', () => {
    const { getByTestId } = render(<SGBar label="Penalties" value={0} />);
    expect(barStyle(getByTestId).width).toBe('0%');
    expect(getByTestId('sg-bar-value').props.children.join('')).toBe('+0.00');
  });

  it('renders an em-dash row for null values', () => {
    const { getByTestId, getByText, queryByTestId } = render(<SGBar label="Putting" value={null} />);
    expect(getByTestId('sg-bar-row')).toBeTruthy();
    expect(getByText('—')).toBeTruthy();
    expect(queryByTestId('sg-bar-track')).toBeNull();
    expect(queryByTestId('sg-bar-value')).toBeNull();
  });
});
