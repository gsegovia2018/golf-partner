import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import DiagnosisCard from '../DiagnosisCard';
import { DRILLS } from '../../../store/coachDrills';
import { drillText } from '../msg';
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

const openWhy = (r) => fireEvent.press(r.getByTestId('why-row'));

// Words on the card surface, the card title and the drill name left out.
const surfaceText = (r, drillTitle) => {
  const out = [];
  const walk = (node) => {
    if (typeof node === 'string') out.push(node);
    else if (node?.children) node.children.forEach(walk);
  };
  walk(r.toJSON());
  return out.join(' ').replace('Diagnosis', ' ').replace(drillTitle, ' ');
};
const wordCount = (text) => text.split(/\s+/).filter((w) => /[A-Za-z0-9À-ÿ]/.test(w)).length;

describe('DiagnosisCard: the verdict surface (one clear leak)', () => {
  test('headline, stat line, the two bars, one drill, Why and the focus button', () => {
    const r = renderCard(onePutting());
    expect(r.getByText('Fix first')).toBeTruthy();
    expect(r.getByText('Three-putts from 6+ m')).toBeTruthy();
    expect(r.getByText('-1.4')).toBeTruthy();
    expect(r.getByText('strokes a round')).toBeTruthy();
    // the pair: you against a 15, numbers in text
    ['You', 'A 15', '2.5', '2.2', 'putts per try'].forEach((x) => expect(r.getByText(x)).toBeTruthy());
    expect(r.getByTestId('do-row')).toHaveTextContent(/^Do this: Lag ladder/);
    expect(r.getByText('15 min', { exact: false })).toBeTruthy();
    expect(r.getByText('Why')).toBeTruthy();
    expect(r.getByText('Work on this')).toBeTruthy();
  });

  test('the old chain is gone from the card: rail, symptom, cause, pass target, task, tip, check, focus line', () => {
    const r = renderCard(onePutting());
    ['Leak', 'Fix', 'Check', 'Next round'].forEach((x) => expect(r.queryByText(x)).toBeNull());
    expect(r.queryByText(/costs you about/)).toBeNull();
    expect(r.queryByText(/Most of this comes from/)).toBeNull();
    expect(r.queryByText(/^Pass: /)).toBeNull();
    expect(r.queryByText(/On the course, track every putt/)).toBeNull();
    expect(r.queryByTestId('chain-tip')).toBeNull();
    expect(r.queryByTestId('focus-explain')).toBeNull();
    expect(r.queryByText('High confidence')).toBeNull();
  });

  test('the bars are decorative: hidden from accessibility, the numbers are text', () => {
    const r = renderCard(onePutting());
    const hidden = r.UNSAFE_getAllByProps({ accessibilityElementsHidden: true });
    expect(hidden.length).toBeGreaterThanOrEqual(2);
    expect(r.getByTestId('cause-pair')).toHaveTextContent(/You.*2\.5.*A 15.*2\.2.*putts per try/);
  });

  test('a cause without a benchmark draws one bar with its count', () => {
    const r = renderCard(approachShort());
    expect(r.getByText('22 of 31 misses short')).toBeTruthy();
    expect(r.queryByText('You')).toBeNull();
  });

  test('at target 0 the reference is Scratch', () => {
    const stats = onePutting();
    const w = week(stats);
    w.chains[0].causes.primary = { ...w.chains[0].causes.primary, benchmark: { source: 'target', targetHandicap: 0, expectedPutts: 2.0 } };
    const r = render(wrap(<DiagnosisCard week={w} diagnosis={stats.coachDiagnosis} swingSupport={WEB} />));
    expect(r.getByText('Scratch')).toBeTruthy();
    expect(r.queryByText(/^A 0/)).toBeNull();
  });

  test('without a cause the headline is the area and the bucket, and there are no bars', () => {
    const stats = mkStats(mkDiagnosis({ leaks: [mkLeak('aroundGreen', null, -1.0)] }));
    const r = renderCard(stats);
    expect(r.getByText('Short game')).toBeTruthy();
    expect(r.queryByTestId('cause-pair')).toBeNull();
    expect(r.getByTestId('do-row')).toBeTruthy();
  });

  test('the focus button commits { leak, bucket, cause }', () => {
    const stats = onePutting();
    const onCommit = jest.fn();
    const r = renderCard(stats, {}, { onCommitFocus: onCommit });
    fireEvent.press(r.getByLabelText('Work on this'));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const arg = onCommit.mock.calls[0][0];
    expect(arg.leak.id).toBe('leak:putting:6+');
    expect(arg.bucket).toBe('6+');
    expect(arg.cause.id).toBe('cause:putting:lag');
    expect(arg.swingId).toBeUndefined();
  });

  test('no focus button without a handler, and none while a focus is active', () => {
    const stats = onePutting();
    expect(render(wrap(<DiagnosisCard week={week(stats)} diagnosis={stats.coachDiagnosis} />)).queryByLabelText('Work on this')).toBeNull();
    expect(renderCard(stats, {}, { focusActive: true }).queryByLabelText('Work on this')).toBeNull();
  });

  test('Do this and Why are 44 px buttons', () => {
    const r = renderCard(onePutting());
    ['do-row', 'why-row'].forEach((id) => {
      const row = r.getByTestId(id);
      expect(row.props.accessibilityRole).toBe('button');
      expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(44);
    });
  });
});

describe('DiagnosisCard: word budget', () => {
  test('the clear-leak surface stays within 30 words, drill name and card title excluded', () => {
    const stats = onePutting();
    const w = week(stats);
    const drill = w.chains[0].drills.find((d) => d.source !== 'swing') ?? w.chains[0].drills[0];
    const title = drillText(DRILLS.find((d) => d.id === drill.drillId), 'title');
    const r = render(wrap(<DiagnosisCard week={w} diagnosis={stats.coachDiagnosis} roundCount={12} onCommitFocus={jest.fn()} swingSupport={WEB} />));
    const text = surfaceText(r, title);
    expect(wordCount(text)).toBeLessThanOrEqual(30);
  });
});

describe('DiagnosisCard: the Why sheet', () => {
  test('stays closed until Why is pressed', () => {
    const r = renderCard(onePutting());
    expect(r.queryByTestId('why-sheet-title')).toBeNull();
    openWhy(r);
    expect(r.getByTestId('why-sheet-title')).toHaveTextContent('Three-putts from 6+ m');
  });

  test('holds the cause, the other possibility, the evidence, the check and what the coach does next', () => {
    const r = renderCard(onePutting());
    openWhy(r);
    expect(r.getByText('Putting · 6+ m · -1.4 strokes a round vs a 15 handicap')).toBeTruthy();
    expect(r.getByText(
      'Most of this comes from putts from 6+ m that three-putt (18 of 58, 31%), averaging 2.5 putts (a 15 handicap averages 2.2).',
    )).toBeTruthy();
    expect(r.getByText(/^One possibility: short putts from 1-2 m/)).toBeTruthy();
    expect(r.getByText('Evidence')).toBeTruthy();
    expect(r.getByText('High confidence')).toBeTruthy();
    expect(r.getByText('12 rounds')).toBeTruthy();
    expect(r.getByText('216 holes')).toBeTruthy();
    expect(r.getByText('Three-putt rate from 6+ m: now 31%.')).toBeTruthy();
    expect(r.getByText('Read again after 2 rounds; the verdict settles at 4.')).toBeTruthy();
    expect(r.getByTestId('focus-explain')).toHaveTextContent(
      "The coach tracks three-putt rate from 6+ m over your next rounds, tells you after 2 rounds if it's improving, and levels up your plan.",
    );
  });

  test('says when most of the gap is untracked', () => {
    const recon = (residualAvg) => ({ strokesGained: { reconciliation: { rounds: 5, gapAvg: -4.3, residualAvg } } });
    const r = renderCard({ ...onePutting(), ...recon(-3.3) });
    expect(r.queryByTestId('untracked-note')).toBeNull();
    openWhy(r);
    expect(r.getByText(/Most of your gap \(-3\.3 of -4\.3\) is strokes the coach can't see by category/)).toBeTruthy();
    const quiet = renderCard({ ...onePutting(), ...recon(-0.9) });
    openWhy(quiet);
    expect(quiet.queryByTestId('untracked-note')).toBeNull();
  });

  test('Check at target 0 says scratch, never "a 0 handicap"', () => {
    const stats = onePutting();
    const w = week(stats);
    w.chains[0].check = { ...w.chains[0].check, value: 0.5, unit: 'sgPerShot', benchmark: 1.2, hcp: 0, baseline: null };
    const r = render(wrap(<DiagnosisCard week={w} diagnosis={stats.coachDiagnosis} roundCount={stats.roundCount} swingSupport={WEB} />));
    openWhy(r);
    expect(r.queryByText(/a 0 handicap/)).toBeNull();
    expect(r.getByText(/\(scratch: /)).toBeTruthy();
  });

  test('Check cites the benchmark when a table has the same metric', () => {
    const top = mkLeak('putting', null, -1.1);
    const s2 = mkStats(mkDiagnosis({ leaks: [top] }), { strokesGained: { byCategory: { putting: -1.1 }, roundsByCategory: { putting: 12 }, sampleHolesByCategory: { putting: 216 } } });
    const r2 = renderCard(s2);
    openWhy(r2);
    expect(r2.getByText('Putting, strokes gained per round: now -1.10 SG / round (a 15 handicap: 0.00 SG / round).')).toBeTruthy();
  });

  test('no explanation without a focus button', () => {
    const r = renderCard(onePutting(), {}, { focusActive: true });
    openWhy(r);
    expect(r.queryByTestId('focus-explain')).toBeNull();
    expect(r.getByText('Three-putt rate from 6+ m: now 31%.')).toBeTruthy();
  });
});

describe('DiagnosisCard: two close leaks', () => {
  test('two compact blocks, one Why row and two outline focus buttons', () => {
    const stats = tieStats();
    const onCommit = jest.fn();
    const r = renderCard(stats, {}, { onCommitFocus: onCommit });
    expect(r.getByText('Two leaks too close to call')).toBeTruthy();
    expect(r.getByTestId('diagnosis-chain-1')).toHaveTextContent(/Approaches from 150-200 m.*-0\.9.*strokes a round/);
    expect(r.getByTestId('diagnosis-chain-2')).toHaveTextContent(/Drives missing left.*-0\.8.*strokes a round/);
    expect(r.getAllByTestId('do-row')).toHaveLength(2);
    expect(r.getAllByTestId('why-row')).toHaveLength(1);
    expect(r.queryByText(/so the plan splits the week 45 \/ 45/)).toBeNull();
    expect(r.queryByLabelText('Work on this')).toBeNull();
    fireEvent.press(r.getByLabelText('Work on Approach'));
    expect(onCommit.mock.calls[0][0].leak.category).toBe('approach');
    fireEvent.press(r.getByLabelText('Work on Off the tee'));
    expect(onCommit.mock.calls[1][0].leak.category).toBe('offTheTee');
  });

  test('the sheet shows both leaks with the split and explains the focus once, generically', () => {
    const r = renderCard(tieStats());
    openWhy(r);
    expect(r.getByText(/so the plan splits the week 45 \/ 45/)).toBeTruthy();
    expect(r.getByText('Leak 1 · Approach')).toBeTruthy();
    expect(r.getByText('Leak 2 · Off the tee')).toBeTruthy();
    expect(r.getByText(/approach shots from 150-200 m, costing 0.6 strokes each/)).toBeTruthy();
    expect(r.getByText(/drives that miss left/)).toBeTruthy();
    expect(r.getAllByTestId('focus-explain')).toHaveLength(1);
    expect(r.getByTestId('focus-explain')).toHaveTextContent(/^The coach tracks its metric over your next rounds, tells you after 2 rounds/);
  });
});

describe('DiagnosisCard: few rounds and no shot detail', () => {
  test('few rounds: the needs rows and one logging ask, no focus button', () => {
    const r = renderCard(fewRounds());
    expect(r.getByText('Not enough rounds to rank your leaks yet')).toBeTruthy();
    expect(r.getByText('needs 1 more round')).toBeTruthy();
    expect(r.getByText('needs 1 more round, 4 more holes')).toBeTruthy();
    expect(r.getByText('Log one more round with shot detail')).toBeTruthy();
    expect(r.queryByText('Insufficient')).toBeNull();
    expect(r.queryByTestId('why-row')).toBeNull();
    expect(r.queryByLabelText('Work on this')).toBeNull();
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
  test('wears the focus badge and draws the pair from the check baseline, like the focus card', () => {
    const stats = approachShort();
    stats.approachMissByDistance.buckets['100-150'].shortRate = 48;
    const r = renderCard(stats, { focus: focusRecord(), verdict: verdictOf() }, { focusActive: true });
    expect(r.getByText('Your focus')).toBeTruthy();
    expect(r.queryByText('Fix first')).toBeNull();
    expect(r.queryByLabelText('Work on this')).toBeNull();
    expect(r.getByTestId('cause-pair')).toHaveTextContent(/Now.*48%.*At start.*71%.*Short misses from 100-150 m/);
    openWhy(r);
    expect(r.getByText('Short misses from 100-150 m: now 48%, was 71% when you committed.')).toBeTruthy();
  });

  test('the drill row carries the level 2 pass target in its sheet', () => {
    const stats = approachShort();
    const r = renderCard(stats, { focus: focusRecord(), verdict: verdictOf() }, { focusActive: true });
    fireEvent.press(r.getByTestId('do-row'));
    expect(r.getAllByText('10 of 15 inside a green-sized 12 m circle').length).toBeGreaterThan(0);
    expect(r.getByTestId('drill-level-2')).toHaveTextContent(/your level/);
  });
});

describe('DiagnosisCard: the swing', () => {
  const props = (over) => ({ swingSupport: ANDROID, onRecordSwing: jest.fn(), onOpenSwing: jest.fn(), ...over });

  test('linked: one compact row on the card that opens the analysis', () => {
    const onOpenSwing = jest.fn();
    const r = renderCard(teeLeft(), { swings: [driverSwing()] }, props({ onOpenSwing }));
    expect(r.getByTestId('swing-row')).toHaveTextContent(/^Swing: Over the top · driver, 4 Oct/);
    expect(r.queryByText(/the fault that usually causes this/)).toBeNull();
    fireEvent.press(r.getByLabelText('Open swing analysis'));
    expect(onOpenSwing).toHaveBeenCalledWith('sw-driver');
  });

  test('linked: the sheet carries the sentence and its own open action', () => {
    const onOpenSwing = jest.fn();
    const r = renderCard(teeLeft(), { swings: [driverSwing()] }, props({ onOpenSwing }));
    openWhy(r);
    expect(r.getByText('Your driver swing recorded 4 Oct shows over the top, the fault that usually causes this.')).toBeTruthy();
    expect(r.getAllByLabelText('Open swing analysis')).toHaveLength(2);
    fireEvent.press(r.getAllByLabelText('Open swing analysis')[1]);
    expect(onOpenSwing).toHaveBeenCalledWith('sw-driver');
  });

  test('linked swing id travels with the committed focus', () => {
    const onCommit = jest.fn();
    const r = renderCard(teeLeft(), { swings: [driverSwing()] }, props({ onCommitFocus: onCommit }));
    fireEvent.press(r.getByLabelText('Work on this'));
    expect(onCommit.mock.calls[0][0].swingId).toBe('sw-driver');
  });

  test('stale: nothing on the card, the sheet says it is old and offers a new recording', () => {
    const onRecordSwing = jest.fn();
    const r = renderCard(teeLeft(), { swings: [driverSwing({ createdAt: '2026-07-01T10:00:00.000Z' })] }, props({ onRecordSwing }));
    expect(r.queryByTestId('swing-row')).toBeNull();
    openWhy(r);
    expect(r.getByText(/but it is old now\.$/)).toBeTruthy();
    fireEvent.press(r.getByLabelText('Record a swing with the driver'));
    expect(onRecordSwing).toHaveBeenCalledTimes(1);
  });

  test('wrong club: names the last club and asks for the right one', () => {
    const r = renderCard(teeLeft(), { swings: [driverSwing({ id: 'sw-iron', club: 'iron', mainFault: 'flip' })] }, props());
    openWhy(r);
    expect(r.getByText('Your last swing was with the iron. Record one with the driver to test this.')).toBeTruthy();
    expect(r.getByLabelText('Record a swing with the driver')).toBeTruthy();
  });

  test('none on Android: record button navigates', () => {
    const onRecordSwing = jest.fn();
    const r = renderCard(teeLeft(), { swings: [] }, props({ onRecordSwing }));
    openWhy(r);
    expect(r.getByText('No swing recorded with the driver yet.')).toBeTruthy();
    fireEvent.press(r.getByLabelText('Record a swing with the driver'));
    expect(onRecordSwing).toHaveBeenCalledTimes(1);
  });

  test('none on web: a plain line, no record button', () => {
    const r = renderCard(teeLeft(), { swings: [] }, { swingSupport: WEB, onRecordSwing: jest.fn() });
    openWhy(r);
    expect(r.getByTestId('swing-unavailable')).toBeTruthy();
    expect(r.getByText(/^Swing analysis runs on the phone app\. Record a swing with the driver there/)).toBeTruthy();
    expect(r.queryByLabelText('Record a swing with the driver')).toBeNull();
  });

  test('none on a binary that needs an update', () => {
    const r = renderCard(teeLeft(), { swings: [] }, { swingSupport: { supported: false, reason: 'update' }, onRecordSwing: jest.fn() });
    openWhy(r);
    expect(r.getByText('Swing analysis needs an app update on your phone before it can check this leak.')).toBeTruthy();
    expect(r.queryByLabelText('Record a swing with the driver')).toBeNull();
  });

  test('not a swing cause: no swing line at all', () => {
    const r = renderCard(onePutting(), { swings: [] }, props());
    expect(r.queryByTestId('swing-row')).toBeNull();
    openWhy(r);
    expect(r.queryByTestId('swing-line')).toBeNull();
  });

  test('swing only: a recent fault the leak does not point at stays in the sheet, without a button', () => {
    const r = renderCard(onePutting(), { swings: [driverSwing({ mainFault: 'early_extension' })] }, props());
    expect(r.queryByTestId('swing-row')).toBeNull();
    openWhy(r);
    expect(r.getByText(/showed early extension\. That is not part of this leak/)).toBeTruthy();
    expect(r.queryByLabelText('Open swing analysis')).toBeNull();
    expect(r.queryByLabelText('Record a swing with the driver')).toBeNull();
  });
});

describe('DiagnosisCard: drill detail sheet', () => {
  test('Do this opens the sheet with the instruction and three levels', () => {
    const r = renderCard(onePutting());
    expect(r.queryByText('How to do it')).toBeNull();
    fireEvent.press(r.getByTestId('do-row'));
    expect(r.getByText('How to do it')).toBeTruthy();
    expect(r.getByText(/^Take 10 putts from 8 m to one hole/)).toBeTruthy();
    expect(r.getByText('Pass target')).toBeTruthy();
    [1, 2, 3].forEach((n) => expect(r.getByTestId(`drill-level-${n}`)).toBeTruthy());
    expect(r.getByText('8 of 10 finish inside 1 m of the hole, from 10 m')).toBeTruthy();
    expect(r.getAllByText(/your level/)).toHaveLength(1);
    expect(r.getByTestId('drill-level-1')).toHaveTextContent(/your level/);
  });

  test('a swing drill shows its instruction and pass target, no levels', () => {
    const stats = teeLeft();
    const w = week(stats, { swings: [driverSwing()], minutesPerWeek: 90 });
    const swingDrill = w.chains[0].drills.find((d) => d.source === 'swing');
    w.chains[0].drills = [swingDrill];
    const r = render(wrap(<DiagnosisCard week={w} diagnosis={stats.coachDiagnosis} swingSupport={ANDROID} />));
    fireEvent.press(r.getByTestId('do-row'));
    expect(r.getByText('How to do it')).toBeTruthy();
    expect(r.getByText('Pass target')).toBeTruthy();
    expect(r.queryByTestId('drill-level-1')).toBeNull();
    expect(r.queryByText(/your level/)).toBeNull();
  });
});

describe('DiagnosisCard: renders nothing without a week', () => {
  test('null week', () => {
    expect(render(wrap(<DiagnosisCard week={null} />)).toJSON()).toBeNull();
  });
});
