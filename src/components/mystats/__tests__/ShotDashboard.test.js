import React from 'react';
import { render } from '@testing-library/react-native';
import ShotDashboard from '../ShotDashboard';

jest.mock('../../../theme/ThemeContext', () => ({
  useTheme: () => {
    const { light, semantic, typography, fonts, spacing, radius } = jest.requireActual('../../../theme/tokens');
    return {
      theme: {
        ...light,
        semantic,
        masters: semantic.masters,
        destructive: semantic.destructive.light,
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

function renderDash(sg = baseSG) {
  return render(<ShotDashboard stats={{ strokesGained: sg }} targetHandicap={0} onInfo={jest.fn()} />);
}

describe('ShotDashboard category gating and deltas', () => {
  test('under-sampled category renders needs-more-holes instead of a bar', () => {
    const r = renderDash();
    expect(r.getAllByText('Off the tee: needs 6 more holes').length).toBeGreaterThan(0);
  });
  test('well-sampled categories show a delta badge when history exists', () => {
    const r = renderDash();
    expect(r.getByText('▲ +0.6 vs your last stretch')).toBeTruthy();
  });
  test('no delta badge without personalDelta', () => {
    const r = renderDash({ ...baseSG, personalDelta: null });
    expect(r.queryByText(/vs your last stretch/)).toBeNull();
  });
});

import { buildShotSignals } from '../ShotDashboard';

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
