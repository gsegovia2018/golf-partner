import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import DiagnosisCard from '../DiagnosisCard';
import { DRILLS } from '../../../store/coachDrills';
import {
  onePutting, tieStats, teeLeft, fewRounds, noDetail, approachShort, week, driverSwing, focusRecord, verdictOf,
  mkLeak, mkDiagnosis, mkStats,
} from './coachFixtures';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
const ANDROID = { supported: true };
const WEB = { supported: false, reason: 'web' };

const renderCard = (stats, opts = {}, props = {}) => render(wrap(
  <DiagnosisCard
    week={week(stats, opts)}
    diagnosis={stats.coachDiagnosis}
    roundCount={stats.roundCount}
    onCommitFocus={jest.fn()}
    swingSupport={WEB}
    {...props}
  />,
));

describe('DiagnosisCard: untracked-dominant gap', () => {
  const recon = (residualAvg) => ({ strokesGained: { reconciliation: { rounds: 5, gapAvg: -4.3, residualAvg } } });
  test('says most of the gap is untracked, at the top of the Leak step', () => {
    const r = renderCard({ ...onePutting(), ...recon(-3.3) });
    expect(r.getByText(/Most of your gap \(-3\.3 of -4\.3\) is strokes the coach can't see by category/)).toBeTruthy();
  });
  test('says nothing when the top leak is the bigger part', () => {
    const r = renderCard({ ...onePutting(), ...recon(-0.9) });
    expect(r.queryByTestId('untracked-note')).toBeNull();
  });
});

describe('DiagnosisCard: one clear leak', () => {
  test('renders the Leak, Why, Fix and Check rail with the real numbers', () => {
    const stats = onePutting();
    const r = renderCard(stats);
    expect(r.getByText('Fix first')).toBeTruthy();
    ['Leak', 'Why', 'Fix', 'Check'].forEach((step) => expect(r.getByText(step)).toBeTruthy());
    expect(r.getByText('Putting · 6+ m')).toBeTruthy();
    // Leak: strokes a round vs the target, confidence and sample chips
    expect(r.getByText('-1.4')).toBeTruthy();
    expect(r.getByText('strokes a round vs a 15 handicap')).toBeTruthy();
    expect(r.getByText('Putting costs you about 1.4 strokes a round against a 15 handicap, mostly from 6+ m (12 rounds).')).toBeTruthy();
    expect(r.getByText('High confidence')).toBeTruthy();
    expect(r.getByText('12 rounds')).toBeTruthy();
    expect(r.getByText('216 holes')).toBeTruthy();
    // Why: primary cause with its counts and the benchmark, then the alternative
    expect(r.getByText(
      'Most of this comes from putts from 6+ m that three-putt (18 of 58, 31%), averaging 2.5 putts (a 15 handicap averages 2.2).',
    )).toBeTruthy();
    expect(r.getByText(/^One possibility: short putts from 1-2 m/)).toBeTruthy();
  });

  test('Fix lists the drills with level and pass target, the on-course task and the matching tip', () => {
    const r = renderCard(onePutting());
    expect(r.getByText(/^Lag ladder/)).toBeTruthy();
    expect(r.getAllByText(/^Level 1$/).length).toBeGreaterThan(0);
    expect(r.getByText('Pass: 7 of 10 finish inside 1 m of the hole')).toBeTruthy();
    expect(r.getByText('Next round')).toBeTruthy();
    expect(r.getByText('On the course, track every putt from 6+ m and count the three-putts.')).toBeTruthy();
    expect(r.getByTestId('chain-tip')).toBeTruthy();
    expect(r.getByText(/^Lag first from 6\+ m/)).toBeTruthy();
    expect(r.getByText('≈ +0.7 pts / round', { exact: false })).toBeTruthy();
  });

  test('Fix shows at most 3 drills and counts the rest', () => {
    const stats = onePutting();
    const w = week(stats);
    const base = w.chains[0].drills[0];
    w.chains[0].drills = DRILLS.filter((d) => d.area === 'putting').slice(0, 5).map((d) => ({ ...base, drillId: d.id, role: 'focus' }));
    const r = render(wrap(<DiagnosisCard week={w} diagnosis={stats.coachDiagnosis} roundCount={stats.roundCount} swingSupport={WEB} />));
    expect(r.getAllByText(/^Pass: /)).toHaveLength(3);
    expect(r.getByText("+2 more in this week's plan")).toBeTruthy();
    const three = week(stats);
    three.chains[0].drills = w.chains[0].drills.slice(0, 3);
    expect(render(wrap(<DiagnosisCard week={three} diagnosis={stats.coachDiagnosis} roundCount={stats.roundCount} swingSupport={WEB} />)).queryByTestId('fix-more')).toBeNull();
  });

  test('Check at target 0 says scratch, never "a 0 handicap"', () => {
    const stats = onePutting();
    const w = week(stats);
    w.chains[0].check = { ...w.chains[0].check, value: 0.5, unit: 'sgPerShot', benchmark: 1.2, hcp: 0, baseline: null };
    const r = render(wrap(<DiagnosisCard week={w} diagnosis={stats.coachDiagnosis} roundCount={stats.roundCount} swingSupport={WEB} />));
    expect(r.queryByText(/a 0 handicap/)).toBeNull();
    expect(r.getByText(/\(scratch: /)).toBeTruthy();
  });

  test('Check names the metric, now, the benchmark where one exists, and when it re-reads', () => {
    const r = renderCard(onePutting());
    // threePuttRate from 6+ m has no table benchmark: the line is value only
    expect(r.getByText('Three-putt rate from 6+ m: now 31%.')).toBeTruthy();
    expect(r.getByText('Read again after 2 rounds; the verdict settles at 4.')).toBeTruthy();
  });

  test('Check cites the benchmark when a table has the same metric', () => {
    const stats = teeLeft();
    const r = renderCard(stats);
    // missSideShare has no table either; use a putting category leak with the SG metric
    expect(r.queryByText(/a 15 handicap: /)).toBeNull();
    const top = mkLeak('putting', null, -1.1);
    const s2 = mkStats(mkDiagnosis({ leaks: [top] }), { strokesGained: { byCategory: { putting: -1.1 }, roundsByCategory: { putting: 12 }, sampleHolesByCategory: { putting: 216 } } });
    const r2 = renderCard(s2);
    expect(r2.getByText('Putting, strokes gained per round: now -1.10 SG / round (a 15 handicap: 0.00 SG / round).')).toBeTruthy();
  });

  test('the focus button commits { leak, bucket, cause }', () => {
    const stats = onePutting();
    const onCommit = jest.fn();
    const r = renderCard(stats, {}, { onCommitFocus: onCommit });
    fireEvent.press(r.getByLabelText('Make this my focus'));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const arg = onCommit.mock.calls[0][0];
    expect(arg.leak.id).toBe('leak:putting:6+');
    expect(arg.bucket).toBe('6+');
    expect(arg.cause.id).toBe('cause:putting:lag');
    expect(arg.swingId).toBeUndefined();
  });

  test('no focus button without a handler', () => {
    const stats = onePutting();
    const r = render(wrap(<DiagnosisCard week={week(stats)} diagnosis={stats.coachDiagnosis} />));
    expect(r.queryByLabelText('Make this my focus')).toBeNull();
  });
});

describe('DiagnosisCard: two close leaks', () => {
  test('shows both chains and two outline focus buttons', () => {
    const stats = tieStats();
    const onCommit = jest.fn();
    const r = renderCard(stats, {}, { onCommitFocus: onCommit });
    expect(r.getByText('Two leaks too close to call')).toBeTruthy();
    expect(r.getByText(/so the plan splits the week 45 \/ 45/)).toBeTruthy();
    expect(r.getByText('Leak 1 · Approach')).toBeTruthy();
    expect(r.getByText('Leak 2 · Off the tee')).toBeTruthy();
    expect(r.getByTestId('diagnosis-chain-1')).toBeTruthy();
    expect(r.getByTestId('diagnosis-chain-2')).toBeTruthy();
    expect(r.queryByLabelText('Make this my focus')).toBeNull();
    fireEvent.press(r.getByLabelText('Focus: Approach'));
    expect(onCommit.mock.calls[0][0].leak.category).toBe('approach');
    fireEvent.press(r.getByLabelText('Focus: Off the tee'));
    expect(onCommit.mock.calls[1][0].leak.category).toBe('offTheTee');
  });

  test('each chain has its own cause and on-course task', () => {
    const r = renderCard(tieStats());
    expect(r.getByText(/approach shots from 150-200 m, costing 0.6 strokes each/)).toBeTruthy();
    expect(r.getByText(/drives that miss left/)).toBeTruthy();
    expect(r.getByText('On the course, note the club and the result of each approach from 150-200 m.')).toBeTruthy();
    expect(r.getByText('On the course, note each drive that misses left.')).toBeTruthy();
  });
});

describe('DiagnosisCard: few rounds and no shot detail', () => {
  test('few rounds: insufficient rows say what is needed, no focus button', () => {
    const r = renderCard(fewRounds());
    expect(r.getByText('Not enough rounds to rank your leaks yet')).toBeTruthy();
    expect(r.getByText('Each area needs at least 3 rounds and 10 holes with shot detail before the coach ranks it.')).toBeTruthy();
    expect(r.getByText('needs 1 more round')).toBeTruthy();
    expect(r.getByText('needs 1 more round, 4 more holes')).toBeTruthy();
    expect(r.getAllByText('Insufficient')).toHaveLength(2);
    expect(r.queryByLabelText('Make this my focus')).toBeNull();
    expect(r.queryByText('Fix first')).toBeNull();
  });

  test('rounds but no shot detail', () => {
    const r = renderCard(noDetail());
    expect(r.getByText('No shot detail yet')).toBeTruthy();
    expect(r.getByText('6 rounds scored, but no putts or approaches logged, so nothing can be priced against your target.')).toBeTruthy();
    expect(r.getByText('Turn on putting and approach tracking in Settings, then log them for 3 rounds.')).toBeTruthy();
  });

  test('a candidate under the leak floor is named, not ranked', () => {
    const candidate = mkLeak('putting', null, -0.3, { sample: { rounds: 12, holes: 11 } });
    const stats = mkStats(mkDiagnosis({ candidate }));
    const r = renderCard(stats);
    expect(r.getByText('Nothing clearly costs you yet')).toBeTruthy();
    expect(r.getByText('The biggest candidate is Putting at 0.3 strokes a round, from 11 holes. That is too small to call a leak.')).toBeTruthy();
  });
});

describe('DiagnosisCard: focus in progress', () => {
  test('wears the focus badge, shows the committed metric and hides the buttons', () => {
    const stats = approachShort();
    stats.approachMissByDistance.buckets['100-150'].shortRate = 48;
    const r = renderCard(stats, { focus: focusRecord(), verdict: verdictOf() }, { focusActive: true });
    expect(r.getByText('Your focus')).toBeTruthy();
    expect(r.queryByText('Fix first')).toBeNull();
    expect(r.queryByLabelText('Make this my focus')).toBeNull();
    expect(r.getByText('Short misses from 100-150 m: now 48%, was 71% when you committed.')).toBeTruthy();
    // level 2 drills carry the level 2 pass target
    expect(r.getAllByText(/^Level 2$/).length).toBeGreaterThan(0);
    expect(r.getByText('Pass: 10 of 15 inside a green-sized 12 m circle')).toBeTruthy();
  });
});

describe('DiagnosisCard: the swing line (six states)', () => {
  const props = (over) => ({ swingSupport: ANDROID, onRecordSwing: jest.fn(), onOpenSwing: jest.fn(), ...over });

  test('linked: names the swing and opens its results', () => {
    const onOpenSwing = jest.fn();
    const r = renderCard(teeLeft(), { swings: [driverSwing()] }, props({ onOpenSwing }));
    expect(r.getByText('Swing')).toBeTruthy();
    expect(r.getByText('Your driver swing recorded 4 Oct shows over the top, the fault that usually causes this.')).toBeTruthy();
    fireEvent.press(r.getByLabelText('Open swing analysis'));
    expect(onOpenSwing).toHaveBeenCalledWith('sw-driver');
  });

  test('linked swing id travels with the committed focus', () => {
    const onCommit = jest.fn();
    const r = renderCard(teeLeft(), { swings: [driverSwing()] }, props({ onCommitFocus: onCommit }));
    fireEvent.press(r.getByLabelText('Make this my focus'));
    expect(onCommit.mock.calls[0][0].swingId).toBe('sw-driver');
  });

  test('stale: says it is old and offers a new recording', () => {
    const onRecordSwing = jest.fn();
    const r = renderCard(teeLeft(), { swings: [driverSwing({ createdAt: '2026-07-01T10:00:00.000Z' })] }, props({ onRecordSwing }));
    expect(r.getByText(/but it is old now\.$/)).toBeTruthy();
    fireEvent.press(r.getByLabelText('Record a swing with the driver'));
    expect(onRecordSwing).toHaveBeenCalledTimes(1);
  });

  test('wrong club: names the last club and asks for the right one', () => {
    const r = renderCard(teeLeft(), { swings: [driverSwing({ id: 'sw-iron', club: 'iron', mainFault: 'flip' })] }, props());
    expect(r.getByText('Your last swing was with the iron. Record one with the driver to test this.')).toBeTruthy();
    expect(r.getByLabelText('Record a swing with the driver')).toBeTruthy();
  });

  test('none on Android: record button navigates', () => {
    const onRecordSwing = jest.fn();
    const r = renderCard(teeLeft(), { swings: [] }, props({ onRecordSwing }));
    expect(r.getByText('No swing recorded with the driver yet.')).toBeTruthy();
    fireEvent.press(r.getByLabelText('Record a swing with the driver'));
    expect(onRecordSwing).toHaveBeenCalledTimes(1);
  });

  test('none on web: a plain line, no record button', () => {
    const r = renderCard(teeLeft(), { swings: [] }, { swingSupport: WEB, onRecordSwing: jest.fn() });
    expect(r.getByTestId('swing-unavailable')).toBeTruthy();
    expect(r.getByText(/^Swing analysis runs on the phone app\. Record a swing with the driver there/)).toBeTruthy();
    expect(r.queryByLabelText('Record a swing with the driver')).toBeNull();
  });

  test('none on a binary that needs an update', () => {
    const r = renderCard(teeLeft(), { swings: [] }, { swingSupport: { supported: false, reason: 'update' }, onRecordSwing: jest.fn() });
    expect(r.getByText('Swing analysis needs an app update on your phone before it can check this leak.')).toBeTruthy();
    expect(r.queryByLabelText('Record a swing with the driver')).toBeNull();
  });

  test('not a swing cause: no swing line at all', () => {
    const r = renderCard(onePutting(), { swings: [] }, props());
    expect(r.queryByTestId('swing-line')).toBeNull();
  });

  test('swing only: a recent fault the leak does not point at is a plain line without a button', () => {
    const r = renderCard(onePutting(), { swings: [driverSwing({ mainFault: 'early_extension' })] }, props());
    expect(r.getByText(/showed early extension\. That is not part of this leak/)).toBeTruthy();
    expect(r.queryByLabelText('Open swing analysis')).toBeNull();
    expect(r.queryByLabelText('Record a swing with the driver')).toBeNull();
  });

  test('the swing drill joins the Fix step when linked', () => {
    const r = renderCard(teeLeft(), { swings: [driverSwing()], minutesPerWeek: 90 }, props());
    expect(r.getAllByText('Swing drill').length).toBeGreaterThan(0);
  });
});

describe('DiagnosisCard: renders nothing without a week', () => {
  test('null week', () => {
    expect(render(wrap(<DiagnosisCard week={null} />)).toJSON()).toBeNull();
  });
});
