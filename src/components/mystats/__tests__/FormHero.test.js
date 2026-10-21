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

// The hero reads avgDifferential, not avgPoints: points are net of the
// handicap each round was played off, so they cannot carry a cross-era
// trend. Lower differential is better, hence delta -3 with direction 'up'.
const form = {
  hasHistory: true,
  recentCount: 3,
  historyCount: 5,
  metrics: [
    { key: 'avgDifferential', label: 'Score differential', recent: 14.2, history: 17.2, delta: -3, direction: 'up' },
  ],
};
const formSeries = {
  metrics: {
    avgDifferential: [
      { label: 'R1', value: 19 },
      { label: 'R2', value: 17 },
      { label: 'R3', value: 14.2 },
    ],
  },
};

describe('FormHero', () => {
  test('formVerdict mirrors the Coach form-trend copy', () => {
    expect(formVerdict('up')).toBe('Improving lately');
    expect(formVerdict('down')).toBe('Trending down lately');
    expect(formVerdict('flat')).toBe('Holding steady');
  });

  test('renders kicker, verdict from stats.form, and the differential number in surface ink', () => {
    const { getByText, getByTestId } = render(wrap(
      <FormHero form={form} formSeries={formSeries} metrics={{ avgPoints: 33 }} n={5} onInfo={() => {}} />
    ));

    expect(getByText('Current form · Last 5')).toBeTruthy();
    expect(getByText('Improving lately')).toBeTruthy();
    const pts = getByTestId('form-hero-pts');
    const style = StyleSheet.flatten(pts.props.style);
    expect(style.color).toBe('#ffffff'); // text.inverse on the toned surface — gold is ceremony only
    expect(style.fontFamily).toBe('PlayfairDisplay-Black');
    // The suffix inside the hero number itself — ' diff' with its leading
    // space, so this doesn't also match the meta line's "Score differential".
    expect(getByText(' diff')).toBeTruthy();
  });

  // The tone rule, as on the Informe de vuelta hero: green improving, ink
  // steady, red trending down — never green regardless of direction.
  test.each([
    ['up', '#006747'],
    ['flat', '#1a1a1a'],
    ['down', '#c8102e'],
  ])('direction %s paints the surface %s', (direction, bg) => {
    const f = { ...form, metrics: [{ ...form.metrics[0], direction }] };
    const { getByTestId } = render(wrap(
      <FormHero form={f} formSeries={formSeries} metrics={{}} n={5} onInfo={() => {}} />
    ));
    expect(StyleSheet.flatten(getByTestId('form-hero-surface').props.style).backgroundColor).toBe(bg);
  });

  test('draws the differential chart in surface ink, ringed in the surface colour', () => {
    const view = render(wrap(
      <FormHero form={form} formSeries={formSeries} metrics={{}} n={5} onInfo={() => {}} />
    ));

    const canvas = view.getByTestId('trend-chart-canvas');
    fireEvent(canvas, 'layout', { nativeEvent: { layout: { width: 300 } } });
    const circles = view.UNSAFE_getAllByType(Circle);
    const last = circles[circles.length - 1];
    expect(last.props.stroke).toBe('#006747'); // ring = the improving surface
    expect(last.props.fill).toBe('#ffffff'); // end dot in surface ink
  });

  test('meta line explains the comparison; the delta sits in its own chip', () => {
    const { getByText, getByTestId } = render(wrap(
      <FormHero form={form} formSeries={formSeries} metrics={{ avgPoints: 33 }} n={5} onInfo={() => {}} />
    ));

    expect(getByText('Score differential · recent 3 vs previous 5 rounds · 33 pts/rnd')).toBeTruthy();
    // A negative differential delta is the IMPROVEMENT, so it takes the up
    // arrow — the inverse of how a points delta would read.
    expect(getByTestId('form-hero-delta').props.children).toBe('▲ -3 vs previous');
  });

  test('a worse differential takes the down arrow with an explicit plus', () => {
    const worse = { ...form, metrics: [{ ...form.metrics[0], delta: 2.4, direction: 'down' }] };
    const { getByTestId } = render(wrap(
      <FormHero form={worse} formSeries={formSeries} metrics={{}} n={5} onInfo={() => {}} />
    ));

    expect(getByTestId('form-hero-delta').props.children).toBe('▼ +2.4 vs previous');
  });

  test('points per round survives in the meta line as the as-played fact', () => {
    const { getByText } = render(wrap(
      <FormHero form={form} formSeries={formSeries} metrics={{ avgPoints: 33 }} n={5} onInfo={() => {}} />
    ));

    expect(getByText(/33 pts\/rnd/)).toBeTruthy();
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
    expect(getByText('Score differential · select more rounds to compare recent form. · 30 pts/rnd')).toBeTruthy();
  });

  test('keeps the scoreDifferential infoKey wired to the kicker info button', () => {
    const onInfo = jest.fn();
    const { getByLabelText } = render(wrap(
      <FormHero form={form} formSeries={formSeries} metrics={{}} n={5} onInfo={onInfo} />
    ));

    fireEvent.press(getByLabelText('What is Score differential'));
    expect(onInfo).toHaveBeenCalledWith('scoreDifferential');
  });
});
