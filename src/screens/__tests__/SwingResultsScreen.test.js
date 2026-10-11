import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import SwingResultsScreen from '../SwingResultsScreen';
import * as store from '../../store/swingStore';
import { runAnalysis } from '../../swing/runAnalysis';
import { shareSwingExport } from '../../swing/shareExport';
import { getStill, ensureStills } from '../../swing/frames';
import { analyze } from '../../swing/analyze';
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
  subscribeSwings: jest.fn(() => () => {}),
  getSwingsVersion: jest.fn(() => 0),
  getSwing: jest.fn(),
  hydrateSwings: jest.fn(() => Promise.resolve()),
  renameSwing: jest.fn(() => Promise.resolve()),
  readAnalysis: jest.fn(),
  readPose: jest.fn(),
  markSwingFailed: jest.fn(() => Promise.resolve()),
  swingVideoUri: jest.fn(() => 'file:///doc/swings/s1/video.mp4'),
}));
jest.mock('../../swing/shareExport', () => ({ shareSwingExport: jest.fn(() => Promise.resolve('shared')) }));
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
const base = { pass2: { addressFrame: lab.expected.addressFrame, shaft: {} }, heightCm: 176, handedness: 'right', swingId: 's1', createdAt: '2026-10-11T16:42:00.000Z' };
const ownerMarks = Object.fromEntries(Object.entries(TRUTH.checkpoints).map(([k, c]) => [k, {
  hands: norm(c.hands), head: c.hidden ? null : norm(c.head), hidden: c.hidden,
}]));
ownerMarks.preImpact = { hands: norm({ x: 222, y: 400 }), head: norm({ x: 240, y: 470 }), hidden: false };
const MARKED = analyze(pose, { ...base, marks: ownerMarks });
const UNMARKED = analyze(pose, base);

const ROW = { id: 's1', name: 'Sat 11 Oct · 18:42', createdAt: '2026-10-11T16:42:00.000Z', status: 'ready', club: null, source: 'import' };

function setup({ row = ROW, analysis = MARKED } = {}) {
  store.getSwing.mockReturnValue(row);
  store.readAnalysis.mockResolvedValue(analysis);
  store.readPose.mockResolvedValue(pose);
  const navigation = { navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => () => {}) };
  const utils = render(<ThemeProvider><SwingResultsScreen navigation={navigation} route={{ params: { swingId: 's1' } }} /></ThemeProvider>);
  return { ...utils, navigation };
}

const labelOf = (id) => SWING_STRINGS.checkLabel[id];

beforeEach(() => {
  jest.clearAllMocks();
  getStill.mockReturnValue(null);
  ensureStills.mockResolvedValue({});
});

describe('SwingResultsScreen: a stored swing', () => {
  test('shows the verdict, counts, the nine-step timeline and the checks at the opening checkpoint', async () => {
    const { findByText, getByLabelText, getAllByText } = setup();
    expect(await findByText('Early extension.')).toBeTruthy();
    expect(getAllByText(new RegExp(`^${MARKED.counts.red} fix$`)).length).toBeGreaterThan(0);
    expect(getAllByText(/^\d+ fps$/).length).toBeGreaterThan(0);
    ['Address', 'Takeaway', 'Lead arm', 'Top', 'Transition', 'Shaft down', 'Impact', 'Trail arm', 'Finish']
      .forEach((n) => expect(getByLabelText(new RegExp(`^${n}(,|$)`))).toBeTruthy());
    expect(getByLabelText(/^Impact, Fix/)).toBeTruthy(); // worst status dot + word (D14)
    expect(getAllByText(T.atCheckpoint('Impact')).length).toBe(1);
    expect(getAllByText(labelOf('spine_loss')).length).toBeGreaterThan(0);
  });

  test('lists all 15 check rows in the flat "All checks" list, with approx. only where flagged', async () => {
    const { findByText, getAllByLabelText } = setup();
    await findByText(T.allChecks);
    const rows = getAllByLabelText(/^(Posture at address|Hands between the planes|Butt end|Shaft direction|Downswing path|Clubhead on the plane|Hands height|Hands toward|Shaft angle|Spine angle|Hips hold|Head stays|Tempo|Finish balance)/);
    // each check appears once in the list; the ones at impact also appear in the "At impact" card
    expect(rows.length).toBeGreaterThanOrEqual(15);
  });

  test('tapping a timeline step shows that checkpoint and resets the nudge', async () => {
    const { findByText, getByLabelText, getByText } = setup();
    await findByText('Early extension.');
    fireEvent.press(getByLabelText(/^Address/));
    expect(getByText(T.atCheckpoint('Address'))).toBeTruthy();
    fireEvent.press(getByLabelText(T.nextFrame));
    expect(getByText(/\(\+1\)/)).toBeTruthy();
    fireEvent.press(getByLabelText(/^Top/));
    expect(getByText(T.atCheckpoint('Top'))).toBeTruthy();
    expect(() => getByText(/\(\+1\)/)).toThrow();
  });

  test('the frame nudge stops at +-2 (stills exist only there)', async () => {
    const { findByText, getByLabelText, getByText } = setup();
    await findByText('Early extension.');
    for (let i = 0; i < 4; i += 1) fireEvent.press(getByLabelText(T.nextFrame));
    expect(getByText(/\(\+2\)/)).toBeTruthy();
    for (let i = 0; i < 6; i += 1) fireEvent.press(getByLabelText(T.prevFrame));
    expect(getByText(/\(-2\)/)).toBeTruthy();
  });

  test('a checkpoint with no checks says so', async () => {
    const { findByText, getByLabelText, getByText } = setup();
    await findByText('Early extension.');
    fireEvent.press(getByLabelText(/^Takeaway/));
    expect(getByText(T.noChecksAt)).toBeTruthy();
  });

  test('tapping a check selects it', async () => {
    const { findByText, getAllByLabelText } = setup();
    await findByText('Early extension.');
    const spine = getAllByLabelText(/^Spine angle kept/)[0];
    fireEvent.press(spine);
    expect(getAllByLabelText(/^Spine angle kept/)[0].props.accessibilityState.selected).toBe(true);
  });

  test('a row in "All checks" jumps to its checkpoint', async () => {
    const { findByText, getByLabelText, getAllByLabelText, getByText } = setup();
    await findByText('Early extension.');
    fireEvent.press(getByLabelText(/^Address/));
    const rows = getAllByLabelText(/^Hands height at impact/);
    fireEvent.press(rows[rows.length - 1]);
    expect(getByText(T.atCheckpoint('Impact'))).toBeTruthy();
  });

  test('shows the drills for the main fault and expands the rest', async () => {
    const { findByText, getByText, queryByText, getByLabelText } = setup();
    await findByText('Early extension.');
    expect(getByText(T.drillsTitle('Early extension'))).toBeTruthy();
    expect(getByText('The chair')).toBeTruthy();
    expect(queryByText('Club behind the heels')).toBeNull();
    fireEvent.press(getByLabelText(T.moreDrills(1)));
    expect(getByText('Club behind the heels')).toBeTruthy();
  });

  test('D16: club checks with no clubhead placed offer "Place clubhead", which opens Edit marks on that checkpoint', async () => {
    const { findByText, getAllByLabelText, navigation } = setup({ analysis: UNMARKED });
    await findByText('Early extension.');
    const cta = getAllByLabelText(/^Place clubhead: Butt end/);
    fireEvent.press(cta[cta.length - 1]);
    expect(navigation.navigate).toHaveBeenCalledWith('SwingEditMarks', { swingId: 's1', checkpoint: 'leadArm' });
  });

  test('a hidden clubhead is a decision: the row says Hidden and offers no placement', async () => {
    const hiddenOnly = {
      ...MARKED,
      checks: MARKED.checks.map((c) => (c.id === 'downswing_path'
        ? { ...c, status: 'unknown', reason: 'hidden', value: null, text: 'Clubhead hidden at shaft down' } : c)),
    };
    const { findByText, queryByLabelText, getAllByText } = setup({ analysis: hiddenOnly });
    await findByText('Early extension.');
    expect(getAllByText('Hidden').length).toBeGreaterThan(0);
    expect(queryByLabelText(/^Place clubhead: Downswing path/)).toBeNull();
  });

  test('approximate clips say so in the hero and the banner, and flag cm values', async () => {
    const approx = { ...MARKED, approximate: true, checks: MARKED.checks.map((c) => (c.unit === 'cm' ? { ...c, approximate: true } : c)) };
    const { findByText, getByText, getAllByText } = setup({ analysis: approx });
    await findByText('Early extension.');
    expect(getAllByText(T.approxChip).length).toBeGreaterThan(1); // the hero chip and the cm values
    expect(getByText(T.approxBanner)).toBeTruthy();
    expect(getAllByText(/approx\./).length).toBeGreaterThan(2);
  });

  test('Edit marks from the header menu and from the button both open on the current checkpoint; Rename saves', async () => {
    const { findByText, getByLabelText, getByPlaceholderText, navigation } = setup();
    await findByText('Early extension.');
    fireEvent.press(getByLabelText(T.editMarks));
    expect(navigation.navigate).toHaveBeenLastCalledWith('SwingEditMarks', { swingId: 's1', checkpoint: 'impact' });
    fireEvent.press(getByLabelText(T.menu));
    fireEvent.press(getByLabelText(T.rename));
    fireEvent.changeText(getByPlaceholderText(T.renamePlaceholder), 'Range · 7-iron');
    await act(async () => { fireEvent.press(getByLabelText(T.save)); });
    expect(store.renameSwing).toHaveBeenCalledWith('s1', 'Range · 7-iron');
  });

  test('Export swing in the header menu builds the zip and opens the share sheet; a failure says so', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { findByText, getByLabelText } = setup();
    await findByText('Early extension.');
    fireEvent.press(getByLabelText(T.menu));
    await act(async () => { fireEvent.press(getByLabelText(SWING_STRINGS.exportSwing.menu)); });
    expect(shareSwingExport).toHaveBeenCalledWith('s1');
    expect(alert).not.toHaveBeenCalled();
    shareSwingExport.mockRejectedValueOnce(new Error('boom'));
    fireEvent.press(getByLabelText(T.menu));
    await act(async () => { fireEvent.press(getByLabelText(SWING_STRINGS.exportSwing.menu)); });
    expect(alert).toHaveBeenCalledWith(SWING_STRINGS.exportSwing.failed);
  });

  test('asks for the stills it is missing and redraws when they arrive', async () => {
    ensureStills.mockImplementation(async () => { getStill.mockReturnValue('file:///doc/swings/s1/frames/556.jpg'); return { 556: 'file:///x.jpg' }; });
    const { findByText, getByLabelText } = setup();
    await findByText('Early extension.');
    await waitFor(() => expect(ensureStills).toHaveBeenCalled());
    const frame = MARKED.checkpoints.impact.i;
    expect(ensureStills).toHaveBeenCalledWith('s1', [frame - 2, frame - 1, frame, frame + 1, frame + 2]);
    await waitFor(() => expect(getByLabelText(new RegExp(`^Impact still, frame ${frame}`)).props.source).toEqual({ uri: 'file:///doc/swings/s1/frames/556.jpg' }));
  });

  test('reloads the analysis when it comes back into focus (after Edit marks)', async () => {
    const { findByText, navigation } = setup();
    await findByText('Early extension.');
    const focus = navigation.addListener.mock.calls.filter(([n]) => n === 'focus').pop()[1];
    store.readAnalysis.mockClear();
    await act(async () => { focus(); });
    expect(store.readAnalysis).toHaveBeenCalled();
  });
});

describe('SwingResultsScreen: a swing still to analyse', () => {
  const PENDING = { ...ROW, status: 'pending' };

  test('processing shows the stages inside the results shell, then the results with pass 2 pending, then the final state', async () => {
    let onProgress; let onPartial; let finish;
    runAnalysis.mockImplementation((id, o) => { ({ onProgress, onPartial } = o); return new Promise((r) => { finish = r; }); });
    const { findByText, getByText, getAllByText, queryByText, getAllByLabelText } = setup({ row: PENDING, analysis: UNMARKED });

    expect(await findByText(T.stages.reading)).toBeTruthy();
    expect(getByText(T.stages.pose)).toBeTruthy();
    expect(getByText(T.stages.planes)).toBeTruthy();
    expect(getByText('reading…')).toBeTruthy(); // hero skeleton
    await act(async () => { onProgress({ stage: 'pose', done: 120, total: 300, probe: { height: 720, containerFps: 30, captureFps: 240, durationMs: 4100 } }); });
    expect(getByText('120 / 300')).toBeTruthy();
    expect(getByText(/720p · 240 fps · 4\.1 s/)).toBeTruthy();
    expect(getByText(T.notUploaded, { exact: false })).toBeTruthy();

    await act(async () => { await onPartial(UNMARKED); });
    expect(await findByText('Early extension.')).toBeTruthy();
    expect(queryByText(T.stages.reading)).toBeNull();
    // pass 2 pending: the clubhead rows are "calculating", not asking the user yet
    expect(getAllByText(T.calculating).length).toBeGreaterThan(0);
    expect(() => getAllByLabelText(/^Place clubhead/)).toThrow();

    await act(async () => { finish({ analysis: UNMARKED, pass2: 'done' }); });
    await waitFor(() => expect(getAllByLabelText(/^Place clubhead/).length).toBeGreaterThan(0));
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
    const { findByLabelText, findByText } = setup({ row: PENDING });
    fireEvent.press(await findByLabelText(T.retry));
    expect(await findByText(T.stages.reading)).toBeTruthy();
    expect(runAnalysis).toHaveBeenCalledTimes(2);
  });
});
