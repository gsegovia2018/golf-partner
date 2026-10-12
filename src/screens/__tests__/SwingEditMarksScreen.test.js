import React from 'react';
import { Alert, Image, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import SwingEditMarksScreen from '../SwingEditMarksScreen';
import * as store from '../../store/swingStore';
import { getStill, ensureStills } from '../../swing/frames';
import { analyze } from '../../swing/analyze';
import { fitRect } from '../../components/swing/SwingOverlay';
import { LOUPE_SIZE, loupePlacement, loupeImage } from '../../swing/loupe';
import { SWING_STRINGS } from '../../swing/strings';
import { fixtureNative, TRUTH, W, H } from '../../swing/__tests__/helpers';

const lab = require('../../swing/__tests__/fixtures/lab-d15-pass1.json');

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children }) => React.createElement(React.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});
jest.mock('../../store/swingStore', () => ({
  readAnalysis: jest.fn(),
  readPose: jest.fn(),
  readProbe: jest.fn(),
  readMarks: jest.fn(),
  saveAnalysis: jest.fn(() => Promise.resolve()),
  saveMarks: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../swing/frames', () => ({
  getStill: jest.fn(() => 'file:///doc/swings/s1/frames/x.jpg'),
  ensureStills: jest.fn(() => Promise.resolve({})),
}));

const E = SWING_STRINGS.edit;
const ball = { x: TRUTH.ball.x / W, y: TRUTH.ball.y / H, r: 2.1 / W };
const pose = { ...fixtureNative({ ball, ballGoneFrame: lab.expected.ballGoneFrame }), pass2: { addressFrame: lab.expected.addressFrame, shaft: {} } };
const probe = { containerFps: 29.97, captureFps: null, duplicateFrameRatio: 0 };
const base = { pass2: pose.pass2, probe, heightCm: 176, handedness: 'right', club: 'iron', source: 'import', swingId: 's1', createdAt: 'x' };
const FIRST = analyze(pose, base);
const LEFT = analyze(pose, { ...base, handedness: 'left' });

// The test window is 750 x 1334, so the still is contain-fit into a 440 x 667 box.
const RECT = fitRect(440, 667, W, H);
const px = (p) => [p[0] * RECT.w, p[1] * RECT.h];

// PanResponder reads the touch history, so the events carry one.
const history = (x, y, x0 = x, y0 = y, t = 1) => ({
  indexOfSingleActiveTouch: 0,
  mostRecentTimeStamp: t,
  numberActiveTouches: 1,
  touchBank: [{
    touchActive: true, startPageX: x0, startPageY: y0, startTimeStamp: 1, currentPageX: x, currentPageY: y, currentTimeStamp: t, previousPageX: x0, previousPageY: y0, previousTimeStamp: 1,
  }],
});
const touch = (layer, [x, y], moves = []) => {
  fireEvent(layer, 'responderGrant', { nativeEvent: { locationX: x, locationY: y, pageX: x, pageY: y, touches: [], changedTouches: [] }, touchHistory: history(x, y) });
  let t = 2;
  moves.forEach(([mx, my]) => {
    fireEvent(layer, 'responderMove', { nativeEvent: { locationX: mx, locationY: my, pageX: mx, pageY: my, touches: [], changedTouches: [] }, touchHistory: history(mx, my, x, y, t) });
    t += 1;
  });
  const [ex, ey] = moves.length ? moves[moves.length - 1] : [x, y];
  fireEvent(layer, 'responderRelease', { nativeEvent: { locationX: ex, locationY: ey, pageX: ex, pageY: ey, touches: [], changedTouches: [] }, touchHistory: history(ex, ey, x, y, t) });
};

function setup({ analysis = FIRST, marks = null, checkpoint = 'leadArm', missing = false } = {}) {
  store.readAnalysis.mockResolvedValue(missing ? null : analysis);
  store.readPose.mockResolvedValue(pose);
  store.readProbe.mockResolvedValue(probe);
  store.readMarks.mockResolvedValue(marks);
  const listeners = {};
  const navigation = {
    goBack: jest.fn(), dispatch: jest.fn(), navigate: jest.fn(),
    addListener: jest.fn((name, cb) => { listeners[name] = cb; return () => {}; }),
  };
  const utils = render(<ThemeProvider><SwingEditMarksScreen navigation={navigation} route={{ params: { swingId: 's1', checkpoint } }} /></ThemeProvider>);
  return { ...utils, navigation, listeners };
}

const open = async (opts) => {
  const r = setup(opts);
  await r.findByText(E.title);
  return { ...r, layer: r.getByTestId('edit-touch-layer') };
};
const savedMarks = () => store.saveMarks.mock.calls[store.saveMarks.mock.calls.length - 1][1];
const savedAnalysis = () => store.saveAnalysis.mock.calls[store.saveAnalysis.mock.calls.length - 1][1];
const rowStatus = (a, id, cp) => a.checks.find((c) => c.id === id && (!cp || c.cp === cp)).status;

beforeEach(() => {
  jest.clearAllMocks();
  getStill.mockReturnValue('file:///doc/swings/s1/frames/x.jpg');
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('SwingEditMarksScreen: the cue, the scrubber and the panels', () => {
  test('opens on the checkpoint it was sent to, with its cue card and the How to mark panel', async () => {
    const { getByText, getAllByText } = await open({ checkpoint: 'leadArm' });
    expect(getByText('P3')).toBeTruthy();
    expect(getAllByText('Lead arm parallel').length).toBeGreaterThan(0);
    expect(getByText('Left arm parallel to the ground in the backswing.')).toBeTruthy();
    expect(getByText(/the first frame your left arm is level/)).toBeTruthy();
    expect(getByText(E.howTo)).toBeTruthy();
    HOW_TO.forEach((k) => expect(getByText(`${k}: `)).toBeTruthy());
  });

  test('cues are mirrored for a left-handed golfer', async () => {
    const { getByText } = await open({ analysis: LEFT, checkpoint: 'leadArm' });
    expect(getByText('Right arm parallel to the ground in the backswing.')).toBeTruthy();
  });

  test('the How to mark panel collapses', async () => {
    const { getByLabelText, queryByText } = await open();
    fireEvent.press(getByLabelText(E.howTo));
    expect(queryByText('Hands: ')).toBeNull();
  });

  test('previewing a frame never moves the checkpoint; Set <checkpoint> to this frame does', async () => {
    const { getByLabelText, queryByLabelText } = await open({ checkpoint: 'top' });
    const f = FIRST.checkpoints.top.i;
    expect(getByLabelText(E.onThisFrame('Top of backswing'))).toBeTruthy();
    fireEvent.press(getByLabelText(E.scrubStep(10)));
    expect(getByLabelText(E.setFrame('Top of backswing', f + 10))).toBeTruthy();
    expect(getByLabelText(E.save).props.accessibilityState?.disabled ?? getByLabelText(E.save).props['aria-disabled']).toBeTruthy(); // preview alone is not an edit
    await act(async () => { fireEvent.press(getByLabelText(E.setFrame('Top of backswing', f + 10))); });
    expect(queryByLabelText(E.setFrame('Top of backswing', f + 10))).toBeNull();
    expect(getByLabelText(E.onThisFrame('Top of backswing'))).toBeTruthy();
    await act(async () => { fireEvent.press(getByLabelText(E.save)); });
    expect(savedMarks().frames).toEqual([expect.objectContaining({ checkpoint: 'top', i: f + 10, iProposed: f, corrected: true })]);
    expect(savedAnalysis().checkpoints.top.i).toBe(f + 10);
  });

  test('asks for a still it does not have, and keeps showing the last one meanwhile', async () => {
    getStill.mockReturnValue(null);
    ensureStills.mockResolvedValue({ [FIRST.checkpoints.leadArm.i]: 'file:///doc/swings/s1/frames/l.jpg' });
    const { getByLabelText } = await open({ checkpoint: 'leadArm' });
    await waitFor(() => expect(ensureStills).toHaveBeenCalledWith('s1', [FIRST.checkpoints.leadArm.i]));
    await waitFor(() => expect(getByLabelText(/^Lead arm parallel still/).props.source).toEqual({ uri: 'file:///doc/swings/s1/frames/l.jpg' }));
  });

  test('an analysis that is not there says so', async () => {
    const { findByText } = setup({ missing: true });
    expect(await findByText(E.loadFailed)).toBeTruthy();
  });
});

const HOW_TO = ['Hands', 'Clubhead', 'Ball', 'Clubhead hidden'];

describe('SwingEditMarksScreen: placing and dragging', () => {
  test('D16: a tap on the image places the clubhead, and the club-dependent row recomputes at once', async () => {
    const { getAllByLabelText, getByLabelText, queryAllByLabelText, layer } = await open({ checkpoint: 'leadArm' });
    expect(getAllByLabelText(/^Place clubhead: Halfway back/).length).toBeGreaterThan(0);
    fireEvent.press(getByLabelText(E.clubhead));
    await act(async () => { touch(layer, px([0.24, 0.32])); });
    expect(queryAllByLabelText(/^Place clubhead: Halfway back/)).toHaveLength(0);
    await act(async () => { fireEvent.press(getByLabelText(E.save)); });
    const lead = savedMarks().frames.find((f) => f.checkpoint === 'leadArm');
    expect(lead.head.final[0]).toBeCloseTo(0.24, 2);
    expect(lead.head.proposed).toBeNull();
    expect(lead.corrected).toBe(true);
    expect(rowStatus(savedAnalysis(), 'butt_extension')).not.toBe('unknown');
    expect(store.saveAnalysis.mock.invocationCallOrder[0]).toBeLessThan(store.saveMarks.mock.invocationCallOrder[0]);
  });

  test('the rule: placing a mark while previewing another frame adopts that frame', async () => {
    const { getByLabelText, getByText, queryByLabelText, layer } = await open({ checkpoint: 'leadArm' });
    const f = FIRST.checkpoints.leadArm.i;
    fireEvent.press(getByLabelText(E.scrubStep(10)));
    fireEvent.press(getByLabelText(E.scrubStep(1)));
    fireEvent.press(getByLabelText(E.clubhead));
    await act(async () => { touch(layer, px([0.24, 0.32])); });
    expect(getByText(E.frameSet('Lead arm parallel', f + 11))).toBeTruthy();
    expect(getByLabelText(E.onThisFrame('Lead arm parallel'))).toBeTruthy();
    expect(queryByLabelText(E.setFrame('Lead arm parallel', f + 11))).toBeNull();
    await act(async () => { fireEvent.press(getByLabelText(E.save)); });
    const lead = savedMarks().frames.find((x) => x.checkpoint === 'leadArm');
    expect(lead.i).toBe(f + 11);
    expect(lead.iProposed).toBe(f);
    expect(savedAnalysis().checkpoints.leadArm.i).toBe(f + 11);
  });

  test('the same rule for the arrows and the hidden toggle', async () => {
    const { getByLabelText, getByText } = await open({ checkpoint: 'top' });
    const f = FIRST.checkpoints.top.i;
    fireEvent.press(getByLabelText(E.scrubStep(-1)));
    fireEvent.press(getByLabelText(E.nudge.right));
    expect(getByText(E.frameSet('Top of backswing', f - 1))).toBeTruthy();
    fireEvent.press(getByLabelText(E.scrubStep(1)));
    fireEvent.press(getByLabelText(E.scrubStep(1)));
    fireEvent(getByLabelText(E.hiddenTitle), 'valueChange', true);
    expect(getByText(E.frameSet('Top of backswing', f + 1))).toBeTruthy();
  });

  test('dragging a handle moves it; one drag is one undo step; Undo puts it back', async () => {
    const { getByLabelText, layer } = await open({ checkpoint: 'impact' });
    const impact = FIRST.clubMarks.impact.hands;
    const undoBtn = () => getByLabelText(/^Undo/);
    expect(undoBtn().props.accessibilityState?.disabled ?? undoBtn().props['aria-disabled']).toBeTruthy();
    const [x, y] = px(impact);
    await act(async () => { touch(layer, [x + 6, y - 5], [[x + 30, y - 10], [x + 60, y - 20]]); });
    expect(getByLabelText(E.undoCount(1))).toBeTruthy();
    await act(async () => { fireEvent.press(getByLabelText(E.save)); });
    const hands = savedMarks().frames.find((f) => f.checkpoint === 'impact').hands;
    expect(hands.placed).toBe(true);
    expect(hands.final[0]).toBeGreaterThan(impact[0] + 0.1); // moved by about 54 px of a 375 px wide picture
    expect(hands.final[1]).toBeLessThan(impact[1]);
  });

  test('Undo restores the previous state and disables itself again', async () => {
    const { getByLabelText, layer } = await open({ checkpoint: 'leadArm' });
    fireEvent.press(getByLabelText(E.clubhead));
    await act(async () => { touch(layer, px([0.24, 0.32])); });
    await act(async () => { fireEvent.press(getByLabelText(E.undoCount(1))); });
    expect(getByLabelText(E.undo)).toBeTruthy();
    expect(getByLabelText(E.save).props.accessibilityState?.disabled ?? getByLabelText(E.save).props['aria-disabled']).toBeTruthy();
  });

  test('arrows nudge the active target by one video pixel, as one undo step while they come in a burst', async () => {
    const { getByLabelText } = await open({ checkpoint: 'impact' });
    const impact = FIRST.clubMarks.impact.hands;
    fireEvent.press(getByLabelText(E.nudge.right));
    fireEvent.press(getByLabelText(E.nudge.right));
    fireEvent.press(getByLabelText(E.nudge.down));
    expect(getByLabelText(E.undoCount(1))).toBeTruthy();
    await act(async () => { fireEvent.press(getByLabelText(E.save)); });
    const hands = savedMarks().frames.find((f) => f.checkpoint === 'impact').hands.final;
    expect(hands[0]).toBeCloseTo(impact[0] + 2 / W, 6);
    expect(hands[1]).toBeCloseTo(impact[1] + 1 / H, 6);
  });

  test('nudging a clubhead that is not placed says so instead of inventing one', async () => {
    const { getByLabelText, getByText } = await open({ checkpoint: 'leadArm' });
    fireEvent.press(getByLabelText(E.clubhead));
    fireEvent.press(getByLabelText(E.nudge.left));
    expect(getByText(E.placeFirst)).toBeTruthy();
  });

  test('the hidden toggle turns the row into "Hidden" (a decision, no CTA) and placing a head unhides', async () => {
    const { getByLabelText, getAllByText, queryAllByLabelText, getAllByLabelText, layer } = await open({ checkpoint: 'top' });
    expect(getAllByLabelText(/^Place clubhead: Shaft direction/).length).toBeGreaterThan(0);
    await act(async () => { fireEvent(getByLabelText(E.hiddenTitle), 'valueChange', true); });
    expect(queryAllByLabelText(/^Place clubhead: Shaft direction/)).toHaveLength(0);
    expect(getAllByText('Hidden').length).toBeGreaterThan(0);
    fireEvent.press(getByLabelText(E.clubhead));
    await act(async () => { touch(layer, px([0.3, 0.3])); });
    expect(getByLabelText(E.hiddenTitle).props.value).toBe(false);
    expect(queryAllByLabelText(/^Place clubhead: Shaft direction/)).toHaveLength(0);
  });

  test('the ball is marked at Address only, and moving it does not move the Address frame', async () => {
    const first = await open({ checkpoint: 'leadArm' });
    expect(first.getByLabelText(E.ball).props.accessibilityState.disabled).toBe(true);
    first.unmount();
    const { getByLabelText, layer } = await open({ checkpoint: 'address' });
    const f = FIRST.checkpoints.address.i;
    fireEvent.press(getByLabelText(E.scrubStep(10))); // scrub past the takeaway (the clubhead hides the ball at address)
    fireEvent.press(getByLabelText(E.ball));
    const [bx, by] = px(FIRST.reference.ball);
    await act(async () => { touch(layer, [bx + 3, by + 2], [[bx + 20, by + 10]]); });
    await act(async () => { fireEvent.press(getByLabelText(E.save)); });
    const marks = savedMarks();
    expect(marks.ball.corrected).toBe(true);
    expect(marks.ball.final[0]).toBeGreaterThan(marks.ball.proposed[0]);
    expect(marks.frames.find((x) => x.checkpoint === 'address')).toBeUndefined();
    expect(savedAnalysis().checkpoints.address.i).toBe(f);
  });

  test('Reset checkpoint to auto goes back to the proposal', async () => {
    const { getByLabelText, getAllByLabelText, layer } = await open({ checkpoint: 'leadArm' });
    fireEvent.press(getByLabelText(E.clubhead));
    await act(async () => { touch(layer, px([0.24, 0.32])); });
    await act(async () => { fireEvent.press(getByLabelText(E.reset)); });
    expect(getAllByLabelText(/^Place clubhead: Halfway back/).length).toBeGreaterThan(0);
    expect(getByLabelText(E.save).props.accessibilityState?.disabled ?? getByLabelText(E.save).props['aria-disabled']).toBeTruthy();
  });

  test('timeline steps switch checkpoint and show where the checks need a clubhead', async () => {
    const { getByLabelText, getByText } = await open({ checkpoint: 'leadArm' });
    fireEvent.press(getByLabelText(/^Top/));
    expect(getByText('P4')).toBeTruthy();
    fireEvent.press(getByLabelText(/^Impact/));
    expect(getByText('P7')).toBeTruthy();
  });

  test('a CTA in the live card jumps to the checkpoint that needs the mark (internal frames included)', async () => {
    const { getAllByLabelText, getByText } = await open({ checkpoint: 'top' });
    const ctas = getAllByLabelText(/^Place clubhead: Clubhead on the plane, pre-impact/);
    fireEvent.press(ctas[0]);
    expect(getByText('Pre-impact')).toBeTruthy();
  });
});

describe('SwingEditMarksScreen: saving and leaving', () => {
  const change = async (layer, getByLabelText) => {
    fireEvent.press(getByLabelText(E.clubhead));
    await act(async () => { touch(layer, px([0.24, 0.32])); });
  };

  test('Save writes the analysis and marks.json, then closes', async () => {
    const { getByLabelText, layer, navigation } = await open({ checkpoint: 'leadArm' });
    await change(layer, getByLabelText);
    await act(async () => { fireEvent.press(getByLabelText(E.save)); });
    expect(store.saveAnalysis).toHaveBeenCalledWith('s1', expect.objectContaining({ schema: 'swing-analysis/1' }));
    expect(savedMarks()).toMatchObject({ schema: 'swing-club-labels/1', swingId: 's1', handedness: 'right' });
    expect(navigation.goBack).toHaveBeenCalled();
  });

  test('reopening re-applies the saved marks: the club row stays measured and Reset still has the proposal', async () => {
    const { getByLabelText, layer } = await open({ checkpoint: 'leadArm' });
    await change(layer, getByLabelText);
    await act(async () => { fireEvent.press(getByLabelText(E.save)); });
    const marks = savedMarks();
    const analysis = savedAnalysis();
    const again = await open({ analysis, marks, checkpoint: 'leadArm' });
    expect(again.queryAllByLabelText(/^Place clubhead: Halfway back/)).toHaveLength(0);
    fireEvent.press(again.getByLabelText(E.reset));
    expect(again.getAllByLabelText(/^Place clubhead: Halfway back/).length).toBeGreaterThan(0);
  });

  test('unsaved changes ask before leaving, with Keep editing and Discard as the choices', async () => {
    const { getByLabelText, layer, listeners } = await open({ checkpoint: 'leadArm' });
    const event = () => ({ preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } });

    const clean = event();
    listeners.beforeRemove(clean);
    expect(clean.preventDefault).not.toHaveBeenCalled();

    await change(layer, getByLabelText);
    const dirty = event();
    listeners.beforeRemove(dirty);
    expect(dirty.preventDefault).toHaveBeenCalled();
    const [title, , buttons] = Alert.alert.mock.calls[0];
    expect(title).toBe(E.discardTitle);
    expect(buttons.map((b) => b.text)).toEqual([E.keep, E.discard]);
  });

  test('Discard performs the navigation that was blocked', async () => {
    const { getByLabelText, layer, listeners, navigation } = await open({ checkpoint: 'leadArm' });
    await change(layer, getByLabelText);
    const e = { preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } };
    listeners.beforeRemove(e);
    Alert.alert.mock.calls[0][2].find((b) => b.text === E.discard).onPress();
    expect(navigation.dispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
  });

  test('after a save the guard lets the screen close', async () => {
    const { getByLabelText, layer, listeners } = await open({ checkpoint: 'leadArm' });
    await change(layer, getByLabelText);
    await act(async () => { fireEvent.press(getByLabelText(E.save)); });
    const e = { preventDefault: jest.fn(), data: { action: {} } };
    listeners.beforeRemove(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  test('a failed save keeps the screen and says so', async () => {
    store.saveMarks.mockRejectedValueOnce(new Error('disk'));
    const { getByLabelText, layer, navigation } = await open({ checkpoint: 'leadArm' });
    await change(layer, getByLabelText);
    await act(async () => { fireEvent.press(getByLabelText(E.save)); });
    expect(Alert.alert).toHaveBeenCalledWith(E.saveFailed);
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});

// --- The drag loupe (D20) -------------------------------------------------------------------------
// Raw responder events: `touch()` above does grant, moves and release in one go, but the loupe is
// only there between them.
const nativeEvent = (x, y) => ({ locationX: x, locationY: y, pageX: x, pageY: y, touches: [], changedTouches: [] });
const grant = (layer, [x, y]) => fireEvent(layer, 'responderGrant', { nativeEvent: nativeEvent(x, y), touchHistory: history(x, y) });
const move = (layer, [x, y], [x0, y0], t = 5) => fireEvent(layer, 'responderMove', { nativeEvent: nativeEvent(x, y), touchHistory: history(x, y, x0, y0, t) });
const release = (layer, [x, y], [x0, y0] = [x, y]) => fireEvent(layer, 'responderRelease', { nativeEvent: nativeEvent(x, y), touchHistory: history(x, y, x0, y0, 9) });
// The loupe is hidden from the accessibility tree on purpose, so queries must opt in to see it.
const opt = { includeHiddenElements: true };
const loupeEl = (u) => u.getByTestId('edit-loupe', opt);
const maybeLoupe = (u) => u.queryByTestId('edit-loupe', opt);
const loupeStyle = (utils) => StyleSheet.flatten(loupeEl(utils).props.style);
const loupeImg = (utils) => StyleSheet.flatten(loupeEl(utils).findByType(Image).props.style);

describe('SwingEditMarksScreen: the drag loupe (D20)', () => {
  test('is not there until a mark is grabbed, shows while it is dragged, and goes on release', async () => {
    const utils = await open({ checkpoint: 'impact' });
    const { layer } = utils;
    expect(maybeLoupe(utils)).toBeNull();
    const [x, y] = px(FIRST.clubMarks.impact.hands);
    await act(async () => { grant(layer, [x, y]); });
    expect(loupeEl(utils)).toBeTruthy();
    await act(async () => { move(layer, [x + 20, y + 10], [x, y]); });
    expect(loupeEl(utils)).toBeTruthy();
    await act(async () => { release(layer, [x + 20, y + 10], [x, y]); });
    expect(maybeLoupe(utils)).toBeNull();
  });

  test('is 120 px across, above the finger (not covering it) and follows it while dragging', async () => {
    const utils = await open({ checkpoint: 'impact' });
    const [x, y] = px(FIRST.clubMarks.impact.hands);
    await act(async () => { grant(utils.layer, [x, y]); });
    const first = loupeStyle(utils);
    expect([first.width, first.height, first.borderRadius]).toEqual([LOUPE_SIZE, LOUPE_SIZE, LOUPE_SIZE / 2]);
    const at = loupePlacement([x, y], RECT);
    expect(at.placement).toBe('above');
    expect(first.top + LOUPE_SIZE).toBeLessThan(y); // the finger is below the whole circle
    await act(async () => { move(utils.layer, [x + 30, y - 25], [x, y]); });
    const moved = loupeStyle(utils);
    expect(moved.top).toBeLessThan(first.top); // it rose with the finger
    await act(async () => { release(utils.layer, [x + 30, y - 25], [x, y]); });
  });

  test('flips below the finger when there is no room above (near the top edge of the still)', async () => {
    const utils = await open({ checkpoint: 'leadArm' });
    fireEvent.press(utils.getByLabelText(E.clubhead));
    const finger = [RECT.w / 2, 24];
    await act(async () => { grant(utils.layer, finger); });
    const style = loupeStyle(utils);
    expect(loupePlacement(finger, RECT).placement).toBe('below');
    expect(style.top).toBeGreaterThan(finger[1]); // entirely below the fingertip
    await act(async () => { release(utils.layer, finger); });
  });

  test('stays inside the still horizontally when the finger is at the left or right edge', async () => {
    const utils = await open({ checkpoint: 'leadArm' });
    fireEvent.press(utils.getByLabelText(E.clubhead));
    await act(async () => { grant(utils.layer, [2, 300]); });
    expect(loupeStyle(utils).left).toBe(0);
    await act(async () => { release(utils.layer, [2, 300]); });
    await act(async () => { grant(utils.layer, [RECT.w - 2, 300]); });
    expect(loupeStyle(utils).left).toBe(RECT.w - LOUPE_SIZE);
    await act(async () => { release(utils.layer, [RECT.w - 2, 300]); });
  });

  test('shows the same still at 3x with the marked point at the centre, and the mark moves under it', async () => {
    const utils = await open({ checkpoint: 'impact' });
    const [x, y] = px(FIRST.clubMarks.impact.hands);
    await act(async () => { grant(utils.layer, [x, y]); });
    const img = loupeImg(utils);
    expect(loupeEl(utils).findByType(Image).props.source).toEqual({ uri: 'file:///doc/swings/s1/frames/x.jpg' });
    const want = loupeImage(FIRST.clubMarks.impact.hands, RECT);
    expect([img.width, img.height, img.left, img.top]).toEqual([want.width, want.height, want.left, want.top]);
    expect(img.width).toBe(RECT.w * 3);
    await act(async () => { move(utils.layer, [x + 10, y], [x, y]); });
    expect(loupeImg(utils).left).toBeCloseTo(img.left - 30, 6); // 10 px of drag = 30 px of magnified image
    await act(async () => { release(utils.layer, [x + 10, y], [x, y]); });
  });

  test('is decorative: hidden from screen readers and never takes a touch', async () => {
    const utils = await open({ checkpoint: 'impact' });
    const [x, y] = px(FIRST.clubMarks.impact.hands);
    await act(async () => { grant(utils.layer, [x, y]); });
    const loupe = loupeEl(utils);
    expect(loupe.props.accessibilityElementsHidden).toBe(true);
    expect(loupe.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(loupe.props.pointerEvents).toBe('none');
    await act(async () => { release(utils.layer, [x, y]); });
  });

  test('a cancelled gesture hides it too', async () => {
    const utils = await open({ checkpoint: 'impact' });
    const [x, y] = px(FIRST.clubMarks.impact.hands);
    await act(async () => { grant(utils.layer, [x, y]); });
    await act(async () => { fireEvent(utils.layer, 'responderTerminate', { nativeEvent: nativeEvent(x, y), touchHistory: history(x, y) }); });
    expect(maybeLoupe(utils)).toBeNull();
  });

  describe('arrow nudges', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    test('show it for about 600 ms so a 1-px move is visible, and each nudge restarts the clock', async () => {
      const utils = await open({ checkpoint: 'impact' });
      jest.useFakeTimers();
      expect(maybeLoupe(utils)).toBeNull();
      fireEvent.press(utils.getByLabelText(E.nudge.right));
      expect(loupeEl(utils)).toBeTruthy();
      act(() => { jest.advanceTimersByTime(400); });
      fireEvent.press(utils.getByLabelText(E.nudge.right)); // restarts
      act(() => { jest.advanceTimersByTime(400); });
      expect(loupeEl(utils)).toBeTruthy(); // 800 ms after the first, 400 after the second
      act(() => { jest.advanceTimersByTime(200); });
      expect(maybeLoupe(utils)).toBeNull();
    });

    test('centres on the nudged mark: one video pixel moves the magnified still by 3 view px', async () => {
      const utils = await open({ checkpoint: 'impact' });
      jest.useFakeTimers();
      fireEvent.press(utils.getByLabelText(E.nudge.right));
      const a = loupeImg(utils);
      fireEvent.press(utils.getByLabelText(E.nudge.right));
      const b = loupeImg(utils);
      expect(a.left - b.left).toBeCloseTo((3 * RECT.w) / W, 6);
    });

    test('a drag takes over from a nudge, and release hides it at once', async () => {
      const utils = await open({ checkpoint: 'impact' });
      jest.useFakeTimers();
      fireEvent.press(utils.getByLabelText(E.nudge.right));
      const [x, y] = px(FIRST.clubMarks.impact.hands);
      await act(async () => { grant(utils.layer, [x, y]); });
      act(() => { jest.advanceTimersByTime(700); });
      expect(loupeEl(utils)).toBeTruthy(); // the nudge timer must not cut a live drag
      await act(async () => { release(utils.layer, [x, y]); });
      expect(maybeLoupe(utils)).toBeNull();
    });
  });
});
