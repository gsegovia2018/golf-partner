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
const RED = semantic.masters.red; // '#c8102e'

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
  test('fixFirst insight renders the green surface with a gold badge', () => {
    const view = render(wrap(<CoachHero insight={insight} />));
    expect(surfaceColor(view)).toBe(GREEN);
    const badge = view.getByTestId('fix-first-badge');
    expect(StyleSheet.flatten(badge.props.style).backgroundColor).toBe('rgba(255,215,0,0.16)');
    const badgeLabel = view.getByText('Fix first');
    expect(StyleSheet.flatten(badgeLabel.props.style).color).toBe(semantic.winner.dark);
  });

  test('gettingWorse insight renders the Masters-red surface with no badge', () => {
    const view = render(wrap(<CoachHero insight={{ ...insight, group: 'gettingWorse' }} />));
    expect(surfaceColor(view)).toBe(RED);
    expect(view.queryByTestId('fix-first-badge')).toBeNull();
  });

  test('keepDoing insight renders the green surface', () => {
    const view = render(wrap(<CoachHero insight={{ ...insight, group: 'keepDoing', tone: 'good' }} />));
    expect(surfaceColor(view)).toBe(GREEN);
  });

  test('empty state renders the green surface', () => {
    const view = render(wrap(<CoachHero insight={null} />));
    expect(surfaceColor(view)).toBe(GREEN);
  });

  test('bad-tone area label uses winner gold on the Masters-red surface', () => {
    const view = render(wrap(<CoachHero insight={{ ...insight, group: 'gettingWorse' }} />));
    const area = view.getByText('Putting');
    expect(StyleSheet.flatten(area.props.style).color).toBe(semantic.winner.dark);
  });

  test('fixFirst area label stays neutral cream — never red on the standing card', () => {
    const view = render(wrap(<CoachHero insight={insight} />));
    const area = view.getByText('Putting');
    expect(StyleSheet.flatten(area.props.style).color).toBe('rgba(243,239,230,0.7)');
  });

  test('bad-tone area label keeps destructive red on the green surface', () => {
    const view = render(wrap(<CoachHero insight={{ ...insight, group: 'watch' }} />));
    const area = view.getByText('Putting');
    expect(StyleSheet.flatten(area.props.style).color).toBe(semantic.destructive.dark);
  });

  test('focus button text matches the active surface color', () => {
    const onCommitFocus = jest.fn();
    const fixFirst = render(wrap(<CoachHero insight={insight} onCommitFocus={onCommitFocus} />));
    expect(StyleSheet.flatten(fixFirst.getByText('Make this my focus').props.style).color).toBe(GREEN);

    const worse = render(
      wrap(<CoachHero insight={{ ...insight, group: 'gettingWorse' }} onCommitFocus={onCommitFocus} />)
    );
    expect(StyleSheet.flatten(worse.getByText('Make this my focus').props.style).color).toBe(RED);
  });
});
