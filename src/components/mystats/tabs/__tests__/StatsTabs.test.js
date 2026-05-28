import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../../theme/ThemeContext';
import OverviewTab from '../OverviewTab';
import ShotsTab from '../ShotsTab';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

function baseStats() {
  return {
    metrics: { rounds: 3, avgPoints: 30, bestRoundPoints: 38 },
    form: {
      hasHistory: true,
      metrics: [{ key: 'avgPoints', direction: 'up', delta: 3 }],
    },
    formSeries: { metrics: { avgPoints: [{ label: 'R1', value: 27 }, { label: 'R2', value: 33 }] } },
    ranking: { baseline: 1.6, strengths: [], weaknesses: [] },
    strokesGained: {
      total: -1.25,
      sampleHoles: 18,
      byCategory: { tee: 0.4, approach: -0.2, aroundGreen: -0.1, putting: -1.35 },
    },
    actionPlan: {
      keep: { area: 'Driving', label: 'Super drives', score: 0.7, sample: 6, unit: 'pts / hole', value: 2 },
      improve: { area: 'Putting', label: '6+ m putts', score: -0.81, sample: 6, unit: 'SG / putt', value: -0.81 },
      practice: { area: 'Approach', label: '200+ m approaches', score: -0.09, sample: 6, unit: 'SG / shot', value: -0.09 },
      strengths: [{ area: 'Driving', label: 'Super drives', score: 0.7, sample: 6, unit: 'pts / hole', value: 2 }],
      improvements: [
        { area: 'Putting', label: '6+ m putts', score: -0.81, sample: 6, unit: 'SG / putt', value: -0.81 },
        { area: 'Driving', label: 'Right misses', score: -1.33, sample: 6, unit: 'pts / hole', value: 0 },
      ],
    },
  };
}

function shotStats() {
  return {
    ...baseStats(),
    teeShot: {
      hasData: true,
      fairway: { holes: 12, avgPoints: 2 },
      missed: { holes: 6, avgPoints: 0 },
      byDirection: {
        left: { holes: 0, avgPoints: 0 },
        right: { holes: 6, avgPoints: 0 },
        short: { holes: 0, avgPoints: 0 },
      },
      teePenalty: { holes: 0, avgPoints: 0 },
      penaltyDrag: 0,
    },
    shots: {
      hasData: true,
      roundsWithData: 1,
      putts: { perRound: 42, holes: 18, onePutts: 0, threePuttPlus: 6 },
      drives: { fairwayPct: 67, fairwaysHit: 12, recorded: 18 },
      gir: { pct: 67, eligible: 18 },
      penalties: { total: 0 },
    },
    driveImpact: {
      hasData: true,
      buckets: {
        super: { holes: 6, avgPoints: 2, avgVsPar: 0, penaltyRate: 0 },
        fairway: { holes: 6, avgPoints: 2, avgVsPar: 0, penaltyRate: 0 },
        left: { holes: 0, avgPoints: 0, avgVsPar: 0, penaltyRate: 0 },
        right: { holes: 6, avgPoints: 0, avgVsPar: 2, penaltyRate: 0 },
        short: { holes: 0, avgPoints: 0, avgVsPar: 0, penaltyRate: 0 },
      },
    },
    approachImpact: {
      hasData: true,
      buckets: {
        '0-50': { holes: 0, avgPoints: 0, avgVsPar: 0, girRate: null },
        '50-100': { holes: 0, avgPoints: 0, avgVsPar: 0, girRate: null },
        '100-150': { holes: 12, avgPoints: 2, avgVsPar: 0, girRate: 100 },
        '150-200': { holes: 0, avgPoints: 0, avgVsPar: 0, girRate: null },
        '200+': { holes: 6, avgPoints: 0, avgVsPar: 2, girRate: 0 },
      },
    },
    puttDive: { hasData: true, twoPuttPct: 67, girPuttsAvg: 2, nonGirPuttsAvg: 3, onePuttSave: { pct: 0 } },
    lagPutting: { avgPuttsByBucket: {}, sample: { perBucket: {} } },
    puttingTarget: {
      hasData: true,
      buckets: {
        '0-1': { attempts: 0, avgPutts: null, expectedPutts: null, sgPerPutt: null, threePuttRate: null },
        '1-2': { attempts: 0, avgPutts: null, expectedPutts: null, sgPerPutt: null, threePuttRate: null },
        '2-3': { attempts: 0, avgPutts: null, expectedPutts: null, sgPerPutt: null, threePuttRate: null },
        '3-6': { attempts: 12, avgPutts: 2, expectedPutts: 1.95, sgPerPutt: -0.05, threePuttRate: 0 },
        '6+': { attempts: 6, avgPutts: 3, expectedPutts: 2.19, sgPerPutt: -0.81, threePuttRate: 100 },
      },
    },
    approachTarget: {
      hasData: true,
      buckets: {
        '0-50': { holes: 0, avgSg: null, girRate: null },
        '50-100': { holes: 0, avgSg: null, girRate: null },
        '100-150': { holes: 12, avgSg: 0.31, girRate: 100 },
        '150-200': { holes: 0, avgSg: null, girRate: null },
        '200+': { holes: 6, avgSg: -0.09, girRate: 0 },
      },
    },
    sandSaves: null,
    upAndDown: null,
    bunkerVisits: null,
  };
}

describe('My Stats tabs', () => {
  test('OverviewTab renders the actionable plan', async () => {
    const { findByText } = render(wrap(
      <OverviewTab stats={baseStats()} onInfo={() => {}} targetHandicap={14} onChangeTarget={() => {}} />
    ));

    expect(await findByText('Action Plan')).toBeTruthy();
    expect(await findByText('Super drives')).toBeTruthy();
    expect(await findByText('6+ m putts')).toBeTruthy();
  });

  test('ShotsTab renders drive, approach, and target-distance impact sections', async () => {
    const { findByText } = render(wrap(
      <ShotsTab stats={shotStats()} onInfo={() => {}} targetHandicap={14} onChangeTarget={() => {}} />
    ));

    expect(await findByText('Drive score impact')).toBeTruthy();
    expect(await findByText('Super drives')).toBeTruthy();
    expect(await findByText('Approach score impact')).toBeTruthy();
    expect(await findByText('Putting vs target')).toBeTruthy();
    expect(await findByText('Approach vs target')).toBeTruthy();
  });
});
