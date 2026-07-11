import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../../theme/ThemeContext';
import BreakdownTab from '../BreakdownTab';
import CoachTab from '../CoachTab';
import ShotsTab from '../ShotsTab';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

function baseStats() {
  return {
    metrics: { rounds: 3, avgPoints: 30, bestRoundPoints: 38, avgVsPar: 13 },
    history: [
      { points: 30, holesPlayed: 18 },
      { points: 31, holesPlayed: 18 },
      { points: 29, holesPlayed: 18 },
    ],
    distribution: {
      eagles: 0, birdies: 2, pars: 8, bogeys: 5, doubles: 2, worse: 1, total: 18,
    },
    // Gross vs-par mix for the ShotsTab benchmark rows — deliberately
    // different from the net `distribution` so tests can prove the
    // benchmark reads gross (one net birdie was handicap-assisted).
    distributionGross: {
      eagles: 0, birdies: 1, pars: 9, bogeys: 5, doubles: 2, worse: 1, total: 18,
    },
    parType: {
      par3: { holes: 4, avgPoints: 1.5, avgStrokes: 4 },
      par4: { holes: 10, avgPoints: 1.7, avgStrokes: 5.2 },
      par5: { holes: 4, avgPoints: 2, avgStrokes: 6 },
    },
    difficulty: {
      hard: { holes: 6, avgPoints: 1.5 },
      mid: { holes: 6, avgPoints: 1.7 },
      easy: { holes: 6, avgPoints: 1.8 },
    },
    frontBack: { rounds: [{}, {}, {}], frontAvg: 1.67, backAvg: 1.67 },
    warmupClosing: {
      warmup: { holes: 9, avgPoints: 1.5 },
      closing: { holes: 9, avgPoints: 1.7 },
    },
    bounceBack: { rate: 33, opportunities: 6 },
    scrambling: { pct: 40, missedGir: 5 },
    form: {
      hasHistory: true,
      metrics: [{ key: 'avgPoints', direction: 'up', delta: 3 }],
    },
    formSeries: { metrics: { avgPoints: [{ label: 'R1', value: 27 }, { label: 'R2', value: 33 }] } },
    ranking: {
      baseline: 1.6,
      strengths: [
        { label: 'Fairway drives', avgPoints: 2.1, deviation: 0.5 },
        { label: 'Super drives', avgPoints: 2, deviation: 0.4 },
        { label: '100-150 m approaches', avgPoints: 1.9, deviation: 0.3 },
      ],
      weaknesses: [
        { label: '6+ m putts', avgPoints: 0.6, deviation: -1 },
        { label: 'Right misses', avgPoints: 0.5, deviation: -1.1 },
        { label: '200+ m approaches', avgPoints: 0.7, deviation: -0.9 },
      ],
    },
    courseMastery: [
      { courseName: 'Oak', rounds: 1, avgPoints: 54, bestPoints: 54, trend: 0 },
      { courseName: 'Pine', rounds: 2, avgPoints: 27, bestPoints: 36, trend: -1 },
    ],
    careerMilestones: {
      birdies: 18, eagles: 0, longestParStreak: 18, bestNine: 27, bestRound: 54,
    },
    strokesGained: {
      total: -1.25,
      sampleHoles: 18,
      byCategory: { approach: -0.2, aroundGreen: -0.1, putting: -1.35 },
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
    coach: {
      hero: {
        id: 'putting:6-m-putts',
        group: 'fixFirst',
        area: 'putting',
        areaLabel: 'Putting',
        title: '6+ m putts',
        reason: 'Long first putts are costing shots against your target.',
        metric: '-0.81 SG / putt',
        sample: 6,
        confidence: 'high',
        tone: 'bad',
      },
      board: {
        fixFirst: [{
          id: 'putting:6-m-putts',
          group: 'fixFirst',
          area: 'putting',
          areaLabel: 'Putting',
          title: '6+ m putts',
          reason: 'Long first putts are the biggest leak.',
          metric: '-0.81 SG / putt',
          sample: 6,
          confidence: 'high',
          tone: 'bad',
        }],
        keepDoing: [{
          id: 'driving:fairway-drives',
          group: 'keepDoing',
          area: 'driving',
          areaLabel: 'Driving',
          title: 'Stock tee shot',
          reason: 'Fairways are producing stable points.',
          metric: '+0.50 pts / hole',
          sample: 12,
          confidence: 'medium',
          tone: 'good',
        }],
        gettingBetter: [],
        gettingWorse: [],
        nextGains: [],
        watch: [],
      },
      practicePlan: [
        {
          id: 'practice-putting',
          role: 'practiceFirst',
          sourceInsightId: 'putting:6-m-putts',
          title: '6+ m putts distance ladder',
          instruction: 'Roll sets from 6, 9 and 12 m and finish inside a club length.',
          reason: 'Distance control reduces three-putt damage.',
        },
        {
          id: 'practice-driving',
          role: 'secondaryFocus',
          sourceInsightId: 'driving:fairway-drives',
          title: 'Stock tee-shot rehearsal',
          instruction: 'Rehearse the tee shot that keeps you in play.',
          reason: 'This is already a scoring strength.',
        },
        {
          id: 'practice-cue',
          role: 'onCourseCue',
          title: 'Choose pace before line',
          instruction: 'Commit to speed on long putts before aiming.',
        },
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
      roundsWithPuttData: 1,
      putts: { perRound: 42, per18: 42, holes: 18, onePutts: 0, threePuttPlus: 6 },
      drives: {
        fairwayPct: 67,
        fairwaysHit: 12,
        recorded: 18,
        distribution: { fairway: 12, left: 0, right: 6, short: 0, super: 0 },
      },
      gir: { pct: 67, eligible: 18 },
      penalties: { tee: 0, other: 0, total: 0, teeOnDriveHoles: 0 },
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
    puttDive: {
      hasData: true,
      holes: 18,
      twoPuttPct: 67,
      girHoles: 12,
      girPuttsAvg: 2,
      nonGirHoles: 6,
      nonGirPuttsAvg: 3,
      onePuttSave: { pct: 0, attempts: 6 },
    },
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
  test('CoachTab renders form trend first, fix-first priority, board, and practice plan', async () => {
    const { findByText, findAllByText, queryByText } = render(wrap(
      <CoachTab stats={baseStats()} onInfo={() => {}} targetHandicap={14} onChangeTarget={() => {}} />
    ));

    expect(await findByText('Current form')).toBeTruthy();
    expect(await findByText('Improving lately')).toBeTruthy();
    expect((await findAllByText('6+ m putts')).length).toBeGreaterThan(0);
    expect(await findByText('Long first putts are the biggest leak.')).toBeTruthy();
    expect(await findByText('Coach Board')).toBeTruthy();
    expect(await findByText('Protect')).toBeTruthy();
    expect(queryByText('Performance Snapshot')).toBeNull();
    expect(queryByText('Strokes gained by area')).toBeNull();
    expect(queryByText('Evidence behind it')).toBeNull();
    expect(await findByText('Stock tee shot')).toBeTruthy();
    expect(await findByText('Plan: Secondary focus')).toBeTruthy();
    expect(await findByText('Practice Plan')).toBeTruthy();
  });

  test('CoachTab shows which target handicap the coaching is benchmarked against', async () => {
    const onChangeTarget = jest.fn();
    const { findByText, getByLabelText } = render(wrap(
      <CoachTab stats={baseStats()} onInfo={() => {}} targetHandicap={14} onChangeTarget={onChangeTarget} />
    ));

    expect(await findByText(/vs 14-handicap target/)).toBeTruthy();
    fireEvent.press(getByLabelText('Change target handicap'));
    expect(onChangeTarget).toHaveBeenCalledTimes(1);
  });

  test('CoachTab benchmarks against scratch when no target handicap is set', async () => {
    const { findByText } = render(wrap(
      <CoachTab stats={baseStats()} onInfo={() => {}} targetHandicap={null} onChangeTarget={() => {}} />
    ));

    expect(await findByText(/vs scratch/)).toBeTruthy();
  });

  test('ShotsTab renders target-handicap strokes gained and benchmark sections', async () => {
    const { findByText, findAllByText, queryByText, getByLabelText } = render(wrap(
      <ShotsTab stats={shotStats()} onInfo={() => {}} targetHandicap={14} onChangeTarget={() => {}} />
    ));

    expect(await findByText('Strokes Gained Dashboard')).toBeTruthy();
    expect(await findByText('What is working')).toBeTruthy();
    expect(await findByText('What is costing shots')).toBeTruthy();
    expect(await findByText('Scoring')).toBeTruthy();
    expect(queryByText('Score vs par')).toBeNull();
    expect(await findByText('Par 3 avg score')).toBeTruthy();
    expect(await findByText('Par 4 avg score')).toBeTruthy();
    expect(await findByText('Par 5 avg score')).toBeTruthy();
    expect(await findByText('Driving vs target')).toBeTruthy();
    expect(await findByText('Driver distance')).toBeTruthy();
    expect((await findAllByText('Approach')).length).toBeGreaterThan(0);
    expect(await findByText('Approach vs target')).toBeTruthy();
    expect((await findAllByText('Putting')).length).toBeGreaterThan(0);
    expect(await findByText('Putting vs target')).toBeTruthy();
    expect(getByLabelText('What is Scoring')).toBeTruthy();
    expect(getByLabelText('What is Driving vs target')).toBeTruthy();
    expect(getByLabelText('What is Approach vs target')).toBeTruthy();
    expect(getByLabelText('What is Putting vs target')).toBeTruthy();
  });

  test('ShotsTab compares aggregate shot metrics with the target handicap', async () => {
    const { findAllByText, findByText } = render(wrap(
      <ShotsTab stats={shotStats()} onInfo={() => {}} targetHandicap={14} onChangeTarget={() => {}} />
    ));

    expect(await findByText('3-putts / round')).toBeTruthy();
    // Putting rows are normalized to an 18-hole rate off logged holes —
    // the secondary copy states the per-18 basis instead of raw rounds.
    expect(await findByText('vs target hcp · 6 total · 18 holes · target 3.5 / 18 holes')).toBeTruthy();
    expect((await findAllByText('vs target hcp · 18 holes · target 25%')).length).toBeGreaterThan(0);
    expect((await findAllByText('vs target hcp · 18 holes · target 31.9 / 18 holes')).length).toBeGreaterThan(0);
    // Scoring-mix benchmark rows read the GROSS distribution (1 gross
    // birdie), not the net distribution (2 net birdies).
    expect(await findByText('vs target hcp · 1 total · 18 holes · target 0.4')).toBeTruthy();
  });

  test('ShotsTab flags low-sample benchmark rows instead of over-coloring them', async () => {
    const stats = {
      ...shotStats(),
      parType: {
        ...shotStats().parType,
        par3: { holes: 4, avgPoints: 0.5, avgStrokes: 5.1 },
      },
    };
    const { findAllByText, findByText } = render(wrap(
      <ShotsTab stats={stats} onInfo={() => {}} targetHandicap={15} onChangeTarget={() => {}} />
    ));

    expect(await findByText('Par 3 avg score')).toBeTruthy();
    expect((await findAllByText('vs target hcp · 4 holes · target 3.9 · low sample')).length).toBeGreaterThan(0);
  });

  test('ShotsTab leaves scoring patterns out of the target-handicap view', async () => {
    const { queryByText } = render(wrap(
      <ShotsTab stats={shotStats()} onInfo={() => {}} targetHandicap={14} onChangeTarget={() => {}} />
    ));

    expect(queryByText('Score by tee result')).toBeNull();
    expect(queryByText('Drive bucket impact')).toBeNull();
    expect(queryByText('Score by approach distance')).toBeNull();
  });

  test('BreakdownTab includes shot patterns compared with my own average points', async () => {
    const { findByText, findAllByText, queryByText } = render(wrap(
      <BreakdownTab stats={shotStats()} onInfo={() => {}} />
    ));

    expect(await findByText('Course Mastery')).toBeTruthy();
    expect(await findByText('Career Milestones')).toBeTruthy();
    expect(await findByText('Scoring patterns')).toBeTruthy();
    expect(await findByText('Course scoring patterns')).toBeTruthy();
    expect(await findByText('Round timing patterns')).toBeTruthy();
    expect(await findByText('Tee result patterns')).toBeTruthy();
    expect(await findByText('Drive bucket patterns')).toBeTruthy();
    expect(await findByText('Approach distance patterns')).toBeTruthy();
    expect(await findByText('Recovery patterns')).toBeTruthy();
    expect(await findByText('Birdies+ / round')).toBeTruthy();
    expect(await findByText('Par 3s')).toBeTruthy();
    expect(await findByText('Fairway found')).toBeTruthy();
    expect(await findByText('Fairway missed')).toBeTruthy();
    expect((await findAllByText(/vs your avg/)).length).toBeGreaterThan(0);
    expect(queryByText('Score distribution')).toBeNull();
    expect(queryByText('Hole difficulty')).toBeNull();
  });

  test('BreakdownTab shows the actual average baseline for timing rows', async () => {
    const stats = {
      ...shotStats(),
      metrics: { ...shotStats().metrics, avgPoints: 30 },
      history: [
        { points: 30, holesPlayed: 18 },
        { points: 30, holesPlayed: 18 },
      ],
      frontBack: { rounds: [{}, {}], frontAvg: 1.67, backAvg: 1.67 },
      warmupClosing: {
        warmup: { holes: 6, avgPoints: 1.67 },
        closing: { holes: 6, avgPoints: 1.67 },
      },
    };
    const { findAllByText, queryByText } = render(wrap(
      <BreakdownTab stats={stats} onInfo={() => {}} />
    ));

    expect((await findAllByText('vs your avg · 18 holes · avg 1.67 pts/hole · +0')).length).toBeGreaterThan(0);
    expect(queryByText(/-1.5 vs your avg/)).toBeNull();
  });

  test('BreakdownTab shows Course Mastery rows and Career Milestones tiles', async () => {
    const { findByText, findAllByText, getByLabelText } = render(wrap(
      <BreakdownTab stats={baseStats()} onInfo={() => {}} />
    ));

    // Course Mastery: sorted best-avg-first (Oak 54 before Pine 27), each
    // row showing rounds/best/avg, and a trend icon per course.
    expect(await findByText('Oak')).toBeTruthy();
    expect(await findByText('Pine')).toBeTruthy();
    expect(await findByText('1 round · best 54 pts')).toBeTruthy();
    expect(await findByText('2 rounds · best 36 pts')).toBeTruthy();
    expect(await findByText('54 pts avg')).toBeTruthy();
    expect(await findByText('27 pts avg')).toBeTruthy();
    expect(getByLabelText('Pine trend bad')).toBeTruthy();
    expect(getByLabelText('Oak trend neutral')).toBeTruthy();

    // Career Milestones: birdies/eagles/streak counts plus best nine/round.
    // birdies and longestParStreak are both 18 in this fixture — two tiles
    // legitimately share the value.
    expect((await findAllByText('18')).length).toBe(2);
    expect(await findByText('Birdies')).toBeTruthy();
    expect(await findByText('Eagles')).toBeTruthy();
    expect(await findByText('Best par streak')).toBeTruthy();
    expect(await findByText('27')).toBeTruthy();
    expect(await findByText('Best nine (pts)')).toBeTruthy();
    expect(await findByText('54')).toBeTruthy();
    expect(await findByText('Best round (pts)')).toBeTruthy();
  });

  test('BreakdownTab hides Course Mastery when there is no complete round at any course', async () => {
    const stats = { ...baseStats(), courseMastery: [] };
    const { queryByText } = render(wrap(
      <BreakdownTab stats={stats} onInfo={() => {}} />
    ));

    expect(queryByText('Course Mastery')).toBeNull();
  });
});
