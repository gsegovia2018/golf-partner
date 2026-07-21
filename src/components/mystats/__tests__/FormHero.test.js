import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { Circle } from 'react-native-svg';
import { ThemeProvider } from '../../../theme/ThemeContext';
import FormHero, { formVerdict } from '../FormHero';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const form = {
  hasHistory: true,
  recentCount: 3,
  historyCount: 5,
  metrics: [
    { key: 'avgPoints', label: 'Points / round', recent: 33, history: 30, delta: 3, direction: 'up' },
  ],
};
const formSeries = {
  metrics: {
    avgPoints: [
      { label: 'R1', value: 27 },
      { label: 'R2', value: 30 },
      { label: 'R3', value: 33 },
    ],
  },
};

describe('FormHero', () => {
  test('formVerdict mirrors the Coach form-trend copy', () => {
    expect(formVerdict('up')).toBe('Improving lately');
    expect(formVerdict('down')).toBe('Trending down lately');
    expect(formVerdict('flat')).toBe('Holding steady');
  });

  test('renders kicker, verdict from stats.form, and the gold pts/rnd number', () => {
    const { getByText, getByTestId } = render(wrap(
      <FormHero form={form} formSeries={formSeries} metrics={{ avgPoints: 33 }} n={5} onInfo={() => {}} />
    ));

    expect(getByText('Current form · Last 5')).toBeTruthy();
    expect(getByText('Improving lately')).toBeTruthy();
    const pts = getByTestId('form-hero-pts');
    const style = StyleSheet.flatten(pts.props.style);
    expect(style.color).toBe('#ffd700'); // semantic.winner.dark gold
    expect(style.fontFamily).toBe('PlayfairDisplay-Black');
    expect(getByText(/pts\/rnd/)).toBeTruthy();
  });

  test('draws the points-per-round chart on the hero surface with a green ring and gold end dot', () => {
    const view = render(wrap(
      <FormHero form={form} formSeries={formSeries} metrics={{}} n={5} onInfo={() => {}} />
    ));

    const canvas = view.getByTestId('trend-chart-canvas');
    fireEvent(canvas, 'layout', { nativeEvent: { layout: { width: 300 } } });
    const circles = view.UNSAFE_getAllByType(Circle);
    const last = circles[circles.length - 1];
    expect(last.props.stroke).toBe('#0f3d2c'); // hero green ring, not white card bg
    expect(last.props.fill).toBe('#ffd700'); // gold end dot
  });

  test('meta line explains the comparison and carries the points delta', () => {
    const { getByText } = render(wrap(
      <FormHero form={form} formSeries={formSeries} metrics={{}} n={5} onInfo={() => {}} />
    ));

    expect(getByText('Points per round · recent 3 vs previous 5 rounds · ▲ +3 pts')).toBeTruthy();
  });

  test('without history the meta falls back to the select-more-rounds prompt', () => {
    const { getByText } = render(wrap(
      <FormHero
        form={{ hasHistory: false, metrics: [] }}
        formSeries={formSeries}
        metrics={{ avgPoints: 30 }}
        n={10}
        onInfo={() => {}}
      />
    ));

    expect(getByText('Holding steady')).toBeTruthy();
    expect(getByText('Points per round · select more rounds to compare recent form.')).toBeTruthy();
  });

  test('keeps the pointsPerRound infoKey wired to the kicker info button', () => {
    const onInfo = jest.fn();
    const { getByLabelText } = render(wrap(
      <FormHero form={form} formSeries={formSeries} metrics={{}} n={5} onInfo={onInfo} />
    ));

    fireEvent.press(getByLabelText('What is Points per round'));
    expect(onInfo).toHaveBeenCalledWith('pointsPerRound');
  });
});
