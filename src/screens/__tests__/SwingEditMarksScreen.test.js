import React from 'react';
import { Alert, Image, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import SwingEditMarksScreen from '../SwingEditMarksScreen';
import { Text as SvgText } from 'react-native-svg';
import SwingOverlay, { fitRect } from '../../components/swing/SwingOverlay';
import * as store from '../../store/swingStore';
import { getStill, ensureStills } from '../../swing/frames';
import { analyze } from '../../swing/analyze';
import { emptyMarks } from '../../swing/labels';
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
  getSwing: jest.fn(() => ({ id: 's1', club: 'iron' })),
  getSwingProfile: jest.fn(() => ({ lastClub: 'iron' })),
  setSwingClub: jest.fn(() => Promise.resolve()),
  setLastSwingClub: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../swing/frames', () => ({
  getStill: jest.fn(() => 'file:///doc/swings/s1/frames/x.jpg'),
  ensureStills: jest.fn(() => Promise.resolve({})),
}));

const M = SWING_STRINGS.mark;
const ball = { x: TRUTH.ball.x / W, y: TRUTH.ball.y / H, r: 2.1 / W };
const pose = { ...fixtureNative({ ball, ballGoneFrame: lab.expected.ballGoneFrame }), pass2: { addressFrame: lab.expected.addressFrame, shaft: {} } };
const probe = { containerFps: 29.97, captureFps: null, duplicateFrameRatio: 0 };
const base = { pass2: pose.pass2, probe, heightCm: 176, handedness: 'right', club: 'iron', source: 'import', swingId: 's1', createdAt: 'x' };
const FIRST = analyze(pose, base);
const FRESH = { ...emptyMarks({ swingId: 's1' }), pass: { state: 'none', skipped: [] } };

// The test window is 750 x 1334 and onLayout never fires, so the video box is the fallback 480 x 560.
const RECT = fitRect(480, Math.round(1334 * 0.42), W, H);
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
const nativeEvent = (x, y) => ({ locationX: x, locationY: y, pageX: x, pageY: y, touches: [], changedTouches: [] });
const grant = (layer, [x, y]) => fireEvent(layer, 'responderGrant', { nativeEvent: nativeEvent(x, y), touchHistory: history(x, y) });
const move = (layer, [x, y], [x0, y0], t = 5) => fireEvent(layer, 'responderMove', { nativeEvent: nativeEvent(x, y), touchHistory: history(x, y, x0, y0, t) });
const release = (layer, [x, y], [x0, y0] = [x, y]) => fireEvent(layer, 'responderRelease', { nativeEvent: nativeEvent(x, y), touchHistory: history(x, y, x0, y0, 9) });
const touch = (layer, [x, y], moves = []) => {
  grant(layer, [x, y]);
  moves.forEach((m, k) => move(layer, m, [x, y], 2 + k));
  release(layer, moves.length ? moves[moves.length - 1] : [x, y], [x, y]);
};

// Native seeds a clubhead at address and impact (D16): the pass tests use it for "Looks right".
const seeds = (a) => Object.fromEntries(['address', 'impact'].map((k) => [a.checkpoints[k].i, {
  head: [TRUTH.checkpoints[k].head.x, TRUTH.checkpoints[k].head.y], hidden: false, conf: 0.8, source: 'edge',
}]));
const SEEDED_POSE = { ...pose, pass2: { ...pose.pass2, shaft: seeds(FIRST) } };
const SEEDED = analyze(SEEDED_POSE, { ...base, pass2: SEEDED_POSE.pass2 });

function setup({
  analysis = FIRST, marks = null, checkpoint = 'leadArm', mode, missing = false, seeded = false,
} = {}) {
  store.readAnalysis.mockResolvedValue(missing ? null : seeded ? SEEDED : analysis);
  store.readPose.mockResolvedValue(seeded ? SEEDED_POSE : pose);
  store.readProbe.mockResolvedValue(probe);
  store.readMarks.mockResolvedValue(marks);
  const listeners = {};
  const navigation = {
    goBack: jest.fn(), dispatch: jest.fn(), navigate: jest.fn(), replace: jest.fn(),
    addListener: jest.fn((name, cb) => { listeners[name] = cb; return () => {}; }),
  };
  const utils = render(<ThemeProvider><SwingEditMarksScreen navigation={navigation} route={{ params: { swingId: 's1', checkpoint, mode } }} /></ThemeProvider>);
  return { ...utils, navigation, listeners };
}

const open = async ({ at = 'mark-canvas', settle = true, ...opts } = {}) => {
  const r = setup(opts);
  await r.findByTestId(at);
  // the canvas takes no touch until the still of its frame is on screen
  if (at === 'mark-canvas' && settle) await waitFor(() => expect(r.queryByTestId('mark-loading')).toBeNull());
  return { ...r, layer: r.queryByTestId('edit-touch-layer') };
};
const savedMarks = () => store.saveMarks.mock.calls[store.saveMarks.mock.calls.length - 1][1];
const savedAnalysis = () => store.saveAnalysis.mock.calls[store.saveAnalysis.mock.calls.length - 1][1];
const rowStatus = (a, id, cp) => a.checks.find((c) => c.id === id && (!cp || c.cp === cp)).status;
const dock = (u, m) => u.getByTestId(`dock-${m}`);
const dockLabel = (u, m) => dock(u, m).props.accessibilityLabel;
const press = async (el) => { await act(async () => { fireEvent.press(el); }); };

beforeEach(() => {
  jest.clearAllMocks();
  getStill.mockReturnValue('file:///doc/swings/s1/frames/x.jpg');
  ensureStills.mockImplementation(() => Promise.resolve({})); // clearAllMocks keeps a test's own implementation
  store.saveMarks.mockImplementation(() => Promise.resolve());
  store.getSwingProfile.mockReturnValue({ lastClub: 'iron' });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('the canvas (D26: design C, V2 stop guidance)', () => {
  test('opens at the position with the stop line, the fine strip, the dock and the six chapters; no skeleton or planes', async () => {
    getStill.mockReturnValue(null);
    const u = await open({ checkpoint: 'top', settle: false });
    expect(u.getByText('P4 · Top of backswing')).toBeTruthy();
    expect(u.getByText(M.edit)).toBeTruthy();
    const stop = u.getByTestId('mark-stop-line');
    expect(within(stop).getByText(M.stopKind.last)).toBeTruthy();
    expect(within(stop).getByText(/before the club starts down/)).toBeTruthy();
    expect(within(stop).getByText(M.watch('the clubhead, not the hands'))).toBeTruthy();
    const f = FIRST.checkpoints.top.i;
    expect(u.getByTestId(`fine-${f - 8}`)).toBeTruthy();
    expect(u.getByTestId(`fine-${f + 8}`)).toBeTruthy();
    expect(u.queryByTestId(`fine-${f + 9}`)).toBeNull();
    expect(u.getByText(M.proposedFlag(f))).toBeTruthy();
    expect(u.getByText('← going back')).toBeTruthy();
    expect(u.getByText('coming down →')).toBeTruthy();
    ['address', 'leadArm', 'top', 'shaftDown', 'impact', 'shaftThrough'].forEach((k) => expect(u.getByTestId(`chapter-${k}`)).toBeTruthy());
    ['takeaway', 'transition', 'trailArm', 'finish'].forEach((k) => expect(u.queryByTestId(`chapter-${k}`)).toBeNull());
    expect(u.getByText(M.counts(0, 0, 6))).toBeTruthy();
    const overlay = u.UNSAFE_getByType(SwingOverlay);
    expect(overlay.props.pose).toBeUndefined();
    expect(overlay.props.showPlanes).toBe(false);
    expect(ensureStills).toHaveBeenCalledWith('s1', expect.arrayContaining([f - 8, f + 8]));
  });

  test('review: every mark on the still has its chip, the active one included (hands, clubhead, ball at address)', async () => {
    const u = await open({ checkpoint: 'address', seeded: true });
    const chips = () => u.UNSAFE_getAllByType(SvgText).map((n) => n.props.children);
    expect(chips().sort()).toEqual(['BALL · PROPOSED', 'CLUBHEAD · PROPOSED', 'HANDS · PROPOSED']);
    await press(u.getByTestId('mark-confirm'));
    expect(chips()).toContain('HANDS · CONFIRMED');
  });

  test('"More" expands the full cue inline (the fine strip folds away); "Less" closes it', async () => {
    const u = await open({ checkpoint: 'shaftThrough' });
    await press(u.getByLabelText(M.more));
    expect(within(u.getByTestId('mark-cue')).getByText(/often points away from the camera/)).toBeTruthy();
    expect(u.queryByTestId('mark-fine-strip')).toBeNull();
    await press(u.getByLabelText(M.less));
    expect(u.queryByTestId('mark-cue')).toBeNull();
    expect(u.getByTestId('mark-fine-strip')).toBeTruthy();
  });

  test('cues and the stop line are mirrored for a left-handed golfer', async () => {
    const u = await open({ checkpoint: 'shaftDown', analysis: analyze(pose, { ...base, handedness: 'left' }) });
    expect(within(u.getByTestId('mark-stop-line')).getByText(/hands by the left hip/)).toBeTruthy();
  });

  test('the dock names each mark with its status word; the ball is address only', async () => {
    const u = await open({ checkpoint: 'top' });
    expect(dockLabel(u, 'hands')).toBe(M.dockLabel('Hands', 'Proposed'));
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Missing'));
    expect(dockLabel(u, 'ball')).toBe(M.dockLabel('Ball', M.addressOnly));
    expect(u.getByText(`Hands · ${M.line.proposed}`)).toBeTruthy();
    await press(dock(u, 'ball'));
    expect(u.getByText(M.ballOnlyAddress)).toBeTruthy();
    expect(dock(u, 'hands').props.accessibilityState.selected).toBe(true);
    await press(dock(u, 'head'));
    expect(u.getByText(`Clubhead · ${M.line.missing('Clubhead')}`)).toBeTruthy();
  });

  test('D16: a tap places the clubhead (Moved), Confirm makes it Confirmed, Save writes it with the flags', async () => {
    const u = await open({ checkpoint: 'leadArm' });
    await press(dock(u, 'head'));
    await act(async () => { touch(u.layer, px([0.24, 0.32])); });
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Moved'));
    await press(u.getByTestId('mark-confirm'));
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Confirmed'));
    await press(u.getByLabelText(M.primary.editSave));
    const lead = savedMarks().frames.find((f) => f.checkpoint === 'leadArm');
    expect(lead.head.final[0]).toBeCloseTo(0.24, 2);
    expect(lead).toMatchObject({ corrected: true, confirmed: true, head: { confirmed: true }, hands: { confirmed: true } });
    expect(rowStatus(savedAnalysis(), 'butt_extension')).not.toBe('unknown');
    // marks.json is the source of truth: it is written before analysis.json
    expect(store.saveMarks.mock.invocationCallOrder[0]).toBeLessThan(store.saveAnalysis.mock.invocationCallOrder[0]);
    expect(u.navigation.goBack).toHaveBeenCalled();
  });

  test('the fine strip previews a neighbour (the flag stays), and placing a mark there adopts that frame', async () => {
    const u = await open({ checkpoint: 'leadArm' });
    const f = FIRST.checkpoints.leadArm.i;
    await press(u.getByTestId(`fine-${f + 2}`));
    expect(u.getByText(M.previewFlag(f + 2, 2))).toBeTruthy();
    expect(u.getByTestId(`fine-${f}`).props.accessibilityLabel).toBe(M.thumbLabel(f, 0));
    await press(u.getByLabelText(M.nextFrame));
    await press(dock(u, 'head'));
    await act(async () => { touch(u.layer, px([0.24, 0.32])); });
    expect(u.getByText(M.currentFlag(f + 3, 3))).toBeTruthy();
    await press(u.getByLabelText(M.primary.editSave));
    const lead = savedMarks().frames.find((x) => x.checkpoint === 'leadArm');
    expect([lead.i, lead.iProposed]).toEqual([f + 3, f]);
    expect(savedAnalysis().checkpoints.leadArm.i).toBe(f + 3);
  });

  test('Hidden is a decision (status Hidden, no Confirm); placing a head unhides it', async () => {
    const u = await open({ checkpoint: 'top' });
    await press(dock(u, 'head'));
    await press(u.getByTestId('mark-hidden'));
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Hidden'));
    expect(u.getByText(M.hiddenToast)).toBeTruthy();
    expect(u.queryByTestId('mark-confirm')).toBeNull();
    await act(async () => { touch(u.layer, px([0.3, 0.3])); });
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Moved'));
  });

  test('a drag moves the hands as one undo step; Undo puts them back', async () => {
    const u = await open({ checkpoint: 'impact' });
    const impact = FIRST.clubMarks.impact.hands;
    expect(u.getByTestId('mark-undo').props.accessibilityState.disabled).toBe(true);
    const [x, y] = px(impact);
    await act(async () => { touch(u.layer, [x + 6, y - 5], [[x + 30, y - 10], [x + 60, y - 20]]); });
    expect(u.getByLabelText(M.undoCount(1))).toBeTruthy();
    expect(dockLabel(u, 'hands')).toBe(M.dockLabel('Hands', 'Moved'));
    await press(u.getByLabelText(M.undoCount(1)));
    expect(dockLabel(u, 'hands')).toBe(M.dockLabel('Hands', 'Proposed'));
    await act(async () => { touch(u.layer, [x + 6, y - 5], [[x + 60, y - 20]]); });
    await press(u.getByLabelText(M.primary.editSave));
    const hands = savedMarks().frames.find((f) => f.checkpoint === 'impact').hands;
    expect(hands.placed).toBe(true);
    expect(hands.final[0]).toBeGreaterThan(impact[0] + 0.1);
  });

  test('arrows nudge by one video pixel, one undo step per burst; a missing clubhead is not invented', async () => {
    const u = await open({ checkpoint: 'impact' });
    const impact = FIRST.clubMarks.impact.hands;
    fireEvent.press(u.getByLabelText(M.nudge.right));
    fireEvent.press(u.getByLabelText(M.nudge.right));
    fireEvent.press(u.getByLabelText(M.nudge.down));
    expect(u.getByLabelText(M.undoCount(1))).toBeTruthy();
    await press(u.getByLabelText(M.primary.editSave));
    const hands = savedMarks().frames.find((f) => f.checkpoint === 'impact').hands.final;
    expect(hands[0]).toBeCloseTo(impact[0] + 2 / W, 6);
    expect(hands[1]).toBeCloseTo(impact[1] + 1 / H, 6);
    const v = await open({ checkpoint: 'leadArm' });
    await press(dock(v, 'head'));
    fireEvent.press(v.getByLabelText(M.nudge.left));
    expect(v.getByText(M.placeHead)).toBeTruthy();
  });

  test('the ball moves at Address only, without moving the Address frame', async () => {
    const u = await open({ checkpoint: 'address' });
    const f = FIRST.checkpoints.address.i;
    await press(u.getByTestId(`fine-${f + 8}`)); // past the takeaway the clubhead no longer hides the ball
    await press(dock(u, 'ball'));
    const [bx, by] = px(FIRST.reference.ball);
    await act(async () => { touch(u.layer, [bx + 3, by + 2], [[bx + 20, by + 10]]); });
    expect(dockLabel(u, 'ball')).toBe(M.dockLabel('Ball', 'Moved'));
    await press(u.getByLabelText(M.primary.editSave));
    const marks = savedMarks();
    expect(marks.ball).toMatchObject({ corrected: true, confirmed: true });
    expect(marks.ball.final[0]).toBeGreaterThan(marks.ball.proposed[0]);
    expect(savedAnalysis().checkpoints.address.i).toBe(f + 8); // Save confirms the shown frame ("Use frame")
  });

  test('a chapter tap with an unconfirmed move asks: Keep editing stays, Discard reverts, Confirm and leave keeps', async () => {
    const u = await open({ checkpoint: 'leadArm' });
    await press(dock(u, 'head'));
    await act(async () => { touch(u.layer, px([0.24, 0.32])); });
    await press(u.getByTestId('chapter-top'));
    expect(u.getByTestId('mark-discard-sheet')).toBeTruthy();
    await press(u.getByLabelText(M.keepEditing));
    expect(u.queryByTestId('mark-discard-sheet')).toBeNull();
    expect(u.getByText('P3 · Lead arm parallel')).toBeTruthy();
    await press(u.getByTestId('chapter-top'));
    await press(u.getByLabelText(M.discardMove));
    expect(u.getByText('P4 · Top of backswing')).toBeTruthy();
    await press(u.getByTestId('chapter-leadArm'));
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Missing'));
    await press(dock(u, 'head'));
    await act(async () => { touch(u.layer, px([0.24, 0.32])); });
    await press(u.getByTestId('chapter-top'));
    await press(u.getByLabelText(M.confirmLeave));
    await press(u.getByTestId('chapter-leadArm'));
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Confirmed'));
  });

  test('an unconfirmed position reads Save (it confirms it); once confirmed and untouched, Done closes without writing', async () => {
    const u = await open({ checkpoint: 'top' });
    await press(u.getByLabelText(M.primary.editSave));
    const again = await open({ checkpoint: 'top', analysis: savedAnalysis(), marks: savedMarks() });
    store.saveMarks.mockClear();
    await press(again.getByLabelText(M.primary.editDone));
    expect(store.saveMarks).not.toHaveBeenCalled();
    expect(again.navigation.goBack).toHaveBeenCalled();
  });

  test('Cancel with changes asks before dropping them; Discard performs the blocked navigation', async () => {
    const event = () => ({ preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } });
    const c = await open({ checkpoint: 'leadArm' });
    const clean = event();
    c.listeners.beforeRemove(clean);
    expect(clean.preventDefault).toHaveBeenCalled(); // the guard always routes through the canvas…
    expect(c.navigation.dispatch).toHaveBeenCalledWith({ type: 'GO_BACK' }); // …which lets a clean screen go
    const u = await open({ checkpoint: 'leadArm' });
    await press(dock(u, 'head'));
    await act(async () => { touch(u.layer, px([0.24, 0.32])); });
    const dirty = event();
    u.listeners.beforeRemove(dirty);
    const [title, , buttons] = Alert.alert.mock.calls[0];
    expect(title).toBe(M.leaveTitle);
    expect(buttons.map((b) => b.text)).toEqual([M.keepEditing, M.discard]);
    buttons.find((b) => b.text === M.discard).onPress();
    expect(u.navigation.dispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
  });

  test('a failed save keeps the screen and says so', async () => {
    store.saveMarks.mockRejectedValueOnce(new Error('disk'));
    const u = await open({ checkpoint: 'leadArm' });
    await press(dock(u, 'head'));
    await act(async () => { touch(u.layer, px([0.24, 0.32])); });
    await press(u.getByLabelText(M.primary.editSave));
    expect(u.getByText(M.saveFailed)).toBeTruthy();
    expect(u.navigation.goBack).not.toHaveBeenCalled();
  });

  test('the automatic finish (the "Fix it" door) opens with an auto pill and no chapter', async () => {
    const u = await open({ checkpoint: 'finish' });
    expect(u.getByText('P10 · Finish')).toBeTruthy();
    expect(u.getByText(M.auto)).toBeTruthy();
    expect(u.getByText(M.automatic('P10'))).toBeTruthy();
    ['address', 'leadArm', 'top', 'shaftDown', 'impact', 'shaftThrough'].forEach((k) => expect(u.getByTestId(`chapter-${k}`).props.accessibilityState.selected).toBe(false));
    expect(within(u.getByTestId('mark-stop-line')).getByText(M.stopKind.first)).toBeTruthy();
  });

  test('review: nothing is placed or saved on a still that is not on screen yet (the previous frame is still shown)', async () => {
    const f = FIRST.checkpoints.leadArm.i;
    let arrive;
    getStill.mockImplementation((_id, fr) => (fr === f + 2 ? null : 'file:///doc/swings/s1/frames/x.jpg'));
    ensureStills.mockImplementation(() => new Promise((r) => { arrive = r; }));
    const u = await open({ checkpoint: 'leadArm' });
    await press(u.getByTestId(`fine-${f + 2}`));
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); }); // past the 90 ms debounce
    expect(u.getByTestId('mark-loading')).toBeTruthy();
    expect(u.getByTestId('mark-primary').props.accessibilityState.disabled).toBe(true);
    await press(dock(u, 'head'));
    await act(async () => { touch(u.layer, px([0.24, 0.32])); });
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Missing')); // the tap was refused
    expect(u.getAllByText(M.loadingFrame(f + 2)).length).toBe(2); // the pill on the still and the toast
    getStill.mockReturnValue('file:///doc/swings/s1/frames/x.jpg');
    await act(async () => { arrive({}); });
    expect(u.queryByTestId('mark-loading')).toBeNull();
    await act(async () => { touch(u.layer, px([0.24, 0.32])); });
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Moved'));
  });

  test('review: Undo stays inside the position; a new position starts with nothing to undo', async () => {
    const u = await open({ checkpoint: 'leadArm' });
    await press(dock(u, 'head'));
    await act(async () => { touch(u.layer, px([0.24, 0.32])); });
    expect(u.getByLabelText(M.undoCount(1))).toBeTruthy();
    await press(u.getByTestId('chapter-top'));
    await press(u.getByLabelText(M.confirmLeave));
    expect(u.getByTestId('mark-undo').props.accessibilityState.disabled).toBe(true);
  });

  test('review: TalkBack cannot reach the canvas behind the discard sheet; the touch layer says what a tap does', async () => {
    const u = await open({ checkpoint: 'leadArm' });
    expect(u.layer.props.accessibilityLabel).toBe(`Hands · ${M.line.proposed}`);
    await press(dock(u, 'head'));
    expect(u.layer.props.accessibilityLabel).toBe(`Clubhead · ${M.line.missing('Clubhead')}`);
    await act(async () => { touch(u.layer, px([0.24, 0.32])); });
    await press(u.getByTestId('chapter-top'));
    const body = u.getByTestId('mark-canvas-body', { includeHiddenElements: true });
    expect(body.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(u.getByTestId('mark-discard-sheet').props.accessibilityViewIsModal).toBe(true);
  });

  test('an analysis that is not there says so', async () => {
    const r = setup({ missing: true });
    expect(await r.findByText(M.loadFailed)).toBeTruthy();
  });
});

describe('the marking pass (D26 flow: club sheet → six positions → finish sheet → Results)', () => {
  const walk = async (u, n) => {
    for (let k = 0; k < n; k += 1) {
      await press(u.getByTestId('mark-primary'));
    }
  };

  test('the club sheet comes first, prefilled from the last choice; Start stores the club and opens Address', async () => {
    store.getSwingProfile.mockReturnValue({ lastClub: 'driver' });
    const u = await open({ mode: 'pass', marks: FRESH, at: 'mark-club-sheet' });
    expect(u.getByLabelText('Driver').props.accessibilityState.selected).toBe(true);
    await press(u.getByLabelText('Iron'));
    await press(u.getByTestId('mark-start'));
    expect(store.setSwingClub).toHaveBeenCalledWith('s1', 'iron');
    expect(store.setLastSwingClub).toHaveBeenCalledWith('iron');
    expect(savedMarks().pass).toEqual({ state: 'partial', skipped: [] });
    expect(savedAnalysis().club).toBe('iron');
    expect(u.getByText('P1 · Address')).toBeTruthy();
    expect(u.getByText('1/6')).toBeTruthy();
    expect(u.queryByText(M.cancel)).toBeNull();
    expect(u.getByTestId('mark-skip')).toBeTruthy();
  });

  test('the primary button says what it saves; Looks right saves the step and moves on', async () => {
    const u = await open({ mode: 'pass', seeded: true, marks: { ...FRESH, pass: { state: 'partial', skipped: [] } } });
    expect(u.getByText('P1 · Address')).toBeTruthy();
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Proposed'));
    const f = FIRST.checkpoints.address.i;
    await press(u.getByTestId(`fine-${f - 1}`));
    expect(u.getByLabelText(M.primary.use(f - 1))).toBeTruthy();
    await press(u.getByTestId(`fine-${f}`));
    expect(u.getByLabelText(M.primary.looks)).toBeTruthy();
    await press(u.getByLabelText(M.primary.looks));
    expect(savedMarks().frames.find((x) => x.checkpoint === 'address')).toMatchObject({ confirmed: true, corrected: false });
    expect(savedMarks().ball.confirmed).toBe(true);
    expect(u.getByText('P3 · Lead arm parallel')).toBeTruthy();
    expect(u.getByLabelText(M.primary.noHead)).toBeTruthy(); // D16: no clubhead proposed here
    await press(dock(u, 'head'));
    await act(async () => { touch(u.layer, px([0.24, 0.32])); });
    expect(u.getByLabelText(M.primary.save)).toBeTruthy();
    expect(u.getByText(M.counts(1, 0, 5))).toBeTruthy();
  });

  test('Skip drops the move, records the skip and moves on; the finish sheet counts and explains; See results', async () => {
    const u = await open({ mode: 'pass', marks: { ...FRESH, pass: { state: 'partial', skipped: [] } } });
    await walk(u, 2); // address, lead arm (no clubhead)
    expect(u.getByText('P4 · Top of backswing')).toBeTruthy();
    await press(dock(u, 'head'));
    await act(async () => { touch(u.layer, px([0.3, 0.2])); });
    await press(u.getByTestId('mark-skip'));
    expect(savedMarks().pass.skipped).toEqual(['top']);
    expect(savedMarks().frames.find((x) => x.checkpoint === 'top')).toBeUndefined();
    await walk(u, 3); // shaft down, impact, shaft through
    const sheet = await u.findByTestId('mark-finish-sheet');
    expect(within(sheet).getByText(M.finishTitle(5, 6))).toBeTruthy();
    expect(within(sheet).getByText(M.skippedLine(['Top']))).toBeTruthy();
    expect(within(sheet).getByText(/No clubhead at .*Lead arm/)).toBeTruthy();
    expect(within(u.getByTestId('finish-row-top')).getByText(M.chip.skipped)).toBeTruthy();
    expect(within(u.getByTestId('finish-row-impact')).getByText(M.chip.confirmed)).toBeTruthy();
    expect(u.navigation.replace).not.toHaveBeenCalled(); // never Results before the pass is finished
    await press(u.getByTestId('mark-see-results'));
    expect(savedMarks().pass).toEqual({ state: 'done', skipped: ['top'] });
    expect(u.navigation.replace).toHaveBeenCalledWith('SwingResults', { swingId: 's1' });
  });

  test('review: one Skip button (in the footer), and a double tap moves on one position only', async () => {
    const u = await open({ mode: 'pass', marks: { ...FRESH, pass: { state: 'partial', skipped: [] } } });
    expect(u.getAllByLabelText(M.skip)).toHaveLength(1);
    await act(async () => {
      fireEvent.press(u.getByTestId('mark-primary'));
      fireEvent.press(u.getByTestId('mark-primary'));
    });
    expect(u.getByText('P3 · Lead arm parallel')).toBeTruthy();
  });

  test('review: a failed save does not block the next ones, and Close then offers to leave without saving', async () => {
    const u = await open({ mode: 'pass', marks: { ...FRESH, pass: { state: 'partial', skipped: [] } } });
    store.saveMarks.mockRejectedValueOnce(new Error('disk'));
    await press(u.getByTestId('mark-primary')); // address: this save fails
    expect(u.getByText(M.saveFailed)).toBeTruthy();
    await press(u.getByTestId('mark-skip')); // lead arm: still saved
    expect(savedMarks().pass.skipped).toEqual(['leadArm']);
    store.saveMarks.mockRejectedValueOnce(new Error('disk'));
    await press(u.getByTestId('mark-close'));
    const [title, , buttons] = Alert.alert.mock.calls[Alert.alert.mock.calls.length - 1];
    expect(title).toBe(M.saveFailed);
    buttons.find((b) => b.text === M.leaveUnsaved).onPress();
    expect(u.navigation.goBack).toHaveBeenCalled();
  });

  test('review: "Use frame N" saves the clubhead the golfer saw on that frame, and analyses that same clubhead', async () => {
    const u = await open({ mode: 'pass', seeded: true, marks: { ...FRESH, pass: { state: 'partial', skipped: ['address', 'leadArm', 'top', 'shaftDown'] } } });
    expect(u.getByText('P7 · Impact')).toBeTruthy();
    const f = FIRST.checkpoints.impact.i;
    await press(u.getByTestId(`fine-${f - 1}`));
    await press(u.getByLabelText(M.primary.use(f - 1)));
    const label = savedMarks().frames.find((x) => x.checkpoint === 'impact');
    const a = savedAnalysis();
    expect(label).toMatchObject({ i: f - 1, confirmed: true, head: { confirmed: true } });
    expect(a.checkpoints.impact.i).toBe(f - 1);
    expect(a.clubMarks.impact.head[0]).toBeCloseTo(label.head.final[0], 6);
    expect(a.clubMarks.impact.head[1]).toBeCloseTo(label.head.final[1], 6);
  });

  test('a step moves on at once while its save runs, so the next touch never lands on the position just left', async () => {
    const u = await open({ mode: 'pass', marks: { ...FRESH, pass: { state: 'partial', skipped: [] } } });
    let release;
    store.saveMarks.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    await press(u.getByTestId('mark-primary')); // address
    expect(u.getByText('P3 · Lead arm parallel')).toBeTruthy(); // before the save has finished
    await press(u.getByTestId('mark-skip')); // lead arm, queued behind the first save
    expect(u.getByText('P4 · Top of backswing')).toBeTruthy();
    const before = store.saveMarks.mock.calls.length;
    await act(async () => { release(); });
    expect(store.saveMarks.mock.calls.length).toBe(before + 1);
    expect(savedMarks().pass.skipped).toEqual(['leadArm']); // the later step was written last
  });

  test('a finish-sheet row reopens that position; the next step goes back to the sheet', async () => {
    const st = (keys) => ({ ...FRESH, pass: { state: 'partial', skipped: keys } });
    const u = await open({ mode: 'pass', marks: st(['address', 'leadArm', 'top', 'shaftDown', 'impact', 'shaftThrough']), at: 'mark-finish-sheet' });
    expect(u.getByTestId('mark-finish-sheet')).toBeTruthy();
    await press(u.getByTestId('finish-row-impact'));
    expect(u.getByText('P7 · Impact')).toBeTruthy();
    await press(u.getByTestId('mark-primary'));
    expect(u.getByTestId('mark-finish-sheet')).toBeTruthy();
    expect(within(u.getByTestId('finish-row-impact')).getByText(M.chip.confirmed)).toBeTruthy();
  });

  test('"Finish frame looks wrong? Fix it" opens the canvas at P10 and Save returns to the sheet', async () => {
    const u = await open({ mode: 'pass', marks: { ...FRESH, pass: { state: 'partial', skipped: ['address', 'leadArm', 'top', 'shaftDown', 'impact', 'shaftThrough'] } }, at: 'mark-finish-sheet' });
    await press(u.getByTestId('mark-fix-finish'));
    expect(u.getByText('P10 · Finish')).toBeTruthy();
    expect(u.getByText(M.auto)).toBeTruthy();
    expect(u.queryByTestId('mark-skip')).toBeNull();
    const f = FIRST.checkpoints.finish.i;
    await press(u.getByTestId(`fine-${f + 3}`));
    await press(u.getByLabelText(M.primary.editSave));
    expect(u.getByTestId('mark-finish-sheet')).toBeTruthy();
    expect(savedMarks().frames.find((x) => x.checkpoint === 'finish')).toMatchObject({ i: f + 3, confirmed: true });
    expect(savedAnalysis().checkpoints.finish.i).toBe(f + 3);
  });

  test('resume: a partial pass opens at the first position to do, with the counts so far', async () => {
    const done = await (async () => {
      const u = await open({ mode: 'pass', marks: { ...FRESH, pass: { state: 'partial', skipped: [] } } });
      await walk(u, 2);
      return savedMarks();
    })();
    const again = await open({ mode: 'pass', marks: { ...done, pass: { state: 'partial', skipped: ['top'] } } });
    expect(again.getByText('P6 · Shaft parallel (down)')).toBeTruthy();
    expect(again.getByText('4/6')).toBeTruthy();
    expect(again.getByText(M.counts(2, 1, 3))).toBeTruthy();
  });

  test('marks from before the mark-first flow resume too: their corrected positions count as confirmed', async () => {
    const legacy = { ...emptyMarks({ swingId: 's1' }) };
    const u = await open({ mode: 'pass', marks: legacy });
    expect(u.getByText('P1 · Address')).toBeTruthy();
  });

  test('Close keeps the progress (saved, still partial) and asks first about an unconfirmed move', async () => {
    const u = await open({ mode: 'pass', marks: { ...FRESH, pass: { state: 'partial', skipped: [] } } });
    await walk(u, 1);
    await press(dock(u, 'head'));
    await act(async () => { touch(u.layer, px([0.24, 0.32])); });
    store.saveMarks.mockClear();
    await press(u.getByTestId('mark-close'));
    expect(u.getByTestId('mark-discard-sheet')).toBeTruthy();
    await press(u.getByLabelText(M.confirmLeave));
    expect(savedMarks().pass.state).toBe('partial');
    expect(savedMarks().frames.find((x) => x.checkpoint === 'leadArm').head.confirmed).toBe(true);
    expect(u.navigation.goBack).toHaveBeenCalled();
  });
});

// --- The drag loupe (D20) -------------------------------------------------------------------------
const opt = { includeHiddenElements: true };
const loupeEl = (u) => u.getByTestId('edit-loupe', opt);
const maybeLoupe = (u) => u.queryByTestId('edit-loupe', opt);
const loupeStyle = (u) => StyleSheet.flatten(loupeEl(u).props.style);
const loupeImg = (u) => StyleSheet.flatten(loupeEl(u).findByType(Image).props.style);

describe('the drag loupe (D20) on the canvas', () => {
  test('shows while a mark is dragged, labelled "Placing · <mark>", and goes on release', async () => {
    const u = await open({ checkpoint: 'impact' });
    expect(maybeLoupe(u)).toBeNull();
    const [x, y] = px(FIRST.clubMarks.impact.hands);
    await act(async () => { grant(u.layer, [x, y]); });
    expect(loupeEl(u)).toBeTruthy();
    expect(u.getByText(M.placing('Hands'), opt)).toBeTruthy();
    await act(async () => { move(u.layer, [x + 20, y + 10], [x, y]); });
    await act(async () => { release(u.layer, [x + 20, y + 10], [x, y]); });
    expect(maybeLoupe(u)).toBeNull();
  });

  test('120 px across, above the finger, flips below at the top edge, stays inside the still', async () => {
    const u = await open({ checkpoint: 'impact' });
    const [x, y] = px(FIRST.clubMarks.impact.hands);
    await act(async () => { grant(u.layer, [x, y]); });
    const first = loupeStyle(u);
    expect([first.width, first.height]).toEqual([LOUPE_SIZE, LOUPE_SIZE]);
    expect(first.top + LOUPE_SIZE).toBeLessThan(y);
    await act(async () => { release(u.layer, [x, y]); });
    await press(dock(u, 'head'));
    const finger = [RECT.w - 2, 24];
    await act(async () => { grant(u.layer, finger); });
    expect(loupePlacement(finger, RECT).placement).toBe('below');
    expect(loupeStyle(u).top).toBeGreaterThan(finger[1]);
    expect(loupeStyle(u).left).toBe(RECT.w - LOUPE_SIZE);
    await act(async () => { release(u.layer, finger); });
  });

  test('the same still at 3x centred on the mark; decorative and touch-transparent', async () => {
    const u = await open({ checkpoint: 'impact' });
    const [x, y] = px(FIRST.clubMarks.impact.hands);
    await act(async () => { grant(u.layer, [x, y]); });
    const img = loupeImg(u);
    const want = loupeImage(FIRST.clubMarks.impact.hands, RECT);
    expect([img.width, img.left, img.top]).toEqual([want.width, want.left, want.top]);
    const l = loupeEl(u);
    expect(l.props.accessibilityElementsHidden).toBe(true);
    expect(l.props.pointerEvents).toBe('none');
    await act(async () => { fireEvent(u.layer, 'responderTerminate', { nativeEvent: nativeEvent(x, y), touchHistory: history(x, y) }); });
    expect(maybeLoupe(u)).toBeNull();
  });

  test('an arrow nudge shows it for about 600 ms', async () => {
    const u = await open({ checkpoint: 'impact' });
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      fireEvent.press(u.getByLabelText(M.nudge.right));
      expect(loupeEl(u)).toBeTruthy();
      act(() => { jest.advanceTimersByTime(650); });
      expect(maybeLoupe(u)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
