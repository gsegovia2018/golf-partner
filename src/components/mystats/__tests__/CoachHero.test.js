import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import CoachHero from '../CoachHero';
import { semantic } from '../../../theme/tokens';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const GREEN = '#0f3d2c';
const BURGUNDY = '#4a1d1d';

const insight = {
  id: 'putting:6-m-putts',
  group: 'fixFirst',
  area: 'putting',
  areaLabel: 'Putting',
  title: '6+ m putts',
  reason: '6+ m putts is costing points across 18 samples.',
  metric: '-0.81 SG / putt',
  sample: 18,
  confidence: 'high',
  tone: 'bad',
};

const surfaceColor = (view) =>
  StyleSheet.flatten(view.getByTestId('coach-hero-surface').props.style).backgroundColor;

describe('CoachHero surface color', () => {
  test('fixFirst insight renders the burgundy surface', () => {
    const view = render(wrap(<CoachHero insight={insight} />));
    expect(surfaceColor(view)).toBe(BURGUNDY);
  });

  test('gettingWorse insight renders the burgundy surface', () => {
    const view = render(wrap(<CoachHero insight={{ ...insight, group: 'gettingWorse' }} />));
    expect(surfaceColor(view)).toBe(BURGUNDY);
  });

  test('keepDoing insight renders the green surface', () => {
    const view = render(wrap(<CoachHero insight={{ ...insight, group: 'keepDoing', tone: 'good' }} />));
    expect(surfaceColor(view)).toBe(GREEN);
  });

  test('empty state renders the green surface', () => {
    const view = render(wrap(<CoachHero insight={null} />));
    expect(surfaceColor(view)).toBe(GREEN);
  });

  test('bad-tone area label uses winner gold on the burgundy surface', () => {
    const view = render(wrap(<CoachHero insight={insight} />));
    const area = view.getByText('Putting');
    expect(StyleSheet.flatten(area.props.style).color).toBe(semantic.winner.dark);
  });

  test('bad-tone area label keeps destructive red on the green surface', () => {
    const view = render(wrap(<CoachHero insight={{ ...insight, group: 'watch' }} />));
    const area = view.getByText('Putting');
    expect(StyleSheet.flatten(area.props.style).color).toBe(semantic.destructive.dark);
  });

  test('focus button text matches the active surface color', () => {
    const onCommitFocus = jest.fn();
    const red = render(wrap(<CoachHero insight={insight} onCommitFocus={onCommitFocus} />));
    const redLabel = red.getByText('Make this my focus');
    expect(StyleSheet.flatten(redLabel.props.style).color).toBe(BURGUNDY);

    const green = render(
      wrap(<CoachHero insight={{ ...insight, group: 'keepDoing', tone: 'good' }} onCommitFocus={onCommitFocus} />)
    );
    expect(StyleSheet.flatten(green.getByText('Make this my focus').props.style).color).toBe(GREEN);
  });
});
