import React from 'react';
import { render, fireEvent, waitFor, within } from '@testing-library/react-native';
import { Text as SvgText } from 'react-native-svg';
import { ThemeProvider } from '../../../../theme/ThemeContext';
import BreakdownTab from '../BreakdownTab';
import CoachTab from '../CoachTab';
import FormTab from '../FormTab';
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
      { courseName: 'Oak', rounds: 1, avgPoints: 54, bestPoints: 54, trend: null, recentPoints: [54] },
      { courseName: 'Elm', rounds: 2, avgPoints: 30, bestPoints: 30, trend: 0, recentPoints: [30, 30] },
      { courseName: 'Pine', rounds: 2, avgPoints: 27, bestPoints: 36, trend: -1, recentPoints: [36, 18] },
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

// Full form/formSeries slice for the Form-tab suite — every FORM_METRICS
// entry plus per-round series and score mix, the shape personalStats builds.
function formStats() {
  const mk = (values) => values.map((value, i) => ({ label: `R${i + 1}`, value }));
  return {
    ...baseStats(),
    form: {
      hasHistory: true,
      recentCount: 3,
      historyCount: 5,
      metrics: [
        { key: 'avgPoints', label: 'Points / round', polarity: 'higher', shot: false, recent: 33, history: 30, delta: 3, direction: 'up' },
        { key: 'avgVsPar', label: 'Strokes vs par', polarity: 'lower', shot: false, recent: 10, history: 13, delta: -3, direction: 'up' },
        { key: 'fairwayPct', label: 'Fairways hit %', polarity: 'higher', shot: true, recent: 60, history: 50, delta: 10, direction: 'up' },
        { key: 'girPct', label: 'Greens in reg %', polarity: 'higher', shot: true, recent: 40, history: 45, delta: -5, direction: 'down' },
        { key: 'puttsPerRound', label: 'Putts / round', polarity: 'lower', shot: true, recent: 30, history: 33, delta: -3, direction: 'up' },
        { key: 'threePuttsPerRound', label: '3-putts / round', polarity: 'lower', shot: true, recent: 2, history: 2, delta: 0, direction: 'flat' },
      ],
    },
    formSeries: {
      hasShotData: true,
      metrics: {
        avgPoints: mk([27, 30, 33]),
        avgVsPar: mk([13, 12, 10]),
        fairwayPct: mk([50, 55, 60]),
        girPct: mk([45, 40, 40]),
        puttsPerRound: mk([33, 31, 30]),
        threePuttsPerRound: mk([2, 2, 2]),
      },
      scoreMix: [
        { label: 'R1', birdiePlus: 2, par: 10, bogey: 4, double: 1, worse: 1 },
        { label: 'R2', birdiePlus: 4, par: 9, bogey: 4, double: 1, worse: 0 },
        { label: 'R3', birdiePlus: 1, par: 11, bogey: 6, double: 0, worse: 0 },
      ],
      damage: mk([5, 3, 0]),
      steadyPct: mk([89, 94, 100]),
    },
  };
}

describe('My Stats tabs', () => {
  test('FormTab renders exactly three cards: hero, instruments, score mix', async () => {
    const { findByText, getByTestId, getAllByTestId, queryByText, getByText } = render(wrap(
      <FormTab stats={formStats()} n={5} onChangeN={() => {}} onInfo={() => {}} />
    ));

    // Hero: kicker + verdict from stats.form + gold pts number + chart. (Two
    // trend canvases render on the tab: the hero's and the steady-holes one.)
    expect(await findByText('Current form · Last 5')).toBeTruthy();
    expect(getByText('Improving lately')).toBeTruthy();
    expect(getByTestId('form-hero-pts')).toBeTruthy();
    expect(getByTestId('form-hero-surface')).toBeTruthy();
    expect(getAllByTestId('trend-chart-canvas')).toHaveLength(2);

    // Instruments: one sparkline row per remaining metric (avgPoints lives
    // in the hero, not the instruments panel).
    expect(getByText('Instruments')).toBeTruthy();
    ['avgVsPar', 'fairwayPct', 'girPct', 'puttsPerRound', 'threePuttsPerRound'].forEach((key) => {
      expect(getByTestId(`sparkline-row-${key}`)).toBeTruthy();
    });
    expect(queryByText('Points / round')).toBeNull();

    // Score mix damage report: headline, per-round columns, steady trend.
    expect(getByText('Score mix')).toBeTruthy();
    expect(getByText('Damage · strokes lost past bogey')).toBeTruthy();
    expect(getByTestId('scoremix-damage-value')).toBeTruthy();
    expect(getByTestId('scoremix-col-0')).toBeTruthy();
    expect(getByTestId('scoremix-col-2')).toBeTruthy();
    expect(getByText('Steady holes · bogey or better')).toBeTruthy();

    // The old four-card layout is gone.
    expect(queryByText('Points per round')).toBeNull();
    expect(queryByText('Recent vs History')).toBeNull();
  });

  test('FormTab period chips select the window and call onChangeN', async () => {
    const onChangeN = jest.fn();
    const { findByText, getByText } = render(wrap(
      <FormTab stats={formStats()} n={5} onChangeN={onChangeN} onInfo={() => {}} />
    ));

    expect(await findByText('Last 3')).toBeTruthy();
    expect(getByText('Last 10')).toBeTruthy();
    fireEvent.press(getByText('Last 3'));
    expect(onChangeN).toHaveBeenCalledWith(3);
  });

  test('FormTab hides shot-metric rows and explains when no shot data is logged', async () => {
    const stats = formStats();
    stats.formSeries.hasShotData = false;
    const { findByTestId, queryByTestId, getByText } = render(wrap(
      <FormTab stats={stats} n={5} onChangeN={() => {}} onInfo={() => {}} />
    ));

    expect(await findByTestId('sparkline-row-avgVsPar')).toBeTruthy();
    ['fairwayPct', 'girPct', 'puttsPerRound', 'threePuttsPerRound'].forEach((key) => {
      expect(queryByTestId(`sparkline-row-${key}`)).toBeNull();
    });
    expect(getByText('Log putts and drives during a round to unlock fairway, green and putting trends.')).toBeTruthy();
  });

  test('FormTab surfaces the not-enough-history note from stats.form', async () => {
    const stats = formStats();
    stats.form.hasHistory = false;
    const { findByText } = render(wrap(
      <FormTab stats={stats} n={10} onChangeN={() => {}} onInfo={() => {}} />
    ));

    expect(await findByText('Not enough history yet — select more than 10 rounds to compare.')).toBeTruthy();
  });

  test('FormTab keeps every infoKey wired', async () => {
    const onInfo = jest.fn();
    const { findByLabelText, getByLabelText } = render(wrap(
      <FormTab stats={formStats()} n={5} onChangeN={() => {}} onInfo={onInfo} />
    ));

    fireEvent.press(await findByLabelText('What is Points per round'));
    expect(onInfo).toHaveBeenCalledWith('pointsPerRound');
    fireEvent.press(getByLabelText('What is Instruments'));
    expect(onInfo).toHaveBeenCalledWith('recentVsHistory');
    fireEvent.press(getByLabelText('What is Score mix'));
    expect(onInfo).toHaveBeenCalledWith('scoreMix');
    fireEvent.press(getByLabelText('What is Damage'));
    expect(onInfo).toHaveBeenCalledWith('damage');
    fireEvent.press(getByLabelText('What is Steady holes'));
    expect(onInfo).toHaveBeenCalledWith('steadyHoles');
    fireEvent.press(getByLabelText('What is Strokes vs par'));
    expect(onInfo).toHaveBeenCalledWith('strokesVsPar');
    fireEvent.press(getByLabelText('What is Putts / round'));
    expect(onInfo).toHaveBeenCalledWith('putts');
  });

  test('FormTab instrument rows expand one at a time (accordion) with per-round values', async () => {
    const view = render(wrap(
      <FormTab stats={formStats()} n={5} onChangeN={() => {}} onInfo={() => {}} />
    ));

    // Expand GIR: the full chart mounts under the row with the metric's own
    // formatter — every selected round's value, oldest → newest.
    fireEvent.press(await view.findByTestId('sparkline-press-girPct'));
    const girExpanded = view.getByTestId('sparkline-expanded-girPct');
    fireEvent(within(girExpanded).getByTestId('trend-chart-canvas'), 'layout', {
      nativeEvent: { layout: { width: 300 } },
    });
    expect(view.UNSAFE_getAllByType(SvgText).map((t) => t.props.children))
      .toEqual(['45%', '40%', '40%']);
    expect(view.getByText('oldest → newest')).toBeTruthy();
    expect(view.getByTestId('sparkline-press-girPct').props.accessibilityLabel)
      .toBe('Greens in reg %: 40%. Hide round-by-round values.');

    // Expanding a sibling collapses GIR — only one row open at a time.
    fireEvent.press(view.getByTestId('sparkline-press-fairwayPct'));
    expect(view.getByTestId('sparkline-expanded-fairwayPct')).toBeTruthy();
    expect(view.queryByTestId('sparkline-expanded-girPct')).toBeNull();
    expect(view.getByTestId('sparkline-press-fairwayPct').props.accessibilityState)
      .toEqual({ expanded: true });
    expect(view.getByTestId('sparkline-press-girPct').props.accessibilityState)
      .toEqual({ expanded: false });

    // Tapping the open row again closes it — nothing left expanded.
    fireEvent.press(view.getByTestId('sparkline-press-fairwayPct'));
    expect(view.queryByTestId('sparkline-expanded-fairwayPct')).toBeNull();
    expect(view.queryByTestId('sparkline-expanded-girPct')).toBeNull();
  });

  test('FormTab info buttons still fire while a row is expanded', async () => {
    const onInfo = jest.fn();
    const view = render(wrap(
      <FormTab stats={formStats()} n={5} onChangeN={() => {}} onInfo={onInfo} />
    ));

    fireEvent.press(await view.findByTestId('sparkline-press-girPct'));
    expect(view.getByTestId('sparkline-expanded-girPct')).toBeTruthy();
    fireEvent.press(view.getByLabelText('What is Greens in reg %'));
    expect(onInfo).toHaveBeenCalledWith('greensInReg');
    // The info tap did not collapse (or re-toggle) the row.
    expect(view.getByTestId('sparkline-expanded-girPct')).toBeTruthy();
  });

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

    expect(await findByText('Strokes gained · vs 14-hcp target')).toBeTruthy();
    // Category board replaced the What-is-working / What-is-costing lists.
    expect(await findByText('Target gap')).toBeTruthy();
    expect(queryByText('What is working')).toBeNull();
    expect(queryByText('What is costing shots')).toBeNull();
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

  test('ShotsTab renders the scoring summary as target meters with gold ticks', async () => {
    const { findByText, getByText, getAllByText, getByTestId, getByLabelText } = render(wrap(
      <ShotsTab stats={shotStats()} onInfo={() => {}} targetHandicap={14} onChangeTarget={() => {}} />
    ));

    // Overline heading + one meter row per summary item, each with a fill
    // (your value) and a gold tick (the benchmark target) on the track.
    expect(await findByText('Scoring vs target')).toBeTruthy();
    expect(getByText('Par 3s')).toBeTruthy();
    expect(getByText('Par 4s')).toBeTruthy();
    expect(getByText('Par 5s')).toBeTruthy();
    expect(getByText('Damage control')).toBeTruthy();
    expect(getByTestId('scoring-meter-par3AvgScore')).toBeTruthy();
    expect(getByTestId('scoring-meter-par3AvgScore-fill')).toBeTruthy();
    expect(getByTestId('scoring-meter-par3AvgScore-tick')).toBeTruthy();
    expect(getByTestId('scoring-meter-doublesOrWorsePerRound-tick')).toBeTruthy();

    // The meta keeps only the sample portion of the row secondary (incl.
    // any low-sample flag), and the target moves to its own line under the
    // value (hcp-14 interpolated).
    expect(getAllByText('4 holes · low sample').length).toBe(2); // par 3s + par 5s
    expect(getByText('10 holes')).toBeTruthy();
    expect(getByText('3 total · 18 holes')).toBeTruthy();
    expect(getByText('target 3.9')).toBeTruthy();
    expect(getByText('target 4.3')).toBeTruthy();
    expect(getByLabelText('Par 3s: 4, target 3.9')).toBeTruthy();
  });

  test('ShotsTab renders the gross score mix bar and magnitude bars on detail rows', async () => {
    const { findByText, getByTestId, queryByTestId } = render(wrap(
      <ShotsTab stats={shotStats()} onInfo={() => {}} targetHandicap={14} onChangeTarget={() => {}} />
    ));

    // The Scoring card's mix is the horizontal ScoreMixBar fed by the GROSS
    // distribution, under a small overline heading.
    expect(await findByText('Score mix · gross')).toBeTruthy();
    expect(getByTestId('scoremix-segment-birdie')).toBeTruthy();
    expect(getByTestId('scoremix-segment-par')).toBeTruthy();
    expect(getByTestId('scoremix-segment-double')).toBeTruthy();

    // Detail rows are BreakdownRow magnitude bars: % rows on the absolute
    // scale, counts per-block, bucket SG rows normalized within the bucket
    // group. Fills sweep in for rows with real magnitude.
    expect(getByTestId('shots-bar-fairways')).toBeTruthy();
    expect(getByTestId('shots-bar-fairways-fill')).toBeTruthy();
    expect(getByTestId('shots-bar-gir')).toBeTruthy();
    expect(getByTestId('shots-bar-puttsPerRound')).toBeTruthy();
    expect(getByTestId('shots-bar-par3AvgScore')).toBeTruthy();
    expect(getByTestId('shots-bar-100-150')).toBeTruthy(); // approach bucket
    expect(getByTestId('shots-bar-6+')).toBeTruthy(); // putting bucket

    // No drive distance logged → dim row keeps the em-dash + EMPTY track.
    expect(getByTestId('shots-bar-driveDistance')).toBeTruthy();
    expect(queryByTestId('shots-bar-driveDistance-fill')).toBeNull();
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

  test('BreakdownTab labels the recovery-putting metric as scrambling, not "up and down"', async () => {
    // The metric's denominator counts every missed-GIR hole with logged
    // putts as an "attempt" — including a two-putt from the fringe or a
    // long 3-putt with no chip/recovery shot. There is no reliable signal
    // in shot detail (approachResult is optional and frequently unset) to
    // gate that denominator on an actual around-the-green shot, so the UI
    // must not claim the classic "up and down" definition. It should read
    // as a scrambling-family metric instead, distinct from the plain
    // "Scrambling" row already on this tab.
    const stats = {
      ...shotStats(),
      sandSaves: { attempts: 5, saves: 2, rate: 0.4 },
      upAndDown: { attempts: 8, conversions: 4, rate: 0.5 },
      bunkerVisits: { totalShots: 6, holesWithSand: 4, avgPerRound: 2 },
    };
    const { findAllByText, queryByText } = render(wrap(
      <BreakdownTab stats={stats} onInfo={() => {}} />
    ));

    const scramblingLabels = await findAllByText(/scrambling/i);
    expect(scramblingLabels.length).toBeGreaterThanOrEqual(2); // the existing row + the renamed one
    expect(queryByText(/up.and.down/i)).toBeNull();
    expect(queryByText(/up & down/i)).toBeNull();
  });

  test('BreakdownTab shows Course Mastery cards and Career Milestones tiles', async () => {
    const { findByText, getAllByText, queryByLabelText } = render(wrap(
      <BreakdownTab stats={baseStats()} onInfo={() => {}} />
    ));

    // Course Mastery: sorted best-avg-first (Oak 54 before Pine 27), each
    // course card showing the big average with its AVG PTS label plus the
    // rounds/best meta. The old trend pill is gone — the sparkline carries
    // the shape of recent rounds instead.
    expect(await findByText('Oak')).toBeTruthy();
    expect(await findByText('Pine')).toBeTruthy();
    expect(await findByText('1 round · best 54 pts')).toBeTruthy();
    expect(await findByText('2 rounds · best 36 pts')).toBeTruthy();
    expect(getAllByText('AVG PTS')).toHaveLength(3);
    expect(await findByText('30')).toBeTruthy(); // Elm avg
    expect(queryByLabelText(/trend/)).toBeNull();

    // Career Milestones (honours board): birdies/eagles/streak counts plus
    // best nine/round. birdies and longestParStreak are both 18 in this
    // fixture — two cells legitimately share the value. The numbers count up
    // on mount, so wait until BOTH staggered count-ups have landed on 18
    // (findAllByText would resolve as soon as the first one finished).
    expect(await findByText('Birdies')).toBeTruthy();
    expect(await findByText('Eagles')).toBeTruthy();
    expect(await findByText('Best par streak')).toBeTruthy();
    await waitFor(() => expect(getAllByText('18')).toHaveLength(2), { timeout: 3000 });
    // '27' and '54' each appear twice once the count-ups land: a mastery
    // card average (Pine 27 / Oak 54) plus the best-nine / best-round tile.
    await waitFor(() => expect(getAllByText('27')).toHaveLength(2), { timeout: 3000 });
    expect(await findByText('Best nine')).toBeTruthy();
    await waitFor(() => expect(getAllByText('54')).toHaveLength(2), { timeout: 3000 });
    expect(await findByText('Best round')).toBeTruthy();
    // The counts are NET (handicap-adjusted) — ShotsTab's birdie benchmark
    // is gross, so the card must disclose the basis.
    expect(await findByText(/net \(handicap-adjusted\)/i)).toBeTruthy();
  });

  test('BreakdownTab tells the story in order: milestones → mastery → mix → patterns', async () => {
    const view = render(wrap(
      <BreakdownTab stats={shotStats()} onInfo={() => {}} />
    ));
    expect(await view.findByText('Course Mastery')).toBeTruthy();

    const titles = [
      'Career Milestones',
      'Course Mastery',
      'Score mix',
      'Scoring patterns',
      'Course scoring patterns',
      'Round timing patterns',
      'Tee result patterns',
      'Drive bucket patterns',
      'Approach distance patterns',
      'Putting patterns',
      'Recovery patterns',
    ];
    const rendered = JSON.stringify(view.toJSON());
    const positions = titles.map((title) => rendered.indexOf(`"${title}"`));
    positions.forEach((pos, i) => {
      expect(pos).toBeGreaterThan(-1);
      if (i > 0) expect(pos).toBeGreaterThan(positions[i - 1]);
    });
  });

  test('BreakdownTab hides Course Mastery when there is no complete round at any course', async () => {
    const stats = { ...baseStats(), courseMastery: [] };
    const { queryByText } = render(wrap(
      <BreakdownTab stats={stats} onInfo={() => {}} />
    ));

    expect(queryByText('Course Mastery')).toBeNull();
  });
});
