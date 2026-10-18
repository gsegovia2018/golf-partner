import 'react-native-gesture-handler/jestSetup';
import React, { Profiler } from 'react';
import { Alert, Image, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { Text as SvgText } from 'react-native-svg';
import { ThemeProvider } from '../../theme/ThemeContext';
import SwingEditMarksScreen, { PANEL_H } from '../SwingEditMarksScreen';
import SwingOverlay, { fitRect } from '../../components/swing/SwingOverlay';
import * as store from '../../store/swingStore';
import { getStill, ensureStills, getProxy } from '../../swing/frames';
import { analyze } from '../../swing/analyze';
import { emptyMarks } from '../../swing/labels';
import {
  LOUPE_SIZE, loupeImage, loupeCorner, loupeSide,
} from '../../swing/loupe';
import { trackX } from '../../swing/scrub';
import { SWING_STRINGS } from '../../swing/strings';
import { fixtureNative, TRUTH, W, H } from '../../swing/__tests__/helpers';
import { detectClub, releaseClub, clubOnDemandSupport } from '../../swing/native';
import { resetClubOnDemand } from '../../swing/clubOnDemand';

const lab = require('../../swing/__tests__/fixtures/lab-d15-pass1.json');

// A drag is drawn from shared values: the stock mock would lose them on every render.
jest.mock('react-native-reanimated', () => require('../../swing/__tests__/liveReanimated'));
jest.mock('../../swing/analyze', () => {
  const real = jest.requireActual('../../swing/analyze');
  return { ...real, analyze: jest.fn(real.analyze) };
});
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
  getProxy: jest.fn(() => null),
  ensureStills: jest.fn(() => Promise.resolve({})),
}));

jest.mock('../../swing/native', () => ({
  clubOnDemandSupport: jest.fn(() => false),
  detectClub: jest.fn(),
  releaseClub: jest.fn(() => Promise.resolve()),
}));

const M = SWING_STRINGS.mark;
const STILL = 'file:///doc/swings/s1/frames/x.jpg';
const ball = { x: TRUTH.ball.x / W, y: TRUTH.ball.y / H, r: 2.1 / W };
const pose = { ...fixtureNative({ ball, ballGoneFrame: lab.expected.ballGoneFrame }), pass2: { addressFrame: lab.expected.addressFrame, shaft: {} } };
const probe = { containerFps: 29.97, captureFps: null, duplicateFrameRatio: 0 };
const base = { pass2: pose.pass2, probe, heightCm: 176, handedness: 'right', club: 'iron', source: 'import', swingId: 's1', createdAt: 'x' };
const FIRST = analyze(pose, base);
const FRESH = { ...emptyMarks({ swingId: 's1' }), pass: { state: 'none', skipped: [] } };
const PARTIAL = { ...FRESH, pass: { state: 'partial', skipped: [] } };
const MAX_FRAME = pose.video.frameCount - 1;

// The test window is 750 x 1334 and onLayout never fires: the video is the fallback box, everything
// between the 52 px top row and the fixed panel (D28).
const RECT = fitRect(480, 1334 - 52 - PANEL_H, W, H);
const px = (p) => [p[0] * RECT.w, p[1] * RECT.h];

// Native seeds a clubhead at address and impact (D16): the pass tests use it for "Looks right".
const seeds = (a) => Object.fromEntries(['address', 'impact'].map((k) => [a.checkpoints[k].i, {
  head: [TRUTH.checkpoints[k].head.x, TRUTH.checkpoints[k].head.y], hidden: false, conf: 0.8, source: 'edge',
}]));
const SEEDED_POSE = { ...pose, pass2: { ...pose.pass2, shaft: seeds(FIRST) } };
const SEEDED = analyze(SEEDED_POSE, { ...base, pass2: SEEDED_POSE.pass2 });

function setup({
  analysis = FIRST, marks = null, checkpoint = 'leadArm', mode, active, missing = false, seeded = false, poseOverride = null,
} = {}) {
  store.readAnalysis.mockResolvedValue(missing ? null : seeded ? SEEDED : analysis);
  store.readPose.mockResolvedValue(poseOverride ?? (seeded ? SEEDED_POSE : pose));
  store.readProbe.mockResolvedValue(probe);
  store.readMarks.mockResolvedValue(marks);
  const listeners = {};
  const navigation = {
    goBack: jest.fn(), dispatch: jest.fn(), navigate: jest.fn(), replace: jest.fn(),
    addListener: jest.fn((name, cb) => { listeners[name] = cb; return () => {}; }),
  };
  const commits = { n: 0 }; // every React commit under the screen
  const utils = render(
    <Profiler id="screen" onRender={() => { commits.n += 1; }}>
      <ThemeProvider><SwingEditMarksScreen navigation={navigation} route={{ params: { swingId: 's1', checkpoint, mode, active } }} /></ThemeProvider>
    </Profiler>,
  );
  return { ...utils, navigation, listeners, commits };
}

const open = async ({ at = 'mark-canvas', settle = true, ...opts } = {}) => {
  const r = setup(opts);
  await r.findByTestId(at);
  // step 2 takes no touch until the still of its frame is on screen
  if (at === 'mark-canvas' && settle) await waitFor(() => expect(r.queryByTestId('mark-loading')).toBeNull());
  return r;
};
const savedMarks = () => store.saveMarks.mock.calls[store.saveMarks.mock.calls.length - 1][1];
const savedAnalysis = () => store.saveAnalysis.mock.calls[store.saveAnalysis.mock.calls.length - 1][1];
const rowStatus = (a, id, cp) => a.checks.find((c) => c.id === id && (!cp || c.cp === cp)).status;
const dock = (u, m) => u.getByTestId(`dock-${m}`);
const dockLabel = (u, m) => dock(u, m).props.accessibilityLabel;
const press = async (el) => { await act(async () => { fireEvent.press(el); }); };
const step = (u) => (u.queryByTestId('mark-step-1') ? 1 : u.queryByTestId('mark-step-2') ? 2 : null);
const picture = (u) => u.UNSAFE_getAllByType(SwingOverlay)[0].props.uri;

// The two UI-thread gestures (D28). In Jest the worklets are plain functions: these call the Pan's
// own callbacks, so a test can stop in the middle of a drag (fireGestureHandler always finishes it).
const ev = (x, y = 0) => ({ x, y, absoluteX: x, absoluteY: y });
const markPan = () => getByGestureTestId('mark-pan');
const grant = (pt) => act(async () => { markPan().handlers.onBegin(ev(...pt)); });
// As on a device: the Pan activates (onStart) once the finger moves; a tap never activates it and
// ends unsuccessful.
const move = (pt) => act(async () => { markPan().handlers.onStart(ev(...pt)); markPan().handlers.onUpdate(ev(...pt)); });
const release = (pt) => act(async () => { markPan().handlers.onFinalize(ev(...pt), true); });
const touch = async (pt, moves = []) => {
  await act(async () => {
    const g = markPan().handlers;
    g.onBegin(ev(...pt));
    if (moves.length) g.onStart(ev(...moves[0]));
    moves.forEach((m) => g.onUpdate(ev(...m)));
    g.onFinalize(ev(...(moves.length ? moves[moves.length - 1] : pt)), moves.length > 0);
  });
};
const TRACK_W = 300;
const layoutTrack = (u) => act(async () => {
  fireEvent(u.getByTestId('mark-track'), 'layout', { nativeEvent: { layout: { width: TRACK_W, height: 32 } } });
});
const trackPan = () => getByGestureTestId('scrub-track');
const atFrame = (f) => trackX(f, TRACK_W, MAX_FRAME);

/** Edit mode opens at step 2; "‹ Frame", a frame from the zoomed row, "Use frame" chooses another. */
const chooseFrame = async (u, f) => {
  if (step(u) === 2) await press(u.getByTestId('mark-change-frame'));
  await press(u.getByTestId(`zoom-${f}`));
  await press(u.getByTestId('mark-use-frame'));
  await waitFor(() => expect(u.queryByTestId('mark-loading')).toBeNull());
};

beforeEach(() => {
  jest.clearAllMocks();
  getStill.mockReturnValue(STILL);
  getProxy.mockReturnValue(null);
  ensureStills.mockImplementation(() => Promise.resolve({})); // clearAllMocks keeps a test's own implementation
  store.saveMarks.mockImplementation(() => Promise.resolve());
  store.getSwingProfile.mockReturnValue({ lastClub: 'iron' });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('the layout (D28: frame first, then marks)', () => {
  test('one slim top row: close and the seven chips (P-number, status dot, short name); the old strip and tiles are gone', async () => {
    const u = await open({ mode: 'pass', marks: PARTIAL });
    ['address', 'takeaway', 'leadArm', 'top', 'shaftDown', 'impact', 'trailArm'].forEach((k) => expect(u.getByTestId(`chapter-${k}`)).toBeTruthy());
    ['transition', 'shaftThrough', 'finish'].forEach((k) => expect(u.queryByTestId(`chapter-${k}`)).toBeNull());
    expect(u.getByTestId('chapter-address').props.accessibilityState.selected).toBe(true);
    expect(within(u.getByTestId('mark-count')).getByText('1/7')).toBeTruthy();
    expect(within(u.getByTestId('mark-count')).getByText(M.tally(0, 0))).toBeTruthy();
    expect(within(u.getByTestId('mark-step-1')).getByTestId('mark-count')).toBeTruthy(); // the count is in the panel's step header now
    expect(within(u.getByTestId('mark-chapters')).queryByTestId('mark-count')).toBeNull();
    expect(u.queryByTestId('mark-fine-strip')).toBeNull();
    expect(u.queryByTestId('mark-undo')).toBeNull();
    const overlay = u.UNSAFE_getAllByType(SwingOverlay)[0];
    expect(overlay.props.pose).toBeUndefined(); // no skeleton or planes while marking
    expect(overlay.props.showPlanes).toBe(false);
    expect([overlay.props.width, overlay.props.height]).toEqual([480, 1334 - 52 - PANEL_H]); // the video takes the rest
  });

  test('step 1: the cue INSIDE the video (pictogram, FIRST/LAST FRAME, stop phrase, watch), the track, the zoomed row ±4, "Proposed frame looks right"', async () => {
    const u = await open({ mode: 'pass', marks: { ...PARTIAL, pass: { state: 'partial', skipped: ['address', 'takeaway', 'leadArm'] } } });
    expect(step(u)).toBe(1);
    const video = u.getByTestId('mark-video');
    const cue = within(video).getByTestId('mark-stop-line');
    expect(within(cue).getByText(M.stopKind.last)).toBeTruthy();
    expect(within(cue).getByText(/before the club starts down/)).toBeTruthy();
    expect(within(cue).getByText(M.watch('the clubhead, not the hands'))).toBeTruthy();
    expect(within(cue).getByTestId('mark-pictogram', { includeHiddenElements: true })).toBeTruthy();
    const f = FIRST.checkpoints.top.i;
    expect(u.getByTestId(`zoom-${f - 4}`)).toBeTruthy();
    expect(u.getByTestId(`zoom-${f + 4}`)).toBeTruthy();
    expect(u.queryByTestId(`zoom-${f + 5}`)).toBeNull();
    expect(u.getByTestId('mark-track')).toBeTruthy();
    expect(u.getByText(M.onProposal)).toBeTruthy();
    expect(u.getByLabelText(M.primary.proposedOk)).toBeTruthy();
    expect(u.getByTestId('mark-skip')).toBeTruthy();
    expect(u.queryByTestId('dock-hands')).toBeNull(); // the marks come in step 2
    expect(within(u.getByTestId('mark-frame-tag')).getByText(M.frameTag(f))).toBeTruthy();
  });

  test('"More" expands the full cue over the video; a tap on it closes it', async () => {
    const u = await open({ mode: 'pass', marks: { ...PARTIAL, pass: { state: 'partial', skipped: ['address', 'takeaway', 'leadArm', 'top', 'shaftDown', 'impact'] } } });
    await press(u.getByTestId('mark-stop-line'));
    expect(within(u.getByTestId('mark-video')).getByText(/first frame your right arm is level in the follow-through/)).toBeTruthy();
    await press(u.getByTestId('mark-cue'));
    expect(u.queryByTestId('mark-cue')).toBeNull();
    expect(u.getByTestId('mark-stop-line')).toBeTruthy();
  });

  test('cues are mirrored for a left-handed golfer', async () => {
    const u = await open({ checkpoint: 'shaftDown', analysis: analyze(pose, { ...base, handedness: 'left' }) });
    await press(u.getByTestId('mark-change-frame'));
    expect(within(u.getByTestId('mark-stop-line')).getByText(/hands by the left hip/)).toBeTruthy();
  });

  test('step 2: the frame frozen, the position pill, the dock INSIDE the video, the mark row, the nudge, "‹ Frame"', async () => {
    const u = await open({ checkpoint: 'top' });
    expect(step(u)).toBe(2);
    const f = FIRST.checkpoints.top.i;
    const video = u.getByTestId('mark-video');
    expect(within(video).getByTestId('mark-pospill').props.accessibilityLabel).toBe(M.posPill('P4', 'Top', f, false));
    ['hands', 'head', 'ball'].forEach((m) => expect(within(video).getByTestId(`dock-${m}`)).toBeTruthy());
    expect(u.getByTestId('mark-row')).toBeTruthy();
    expect(u.getByText(M.nudgeHint)).toBeTruthy();
    expect(u.getByLabelText(M.changeFrameA11y)).toBeTruthy();
    expect(u.queryByTestId('mark-scrubber')).toBeNull();
    expect(u.queryByTestId('mark-stop-line')).toBeNull();
  });

  test('review: every mark on the still has its chip (hands, clubhead, ball at address)', async () => {
    const u = await open({ checkpoint: 'address', seeded: true });
    const chips = () => u.UNSAFE_getAllByType(SvgText).map((n) => n.props.children);
    expect(chips().sort()).toEqual(['BALL · PROPOSED', 'CLUBHEAD · PROPOSED', 'HANDS · PROPOSED']);
    await press(u.getByTestId('mark-confirm'));
    expect(chips()).toContain('HANDS · CONFIRMED');
  });

  test('an analysis that is not there says so', async () => {
    const r = setup({ missing: true });
    expect(await r.findByText(M.loadFailed)).toBeTruthy();
  });
});

describe('step 1 → step 2 → next (the pass)', () => {
  const walk = async (u, n) => {
    for (let k = 0; k < n; k += 1) {
      await press(u.getByTestId('mark-use-frame'));
      await press(u.getByTestId('mark-primary'));
    }
  };

  test('the club sheet comes first, prefilled from the last choice; Start stores the club and opens Address at step 1', async () => {
    store.getSwingProfile.mockReturnValue({ lastClub: 'driver' });
    const u = await open({ mode: 'pass', marks: FRESH, at: 'mark-club-sheet' });
    expect(u.getByLabelText('Driver').props.accessibilityState.selected).toBe(true);
    await press(u.getByLabelText('Iron'));
    await press(u.getByTestId('mark-start'));
    expect(store.setSwingClub).toHaveBeenCalledWith('s1', 'iron');
    expect(store.setLastSwingClub).toHaveBeenCalledWith('iron');
    expect(savedMarks().pass).toEqual({ state: 'partial', skipped: [] });
    expect(savedAnalysis().club).toBe('iron');
    expect(u.getByTestId('chapter-address').props.accessibilityState.selected).toBe(true);
    expect(step(u)).toBe(1);
    expect(u.queryByText(M.cancel)).toBeNull();
    expect(u.getByTestId('mark-skip')).toBeTruthy();
  });

  test('each button says what it does: proposed frame → step 2 → "Looks right · next" saves and opens the next position at step 1', async () => {
    const u = await open({ mode: 'pass', seeded: true, marks: PARTIAL });
    const f = FIRST.checkpoints.address.i;
    await press(u.getByTestId(`zoom-${f - 1}`));
    expect(u.getByLabelText(M.primary.useFrame(f - 1))).toBeTruthy();
    expect(u.getByText(M.offProposal(-1))).toBeTruthy();
    await press(u.getByTestId(`zoom-${f}`));
    await press(u.getByLabelText(M.primary.proposedOk));
    expect(step(u)).toBe(2);
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Proposed')); // the seed, on the proposed frame
    expect(store.saveMarks).not.toHaveBeenCalled(); // step 1 → 2 saves nothing yet
    await press(u.getByLabelText(M.primary.looks));
    const addr = savedMarks().frames.find((x) => x.checkpoint === 'address');
    expect(addr).toMatchObject({ confirmed: true, corrected: false, confirmedFrame: true });
    expect(savedMarks().ball.confirmed).toBe(true);
    expect(u.getByTestId('chapter-takeaway').props.accessibilityState.selected).toBe(true);
    expect(step(u)).toBe(1);
    expect(within(u.getByTestId('mark-count')).getByText(M.tally(1, 0))).toBeTruthy();
    await press(u.getByTestId('mark-use-frame'));
    expect(u.getByLabelText(M.primary.noHead)).toBeTruthy(); // D16: no clubhead proposed here
    await press(dock(u, 'head'));
    await touch(px([0.24, 0.32]));
    expect(u.getByLabelText(M.primary.save)).toBeTruthy();
  });

  test('a chosen frame is the position\'s frame: saved as i with the proposal beside it, and analysed there', async () => {
    const u = await open({ mode: 'pass', marks: PARTIAL });
    const f = FIRST.checkpoints.address.i;
    await press(u.getByLabelText(M.nextFrame));
    await press(u.getByLabelText(M.nextFrame));
    await press(u.getByLabelText(M.primary.useFrame(f + 2)));
    expect(u.getByTestId('mark-pospill').props.accessibilityLabel).toBe(M.posPill('P1', 'Address', f + 2, true));
    await press(u.getByTestId('mark-primary'));
    const addr = savedMarks().frames.find((x) => x.checkpoint === 'address');
    expect([addr.i, addr.iProposed, addr.confirmedFrame]).toEqual([f + 2, f, true]);
    expect(savedAnalysis().checkpoints.address.i).toBe(f + 2);
  });

  test('Skip (step 1) records the skip and moves on; the finish sheet counts and explains; See results', async () => {
    const u = await open({ mode: 'pass', marks: PARTIAL });
    await walk(u, 3); // address, takeaway, lead arm (no clubhead)
    expect(u.getByTestId('chapter-top').props.accessibilityState.selected).toBe(true);
    await press(u.getByTestId('mark-skip'));
    expect(savedMarks().pass.skipped).toEqual(['top']);
    expect(savedMarks().frames.find((x) => x.checkpoint === 'top')).toBeUndefined();
    await walk(u, 3); // shaft down, impact, trail arm
    const sheet = await u.findByTestId('mark-finish-sheet');
    expect(within(sheet).getByText(M.finishTitle(6, 7))).toBeTruthy();
    expect(within(sheet).getByText(M.skippedLine(['Top']))).toBeTruthy();
    expect(within(sheet).getByText(/No clubhead at .*Halfway back/)).toBeTruthy();
    expect(within(u.getByTestId('finish-row-top')).getByText(M.chip.skipped)).toBeTruthy();
    expect(u.navigation.replace).not.toHaveBeenCalled(); // never Results before the pass is finished
    await press(u.getByTestId('mark-see-results'));
    expect(savedMarks().pass).toEqual({ state: 'done', skipped: ['top'] });
    expect(u.navigation.replace).toHaveBeenCalledWith('SwingResults', { swingId: 's1' });
  });

  test('review: a double tap on either primary moves on one step only', async () => {
    const u = await open({ mode: 'pass', marks: PARTIAL });
    await act(async () => {
      fireEvent.press(u.getByTestId('mark-use-frame'));
      fireEvent.press(u.getByTestId('mark-use-frame'));
    });
    expect(step(u)).toBe(2);
    await act(async () => {
      fireEvent.press(u.getByTestId('mark-primary'));
      fireEvent.press(u.getByTestId('mark-primary'));
    });
    expect(u.getByTestId('chapter-takeaway').props.accessibilityState.selected).toBe(true);
    expect(step(u)).toBe(1);
  });

  test('a step moves on at once while its save runs; a failed save does not block the next ones', async () => {
    const u = await open({ mode: 'pass', marks: PARTIAL });
    let done;
    store.saveMarks.mockImplementationOnce(() => new Promise((r) => { done = r; }));
    await walk(u, 1); // address
    expect(u.getByTestId('chapter-takeaway').props.accessibilityState.selected).toBe(true); // before the save has finished
    store.saveMarks.mockRejectedValueOnce(new Error('disk'));
    await press(u.getByTestId('mark-skip')); // takeaway, queued behind the first save, and failing
    await act(async () => { done(); });
    expect(u.getByText(M.saveFailed)).toBeTruthy();
    await press(u.getByTestId('mark-skip')); // lead arm: still saved
    expect(savedMarks().pass.skipped).toEqual(['takeaway', 'leadArm']);
    store.saveMarks.mockRejectedValueOnce(new Error('disk'));
    await press(u.getByTestId('mark-close'));
    const [title, , buttons] = Alert.alert.mock.calls[Alert.alert.mock.calls.length - 1];
    expect(title).toBe(M.saveFailed);
    buttons.find((b) => b.text === M.leaveUnsaved).onPress();
    expect(u.navigation.goBack).toHaveBeenCalled();
  });

  test('a finish-sheet row reopens that position (a confirmed one at step 2); the next step goes back to the sheet', async () => {
    const st = (keys) => ({ ...FRESH, pass: { state: 'partial', skipped: keys } });
    const u = await open({ mode: 'pass', marks: st(['address', 'takeaway', 'leadArm', 'top', 'shaftDown', 'impact', 'trailArm']), at: 'mark-finish-sheet' });
    await press(u.getByTestId('finish-row-impact'));
    expect(step(u)).toBe(1); // skipped: the frame first
    await walk(u, 1);
    expect(u.getByTestId('mark-finish-sheet')).toBeTruthy();
    expect(within(u.getByTestId('finish-row-impact')).getByText(M.chip.confirmed)).toBeTruthy();
    await press(u.getByTestId('finish-row-impact'));
    expect(step(u)).toBe(2); // confirmed: straight to its marks
  });

  test('"Finish frame looks wrong? Fix it" opens P10 at step 1; the chosen frame is saved and the sheet returns', async () => {
    const u = await open({ mode: 'pass', marks: { ...FRESH, pass: { state: 'partial', skipped: ['address', 'takeaway', 'leadArm', 'top', 'shaftDown', 'impact', 'trailArm'] } }, at: 'mark-finish-sheet' });
    await press(u.getByTestId('mark-fix-finish'));
    expect(step(u)).toBe(1);
    expect(within(u.getByTestId('mark-count')).getByText(M.auto)).toBeTruthy();
    expect(u.queryByTestId('mark-skip')).toBeNull();
    const f = FIRST.checkpoints.finish.i;
    await chooseFrame(u, f + 3);
    await press(u.getByLabelText(M.primary.editSave));
    expect(u.getByTestId('mark-finish-sheet')).toBeTruthy();
    expect(savedMarks().frames.find((x) => x.checkpoint === 'finish')).toMatchObject({ i: f + 3, confirmed: true });
    expect(savedAnalysis().checkpoints.finish.i).toBe(f + 3);
  });

  test('resume: a partial pass opens at the first position to do, with the counts so far', async () => {
    const done = await (async () => {
      const u = await open({ mode: 'pass', marks: PARTIAL });
      await walk(u, 3);
      return savedMarks();
    })();
    const again = await open({ mode: 'pass', marks: { ...done, pass: { state: 'partial', skipped: ['top'] } } });
    expect(again.getByTestId('chapter-shaftDown').props.accessibilityState.selected).toBe(true);
    expect(within(again.getByTestId('mark-count')).getByText('5/7')).toBeTruthy();
    expect(within(again.getByTestId('mark-count')).getByText(M.tally(3, 1))).toBeTruthy();
  });

  test('marks from before the mark-first flow resume too', async () => {
    const u = await open({ mode: 'pass', marks: { ...emptyMarks({ swingId: 's1' }) } });
    expect(u.getByTestId('chapter-address').props.accessibilityState.selected).toBe(true);
  });

  test('Close keeps the progress (saved, still partial) and asks first about an unconfirmed move', async () => {
    const u = await open({ mode: 'pass', marks: PARTIAL });
    await walk(u, 1);
    await press(u.getByTestId('mark-use-frame'));
    await press(dock(u, 'head'));
    await touch(px([0.24, 0.32]));
    store.saveMarks.mockClear();
    await press(u.getByTestId('mark-close'));
    expect(u.getByTestId('mark-discard-sheet')).toBeTruthy();
    await press(u.getByLabelText(M.confirmLeave));
    expect(savedMarks().pass.state).toBe('partial');
    expect(savedMarks().frames.find((x) => x.checkpoint === 'takeaway').head.confirmed).toBe(true);
    expect(u.navigation.goBack).toHaveBeenCalled();
  });
});

describe('changing the frame resets that position\'s marks (D28)', () => {
  test('"‹ Frame" goes back with nothing lost; another frame says so on the button, resets the marks and toasts', async () => {
    const u = await open({ checkpoint: 'impact', seeded: true });
    const f = FIRST.checkpoints.impact.i;
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Proposed'));
    const [x, y] = px(SEEDED.clubMarks.impact.hands);
    await touch([x, y], [[x + 30, y - 10]]);
    expect(dockLabel(u, 'hands')).toBe(M.dockLabel('Hands', 'Moved'));
    await press(u.getByTestId('mark-change-frame'));
    expect(step(u)).toBe(1);
    expect(u.getByLabelText(M.primary.proposedOk)).toBeTruthy(); // the same frame: nothing will reset
    await press(u.getByTestId('mark-use-frame'));
    expect(dockLabel(u, 'hands')).toBe(M.dockLabel('Hands', 'Moved')); // kept
    expect(u.queryByText(M.framesReset)).toBeNull();
    await press(u.getByTestId('mark-change-frame'));
    await press(u.getByTestId(`zoom-${f + 2}`));
    expect(u.getByLabelText(M.primary.useReset(f + 2))).toBeTruthy();
    await press(u.getByTestId('mark-use-frame'));
    expect(u.getByText(M.framesReset)).toBeTruthy();
    expect(dockLabel(u, 'hands')).toBe(M.dockLabel('Hands', 'Proposed')); // the tracked grip at the new frame
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Missing')); // the seed was for the proposed frame
    expect(u.getByTestId('mark-pospill').props.accessibilityLabel).toBe(M.posPill('P7', 'Impact', f + 2, true));
    await press(u.getByLabelText(M.primary.editSave));
    const label = savedMarks().frames.find((m) => m.checkpoint === 'impact');
    expect(label).toMatchObject({ i: f + 2, iProposed: f, confirmedFrame: true, hands: { placed: false } });
    expect(label.head.final).toBeNull();
    expect(savedAnalysis().checkpoints.impact.i).toBe(f + 2);
  });

  test('review: a resumed position with saved marks warns before another frame wipes them; an untouched one does not', async () => {
    const first = await open({ mode: 'pass', marks: PARTIAL });
    await press(first.getByTestId('mark-use-frame'));
    await press(first.getByTestId('mark-primary')); // address
    await press(first.getByTestId('mark-use-frame'));
    await press(dock(first, 'head'));
    await touch(px([0.24, 0.32]));
    await press(first.getByTestId('mark-close'));
    await press(first.getByLabelText(M.confirmLeave)); // the clubhead confirmed, the position still to do
    const saved = savedMarks();
    first.unmount();
    const u = await open({ mode: 'pass', marks: saved });
    const f = FIRST.checkpoints.takeaway.i;
    expect(u.getByTestId('chapter-takeaway').props.accessibilityState.selected).toBe(true);
    expect(step(u)).toBe(1);
    await press(u.getByTestId(`zoom-${f + 1}`));
    expect(u.getByLabelText(M.primary.useReset(f + 1))).toBeTruthy();
    await press(u.getByTestId('mark-use-frame'));
    expect(u.getByText(M.framesReset)).toBeTruthy();
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Missing'));
    await press(u.getByTestId('chapter-top')); // untouched: no warning, no toast
    await press(u.getByTestId(`zoom-${FIRST.checkpoints.top.i + 1}`));
    expect(u.getByLabelText(M.primary.useFrame(FIRST.checkpoints.top.i + 1))).toBeTruthy();
    await press(u.getByTestId('mark-use-frame'));
    expect(u.queryByText(M.framesReset)).toBeNull();
  });

  test('back on the proposed frame the clubhead proposal returns; the ball (one per swing) stays where it was', async () => {
    const u = await open({ checkpoint: 'address', seeded: true });
    const f = SEEDED.checkpoints.address.i;
    await press(dock(u, 'ball'));
    const [bx, by] = px(SEEDED.reference.ball);
    await touch([bx + 3, by + 2], [[bx + 20, by + 10]]);
    expect(dockLabel(u, 'ball')).toBe(M.dockLabel('Ball', 'Moved'));
    await chooseFrame(u, f + 4);
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Missing'));
    expect(dockLabel(u, 'ball')).toBe(M.dockLabel('Ball', 'Moved'));
    await chooseFrame(u, f);
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Proposed'));
    await press(u.getByLabelText(M.primary.editSave));
    expect(savedMarks().ball).toMatchObject({ corrected: true, confirmed: true });
  });
});

describe('the whole-clip scrub (D28)', () => {
  test('any frame of the clip is reachable: the track maps the finger to the frame and commits it on release', async () => {
    const u = await open({ mode: 'pass', marks: PARTIAL });
    await layoutTrack(u);
    const target = MAX_FRAME - 3;
    await act(async () => {
      fireGestureHandler(trackPan(), [
        { state: State.BEGAN, x: 20 }, { state: State.ACTIVE, x: 150 }, { state: State.ACTIVE, x: atFrame(target) }, { state: State.END, x: atFrame(target) },
      ]);
    });
    expect(u.getByLabelText(M.primary.useFrame(target))).toBeTruthy();
    expect(within(u.getByTestId('mark-frame-line')).getByText(new RegExp(`^Frame ${target} `))).toBeTruthy();
    expect(u.getByTestId(`zoom-${target}`)).toBeTruthy(); // the zoomed row re-centres on it
  });

  test('device: a tap on the track never activates the Pan (it ends unsuccessful) and still snaps', async () => {
    const u = await open({ mode: 'pass', marks: PARTIAL });
    await layoutTrack(u);
    const top = FIRST.checkpoints.top.i;
    await act(async () => { const g = trackPan().handlers; g.onBegin(ev(atFrame(top) + 3)); g.onFinalize(ev(atFrame(top) + 3), false); });
    expect(u.getByLabelText(M.primary.useFrame(top))).toBeTruthy();
  });

  test('a scrub the system cancels after it started picks nothing', async () => {
    const u = await open({ mode: 'pass', marks: PARTIAL });
    await layoutTrack(u);
    await act(async () => { const g = trackPan().handlers; g.onBegin(ev(20)); g.onStart(ev(200)); g.onUpdate(ev(200)); g.onFinalize(ev(200), false); });
    expect(u.getByLabelText(M.primary.proposedOk)).toBeTruthy();
    expect(within(u.getByTestId('mark-frame-tag')).getByText(M.frameTag(FIRST.checkpoints.address.i))).toBeTruthy();
  });

  test('a tap near a position tick or the proposal flag snaps to it', async () => {
    const u = await open({ mode: 'pass', marks: PARTIAL });
    await layoutTrack(u);
    const top = FIRST.checkpoints.top.i;
    await act(async () => { fireGestureHandler(trackPan(), [{ state: State.BEGAN, x: atFrame(top) + 5 }, { state: State.END, x: atFrame(top) + 5 }]); });
    expect(u.getByLabelText(M.primary.useFrame(top))).toBeTruthy();
    const addr = FIRST.checkpoints.address.i;
    await act(async () => { fireGestureHandler(trackPan(), [{ state: State.BEGAN, x: atFrame(addr) - 4 }, { state: State.END, x: atFrame(addr) - 4 }]); });
    expect(u.getByLabelText(M.primary.proposedOk)).toBeTruthy();
  });

  test('while dragging: the nearest proxy, labelled scrubbing, and no analysis or canvas change; on release the full-res still and its neighbours', async () => {
    const f0 = FIRST.checkpoints.address.i;
    const target = FIRST.checkpoints.impact.i + 7;
    const onDisk = new Set([f0]);
    getStill.mockImplementation((_id, fr) => (onDisk.has(fr) ? `file:///still/${fr}.jpg` : null));
    getProxy.mockImplementation((_id, fr) => `file:///proxy/${Math.round(fr / 4) * 4}.jpg`);
    ensureStills.mockImplementation(async (_id, frames) => { frames.forEach((fr) => onDisk.add(fr)); return {}; });
    const u = await open({ mode: 'pass', marks: PARTIAL });
    await layoutTrack(u);
    expect(picture(u)).toBe(`file:///still/${f0}.jpg`);
    analyze.mockClear();
    const g = trackPan().handlers;
    await act(async () => { g.onBegin(ev(atFrame(f0))); });
    await act(async () => { g.onStart(ev(atFrame(target))); g.onUpdate(ev(atFrame(target))); });
    expect(picture(u)).toBe(`file:///proxy/${Math.round(target / 4) * 4}.jpg`);
    expect(within(u.getByTestId('mark-frame-tag')).getByText(`${M.frameTag(target)} · ${M.scrubbing}`)).toBeTruthy();
    expect(u.getByTestId(`zoom-${target}`)).toBeTruthy();
    expect(u.getByLabelText(M.primary.proposedOk)).toBeTruthy(); // the canvas still has the committed frame
    expect(analyze).not.toHaveBeenCalled();
    expect(ensureStills).not.toHaveBeenCalled(); // nothing is decoded while the finger is down
    await act(async () => { g.onFinalize(ev(atFrame(target)), true); });
    expect(u.getByLabelText(M.primary.useFrame(target))).toBeTruthy();
    await waitFor(() => expect(ensureStills).toHaveBeenCalledWith('s1', [target], 'target'));
    await waitFor(() => expect(picture(u)).toBe(`file:///still/${target}.jpg`));
    expect(within(u.getByTestId('mark-frame-tag')).getByText(M.frameTag(target))).toBeTruthy();
    await waitFor(() => expect(ensureStills).toHaveBeenCalledWith('s1', expect.arrayContaining([target - 4, target - 1, target + 1, target + 4]), 'neighbours'));
  });

  test('apiVersion 2 binary (or a swing from before D28): no proxies, so the last still stays while dragging and fills on release', async () => {
    const f0 = FIRST.checkpoints.address.i;
    const target = f0 + 40;
    const onDisk = new Set([f0]);
    getStill.mockImplementation((_id, fr) => (onDisk.has(fr) ? `file:///still/${fr}.jpg` : null));
    getProxy.mockReturnValue(null);
    ensureStills.mockImplementation(async (_id, frames) => { frames.forEach((fr) => onDisk.add(fr)); return {}; });
    const u = await open({ mode: 'pass', marks: PARTIAL });
    await layoutTrack(u);
    const g = trackPan().handlers;
    await act(async () => { g.onBegin(ev(atFrame(f0))); g.onStart(ev(atFrame(target))); g.onUpdate(ev(atFrame(target))); });
    expect(picture(u)).toBe(`file:///still/${f0}.jpg`); // the last still
    expect(within(u.getByTestId('mark-frame-tag')).getByText(`${M.frameTag(target)} · ${M.scrubbing}`)).toBeTruthy();
    expect(u.getByTestId(`zoom-${target}`).findAllByType(Image)).toEqual([]); // nothing to show yet
    await act(async () => { g.onFinalize(ev(atFrame(target)), true); });
    await waitFor(() => expect(picture(u)).toBe(`file:///still/${target}.jpg`));
  });
});

describe('step 2: placing the marks', () => {
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
    await touch(px([0.24, 0.32]));
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

  test('the gesture is wired through gesture-handler events too (fireGestureHandler)', async () => {
    const u = await open({ checkpoint: 'leadArm' });
    await press(dock(u, 'head'));
    const [x, y] = px([0.3, 0.3]);
    await act(async () => { fireGestureHandler(markPan(), [{ state: State.BEGAN, x, y }, { state: State.ACTIVE, x, y }, { state: State.END, x, y }]); });
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Moved'));
  });

  test('Hidden is a decision (status Hidden, no Confirm); placing a head unhides it', async () => {
    const u = await open({ checkpoint: 'top' });
    await press(dock(u, 'head'));
    await press(u.getByTestId('mark-hidden'));
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Hidden'));
    expect(u.getByText(M.hiddenToast)).toBeTruthy();
    expect(u.queryByTestId('mark-confirm')).toBeNull();
    await touch(px([0.3, 0.3]));
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Moved'));
  });

  test('a drag moves the hands; Save writes them as placed', async () => {
    const u = await open({ checkpoint: 'impact' });
    const impact = FIRST.clubMarks.impact.hands;
    const [x, y] = px(impact);
    await touch([x + 6, y - 5], [[x + 30, y - 10], [x + 60, y - 20]]);
    expect(dockLabel(u, 'hands')).toBe(M.dockLabel('Hands', 'Moved'));
    await press(u.getByLabelText(M.primary.editSave));
    const hands = savedMarks().frames.find((f) => f.checkpoint === 'impact').hands;
    expect(hands.placed).toBe(true);
    expect(hands.final[0]).toBeGreaterThan(impact[0] + 0.1);
  });

  test('arrows nudge by one video pixel; a missing clubhead is not invented', async () => {
    const u = await open({ checkpoint: 'impact' });
    const impact = FIRST.clubMarks.impact.hands;
    await press(u.getByLabelText(M.nudge.right));
    await press(u.getByLabelText(M.nudge.right));
    await press(u.getByLabelText(M.nudge.down));
    await press(dock(u, 'head'));
    await press(u.getByLabelText(M.nudge.left));
    expect(u.getByText(M.placeHead)).toBeTruthy();
    await press(u.getByLabelText(M.primary.editSave));
    const hands = savedMarks().frames.find((f) => f.checkpoint === 'impact').hands.final;
    expect(hands[0]).toBeCloseTo(impact[0] + 2 / W, 6);
    expect(hands[1]).toBeCloseTo(impact[1] + 1 / H, 6);
  });

  test('a chapter tap with an unconfirmed move asks: Keep editing stays, Discard reverts, Confirm and leave keeps', async () => {
    const u = await open({ checkpoint: 'leadArm' });
    await press(dock(u, 'head'));
    await touch(px([0.24, 0.32]));
    await press(u.getByTestId('chapter-top'));
    expect(u.getByTestId('mark-discard-sheet')).toBeTruthy();
    await press(u.getByLabelText(M.keepEditing));
    expect(u.queryByTestId('mark-discard-sheet')).toBeNull();
    expect(u.getByTestId('chapter-leadArm').props.accessibilityState.selected).toBe(true);
    await press(u.getByTestId('chapter-top'));
    await press(u.getByLabelText(M.discardMove));
    expect(u.getByTestId('chapter-top').props.accessibilityState.selected).toBe(true);
    await press(u.getByTestId('chapter-leadArm'));
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Missing'));
    await press(dock(u, 'head'));
    await touch(px([0.24, 0.32]));
    await press(u.getByTestId('chapter-top'));
    await press(u.getByLabelText(M.confirmLeave));
    await press(u.getByTestId('chapter-leadArm'));
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Confirmed'));
  });

  test('an unconfirmed position reads Save (it confirms it); once confirmed and untouched, Done closes without writing', async () => {
    const u = await open({ checkpoint: 'top' });
    await press(u.getByLabelText(M.primary.editSave));
    u.unmount();
    const again = await open({ checkpoint: 'top', analysis: savedAnalysis(), marks: savedMarks() });
    store.saveMarks.mockClear();
    await press(again.getByLabelText(M.primary.editDone));
    expect(store.saveMarks).not.toHaveBeenCalled();
    expect(again.navigation.goBack).toHaveBeenCalled();
  });

  test('Cancel (the close button in edit mode) asks before dropping changes; Discard performs the blocked navigation', async () => {
    const event = () => ({ preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } });
    const c = await open({ checkpoint: 'leadArm' });
    expect(c.getByTestId('mark-close').props.accessibilityLabel).toBe(M.cancel);
    const clean = event();
    c.listeners.beforeRemove(clean);
    expect(clean.preventDefault).toHaveBeenCalled(); // the guard always routes through the canvas…
    expect(c.navigation.dispatch).toHaveBeenCalledWith({ type: 'GO_BACK' }); // …which lets a clean screen go
    c.unmount();
    const u = await open({ checkpoint: 'leadArm' });
    await press(dock(u, 'head'));
    await touch(px([0.24, 0.32]));
    await press(u.getByTestId('mark-close'));
    const [title, , buttons] = Alert.alert.mock.calls[0];
    expect(title).toBe(M.leaveTitle);
    expect(buttons.map((b) => b.text)).toEqual([M.keepEditing, M.discard]);
  });

  test('a failed save keeps the screen and says so', async () => {
    store.saveMarks.mockRejectedValueOnce(new Error('disk'));
    const u = await open({ checkpoint: 'leadArm' });
    await press(dock(u, 'head'));
    await touch(px([0.24, 0.32]));
    await press(u.getByLabelText(M.primary.editSave));
    expect(u.getByText(M.saveFailed)).toBeTruthy();
    expect(u.navigation.goBack).not.toHaveBeenCalled();
  });

  test('edit from Results opens step 2 at the saved frame; the automatic finish has an "auto" count and no chapter', async () => {
    const u = await open({ checkpoint: 'finish' });
    expect(step(u)).toBe(2);
    expect(u.getByTestId('mark-pospill').props.accessibilityLabel).toBe(M.posPill('P10', 'Finish', FIRST.checkpoints.finish.i, false));
    expect(within(u.getByTestId('mark-count')).getByText(M.auto)).toBeTruthy();
    ['address', 'takeaway', 'leadArm', 'top', 'shaftDown', 'impact', 'trailArm'].forEach((k) => expect(u.getByTestId(`chapter-${k}`).props.accessibilityState.selected).toBe(false));
    await press(u.getByTestId('mark-change-frame'));
    expect(within(u.getByTestId('mark-stop-line')).getByText(M.stopKind.first)).toBeTruthy();
  });

  test('edit from Results on a saved chosen frame opens there, marked (chosen)', async () => {
    const u = await open({ checkpoint: 'impact' });
    const f = FIRST.checkpoints.impact.i;
    await chooseFrame(u, f - 1);
    await press(u.getByLabelText(M.primary.editSave));
    u.unmount();
    const again = await open({ checkpoint: 'impact', analysis: savedAnalysis(), marks: savedMarks() });
    expect(step(again)).toBe(2);
    expect(again.getByTestId('mark-pospill').props.accessibilityLabel).toBe(M.posPill('P7', 'Impact', f - 1, true));
    expect(within(again.getByTestId('mark-frame-tag')).getByText(M.frameTag(f - 1))).toBeTruthy();
  });

  test('review: step 1 cannot take a frame it is not showing; "Use frame N" waits for that exact still', async () => {
    const f = FIRST.checkpoints.leadArm.i;
    let arrive;
    getStill.mockImplementation((_id, fr) => (fr === f + 2 ? null : STILL));
    getProxy.mockImplementation((_id, fr) => `file:///proxy/${fr}.jpg`);
    ensureStills.mockImplementation(() => new Promise((r) => { arrive = r; }));
    const u = await open({ checkpoint: 'leadArm' });
    await press(u.getByTestId('mark-change-frame'));
    await press(u.getByTestId(`zoom-${f + 2}`));
    expect(picture(u)).toBe(`file:///proxy/${f + 2}.jpg`); // not the frame itself yet
    expect(within(u.getByTestId('mark-frame-tag')).getByText(`${M.frameTag(f + 2)} · ${M.loadingTag}`)).toBeTruthy();
    expect(u.getByTestId('mark-use-frame').props.accessibilityState.disabled).toBe(true);
    await press(u.getByTestId('mark-use-frame'));
    expect(step(u)).toBe(1);
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); }); // past the 90 ms debounce
    getStill.mockReturnValue(STILL);
    await act(async () => { arrive({}); });
    expect(within(u.getByTestId('mark-frame-tag')).getByText(M.frameTag(f + 2))).toBeTruthy();
    expect(u.getByTestId('mark-use-frame').props.accessibilityState.disabled).toBe(false);
  });

  test('review: nothing is placed on a still that is not on screen yet (step 2 opened on a frame still being extracted)', async () => {
    const f = FIRST.checkpoints.leadArm.i;
    let arrive;
    getStill.mockImplementation((_id, fr) => (fr === f ? null : STILL));
    ensureStills.mockImplementation(() => new Promise((r) => { arrive = r; }));
    const u = await open({ checkpoint: 'leadArm', settle: false });
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); }); // past the 90 ms debounce
    expect(u.getByTestId('mark-loading')).toBeTruthy();
    expect(u.getByTestId('mark-primary').props.accessibilityState.disabled).toBe(true);
    await press(dock(u, 'head'));
    await touch(px([0.24, 0.32]));
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Missing')); // the tap was refused
    expect(u.getAllByText(M.loadingFrame(f)).length).toBe(2); // the pill on the still and the toast
    getStill.mockReturnValue(STILL);
    await act(async () => { arrive({}); });
    expect(u.queryByTestId('mark-loading')).toBeNull();
    await touch(px([0.24, 0.32]));
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Moved'));
  });

  test('review: TalkBack cannot reach the canvas behind the discard sheet; the touch layer says what a tap does', async () => {
    const u = await open({ checkpoint: 'leadArm' });
    const layer = () => u.getByTestId('edit-touch-layer');
    expect(layer().props.accessibilityLabel).toBe(`Hands · ${M.line.proposed}`);
    await press(dock(u, 'head'));
    expect(layer().props.accessibilityLabel).toBe(`Clubhead · ${M.line.missing('Clubhead')}`);
    await touch(px([0.24, 0.32]));
    await press(u.getByTestId('chapter-top'));
    const body = u.getByTestId('mark-canvas-body', { includeHiddenElements: true });
    expect(body.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(u.getByTestId('mark-discard-sheet').props.accessibilityViewIsModal).toBe(true);
  });
});

// --- The loupe (D20; D28: in the corner opposite the mark) ----------------------------------------
const opt = { includeHiddenElements: true };
const loupeEl = (u) => u.getByTestId('edit-loupe', opt);
const flat = (el) => StyleSheet.flatten(el.props.style);
const loupeShown = (u) => flat(loupeEl(u)).opacity === 1;
const loupeAt = (u) => { const { transform } = flat(loupeEl(u)); return { left: transform[0].translateX, top: transform[1].translateY }; };
const loupeImg = (u) => flat(loupeEl(u).findByType(Image).parent);
const dragged = (u) => flat(u.getByTestId('edit-loupe-mark', opt));

describe('the loupe on the canvas', () => {
  test('shows while a mark is dragged, labelled "Placing · <mark>", the same still at 3x, and goes on release', async () => {
    const u = await open({ checkpoint: 'impact' });
    expect(loupeShown(u)).toBe(false);
    const hands = FIRST.clubMarks.impact.hands;
    const [x, y] = px(hands);
    await grant([x, y]);
    expect(loupeShown(u)).toBe(true);
    expect(u.getByText(M.placing('Hands'), opt)).toBeTruthy();
    expect(loupeEl(u).findByType(Image).props).toMatchObject({ source: { uri: STILL }, resizeMethod: 'scale' }); // the canvas's own bitmap
    const want = loupeImage(hands, RECT);
    expect([loupeImg(u).width, loupeImg(u).transform]).toEqual([want.width, [{ translateX: want.left }, { translateY: want.top }]]);
    await move([x + 20, y + 10]);
    await release([x + 20, y + 10]);
    expect(loupeShown(u)).toBe(false);
    const l = loupeEl(u);
    expect(l.props.accessibilityElementsHidden).toBe(true);
    expect(l.props.pointerEvents).toBe('none');
  });

  test('sits in the right-hand corner away from the mark, and switches only when the mark comes near it', async () => {
    const u = await open({ checkpoint: 'impact' });
    await press(dock(u, 'head'));
    const low = [RECT.w * 0.3, RECT.h * 0.8]; // a mark low in the frame: the loupe goes top-right
    await grant(low);
    expect(loupeAt(u)).toEqual(loupeCorner(0, RECT));
    expect([LOUPE_SIZE, flat(loupeEl(u)).width]).toEqual([120, 120]);
    await move([RECT.w * 0.3, RECT.h * 0.3]); // up into the top half, but far from the ring: it stays
    expect(loupeAt(u)).toEqual(loupeCorner(0, RECT));
    const near = loupeCorner(0, RECT);
    await move([near.left + 60, near.top + 60]); // the clubhead was placed under the finger, so it follows it exactly
    expect(loupeSide([near.left + 60, near.top + 60], RECT, LOUPE_SIZE, 0)).toBe(1);
    expect(loupeAt(u)).toEqual(loupeCorner(1, RECT)); // the mark reached the ring: bottom-right now
    await release([0, 0]);
  });

  test('an arrow nudge shows it for about 600 ms', async () => {
    const u = await open({ checkpoint: 'impact' });
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'queueMicrotask'] });
    try {
      fireEvent.press(u.getByLabelText(M.nudge.right));
      expect(loupeShown(u)).toBe(true);
      act(() => { jest.advanceTimersByTime(650); });
      expect(loupeShown(u)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

// --- A drag runs on the UI thread and commits once, on release ----------------------------------------

describe('dragging a mark does not touch React or the analysis until release', () => {
  const path = (n = 60, [dx, dy] = [36, -18]) => Array.from({ length: n }, (_, k) => [(dx * (k + 1)) / n, (dy * (k + 1)) / n]);

  test('60 moves: no analyze() and no React commit per move; one analyze() and one commit on release', async () => {
    const u = await open({ checkpoint: 'impact' });
    const [x, y] = px(FIRST.clubMarks.impact.hands);
    await grant([x, y]);
    analyze.mockClear();
    const afterGrant = u.commits.n;
    await act(async () => { path().forEach((d) => markPan().handlers.onUpdate(ev(x + d[0], y + d[1]))); });
    expect(analyze).not.toHaveBeenCalled();
    expect(u.commits.n).toBe(afterGrant); // zero renders for 60 moves
    // the dragged mark and the loupe are on the finger meanwhile
    expect(dragged(u).opacity).toBe(1);
    expect(dragged(u).transform[0].translateX).toBeCloseTo(x + 36, 4);
    expect(dragged(u).transform[1].translateY).toBeCloseTo(y - 18, 4);
    expect(loupeShown(u)).toBe(true);
    expect(store.saveMarks).not.toHaveBeenCalled();
    const before = u.commits.n;
    await release([x + 36, y - 18]);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(u.commits.n - before).toBeLessThanOrEqual(2); // the release (and the overlay clear), not 60
    expect(loupeShown(u)).toBe(false);
    expect(dragged(u).opacity).toBe(0);
    expect(dockLabel(u, 'hands')).toBe(M.dockLabel('Hands', 'Moved'));
  });

  test('the SVG layer skips the mark under the finger and draws it again, moved, after the release', async () => {
    const u = await open({ checkpoint: 'impact', seeded: true });
    const [x, y] = px(FIRST.clubMarks.impact.hands);
    const chips = () => u.UNSAFE_getAllByType(SvgText).map((t) => t.props.children).filter((c) => typeof c === 'string' && c.includes('·'));
    expect(chips().some((c) => c.startsWith(M.names.hands.toUpperCase()))).toBe(true);
    await grant([x, y]);
    expect(chips().some((c) => c.startsWith(M.names.hands.toUpperCase()))).toBe(false);
    expect(chips().some((c) => c.startsWith(M.names.head.toUpperCase()))).toBe(true); // the others stay
    await move([x + 20, y]);
    await release([x + 20, y]);
    expect(chips().some((c) => c.startsWith(M.names.hands.toUpperCase()))).toBe(true);
  });

  test('review: a drag whose position changed under it (a chapter tap mid-drag) commits nothing anywhere', async () => {
    const u = await open({ checkpoint: 'impact' });
    const [x, y] = px(FIRST.clubMarks.impact.hands);
    await grant([x, y]);
    await move([x + 40, y]);
    await press(u.getByTestId('chapter-top'));
    await release([x + 40, y]);
    expect(dockLabel(u, 'hands')).toBe(M.dockLabel('Hands', 'Proposed')); // not dropped on Top
    await press(u.getByTestId('chapter-impact'));
    expect(dockLabel(u, 'hands')).toBe(M.dockLabel('Hands', 'Proposed')); // nor on Impact
  });

  test('a touch on a mark that does not move commits nothing; a tap off the marks places the active one once, on release', async () => {
    const u = await open({ checkpoint: 'impact' });
    const [x, y] = px(FIRST.clubMarks.impact.hands);
    analyze.mockClear();
    await touch([x, y]);
    expect(analyze).not.toHaveBeenCalled();
    expect(dockLabel(u, 'hands')).toBe(M.dockLabel('Hands', 'Proposed'));
    await press(dock(u, 'head'));
    const [hx, hy] = px([0.3, 0.3]);
    await grant([hx, hy]);
    expect(analyze).not.toHaveBeenCalled();
    await release([hx, hy]);
    expect(analyze).toHaveBeenCalledTimes(1);
    await press(u.getByTestId('mark-primary'));
    const head = savedMarks().frames.find((f) => f.checkpoint === 'impact').head.final;
    expect(head[0]).toBeCloseTo(0.3, 2);
    expect(head[1]).toBeCloseTo(0.3, 2);
  });

  test('a drag the system cancels commits nothing and clears the overlay; nudge and confirm still work after it', async () => {
    const u = await open({ checkpoint: 'impact' });
    const [x, y] = px(FIRST.clubMarks.impact.hands);
    analyze.mockClear();
    await act(async () => {
      const g = markPan().handlers;
      g.onBegin(ev(x, y));
      g.onStart(ev(x + 12, y));
      g.onUpdate(ev(x + 12, y));
      g.onFinalize(ev(x + 12, y), false); // cancelled after it had started
    });
    expect(analyze).not.toHaveBeenCalled();
    expect(dockLabel(u, 'hands')).toBe(M.dockLabel('Hands', 'Proposed'));
    expect(loupeShown(u)).toBe(false);
    expect(dragged(u).opacity).toBe(0);
    await press(u.getByLabelText(M.nudge.right));
    await press(u.getByTestId('mark-confirm'));
    expect(dockLabel(u, 'hands')).toBe(M.dockLabel('Hands', 'Confirmed'));
  });
});

describe('club on demand: the model proposes a clubhead on the frame the golfer chose', () => {
  const f = FIRST.checkpoints.impact.i + 2;
  // an answer the test releases by hand, in display px of the decoded frame
  const later = () => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return {
      promise,
      answer: (frame, head = [0.4 * W, 0.5 * H]) => act(async () => {
        resolve({ frames: { [frame]: { head, hidden: false, conf: 0.7, source: 'model', boxes: [] } }, timings: {} });
      }),
    };
  };
  const headStatus = (u) => dockLabel(u, 'head');
  const asks = () => detectClub.mock.calls.map((c) => c[0]).filter((q) => q.frames.length); // the warm-up has none

  beforeEach(() => {
    resetClubOnDemand();
    clubOnDemandSupport.mockReturnValue(true);
    detectClub.mockReset();
  });
  afterAll(() => { clubOnDemandSupport.mockReturnValue(false); });

  test('"Use frame N" asks once with the frame\'s still and the grip; the dot lands as proposed, never confirmed', async () => {
    const d = later();
    detectClub.mockReturnValue(d.promise);
    const u = await open({ checkpoint: 'impact' });
    await chooseFrame(u, f);
    expect(asks()).toHaveLength(1);
    const q = asks()[0];
    expect(q.frames).toHaveLength(1);
    expect(q.frames[0]).toMatchObject({ frame: f, still: STILL });
    expect(q.frames[0].grip).toHaveLength(2);
    expect(q.video).toEqual({ width: W, height: H });
    expect(q.pxPerCm).toBeGreaterThan(0);
    expect(q.scenery).toEqual([]); // analysed before apiVersion 5: no scenery filter
    expect(headStatus(u)).toBe(M.dockLabel('Clubhead', 'Missing'));
    await d.answer(f);
    expect(headStatus(u)).toBe(M.dockLabel('Clubhead', 'Proposed'));
    await press(u.getByLabelText(M.primary.editSave));
    const label = savedMarks().frames.find((m) => m.checkpoint === 'impact');
    expect(label.head).toMatchObject({ proposedSource: 'model', proposedAt: f, confirmed: true });
    expect(label.head.proposed).toEqual([0.4, 0.5]);
  });

  test('passes the scenery pass 2 stored', async () => {
    const scenery = [{ cls: 'head', box: [1, 2, 3, 4] }];
    const withScenery = { ...pose, pass2: { ...pose.pass2, club: { model: 'm', scenery } } };
    detectClub.mockResolvedValue({ frames: {} });
    const u = await open({ checkpoint: 'impact', poseOverride: withScenery });
    await chooseFrame(u, f);
    expect(asks()[0].scenery).toEqual(scenery);
  });

  test('a head hidden before the answer arrives stays hidden', async () => {
    const d = later();
    detectClub.mockReturnValue(d.promise);
    const u = await open({ checkpoint: 'impact' });
    await chooseFrame(u, f);
    await press(dock(u, 'head'));
    await press(u.getByTestId('mark-hidden'));
    await d.answer(f);
    expect(headStatus(u)).toBe(M.dockLabel('Clubhead', 'Hidden'));
  });

  test('an answer for a frame that is no longer chosen is ignored', async () => {
    const first = later();
    detectClub.mockReturnValueOnce(first.promise).mockResolvedValue({ frames: {} });
    const u = await open({ checkpoint: 'impact' });
    await chooseFrame(u, f);
    await chooseFrame(u, f + 1);
    await first.answer(f);
    expect(u.getByTestId('mark-pospill').props.accessibilityLabel).toBe(M.posPill('P7', 'Impact', f + 1, true));
    expect(headStatus(u)).toBe(M.dockLabel('Clubhead', 'Missing'));
  });

  test('an answer during a drag is held and applied after the drop', async () => {
    const d = later();
    detectClub.mockReturnValue(d.promise);
    const u = await open({ checkpoint: 'impact' });
    await chooseFrame(u, f);
    const [x, y] = px(FIRST.clubMarks.impact.hands);
    await grant([x, y]);
    await move([x + 10, y]);
    await d.answer(f);
    expect(headStatus(u)).toBe(M.dockLabel('Clubhead', 'Missing'));
    await release([x + 10, y]);
    expect(headStatus(u)).toBe(M.dockLabel('Clubhead', 'Proposed'));
  });

  test('apiVersion 4: nothing is asked and the head is Missing as before', async () => {
    clubOnDemandSupport.mockReturnValue(false);
    const u = await open({ checkpoint: 'impact' });
    await chooseFrame(u, f);
    expect(detectClub).not.toHaveBeenCalled(); // no warm-up either
    expect(headStatus(u)).toBe(M.dockLabel('Clubhead', 'Missing'));
  });

  test('the proposed frame of a swing pass 2 saw with the model asks nothing', async () => {
    const modelled = { ...SEEDED_POSE, pass2: { ...SEEDED_POSE.pass2, club: { model: 'm' } } };
    const u = await open({ checkpoint: 'impact', seeded: true, poseOverride: modelled });
    await press(u.getByTestId('mark-change-frame'));
    await press(u.getByTestId('mark-use-frame'));
    expect(asks()).toHaveLength(0);
  });

  test('the first scrub away from the proposal warms the detector; closing releases it', async () => {
    detectClub.mockResolvedValue({ frames: {} });
    const u = await open({ checkpoint: 'impact' });
    await press(u.getByTestId('mark-change-frame'));
    await press(u.getByTestId(`zoom-${f}`));
    await press(u.getByTestId(`zoom-${f + 1}`));
    expect(detectClub).toHaveBeenCalledTimes(1);
    expect(detectClub.mock.calls[0][0].frames).toEqual([]);
    u.unmount();
    expect(releaseClub).toHaveBeenCalled();
  });
});

describe('checks v2: seven positions, the unsure clubhead, the deep link', () => {
  const SHORT = SWING_STRINGS.position.short;
  const walk = async (u, n) => {
    for (let k = 0; k < n; k += 1) {
      await press(u.getByTestId('mark-use-frame'));
      await press(u.getByTestId('mark-primary'));
    }
  };
  // the detector saw something at Halfway back under the checks' gate, and something sure at the top
  const proposed = (conf) => {
    const p = { ...pose, pass2: { ...pose.pass2, shaft: { [FIRST.checkpoints.leadArm.i]: { head: [W * 0.24, H * 0.32], hidden: false, conf, source: 'model' } } } };
    return { p, a: analyze(p, { ...base, pass2: p.pass2 }) };
  };

  test('the chips read P-number, dot, short name: seven of them, 46 px wide, no pictograms', async () => {
    const u = await open({ mode: 'pass', marks: PARTIAL });
    const keys = ['address', 'takeaway', 'leadArm', 'top', 'shaftDown', 'impact', 'trailArm'];
    keys.forEach((k, i) => {
      const chip = within(u.getByTestId(`chapter-${k}`));
      expect(chip.getByText(`P${[1, 2, 3, 4, 6, 7, 9][i]}`)).toBeTruthy();
      expect(chip.getByText(SHORT[k])).toBeTruthy();
      expect(chip.queryByTestId(`pictogram-${k}`)).toBeNull();
    });
    expect(u.getByTestId('chapter-leadArm').props.accessibilityLabel).toBe(M.chapterA11y('Halfway back', 'todo'));
  });

  test('step 1 at Takeaway and at Follow-through draws their own pictogram', async () => {
    const skipped = (keys) => ({ ...PARTIAL, pass: { state: 'partial', skipped: keys } });
    const a = await open({ mode: 'pass', marks: skipped(['address']) });
    expect(a.getByTestId('chapter-takeaway').props.accessibilityState.selected).toBe(true);
    expect(within(a.getByTestId('mark-stop-line')).getByTestId('mark-pictogram', { includeHiddenElements: true })).toBeTruthy();
    a.unmount();
    const b = await open({ mode: 'pass', marks: skipped(['address', 'takeaway', 'leadArm', 'top', 'shaftDown', 'impact']) });
    expect(b.getByTestId('chapter-trailArm').props.accessibilityState.selected).toBe(true);
    expect(within(b.getByTestId('mark-stop-line')).getByTestId('mark-pictogram', { includeHiddenElements: true })).toBeTruthy();
  });

  test('a detection under the gate is proposed but says Unsure; Confirm makes it the golfers and the checks read it', async () => {
    const { p, a } = proposed(0.05);
    expect(a.clubMarks.leadArm.head).toBeTruthy();
    const u = await open({ analysis: a, poseOverride: p, checkpoint: 'leadArm' });
    await press(dock(u, 'head'));
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Unsure'));
    expect(u.getByText(`Clubhead · ${M.line.unsure}`)).toBeTruthy();
    await press(u.getByTestId('mark-confirm'));
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Confirmed'));
    await press(u.getByLabelText(M.primary.editSave));
    const lead = savedMarks().frames.find((f) => f.checkpoint === 'leadArm');
    expect(lead.head).toMatchObject({ confirmed: true, proposedSource: 'model' });
    expect(savedAnalysis().clubMarks.leadArm.source).toBe('user');
    expect(rowStatus(savedAnalysis(), 'butt_extension')).not.toBe('unknown');
  });

  test('a detection the checks would read stays Proposed', async () => {
    const { p, a } = proposed(0.9);
    const u = await open({ analysis: a, poseOverride: p, checkpoint: 'leadArm' });
    await press(dock(u, 'head'));
    expect(dockLabel(u, 'head')).toBe(M.dockLabel('Clubhead', 'Proposed'));
  });

  test('the deep link from Results opens the position at step 2 with the Clubhead active', async () => {
    const u = await open({ checkpoint: 'shaftDown', active: 'head' });
    expect(step(u)).toBe(2);
    expect(u.getByTestId('chapter-shaftDown').props.accessibilityState.selected).toBe(true);
    expect(dock(u, 'head').props.accessibilityState.selected).toBe(true);
    expect(dock(u, 'hands').props.accessibilityState.selected).toBe(false);
    expect(u.getByText(`Clubhead · ${M.line.missing('Clubhead')}`)).toBeTruthy();
    expect(u.getByTestId('mark-pospill').props.accessibilityLabel).toBe(M.posPill('P6', 'Downswing', FIRST.checkpoints.shaftDown.i, false));
  });

  test('without the link, Edit marks still opens on the hands', async () => {
    const u = await open({ checkpoint: 'shaftDown' });
    expect(dock(u, 'hands').props.accessibilityState.selected).toBe(true);
  });

  test('walking all seven positions ends on the finish sheet: "7 of 7", the gate explained, the finish read automatically', async () => {
    const u = await open({ mode: 'pass', marks: PARTIAL });
    await walk(u, 7);
    const sheet = await u.findByTestId('mark-finish-sheet');
    expect(within(sheet).getByText(M.finishTitle(7, 7))).toBeTruthy();
    expect(within(sheet).getByText(/the detector was not sure there/)).toBeTruthy();
    expect(within(sheet).getByText(M.autoLine)).toBeTruthy();
    ['address', 'takeaway', 'leadArm', 'top', 'shaftDown', 'impact', 'trailArm'].forEach((k) => expect(within(sheet).getByTestId(`finish-row-${k}`)).toBeTruthy());
    expect(within(sheet).getByText('Halfway back')).toBeTruthy();
    expect(within(sheet).getByText('Follow-through')).toBeTruthy();
    expect(within(sheet).queryByText(/Transition|Shaft through/)).toBeNull();
  });

  test('Spanish: the chips and the unsure line speak Spanish', async () => {
    const { setLanguagePref } = require('../../i18n');
    await act(async () => { await setLanguagePref('es'); });
    try {
      const { p, a } = proposed(0.05);
      const u = await open({ analysis: a, poseOverride: p, checkpoint: 'leadArm' });
      await press(dock(u, 'head'));
      expect(dockLabel(u, 'head')).toBe(SWING_STRINGS.mark.dockLabel('Cabeza del palo', 'Dudosa'));
      expect(u.getByText(/Dudosa · confírmala o toca donde está/)).toBeTruthy();
      expect(within(u.getByTestId('chapter-shaftDown')).getByText('Bajada')).toBeTruthy();
      expect(within(u.getByTestId('chapter-trailArm')).getByText('Seguim.')).toBeTruthy();
    } finally {
      await act(async () => { await setLanguagePref('en'); });
    }
  });
});
