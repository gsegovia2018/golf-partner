import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import ShotDashboard, { buildShotSignals } from '../ShotDashboard';
import { semantic } from '../../../theme/tokens';

jest.mock('../../../theme/ThemeContext', () => ({
  useTheme: () => {
    const { light, semantic, typography, fonts, spacing, radius } = jest.requireActual('../../../theme/tokens');
    return {
      theme: {
        ...light,
        semantic,
        masters: semantic.masters,
        destructive: semantic.destructive.light,
        info: semantic.info.light,
        pairA: semantic.pair.a.light,
        pairB: semantic.pair.b.light,
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

const PANEL = '#ffffff'; // theme.bg.card, light — white inset panel

const baseSG = {
  total: -1.2,
  sampleHoles: 36,
  byCategory: { offTheTee: -0.4, approach: -0.5, aroundGreen: 0.1, putting: -0.4, penalties: 0 },
  sampleHolesByCategory: { offTheTee: 4, approach: 30, aroundGreen: 12, putting: 30, penalties: 36 },
  roundsByCategory: { offTheTee: 1, approach: 2, aroundGreen: 2, putting: 2, penalties: 2 },
  personalDelta: {
    putting: { recent: -0.4, previous: -1.0, delta: 0.6, direction: 'up' },
    offTheTee: { recent: null, previous: null, delta: null, direction: 'flat' },
    approach: { recent: -0.5, previous: -0.5, delta: 0, direction: 'flat' },
    aroundGreen: { recent: 0.1, previous: 0.1, delta: 0, direction: 'flat' },
    penalties: { recent: 0, previous: 0, delta: 0, direction: 'flat' },
  },
  reconciliation: { rounds: 0, perRound: [], expectedAvg: null, actualAvg: null, gapAvg: null, byCategoryAvg: null, residualAvg: null },
  perRound: [],
};

function renderDash(sg = baseSG, extraStats = {}) {
  return render(<ShotDashboard stats={{ strokesGained: sg, ...extraStats }} targetHandicap={0} onInfo={jest.fn()} />);
}

const heroColor = (r) =>
  StyleSheet.flatten(r.getByTestId('sg-hero-surface').props.style).backgroundColor;

describe('ShotDashboard target-gap hero surface', () => {
  test('stays a white inset panel when the SG total is negative — the gap is standing work, not an alarm', () => {
    const r = renderDash({ ...baseSG, total: -1.2 });
    expect(heroColor(r)).toBe(PANEL);
  });
  test('stays a white inset panel when the SG total is positive', () => {
    const r = renderDash({ ...baseSG, total: 0.8 });
    expect(heroColor(r)).toBe(PANEL);
  });
  test('stays a white inset panel at exactly zero and without data', () => {
    expect(heroColor(renderDash({ ...baseSG, total: 0 }))).toBe(PANEL);
    expect(heroColor(renderDash({ ...baseSG, total: null }))).toBe(PANEL);
  });
  test('headline number is winner gold on both signs', () => {
    const losing = renderDash({ ...baseSG, total: -1.2 });
    expect(StyleSheet.flatten(losing.getByText('-1.20 / round').props.style).color)
      .toBe(semantic.winner.light);
    const winning = renderDash({ ...baseSG, total: 0.8 });
    expect(StyleSheet.flatten(winning.getByText('+0.80 / round').props.style).color)
      .toBe(semantic.winner.light);
  });
});

describe('ShotDashboard category board', () => {
  test('under-sampled category renders a locked row with unlock progress', () => {
    const r = renderDash();
    expect(r.getByText('Off the tee')).toBeTruthy();
    // Locked note appears in the row; the hero evidence footnote repeats
    // the weakest-category call-out with its label prefix.
    expect(r.getAllByText('needs 6 more holes').length).toBe(1);
    const fill = r.getByTestId('sg-lock-fill');
    // 4 of 10 holes sampled
    expect(StyleSheet.flatten(fill.props.style).width).toBe('40%');
    expect(StyleSheet.flatten(fill.props.style).backgroundColor).toBe('#3e638f');
  });
  test('locked rows show no SG value', () => {
    const r = renderDash();
    // offTheTee (-0.4) is locked; putting (-0.4) renders the only -0.40
    expect(r.getAllByText('-0.40').length).toBe(1);
  });
  test('well-sampled categories render a board row with bar, sample and value', () => {
    const r = renderDash();
    expect(r.getByText('Approach')).toBeTruthy();
    expect(r.getAllByText('30 holes').length).toBe(2); // approach + putting samples
    expect(r.getByText('-0.50')).toBeTruthy();
    expect(r.getByText('+0.10')).toBeTruthy();
    // 4 unlocked rows each render an SGBarTrack
    expect(r.getAllByTestId('sg-bar-track').length).toBe(4);
  });
  test('well-sampled categories show a compact delta chip when history exists', () => {
    const r = renderDash();
    expect(r.getByText('+0.6')).toBeTruthy();
    expect(r.getByLabelText('Up 0.6 strokes gained vs your previous rounds')).toBeTruthy();
  });
  test('no delta chip without personalDelta', () => {
    const r = renderDash({ ...baseSG, personalDelta: null });
    expect(r.queryByText('+0.6')).toBeNull();
    expect(r.queryByLabelText(/strokes gained vs your previous rounds/)).toBeNull();
  });
  test('bucket signals surface as one-line footnotes on their category row', () => {
    const r = renderDash(baseSG, {
      puttingTarget: {
        buckets: { '6+': { attempts: 16, sgPerPutt: -0.2, avgPutts: 2.4, expectedPutts: 2.1 } },
      },
    });
    // -0.2 · 16 / 2 rounds = -1.60 per round
    expect(r.getByText('6+ m putts: -1.60 SG/rnd')).toBeTruthy();
  });
  test('the standalone signal lists are gone', () => {
    const r = renderDash();
    expect(r.queryByText('What is working')).toBeNull();
    expect(r.queryByText('What is costing shots')).toBeNull();
  });
});

describe('buildShotSignals per-round units', () => {
  test('putt bucket impact = sgPerPutt · attempts / puttingRounds', () => {
    const stats = {
      strokesGained: {
        byCategory: { offTheTee: 0, approach: 0, aroundGreen: 0, putting: 0, penalties: 0 },
        sampleHolesByCategory: { offTheTee: 20, approach: 20, aroundGreen: 20, putting: 20, penalties: 20 },
        sampleHoles: 20,
        roundsByCategory: { offTheTee: 4, approach: 4, aroundGreen: 4, putting: 4, penalties: 4 },
      },
      puttingTarget: {
        buckets: { '6+': { attempts: 16, sgPerPutt: -0.2, avgPutts: 2.4, expectedPutts: 2.1 } },
      },
    };
    const { bad } = buildShotSignals(stats);
    const putt = bad.find((sig) => sig.id === 'putt-6+');
    // -0.2 · 16 / 4 = -0.8 per round
    expect(putt.score).toBeCloseTo(-0.8, 5);
    expect(putt.metric).toBe('-0.80 SG/rnd');
  });
  test('bucket signals without a rounds denominator are skipped', () => {
    const stats = {
      strokesGained: { byCategory: null, sampleHoles: 0, roundsByCategory: null },
      puttingTarget: { buckets: { '6+': { attempts: 16, sgPerPutt: -0.2 } } },
    };
    const { bad } = buildShotSignals(stats);
    expect(bad.find((sig) => sig.id === 'putt-6+')).toBeUndefined();
  });
});
