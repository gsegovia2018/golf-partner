import 'react-native-gesture-handler/jestSetup';
import React from 'react';
import { Alert } from 'react-native';
import {
  act, fireEvent, render, waitFor, within,
} from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { ThemeProvider } from '../../theme/ThemeContext';
import SwingResultsScreen from '../SwingResultsScreen';
import * as store from '../../store/swingStore';
import { runAnalysis } from '../../swing/runAnalysis';
import { shareSwingExport } from '../../swing/shareExport';
import { getStill, ensureStills, nativeApi } from '../../swing/frames';
import { analyze } from '../../swing/analyze';
import { SWING_STRINGS } from '../../swing/strings';
import { emptyMarks, frameLabel, withFrame } from '../../swing/labels';
import { fixesFor, fixCopy } from '../../swing/fixes';
import { drillsForMain } from '../../swing/drills';
import { STEPS } from '../../swing/resultsSteps';
import { markedFromMarks } from '../../swing/markPass';
import {
  fixtureNative, TRUTH, W, H,
} from '../../swing/__tests__/helpers';
import { setLanguagePref } from '../../i18n';
import { shareSwing, unshareSwing, deleteSharedSwing } from '../../store/swingShareStore';

const lab = require('../../swing/__tests__/fixtures/lab-d15-pass1.json');

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children }) => React.createElement(React.Fragment, null, children),
    useSafeAreaInsets: () => ({
      top: 0, right: 0, bottom: 0, left: 0,
    }),
  };
});
jest.mock('../../store/swingStore', () => ({
  subscribeSwings: jest.fn(() => () => {}),
  getSwingsVersion: jest.fn(() => 0),
  getSwing: jest.fn(),
  hydrateSwings: jest.fn(() => Promise.resolve()),
  renameSwing: jest.fn(() => Promise.resolve()),
  readAnalysis: jest.fn(),
  readPose: jest.fn(),
  readProbe: jest.fn(),
  readMarks: jest.fn(),
  saveAnalysis: jest.fn(),
  saveMarks: jest.fn(() => Promise.resolve()),
  getSwingProfile: jest.fn(() => ({ practiceOpen: false })),
  setPracticeOpen: jest.fn(() => Promise.resolve(true)),
  markSwingFailed: jest.fn(() => Promise.resolve()),
  hasCustomName: jest.requireActual('../../store/swingStore').hasCustomName,
  defaultSwingName: jest.requireActual('../../store/swingStore').defaultSwingName,
  deleteSwing: jest.fn(() => Promise.resolve()),
  swingVideoUri: jest.fn(() => 'file:///doc/swings/s1/video.mp4'),
}));
jest.mock('../../swing/shareExport', () => ({ shareSwingExport: jest.fn(() => Promise.resolve('shared')) }));
jest.mock('../../store/swingShareStore', () => ({
  shareSwing: jest.fn(() => Promise.resolve('TOKEN')),
  unshareSwing: jest.fn(() => Promise.resolve()),
  deleteSharedSwing: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../swing/runAnalysis', () => ({ runAnalysis: jest.fn() }));
jest.mock('../../swing/frames', () => ({
  nativeApi: jest.fn(() => ({ cancelAnalysis: jest.fn() })),
  getStill: jest.fn(() => null),
  ensureStills: jest.fn(() => Promise.resolve({})),
}));

const T = SWING_STRINGS.results;
const norm = (p) => (p ? [p.x / W, p.y / H] : null);
const ball = { x: TRUTH.ball.x / W, y: TRUTH.ball.y / H, r: 2.1 / W };
const pose = fixtureNative({ ball, ballGoneFrame: lab.expected.ballGoneFrame });
const base = {
  pass2: { addressFrame: lab.expected.addressFrame, shaft: {} }, heightCm: 176, handedness: 'right', swingId: 's1', createdAt: '2026-10-11T16:42:00.000Z',
};
const ownerMarks = Object.fromEntries(Object.entries(TRUTH.checkpoints).map(([k, c]) => [k, {
  hands: norm(c.hands), head: c.hidden ? null : norm(c.head), hidden: c.hidden,
}]));
const MARKED = analyze(pose, { ...base, marks: ownerMarks });
const UNMARKED = analyze(pose, base);
// the detector saw something at the Downswing, under the checks' gate: proposed to the golfer, not read
const SUBGATE = analyze(pose, {
  ...base,
  pass2: { ...base.pass2, shaft: { [UNMARKED.checkpoints.shaftDown.i]: { head: [W * 0.6, H * 0.62], hidden: false, conf: 0.05, source: 'model' } } },
});
// every measured check green: nothing to fix
const ALLGREEN = {
  ...MARKED,
  main: null,
  counts: { red: 0, yellow: 0, green: MARKED.checks.length, unknown: 0 },
  checks: MARKED.checks.map((c) => ({ ...c, status: 'green' })),
};
// no fault, but a position the owner hid the clubhead at is not measured
const GREEN_SOME_UNKNOWN = { ...ALLGREEN, checks: MARKED.checks.map((c) => (c.status === 'unknown' ? c : { ...c, status: 'green' })) };
const NOTHING = { ...MARKED, main: null, checks: MARKED.checks.map((c) => ({ ...c, status: 'unknown', reason: 'hidden' })) };

// marks.json as Edit marks wrote it: the owner's hands and clubheads (what a re-score reads back).
const OWNER_MARKS = Object.entries(TRUTH.checkpoints).map(([k, c]) => [k, c.frame, c.hands, c.hidden ? null : c.head, c.hidden])
  .reduce((m, [k, i, hands, head, hidden]) => withFrame(m, frameLabel({
    i, checkpoint: k, hands: { proposed: null, final: norm(hands), placed: true }, head: { proposed: null, final: norm(head), finalHidden: hidden },
  })), emptyMarks({ swingId: 's1' }));

const ROW = {
  id: 's1', name: 'Sat 11 Oct · 18:42', createdAt: '2026-10-11T16:42:00.000Z', status: 'ready', club: null, source: 'import', marked: { state: 'done', count: 7 },
};

function setup({ row = ROW, analysis = MARKED, marks = OWNER_MARKS } = {}) {
  store.getSwing.mockReturnValue(row);
  store.readAnalysis.mockResolvedValue(analysis);
  store.readPose.mockResolvedValue({ ...pose, pass2: base.pass2 });
  store.readProbe.mockResolvedValue(null);
  store.readMarks.mockResolvedValue(marks);
  store.saveAnalysis.mockImplementation(async (_id, a) => { store.readAnalysis.mockResolvedValue(a); });
  store.saveMarks.mockImplementation(async (_id, m) => { store.readMarks.mockResolvedValue(m); });
  const navigation = {
    navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn(), addListener: jest.fn(() => () => {}),
  };
  const utils = render(<ThemeProvider><SwingResultsScreen navigation={navigation} route={{ params: { swingId: 's1' } }} /></ThemeProvider>);
  return { ...utils, navigation };
}

const labelOf = (id) => SWING_STRINGS.checkLabel[id];
const FIXES = fixesFor(MARKED);
const cpName = (k) => SWING_STRINGS.checkpoint[k];
const faultName = (a) => SWING_STRINGS.fault[a.main.fault];
const MAIN_AT = MARKED.main.position;
const textOf = (n) => [n.props.children].flat(Infinity).map((c) => (c && typeof c === 'object' ? textOf(c) : c ?? '')).join('');
const HEADLINE = faultName(MARKED); // the verdict: the fault's name is the headline (polish), owner swing
const verdictLabel = (u) => textOf(u.getByTestId('results-verdict-label'));
const ready = (u) => u.findByTestId('results-summary');
const goStep = (u, k) => fireEvent.press(u.getByTestId(`summary-step-${k}`));
const posBar = (u) => u.getByTestId('position-bar').props.accessibilityLabel;
const swipe = async (dx, dy = 0) => {
  await act(async () => {
    fireGestureHandler(getByGestureTestId('step-swipe'), [
      { state: State.BEGAN },
      { state: State.ACTIVE, translationX: dx, translationY: dy },
      { state: State.END, translationX: dx, translationY: dy },
    ]);
  });
};
const tapStill = async (x = 120, y = 140) => {
  await act(async () => {
    fireGestureHandler(getByGestureTestId('place-tap'), [
      { state: State.BEGAN, x, y }, { state: State.ACTIVE, x, y }, { state: State.END, x, y },
    ]);
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  getStill.mockReturnValue(null);
  ensureStills.mockResolvedValue({});
});

describe('SwingResultsScreen: the summary and the stepper (checks v2, design D)', () => {
  test('opens on the main fault: the headline, where it likely starts, one position below', async () => {
    const u = setup();
    await ready(u);
    expect(textOf(u.getByTestId('results-headline'))).toBe(HEADLINE);
    expect(verdictLabel(u)).toBe(T.workFirst);
    expect(posBar(u)).toBe(T.posOf(cpName(MAIN_AT), STEPS.indexOf(MAIN_AT) + 1, 8));
    expect(u.getByTestId(`summary-step-${MAIN_AT}`).props.accessibilityState).toMatchObject({ selected: true });
    expect(MARKED.main.startsAt).toBeTruthy();
    expect(textOf(u.getByTestId('results-starts-at'))).toBe(` · ${T.startsAtShort(cpName(MARKED.main.startsAt))} ›`);
    expect(u.getByTestId('results-starts-at').props.accessibilityLabel).toBe(T.startsAt(cpName(MARKED.main.startsAt)));
    expect(u.getByTestId('results-fix-peek')).toBeTruthy(); // the fix of the row on screen
    expect(u.queryByTestId('place-box')).toBeNull(); // the Impact clubhead is the owner's: nothing to place
  });

  test('eight dots in swing order, each a tab with its name and status word; the main fault and its start are tagged', async () => {
    const u = setup();
    await ready(u);
    STEPS.forEach((k) => expect(u.getByTestId(`summary-step-${k}`)).toBeTruthy());
    expect(u.getByTestId(`summary-step-${MAIN_AT}`).props.accessibilityLabel).toBe(`${T.stepA11y(cpName(MAIN_AT), SWING_STRINGS.statusWord.red)}, ${T.tagFirst}`);
    expect(u.getByTestId(`summary-step-${MARKED.main.startsAt}`).props.accessibilityLabel).toMatch(new RegExp(`${T.tagStarts}$`));
    ['Address', 'Takeaway', 'Halfway', 'Top', 'Down', 'Impact', 'Finish', 'Extras'].forEach((n) => expect(u.getAllByText(n).length).toBeGreaterThan(0));
    expect(u.queryByLabelText(/^Transition|^Shaft through/)).toBeNull(); // P5 and P8 are gone
  });

  test('a tap on a dot jumps to that position and resets the nudge', async () => {
    const u = setup();
    await ready(u);
    fireEvent.press(u.getByLabelText(T.nextFrame));
    expect(u.getByText(/\(\+1\)/)).toBeTruthy();
    goStep(u, 'top');
    expect(posBar(u)).toBe(T.posOf(cpName('top'), 4, 8));
    expect(() => u.getByText(/\(\+1\)/)).toThrow();
    goStep(u, MARKED.main.startsAt);
    expect(posBar(u)).toMatch(new RegExp(`^${cpName(MARKED.main.startsAt)},`));
  });

  test('the "likely starts at" line jumps to that position', async () => {
    const u = setup();
    await ready(u);
    fireEvent.press(u.getByTestId('results-starts-at'));
    expect(posBar(u)).toMatch(new RegExp(`^${cpName(MARKED.main.startsAt)},`));
  });

  test('swipes step to the neighbours and stop at both ends (the strip\'s tabs are the non-gesture path)', async () => {
    const u = setup({ analysis: ALLGREEN }); // opens on Address
    await ready(u);
    expect(posBar(u)).toBe(T.posOf(cpName('address'), 1, 8));
    await swipe(90); // previous: nothing before Address
    expect(posBar(u)).toBe(T.posOf(cpName('address'), 1, 8));
    for (let i = 0; i < 8; i += 1) await swipe(-90);
    expect(posBar(u)).toBe(T.posOf(T.extras, 8, 8)); // and nothing after Extras
    goStep(u, 'top');
    expect(posBar(u)).toBe(T.posOf(cpName('top'), 4, 8));
  });

  test('a swipe on the still steps too: left is next, right is previous, a short one does nothing', async () => {
    const u = setup({ analysis: ALLGREEN });
    await ready(u);
    await swipe(-90);
    expect(posBar(u)).toBe(T.posOf(cpName('takeaway'), 2, 8));
    await swipe(10);
    expect(posBar(u)).toBe(T.posOf(cpName('takeaway'), 2, 8));
    await swipe(90);
    expect(posBar(u)).toBe(T.posOf(cpName('address'), 1, 8));
    await swipe(90);
    expect(posBar(u)).toBe(T.posOf(cpName('address'), 1, 8)); // nothing before Address
  });

  test('each position lists its own rows: Impact has its two, never the extras', async () => {
    const u = setup();
    await ready(u);
    goStep(u, 'impact');
    const rows = within(u.getByTestId('results-rows'));
    expect(rows.getAllByLabelText(new RegExp(`^${labelOf('spine_loss')}`)).length).toBeGreaterThan(0);
    expect(rows.getAllByLabelText(new RegExp(`^${labelOf('hip_drift')}`)).length).toBeGreaterThan(0);
    expect(rows.queryByLabelText(new RegExp(`^${labelOf('tempo')}`))).toBeNull();
  });

  test('tapping a row selects it; the red one carries its fix', async () => {
    const u = setup();
    await ready(u);
    goStep(u, 'impact');
    const rows = within(u.getByTestId('results-rows'));
    const row = rows.getAllByLabelText(new RegExp(`^${labelOf('spine_loss')}`))[0];
    fireEvent.press(row);
    expect(rows.getAllByLabelText(new RegExp(`^${labelOf('spine_loss')}`))[0].props.accessibilityState.selected).toBe(true);
    const sel = MARKED.checks.find((c) => c.id === 'spine_loss');
    if (fixCopy(sel)) expect(within(u.getByTestId('results-fix-peek')).getByText(fixCopy(sel).cue)).toBeTruthy();
  });

  test('the Extras step lists the four groups, the rule and the finish still; nothing coloured', async () => {
    const u = setup();
    await ready(u);
    goStep(u, 'extras');
    expect(posBar(u)).toBe(T.posOf(T.extras, 8, 8));
    const rows = within(u.getByTestId('results-rows'));
    ['tempo', 'finish_balance', 'head_drift', 'hands_height_impact', 'hands_out_impact', 'shaft_angle_impact'].forEach((id) => {
      expect(rows.getAllByLabelText(new RegExp(`^${labelOf(id)}`)).length).toBeGreaterThan(0);
    });
    expect(rows.getByText(T.extrasHint)).toBeTruthy();
    expect(u.getByLabelText(new RegExp(`^${cpName('finish')} still`))).toBeTruthy();
    expect(u.queryByTestId('results-practise')).toBeNull(); // the fix and the drill belong to the main fault's position
  });

  test('every position green: the headline says so, it opens on Address and the practise card is empty', async () => {
    const u = setup({ analysis: ALLGREEN });
    await ready(u);
    expect(textOf(u.getByTestId('results-headline'))).toBe(T.noFaultAll);
    expect(posBar(u)).toBe(T.posOf(cpName('address'), 1, 8));
    expect(u.queryByTestId('results-starts-at')).toBeNull();
    expect(u.getByText(T.fixes.emptyTitle)).toBeTruthy();
    expect(u.queryByTestId('results-fix-peek')).toBeNull();
  });

  test('"Every position is green" only when all seven are measured; else it says what is missing', async () => {
    const pend = setup({ analysis: { ...UNMARKED, main: null } });
    await ready(pend);
    expect(textOf(pend.getByTestId('results-headline'))).toBe(T.noFaultPlace);
    pend.unmount();
    const part = setup({ analysis: GREEN_SOME_UNKNOWN });
    await ready(part);
    expect(textOf(part.getByTestId('results-headline'))).toBe(T.noFaultSoFar);
    part.unmount();
    const none = setup({ analysis: NOTHING });
    await ready(none);
    expect(textOf(none.getByTestId('results-headline'))).toBe(T.nothingMeasured);
  });

  test('the main fault is not a fix peek on a green position; it is the practise card only at its own step', async () => {
    const u = setup();
    await ready(u);
    expect(u.getByTestId('results-practise')).toBeTruthy();
    goStep(u, 'address');
    expect(u.queryByTestId('results-practise')).toBeNull();
    goStep(u, MAIN_AT);
    expect(u.getByTestId('results-practise')).toBeTruthy();
  });

  test('the headline names what the main fault is likely also causing, in one line; none when nothing later', async () => {
    const causing = { ...MARKED, main: { ...MARKED.main, consequences: ['posture_loss', 'stuck', 'flip'] } };
    const a = setup({ analysis: causing });
    await ready(a);
    expect(a.getByTestId('results-also-causing').props.children).toBe('Likely also causing: losing posture, stuck and 1 more');
    a.unmount();
    const lone = { ...MARKED, main: { ...MARKED.main, consequences: [] } };
    const b = setup({ analysis: lone });
    await ready(b);
    expect(b.queryByTestId('results-also-causing')).toBeNull();
  });
});

describe('SwingResultsScreen: placing the clubhead on the still (design D)', () => {
  test('a swing whose Downswing clubhead is unplaced opens there, in place mode, with "Main fault so far"', async () => {
    const u = setup({ analysis: UNMARKED });
    await ready(u);
    expect(posBar(u)).toBe(T.posOf(cpName('shaftDown'), 5, 8));
    expect(u.getByTestId('place-box')).toBeTruthy();
    expect(u.getByText(new RegExp(`^${T.tapWhere}`))).toBeTruthy();
    expect(verdictLabel(u)).toBe(T.mainSoFar);
    expect(u.getByLabelText(T.placeToFinish(cpName('shaftDown')))).toBeTruthy(); // the summary's place line
    expect(u.getByTestId('summary-step-shaftDown').props.accessibilityLabel).toBe(T.stepA11y(cpName('shaftDown'), T.stateNoHead));
    expect(u.queryByTestId('results-nudge')).toBeNull(); // the mark goes on the saved frame
  });

  test('two taps from the summary: the place line opens place mode on a position that was not showing', async () => {
    const u = setup({ analysis: UNMARKED });
    await ready(u);
    goStep(u, 'address');
    expect(u.queryByTestId('place-box')).toBeNull();
    fireEvent.press(u.getByTestId('results-place-line'));
    expect(posBar(u)).toBe(T.posOf(cpName('shaftDown'), 5, 8));
    expect(u.getByTestId('place-box')).toBeTruthy();
  });

  test('a row waiting for its clubhead has a Place button that opens place mode at its position', async () => {
    const u = setup({ analysis: UNMARKED });
    await ready(u);
    goStep(u, 'leadArm');
    expect(u.queryByTestId('place-box')).toBeNull();
    fireEvent.press(u.getAllByLabelText(new RegExp(`^${T.placeClubhead}: `))[0]);
    expect(posBar(u)).toBe(T.posOf(cpName('leadArm'), 3, 8));
    expect(u.getByTestId('place-box')).toBeTruthy();
  });

  test('a tap on the still places the head, saves marks and analysis, re-reads the same screen and offers Undo', async () => {
    const u = setup({ analysis: UNMARKED, marks: { ...emptyMarks({ swingId: 's1' }), pass: { state: 'done', skipped: [] } } });
    await ready(u);
    await tapStill();
    await waitFor(() => expect(store.saveMarks).toHaveBeenCalledTimes(1));
    const [, marks] = store.saveMarks.mock.calls[0];
    const label = marks.frames.find((f) => f.checkpoint === 'shaftDown');
    expect(label.head.confirmed).toBe(true);
    expect(label.head.final).toHaveLength(2);
    expect(marks.pass.state).toBe('done');
    expect(store.saveAnalysis).toHaveBeenCalledTimes(1);
    expect(store.saveAnalysis.mock.calls[0][1].clubMarks.shaftDown.source).toBe('user');
    expect(await u.findByText(T.placed(cpName('shaftDown')))).toBeTruthy();
    expect(posBar(u)).toBe(T.posOf(cpName('shaftDown'), 5, 8)); // the same screen
    expect(u.queryByTestId('place-box')).toBeNull();
    expect(verdictLabel(u)).toBe(T.workFirst); // no longer "so far"
    expect(u.queryByTestId('results-place-line')).toBeNull();
  });

  test('Undo writes back the marks and the analysis from before, and the banner goes', async () => {
    const before = { ...emptyMarks({ swingId: 's1' }), pass: { state: 'done', skipped: [] } };
    const u = setup({ analysis: UNMARKED, marks: before });
    await ready(u);
    await tapStill();
    fireEvent.press(await u.findByTestId('results-undo'));
    await waitFor(() => expect(store.saveMarks).toHaveBeenCalledTimes(2));
    expect(store.saveMarks.mock.calls[1][1]).toBe(before);
    expect(store.saveAnalysis.mock.calls[1][1]).toBe(UNMARKED);
    expect(u.queryByTestId('results-placed')).toBeNull();
    await waitFor(() => expect(u.getByTestId('summary-step-shaftDown').props.accessibilityLabel).toBe(T.stepA11y(cpName('shaftDown'), T.stateNoHead)));
  });

  test('a trip to Edit marks clears the banner, so Undo can never write the pre-trip marks back', async () => {
    const u = setup({ analysis: UNMARKED, marks: { ...emptyMarks({ swingId: 's1' }), pass: { state: 'done', skipped: [] } } });
    await ready(u);
    await tapStill();
    await u.findByTestId('results-placed');
    fireEvent.press(u.getByLabelText(T.editMarks));
    expect(u.queryByTestId('results-placed')).toBeNull();
    // and coming back into focus clears one that was placed since
    const focus = u.navigation.addListener.mock.calls.filter(([n]) => n === 'focus').pop()[1];
    await act(async () => { focus(); });
    expect(u.queryByTestId('results-placed')).toBeNull();
    expect(store.saveMarks).toHaveBeenCalledTimes(1); // nothing was written back
  });

  test('Undo only reverts what the placement wrote: marks edited since are kept', async () => {
    const u = setup({ analysis: UNMARKED, marks: { ...emptyMarks({ swingId: 's1' }), pass: { state: 'done', skipped: [] } } });
    await ready(u);
    await tapStill();
    const written = store.saveMarks.mock.calls[0][1];
    store.readMarks.mockResolvedValue({ ...written, editedElsewhere: true });
    fireEvent.press(await u.findByTestId('results-undo'));
    await waitFor(() => expect(u.queryByTestId('results-placed')).toBeNull());
    expect(store.saveMarks).toHaveBeenCalledTimes(1);
    expect(store.saveAnalysis).toHaveBeenCalledTimes(1);
  });

  test('if the analysis cannot be saved the marks are put back and the failure is shown', async () => {
    const before = { ...emptyMarks({ swingId: 's1' }), pass: { state: 'done', skipped: [] } };
    const u = setup({ analysis: UNMARKED, marks: before });
    await ready(u);
    store.saveAnalysis.mockRejectedValueOnce(new Error('disk'));
    await tapStill();
    expect(await u.findByText(T.placeFailed)).toBeTruthy();
    expect(store.saveMarks).toHaveBeenCalledTimes(2);
    expect(store.saveMarks.mock.calls[1][1]).toBe(before);
  });

  test('a failed Undo is shown, and the placed marks are put back if the analysis could not be written', async () => {
    const u = setup({ analysis: UNMARKED, marks: { ...emptyMarks({ swingId: 's1' }), pass: { state: 'done', skipped: [] } } });
    await ready(u);
    await tapStill();
    const written = store.saveMarks.mock.calls[0][1];
    store.saveAnalysis.mockRejectedValueOnce(new Error('disk'));
    fireEvent.press(await u.findByTestId('results-undo'));
    expect(await u.findByText(T.placeFailed)).toBeTruthy();
    expect(store.saveMarks.mock.calls[store.saveMarks.mock.calls.length - 1][1]).toBe(written);
  });

  test('the place tap rejects a fling: it has a 10 px distance limit', async () => {
    const u = setup({ analysis: UNMARKED });
    await ready(u);
    expect(getByGestureTestId('place-tap').config.maxDist).toBe(10);
  });

  test('the detector\'s unsure dot is a target: "Confirm the dot" accepts it without a placement tap', async () => {
    const u = setup({ analysis: SUBGATE, marks: { ...emptyMarks({ swingId: 's1' }), pass: { state: 'done', skipped: [] } } });
    await ready(u);
    expect(SUBGATE.clubMarks.shaftDown.head).toBeTruthy();
    fireEvent.press(u.getByTestId('place-confirm'));
    await waitFor(() => expect(store.saveMarks).toHaveBeenCalledTimes(1));
    const label = store.saveMarks.mock.calls[0][1].frames.find((f) => f.checkpoint === 'shaftDown');
    expect(label.head.confirmed).toBe(true);
    expect(store.saveAnalysis.mock.calls[0][1].clubMarks.shaftDown.source).toBe('user');
  });

  test('without a detection there is nothing to confirm, only a tap', async () => {
    const u = setup({ analysis: UNMARKED });
    await ready(u);
    expect(u.queryByTestId('place-confirm')).toBeNull();
  });

  test('"Open in Edit marks" opens the canvas on this position with the clubhead active', async () => {
    const u = setup({ analysis: UNMARKED });
    await ready(u);
    fireEvent.press(u.getByTestId('place-open-edit'));
    expect(u.navigation.navigate).toHaveBeenLastCalledWith('SwingEditMarks', { swingId: 's1', checkpoint: 'shaftDown', active: 'head' });
  });

  test('a save that fails says so and keeps place mode', async () => {
    store.saveMarks.mockRejectedValueOnce(new Error('disk'));
    const u = setup({ analysis: UNMARKED, marks: { ...emptyMarks({ swingId: 's1' }), pass: { state: 'done', skipped: [] } } });
    await ready(u);
    await tapStill();
    expect(await u.findByText(T.placeFailed)).toBeTruthy();
    expect(u.getByTestId('place-box')).toBeTruthy();
  });

  test('a hidden clubhead is a decision: the row says Hidden and offers no placement', async () => {
    const hiddenOnly = {
      ...MARKED,
      checks: MARKED.checks.map((c) => (c.id === 'down_vs_takeaway'
        ? {
          ...c, status: 'unknown', reason: 'hidden', value: null, text: 'Clubhead hidden at shaft down',
        } : c)),
    };
    const u = setup({ analysis: hiddenOnly });
    await ready(u);
    goStep(u, 'shaftDown');
    expect(u.getAllByText('Hidden').length).toBeGreaterThan(0);
    expect(u.queryByLabelText(/^Place clubhead: Vs your takeaway/)).toBeNull();
    expect(u.queryByTestId('place-box')).toBeNull();
  });
});

describe('SwingResultsScreen: phone findings (2026-10)', () => {
  const NOBALL = analyze(fixtureNative({ ballGoneFrame: lab.expected.ballGoneFrame }), base); // no ball: no address plane
  const doneMarks = { ...emptyMarks({ swingId: 's1' }), pass: { state: 'done', skipped: [] } };

  test('the main fault and its start are named in words only in the verdict and the tab labels, never as chip badges', async () => {
    const u = setup();
    await ready(u);
    expect(u.queryByText(/^(1st|starts|origen)$/i)).toBeNull();
    u.unmount();
    await act(async () => { await setLanguagePref('es'); });
    try {
      const es = setup();
      await ready(es);
      expect(es.queryByText('origen')).toBeNull();
      expect(within(es.getByTestId('summary-step-takeaway')).getByText('Inicio')).toBeTruthy(); // the chip name keeps it
    } finally {
      await act(async () => { await setLanguagePref('en'); });
    }
  });

  test('place mode hides the still\'s legend; outside it the legend is there for a red or yellow row', async () => {
    const u = setup();
    await ready(u);
    expect(u.getByTestId('overlay-legend')).toBeTruthy();
    u.unmount();
    const p = setup({ analysis: UNMARKED });
    await ready(p);
    expect(p.getByTestId('place-box')).toBeTruthy();
    expect(p.queryByTestId('overlay-legend')).toBeNull();
  });

  test('the swipe hint is short and wraps instead of being cut; both languages', async () => {
    const u = setup({ analysis: UNMARKED });
    await ready(u);
    const hint = u.getByText(T.swipeHint);
    expect(hint.props.numberOfLines).toBeUndefined();
    expect(T.swipeHint.length).toBeLessThanOrEqual(26);
    await act(async () => { await setLanguagePref('es'); });
    try {
      expect(SWING_STRINGS.results.swipeHint.length).toBeLessThanOrEqual(26);
    } finally {
      await act(async () => { await setLanguagePref('en'); });
    }
  });

  test('the placed banner is an overlay on the still, not a row far down the page', async () => {
    const u = setup({ analysis: UNMARKED, marks: doneMarks });
    await ready(u);
    await tapStill();
    const toast = await u.findByTestId('step-toast');
    expect(within(toast).getByText(T.placed(cpName('shaftDown')))).toBeTruthy();
    expect(within(toast).getByTestId('results-undo')).toBeTruthy();
  });

  test('an older swing (marks.json without a pass): placing and Undo keep the unconfirmed count, and Undo restores the marks object', async () => {
    let legacy = emptyMarks({ swingId: 's1' });
    ['address', 'leadArm', 'top', 'impact'].forEach((k) => {
      const c = TRUTH.checkpoints[k];
      legacy = withFrame(legacy, frameLabel({
        i: c.frame + 1, iProposed: c.frame, checkpoint: k, hands: { proposed: norm(c.hands), final: norm(c.hands), placed: true }, head: { proposed: null, final: null, finalHidden: true },
      }));
    });
    const row0 = { ...ROW, marked: { state: 'done', count: markedFromMarks(legacy).count } };
    const u = setup({ row: row0, analysis: UNMARKED, marks: legacy });
    // the store keeps the row's `marked` in step with marks.json, as saveMarks does
    store.saveMarks.mockImplementation(async (_id, m) => {
      store.readMarks.mockResolvedValue(m);
      store.getSwing.mockReturnValue({ ...row0, marked: { state: 'done', count: markedFromMarks(m).count } });
    });
    await ready(u);
    const unconfirmed = () => u.getByTestId('results-unconfirmed').props.children;
    const initial = T.unconfirmedChip(7 - markedFromMarks(legacy).count);
    expect(unconfirmed()).toBe(initial);
    await tapStill();
    await u.findByTestId('results-placed');
    expect(store.saveMarks.mock.calls[0][1].pass).toBeUndefined(); // still an older file
    const after = unconfirmed();
    expect(Number(after.match(/\d+/)[0])).toBeLessThanOrEqual(Number(initial.match(/\d+/)[0]));
    fireEvent.press(u.getByTestId('results-undo'));
    await waitFor(() => expect(store.saveMarks).toHaveBeenCalledTimes(2));
    expect(store.saveMarks.mock.calls[1][1]).toBe(legacy);
    await waitFor(() => expect(unconfirmed()).toBe(initial));
  });

  test('no ball, no address plane: it opens on the Downswing without place mode and asks for the ball first', async () => {
    const u = setup({ analysis: NOBALL, marks: doneMarks });
    await ready(u);
    expect(posBar(u)).toBe(T.posOf(cpName('shaftDown'), 5, 8));
    expect(u.queryByTestId('place-box')).toBeNull();
    expect(u.getByTestId('results-place-line')).toBeTruthy();
    expect(u.getByLabelText(T.askBall)).toBeTruthy();
    fireEvent.press(u.getByTestId('results-place-line'));
    expect(u.navigation.navigate).toHaveBeenLastCalledWith('SwingEditMarks', { swingId: 's1', checkpoint: 'address', active: 'ball' });
  });

  test('rows say which marks they wait for, and a Place button only when one clubhead is all they lack', async () => {
    const nb = setup({ analysis: NOBALL, marks: doneMarks });
    await ready(nb);
    const planeRow = () => within(nb.getByTestId('results-rows')).getByLabelText(new RegExp(`^${labelOf('clubhead_plane_down')}`));
    expect(planeRow().props.accessibilityLabel).not.toMatch(new RegExp(T.placeClubhead));
    expect(within(nb.getByTestId('results-rows')).getByText(T.waitingFor(`${T.needHead(cpName('shaftDown'))}, ${T.needBall}`))).toBeTruthy();
    expect(nb.getByTestId('results-ask-ball')).toBeTruthy();
    nb.unmount();
    const wb = setup({ analysis: UNMARKED, marks: doneMarks });
    await ready(wb);
    const rows = within(wb.getByTestId('results-rows'));
    expect(rows.getByLabelText(new RegExp(`^${T.placeClubhead}: ${labelOf('clubhead_plane_down')}`))).toBeTruthy(); // one clubhead unlocks it
    expect(rows.queryByLabelText(new RegExp(`^${T.placeClubhead}: ${labelOf('down_vs_takeaway')}`))).toBeNull(); // it needs two
    expect(rows.getByText(T.waitingFor(`${T.needHead(cpName('takeaway'))}, ${T.needHead(cpName('shaftDown'))}`))).toBeTruthy();
    expect(wb.queryByTestId('results-ask-ball')).toBeNull();
  });
});

describe('SwingResultsScreen: Spanish', () => {
  beforeEach(async () => { await act(async () => { await setLanguagePref('es'); }); });
  afterEach(async () => { await act(async () => { await setLanguagePref('en'); }); });

  test('the summary, the position and the place line speak Spanish', async () => {
    const u = setup({ analysis: UNMARKED });
    await ready(u);
    expect(verdictLabel(u)).toBe('Lo principal que corregir, por ahora');
    expect(posBar(u)).toBe('Bajada, posición 5 de 8');
    expect(u.getByLabelText('Coloca la cabeza del palo en la posición de bajada para completar la lectura')).toBeTruthy();
    expect(u.getByText('Toca donde está la cabeza del palo · fotograma', { exact: false })).toBeTruthy();
    expect(u.getByTestId('summary-step-shaftDown').props.accessibilityLabel).toBe('Bajada, cabeza del palo sin colocar');
    ['Prep.', 'Inicio', 'Mitad', 'Top', 'Bajada', 'Impacto', 'Acabado', 'Extras'].forEach((n) => expect(u.getAllByText(n).length).toBeGreaterThan(0));
  });

  test('a marked swing says "Lo primero" and where it likely starts', async () => {
    const u = setup();
    await ready(u);
    expect(verdictLabel(u)).toBe('Lo primero');
    expect(textOf(u.getByTestId('results-starts-at'))).toMatch(/^ · empieza en /);
    expect(u.getByTestId('results-starts-at').props.accessibilityLabel).toMatch(/^Probablemente empieza en: /);
  });
});

describe('SwingResultsScreen: coaching', () => {
  const F = T.fixes;

  test('opens on the main fault: its check is selected and its peek is under the still', async () => {
    const u = setup();
    await ready(u);
    const ev = MARKED.main.evidence;
    const first = ev.find((c) => c.status === 'red') ?? ev[0];
    expect(within(u.getByTestId('results-fix-peek')).getByText(fixCopy(first).cue)).toBeTruthy();
    const row = within(u.getByTestId('results-rows')).getAllByLabelText(new RegExp(`^${labelOf(first.id)}`))[0];
    expect(row.props.accessibilityState.selected).toBe(true);
  });

  test('tapping a fix opens the sheet with its steps; Next fix advances; the last says Done', async () => {
    const { findByTestId, getByTestId, getByLabelText, queryByTestId, getByText } = setup();
    await findByTestId('results-summary');
    fireEvent.press(within(getByTestId('results-fix-peek')).getByLabelText(F.howLink));
    const sheet = within(getByTestId('fix-sheet'));
    FIXES[0].copy.steps.forEach((t) => expect(sheet.getByText(t)).toBeTruthy());
    expect(sheet.getByText(F.sheetOverline(1, FIXES.length, cpName(FIXES[0].check.position)))).toBeTruthy();
    if (FIXES.length > 1) {
      fireEvent.press(getByLabelText(F.next));
      expect(within(getByTestId('fix-sheet')).getByText(FIXES[1].copy.headline)).toBeTruthy();
      FIXES[1].copy.steps.forEach((t) => expect(getByText(t)).toBeTruthy());
    }
    for (let i = 1; i < FIXES.length - 1; i += 1) fireEvent.press(getByLabelText(F.next));
    fireEvent.press(getByLabelText(F.done));
    await waitFor(() => expect(queryByTestId('fix-sheet')).toBeNull());
  });

  test('See on swing closes the sheet and moves to the position of the check', async () => {
    expect(FIXES.length).toBeGreaterThan(1);
    const u = setup();
    await ready(u);
    fireEvent.press(within(u.getByTestId('results-fix-peek')).getByLabelText(F.howLink));
    fireEvent.press(u.getByLabelText(F.next));
    const target = FIXES[1].check;
    fireEvent.press(u.getByLabelText(F.seeOnSwing));
    expect(posBar(u)).toMatch(new RegExp(`^${target.extra ? T.extras : cpName(target.position)},`));
    await waitFor(() => expect(u.queryByTestId('fix-sheet')).toBeNull());
  });

  test('D24: the practice plan row opens the 60-minute plan with the main drill in Block', async () => {
    const { findByTestId, getByTestId, queryByText, getByText } = setup();
    await findByTestId('results-summary');
    expect(queryByText(T.practice.blocks[1].body)).toBeNull();
    fireEvent.press(getByTestId('results-practise-plan'));
    T.practice.blocks.forEach((b) => expect(getByText(b.name)).toBeTruthy());
    expect(within(getByTestId('results-practice')).getByText(T.practice.drillIn(drillsForMain(MARKED.main)[0].title))).toBeTruthy(); // the main fault's first drill
  });

  test('shows the drills for the main fault and expands the rest', async () => {
    const evidence = MARKED.checks.filter((c) => c.fault === 'early_extension');
    const ee = {
      ...MARKED, main: { ...MARKED.main, fault: 'early_extension', label: 'Early extension', evidence, consequences: [] },
    };
    const { findByTestId, getByText, queryByText, getByLabelText } = setup({ analysis: ee });
    await findByTestId('results-summary');
    expect(getByText(T.fixes.drill('The chair'))).toBeTruthy(); // the row names the first drill
    fireEvent.press(getByLabelText(new RegExp(`^${T.fixes.drill('The chair')}`)));
    expect(getByText(T.practiseTitle)).toBeTruthy();
    expect(getByText('The chair')).toBeTruthy();
    expect(queryByText('Club behind the heels')).toBeNull();
    fireEvent.press(getByLabelText(T.moreDrills(2)));
    expect(getByText('Club behind the heels')).toBeTruthy();
  });
});

describe('SwingResultsScreen: a stored swing', () => {
  test('the frame nudge stops at +-2 (stills exist only there)', async () => {
    const { findByTestId, getByLabelText, getByText } = setup();
    await findByTestId('results-summary');
    for (let i = 0; i < 4; i += 1) fireEvent.press(getByLabelText(T.nextFrame));
    expect(getByText(/\(\+2\)/)).toBeTruthy();
    for (let i = 0; i < 6; i += 1) fireEvent.press(getByLabelText(T.prevFrame));
    expect(getByText(/\(-2\)/)).toBeTruthy();
  });

  test('approximate clips say so in one notice that opens to the reasons, and flag cm values', async () => {
    const approx = { ...MARKED, approximate: true, scale: { ...MARKED.scale, approx: true }, checks: MARKED.checks.map((c) => (c.unit === 'cm' ? { ...c, approximate: true } : c)) };
    const u = setup({ analysis: approx });
    await ready(u);
    expect(u.getByText(T.approxShort(`${T.approxFps}, ${T.approxHeight}`))).toBeTruthy();
    expect(u.queryByText(T.approxBanner)).toBeNull();
    fireEvent.press(u.getByTestId('results-approx'));
    expect(u.getByText(T.approxBanner)).toBeTruthy();
    expect(u.getByText(T.approxHeightBanner)).toBeTruthy();
    goStep(u, 'takeaway');
    expect(u.getAllByText(/approx\./).length).toBeGreaterThan(0);
  });

  test('a swing whose ball was never found adds "ball not seen" to the notice', async () => {
    const u = setup({ analysis: { ...MARKED, impactFromPose: true } });
    await ready(u);
    expect(u.getByText(T.approxShort(T.approxBall))).toBeTruthy();
    fireEvent.press(u.getByTestId('results-approx'));
    expect(u.getByText(T.approxBallBanner)).toBeTruthy();
  });

  test('a face-on swing shows its five positions and says how it was filmed, with no "take with care" notice', async () => {
    const u = setup({ analysis: { ...MARKED, view: 'faceOn' } });
    await ready(u);
    ['address', 'top', 'shaftDown', 'impact', 'finish', 'extras'].forEach((k) => expect(u.getByTestId(`summary-step-${k}`)).toBeTruthy());
    ['takeaway', 'leadArm', 'trailArm'].forEach((k) => expect(u.queryByTestId(`summary-step-${k}`)).toBeNull());
    expect(u.getByLabelText(`${T.viewFaceOn}. ${T.switchToDtl}`)).toBeTruthy();
    expect(u.queryByTestId('results-approx')).toBeNull();
  });

  test('the view row asks before analysing the swing as filmed from the other side', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const u = setup();
    await ready(u);
    fireEvent.press(u.getByTestId('results-view'));
    expect(alert).toHaveBeenCalledWith(T.switchTitleFaceOn, T.switchBody, expect.any(Array));
    expect(alert.mock.calls[0][2][1].text).toBe(T.switchConfirmFaceOn);
    alert.mockRestore();
  });

  test('Edit marks from the header menu and from the button both open on the position on screen; Rename saves', async () => {
    const { findByTestId, getByLabelText, getByPlaceholderText, navigation } = setup();
    await findByTestId('results-summary');
    fireEvent.press(getByLabelText(T.editMarks));
    expect(navigation.navigate).toHaveBeenLastCalledWith('SwingEditMarks', { swingId: 's1', checkpoint: MAIN_AT }); // the screen opens on the main fault
    fireEvent.press(getByLabelText(T.menu));
    fireEvent.press(getByLabelText(T.rename));
    fireEvent.changeText(getByPlaceholderText(T.renamePlaceholder), 'Range · 7-iron');
    await act(async () => { fireEvent.press(getByLabelText(T.save)); });
    expect(store.renameSwing).toHaveBeenCalledWith('s1', 'Range · 7-iron');
  });

  test('Export swing in the header menu builds the zip and opens the share sheet; a failure says so', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { findByTestId, getByLabelText } = setup();
    await findByTestId('results-summary');
    fireEvent.press(getByLabelText(T.menu));
    await act(async () => { fireEvent.press(getByLabelText(SWING_STRINGS.exportSwing.menu)); });
    expect(shareSwingExport).toHaveBeenCalledWith('s1');
    expect(alert).not.toHaveBeenCalled();
    shareSwingExport.mockRejectedValueOnce(new Error('boom'));
    fireEvent.press(getByLabelText(T.menu));
    await act(async () => { fireEvent.press(getByLabelText(SWING_STRINGS.exportSwing.menu)); });
    expect(alert).toHaveBeenCalledWith(SWING_STRINGS.exportSwing.failed);
  });

  test('asks for the stills it is missing, for the position it opens on, and redraws when they arrive', async () => {
    ensureStills.mockImplementation(async () => { getStill.mockReturnValue('file:///doc/swings/s1/frames/556.jpg'); return { 556: 'file:///x.jpg' }; });
    const { findByTestId, getByLabelText } = setup();
    await findByTestId('results-summary');
    await waitFor(() => expect(ensureStills).toHaveBeenCalled());
    const first = MARKED.checkpoints[MAIN_AT].i; // the first paint is already on the main fault
    expect(ensureStills).toHaveBeenCalledWith('s1', [first - 2, first - 1, first, first + 1, first + 2]);
    await waitFor(() => expect(getByLabelText(new RegExp(`^${cpName(MAIN_AT)} still, frame ${first}`)).props.source).toEqual({ uri: 'file:///doc/swings/s1/frames/556.jpg' }));
  });

  test('reloads the analysis when it comes back into focus (after Edit marks)', async () => {
    const { findByTestId, navigation } = setup();
    await findByTestId('results-summary');
    const focus = navigation.addListener.mock.calls.filter(([n]) => n === 'focus').pop()[1];
    store.readAnalysis.mockClear();
    await act(async () => { focus(); });
    expect(store.readAnalysis).toHaveBeenCalled();
  });
});

describe('SwingResultsScreen: the club chip (D19)', () => {
  test('the club picker is gone from a ready swing', async () => {
    const { findByTestId, queryByTestId, queryByLabelText } = setup();
    await findByTestId('results-summary');
    expect(queryByTestId('results-club-picker')).toBeNull();
    expect(queryByLabelText('Driver')).toBeNull();
  });
});

describe('SwingResultsScreen: after the marking pass (D26)', () => {
  test('never shows results for a swing whose pass is not done: it resumes the marking canvas', async () => {
    const { queryByTestId, navigation } = setup({ row: { ...ROW, marked: { state: 'partial', count: 3 } } });
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('SwingEditMarks', { swingId: 's1', mode: 'pass' }));
    expect(queryByTestId('results-summary')).toBeNull();
    expect(store.readAnalysis).not.toHaveBeenCalled();
  });

  test('a row from before the flow is judged by its marks.json: a position never marked resumes the pass', async () => {
    const noTrailArm = { ...OWNER_MARKS, frames: OWNER_MARKS.frames.filter((f) => f.checkpoint !== 'trailArm') };
    const { navigation } = setup({ row: { ...ROW, marked: undefined }, marks: noTrailArm }); // six of the seven corrected
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('SwingEditMarks', { swingId: 's1', mode: 'pass' }));
    const all = setup({ row: { ...ROW, marked: undefined } }); // OWNER_MARKS: all seven corrected
    expect(await all.findByTestId('results-summary')).toBeTruthy();
  });

  test('a chip says how many positions are not confirmed; none when all seven are', async () => {
    const { findByTestId, getByTestId } = setup({ row: { ...ROW, marked: { state: 'done', count: 4 } } });
    await findByTestId('results-summary');
    expect(getByTestId('results-unconfirmed').props.children).toBe(T.unconfirmedChip(3));
    const all = setup();
    await all.findByTestId('results-summary');
    expect(all.queryByTestId('results-unconfirmed')).toBeNull();
  });

  test('the results have no marks card: Edit marks is the way back to the canvas', async () => {
    const u = setup();
    await u.findByTestId('results-summary');
    expect(u.queryByTestId('results-marks')).toBeNull();
    fireEvent.press(u.getByLabelText(T.editMarks));
    expect(u.navigation.navigate).toHaveBeenLastCalledWith('SwingEditMarks', expect.objectContaining({ swingId: 's1' }));
  });
});

describe('SwingResultsScreen: delete', () => {
  test('More > Delete swing confirms, deletes the swing and goes back to the list', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { findByLabelText, getByLabelText, navigation } = setup();
    fireEvent.press(await findByLabelText(T.menu));
    fireEvent.press(getByLabelText(T.deleteSwing));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, body, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe(SWING_STRINGS.home.deleteTitle);
    expect(body).toBe(SWING_STRINGS.home.deleteBody);
    expect(store.deleteSwing).not.toHaveBeenCalled();
    await act(async () => { await buttons.find((b) => b.style === 'destructive').onPress(); });
    expect(store.deleteSwing).toHaveBeenCalledWith('s1');
    expect(navigation.goBack).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  test('cancelling the confirm keeps the swing', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { findByLabelText, getByLabelText, navigation } = setup();
    fireEvent.press(await findByLabelText(T.menu));
    fireEvent.press(getByLabelText(T.deleteSwing));
    const buttons = alertSpy.mock.calls[0][2];
    expect(buttons.find((b) => b.style === 'cancel').onPress).toBeUndefined();
    expect(store.deleteSwing).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});

describe('SwingResultsScreen: a swing still to analyse', () => {
  const PENDING = { ...ROW, status: 'pending' };

  test('processing shows the stages, then hands over to the marking pass: no results before it', async () => {
    let onProgress; let finish;
    runAnalysis.mockImplementation((id, o) => { ({ onProgress } = o); return new Promise((r) => { finish = r; }); });
    const {
      findAllByText, getByText, getAllByText, getByLabelText, queryByTestId, navigation,
    } = setup({ row: PENDING, analysis: UNMARKED });

    expect(await findAllByText(T.stages.reading)).toHaveLength(2); // the stage line and its step
    expect(getByText(T.stages.pose)).toBeTruthy();
    expect(getByText(T.stages.planes)).toBeTruthy();
    expect(getByText(T.processingTitle)).toBeTruthy();
    await act(async () => { onProgress({ stage: 'pose', done: 120, total: 300, probe: { height: 720, containerFps: 30, captureFps: 240, durationMs: 4100 } }); });
    // the clip strip: 120 of 300 frames is 40 % of a 4.1 s clip, so the playhead reads 1.64 s
    expect(getByText('1.64 s')).toBeTruthy();
    expect(getByLabelText(T.timelineA11y('1.64', '4.10', 120, 300))).toBeTruthy();
    expect(getByText('120')).toBeTruthy();
    expect(getByText('240')).toBeTruthy();
    expect(getAllByText('4.1 s').length).toBeGreaterThan(0);
    expect(getByText(T.stepOf(2, 3))).toBeTruthy();
    // up next: the seven positions the marking pass asks for (checks v2)
    expect(getByText(T.upNextTitle(7))).toBeTruthy();
    ['address', 'takeaway', 'leadArm', 'top', 'shaftDown', 'impact', 'trailArm'].forEach((k) => expect(getByText(SWING_STRINGS.checkpoint[k])).toBeTruthy());
    expect(getByText(SWING_STRINGS.privacy)).toBeTruthy();

    await act(async () => { finish({ analysis: UNMARKED, pass2: 'done' }); });
    expect(navigation.replace).toHaveBeenCalledWith('SwingEditMarks', { swingId: 's1', mode: 'pass' });
    expect(queryByTestId('results-summary')).toBeNull();
  });

  test('processing shows only the stages: no verdict, timeline, checks, club picker or marks', async () => {
    runAnalysis.mockReturnValue(new Promise(() => {}));
    const {
      findAllByText, queryByText, queryByTestId, queryAllByText, getByTestId,
    } = setup({ row: PENDING, analysis: MARKED });
    await findAllByText(T.stages.reading);
    expect(queryByText(T.mainTitle)).toBeNull();
    // "Impact" shows once, in the up-next list of positions to mark, never on a results timeline
    const impact = queryAllByText(SWING_STRINGS.checkpoint.impact);
    expect(impact).toHaveLength(1);
    expect(within(getByTestId('processing-up-next')).getByText(SWING_STRINGS.checkpoint.impact)).toBe(impact[0]);
    expect(queryByText(T.allChecks)).toBeNull();
    expect(queryByText(T.nextMarking)).toBeNull();
    expect(queryByTestId('results-club-picker')).toBeNull();
    expect(queryByTestId('results-marks')).toBeNull();
  });

  test('a stored swing being read shows a neutral loader, not the results chrome', async () => {
    store.readAnalysis.mockReturnValue(new Promise(() => {}));
    const { getByTestId, queryByText } = setup();
    expect(getByTestId('results-loading')).toBeTruthy();
    expect(queryByText(T.mainTitle)).toBeNull();
  });

  test('deleting mid-analysis cancels JS and pass 2 first, then deletes and goes back', async () => {
    const cancel = jest.fn();
    nativeApi.mockReturnValue({ cancelAnalysis: cancel });
    let opts;
    runAnalysis.mockImplementation((id, o) => { opts = o; return new Promise(() => {}); });
    const order = [];
    cancel.mockImplementation(() => order.push('cancel'));
    store.deleteSwing.mockImplementation(async () => { order.push('delete'); });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { findByTestId, navigation } = setup({ row: PENDING });
    fireEvent.press(await findByTestId('results-delete-link'));
    const [title, body, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe(SWING_STRINGS.home.deleteTitle);
    expect(body).toBe(SWING_STRINGS.home.deleteBody);
    expect(opts.isCancelled()).toBe(false); // declining the confirm leaves the run alone
    await act(async () => { await buttons.find((b) => b.style === 'destructive').onPress(); });
    expect(opts.isCancelled()).toBe(true);
    expect(order).toEqual(['cancel', 'delete']);
    expect(store.deleteSwing).toHaveBeenCalledWith('s1');
    expect(navigation.goBack).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  test('review (D26): leaving while the analysis runs cancels native too, so pass 2 never saves late', async () => {
    const cancel = jest.fn();
    nativeApi.mockReturnValue({ cancelAnalysis: cancel });
    runAnalysis.mockReturnValue(new Promise(() => {}));
    const { findAllByText, unmount } = setup({ row: PENDING });
    await findAllByText(T.stages.reading);
    unmount();
    expect(cancel).toHaveBeenCalled();
  });

  test('D12: no_pose says "No golfer found" and offers to record again', async () => {
    runAnalysis.mockResolvedValue({ error: 'no_pose' });
    const { findByText, getByText, getByLabelText, navigation } = setup({ row: PENDING });
    expect(await findByText('No golfer found')).toBeTruthy();
    expect(getByText(/Keep your whole body in frame/)).toBeTruthy();
    expect(getByLabelText(SWING_STRINGS.errors.no_pose)).toBeTruthy(); // title + body read as one sentence
    expect(SWING_STRINGS.errors.no_pose).toMatch(/No golfer found.*Keep your whole body in frame/);
    fireEvent.press(getByLabelText(T.recordAgain));
    expect(navigation.navigate).toHaveBeenCalledWith('SwingCapture');
  });

  test.each([['partial_pose', 'Could not track the whole swing'], ['too_long', 'Clip too long']])('%s is reported in the still slot', async (code, title) => {
    runAnalysis.mockResolvedValue({ error: code });
    const { findByText, getByLabelText } = setup({ row: PENDING });
    expect(await findByText(title)).toBeTruthy();
    expect(getByLabelText(SWING_STRINGS.errors[code])).toBeTruthy();
  });

  test('a native failure shows its code and message and sends them through the share sheet', async () => {
    const { Share } = require('react-native');
    const share = jest.spyOn(Share, 'share').mockResolvedValue({});
    runAnalysis.mockResolvedValue({
      error: 'failed',
      detail: { code: 'ERR_ANALYZE', message: 'GPU delegate failed', stage: 'pose', at: '2026-10-25T10:00:00Z' },
    });
    const { findByText, getByLabelText } = setup({ row: PENDING });
    expect(await findByText('ERR_ANALYZE · GPU delegate failed')).toBeTruthy();
    fireEvent.press(getByLabelText(T.sendDetails));
    expect(share).toHaveBeenCalledWith({ message: expect.stringContaining('Error: ERR_ANALYZE (while pose)') });
    share.mockRestore();
  });

  test('a stored failure keeps its detail; an unreadable clip says so', async () => {
    const { findByText, getByText } = setup({
      row: { ...ROW, status: 'error', error: 'video', errorDetail: { code: 'ERR_UNSUPPORTED_VIDEO', message: 'no readable image', stage: 'pose' } },
    });
    expect(await findByText('Video not readable')).toBeTruthy();
    expect(getByText('ERR_UNSUPPORTED_VIDEO · no readable image')).toBeTruthy();
  });

  test('a swing that already failed shows its error without running again', async () => {
    const { findByText } = setup({ row: { ...ROW, status: 'error', error: 'too_long' } });
    expect(await findByText('Clip too long')).toBeTruthy();
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  test('Cancel leaves the screen and stops the run; the swing is kept to analyse again', async () => {
    let opts;
    runAnalysis.mockImplementation((id, o) => { opts = o; return new Promise((r) => { opts.settle = r; }); });
    const { findByLabelText, navigation } = setup({ row: PENDING });
    fireEvent.press(await findByLabelText(T.cancelAnalysis));
    expect(navigation.goBack).toHaveBeenCalled();
    expect(opts.isCancelled()).toBe(true);
    await act(async () => { opts.settle({ cancelled: true }); });
    expect(store.markSwingFailed).toHaveBeenCalledWith('s1', 'cancelled');
  });

  test('"Analyse again" after a cancelled run starts a new run', async () => {
    runAnalysis.mockResolvedValueOnce({ cancelled: true }).mockReturnValueOnce(new Promise(() => {}));
    const { findByLabelText, findAllByText } = setup({ row: PENDING });
    fireEvent.press(await findByLabelText(T.retry));
    expect((await findAllByText(T.stages.reading)).length).toBeGreaterThan(0);
    expect(runAnalysis).toHaveBeenCalledTimes(2);
  });
});

describe('SwingResultsScreen: share as a link (plan 2026-10-31-swing-share)', () => {
  const S = SWING_STRINGS.share;

  test('More > Share link opens the sheet; uploading shares the swing', async () => {
    const { findByLabelText, getByLabelText, findByTestId, getByTestId } = setup();
    fireEvent.press(await findByLabelText(T.menu));
    fireEvent.press(getByLabelText(S.menu));
    await findByTestId('swing-share-sheet');
    await act(async () => { fireEvent.press(getByTestId('swing-share-upload')); });
    expect(shareSwing).toHaveBeenCalledWith('s1', expect.objectContaining({ onProgress: expect.any(Function) }));
  });

  test('a shared swing shows its link and can stop sharing', async () => {
    const { findByLabelText, getByLabelText, findByTestId, getByTestId } = setup({ row: { ...ROW, share: { token: 'TK' } } });
    fireEvent.press(await findByLabelText(T.menu));
    fireEvent.press(getByLabelText(S.menu));
    expect((await findByTestId('swing-share-url')).props.children).toMatch(/\/s\/TK$/);
    await act(async () => { fireEvent.press(getByTestId('swing-share-stop')); });
    expect(unshareSwing).toHaveBeenCalledWith('s1');
  });

  test('deleting a shared swing says the link closes too, and closes it first', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { findByLabelText, getByLabelText, navigation } = setup({ row: { ...ROW, share: { token: 'TK' } } });
    fireEvent.press(await findByLabelText(T.menu));
    fireEvent.press(getByLabelText(T.deleteSwing));
    const [title, body, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe(S.deleteTitle);
    expect(body).toBe(S.deleteBody);
    await act(async () => { await buttons.find((b) => b.style === 'destructive').onPress(); });
    expect(deleteSharedSwing).toHaveBeenCalledWith('s1');
    expect(store.deleteSwing).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  test('when the link cannot be closed the swing stays and the golfer is told', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    deleteSharedSwing.mockRejectedValueOnce(new Error('offline'));
    const { findByLabelText, getByLabelText, navigation } = setup({ row: { ...ROW, share: { token: 'TK' } } });
    fireEvent.press(await findByLabelText(T.menu));
    fireEvent.press(getByLabelText(T.deleteSwing));
    await act(async () => { await alertSpy.mock.calls[0][2].find((b) => b.style === 'destructive').onPress(); });
    expect(alertSpy).toHaveBeenLastCalledWith(S.deleteStopFailed);
    expect(navigation.goBack).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
