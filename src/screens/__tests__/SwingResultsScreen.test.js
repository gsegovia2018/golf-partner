import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
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
import { homeOf, prioritizeChecks } from '../../swing/checkpointChecks';
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
  readProbe: jest.fn(),
  readMarks: jest.fn(),
  saveAnalysis: jest.fn(),
  getSwingProfile: jest.fn(() => ({ practiceOpen: false })),
  setPracticeOpen: jest.fn(() => Promise.resolve(true)),
  markSwingFailed: jest.fn(() => Promise.resolve()),
  deleteSwing: jest.fn(() => Promise.resolve()),
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

// marks.json as Edit marks wrote it: the owner's hands and clubheads (what a re-score reads back).
const OWNER_MARKS = [...Object.entries(TRUTH.checkpoints).map(([k, c]) => [k, c.frame, c.hands, c.hidden ? null : c.head, c.hidden]),
  ['preImpact', 550, { x: 222, y: 400 }, { x: 240, y: 470 }, false]]
  .reduce((m, [k, i, hands, head, hidden]) => withFrame(m, frameLabel({
    i, checkpoint: k, hands: { proposed: null, final: norm(hands), placed: true }, head: { proposed: null, final: norm(head), finalHidden: hidden },
  })), emptyMarks({ swingId: 's1' }));

const ROW = {
  id: 's1', name: 'Sat 11 Oct · 18:42', createdAt: '2026-10-11T16:42:00.000Z', status: 'ready', club: null, source: 'import', marked: { state: 'done', count: 6 },
};

function setup({ row = ROW, analysis = MARKED, marks = OWNER_MARKS } = {}) {
  store.getSwing.mockReturnValue(row);
  store.readAnalysis.mockResolvedValue(analysis);
  store.readPose.mockResolvedValue({ ...pose, pass2: base.pass2 });
  store.readProbe.mockResolvedValue(null);
  store.readMarks.mockResolvedValue(marks);
  store.saveAnalysis.mockImplementation(async (_id, a) => { store.readAnalysis.mockResolvedValue(a); });
  const navigation = {
    navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn(), addListener: jest.fn(() => () => {}),
  };
  const utils = render(<ThemeProvider><SwingResultsScreen navigation={navigation} route={{ params: { swingId: 's1' } }} /></ThemeProvider>);
  return { ...utils, navigation };
}

const labelOf = (id) => SWING_STRINGS.checkLabel[id];
const FIXES = fixesFor(MARKED);
const openDetail = (u) => fireEvent.press(u.getByTestId('results-detail-toggle')); // the position cards are folded away
const VERDICT = `${MARKED.main.label}.`; // D21: 'Posture at address.' on the owner swing

beforeEach(() => {
  jest.clearAllMocks();
  getStill.mockReturnValue(null);
  ensureStills.mockResolvedValue({});
});

describe('SwingResultsScreen: coaching', () => {
  const F = T.fixes;

  test('the priority card lists red, then yellow, then unknown, each in swing order; greens are folded', async () => {
    const { findByText, getByTestId, queryByLabelText } = setup();
    await findByText(VERDICT);
    const card = within(getByTestId('results-priority'));
    expect(card.getByText(T.priorityTitle)).toBeTruthy();
    const groups = prioritizeChecks(MARKED.checks);
    const nameOf = (c) => (c.cp && T.cpSuffix[c.cp] ? `${c.label}, ${T.cpSuffix[c.cp]}` : c.label);
    const expected = [...groups.red, ...groups.yellow, ...groups.unknown].map(nameOf);
    const labels = card.getAllByLabelText(/./).filter((n) => n.props.accessibilityRole === 'button' && !n.props.testID).map((n) => n.props.accessibilityLabel);
    const rows = labels.filter((l) => expected.some((e) => l.startsWith(`${e},`)));
    expect(rows.map((l) => expected.find((e) => l.startsWith(`${e},`)))).toEqual(expected);
    expect(groups.green.length).toBeGreaterThan(0);
    expect(queryByLabelText(new RegExp(`^${nameOf(groups.green[0])},`))).toBeNull();
    expect(card.getAllByText(SWING_STRINGS.statusWord.red).length).toBeGreaterThan(0); // the group header
  });

  test('greens stay hidden until the fold row is pressed, and it says how many', async () => {
    const { findByText, getByTestId } = setup();
    await findByText(VERDICT);
    const green = prioritizeChecks(MARKED.checks).green;
    const fold = getByTestId('results-good-fold');
    expect(within(fold).getByText(T.goodFold(green.length))).toBeTruthy();
    expect(fold.props.accessibilityState).toMatchObject({ expanded: false });
    const row = () => within(getByTestId('results-priority')).queryAllByLabelText(new RegExp(`^${green[0].label}`));
    expect(row()).toHaveLength(0);
    fireEvent.press(fold);
    expect(getByTestId('results-good-fold').props.accessibilityState).toMatchObject({ expanded: true });
    expect(row().length).toBeGreaterThan(0);
  });

  test('opens on the main fault: its check is selected and its peek is under the timeline', async () => {
    const { findByText, getByTestId, getByLabelText } = setup();
    await findByText(VERDICT);
    const ev = MARKED.main.evidence;
    const first = ev.find((c) => c.status === 'red') ?? ev[0];
    expect(getByLabelText(new RegExp(`^${SWING_STRINGS.checkpoint[homeOf(first)]}(,|$)`))).toBeTruthy();
    expect(within(getByTestId('results-fix-peek')).getByText(fixCopy(first).cue)).toBeTruthy();
  });

  test('tapping a fix opens the sheet with its steps; Next fix advances; the last says Done', async () => {
    const { findByText, getByTestId, getByLabelText, queryByTestId, getByText } = setup();
    await findByText(VERDICT);
    fireEvent.press(within(getByTestId('results-fix-peek')).getByLabelText(F.howLink));
    const sheet = within(getByTestId('fix-sheet'));
    FIXES[0].copy.steps.forEach((t) => expect(sheet.getByText(t)).toBeTruthy());
    expect(sheet.getByText(F.sheetOverline(1, FIXES.length, SWING_STRINGS.checkpoint[homeOf(FIXES[0].check)]))).toBeTruthy();
    if (FIXES.length > 1) {
      fireEvent.press(getByLabelText(F.next));
      expect(within(getByTestId('fix-sheet')).getByText(FIXES[1].copy.headline)).toBeTruthy();
      FIXES[1].copy.steps.forEach((t) => expect(getByText(t)).toBeTruthy());
    }
    for (let i = 1; i < FIXES.length - 1; i += 1) fireEvent.press(getByLabelText(F.next));
    fireEvent.press(getByLabelText(F.done));
    await waitFor(() => expect(queryByTestId('fix-sheet')).toBeNull());
  });

  test('See on swing closes the sheet and selects the check at its checkpoint', async () => {
    const { findByText, getByTestId, getByLabelText, getByText } = setup();
    await findByText(VERDICT);
    fireEvent.press(within(getByTestId('results-fix-peek')).getByLabelText(F.howLink));
    fireEvent.press(getByLabelText(F.seeOnSwing));
    openDetail({ getByTestId });
    expect(getByText(T.atCheckpoint(SWING_STRINGS.checkpoint[homeOf(FIXES[0].check)]))).toBeTruthy();
  });

  test('the selected red / yellow check opens its row with the cue, and its link opens the sheet', async () => {
    const { findByText, getByTestId, getAllByLabelText, queryByTestId } = setup();
    await findByText(VERDICT);
    openDetail({ getByTestId });
    const sel = MARKED.checks.find((c) => homeOf(c) === 'impact' && fixCopy(c));
    expect(sel).toBeTruthy();
    fireEvent.press(getAllByLabelText(new RegExp(`^${SWING_STRINGS.checkLabel[sel.id]}`))[0]); // the priority row jumps to impact
    expect(getAllByLabelText(new RegExp(`^${SWING_STRINGS.checkLabel[sel.id]}`))).toHaveLength(2); // priority list + the "At impact" card
    const peek = within(getByTestId('results-fix-peek'));
    expect(peek.getByText(fixCopy(sel).cue)).toBeTruthy();
    expect(peek.getByText(F.tryThis)).toBeTruthy();
    expect(queryByTestId('fix-sheet')).toBeNull();
    expect(getAllByLabelText(new RegExp(`^${SWING_STRINGS.checkLabel[sel.id]}`)).pop().props.accessibilityState).toMatchObject({ selected: true, expanded: true });
    fireEvent.press(peek.getByLabelText(F.howLink));
    expect(within(getByTestId('fix-sheet')).getByText(fixCopy(sel).headline)).toBeTruthy();
  });
});

describe('SwingResultsScreen: a stored swing', () => {
  test('shows the verdict, counts, the seven-step timeline and the checks at the opening checkpoint', async () => {
    const u = setup();
    const { findByText, getByLabelText, queryByLabelText, getAllByText } = u;
    expect(await findByText(VERDICT)).toBeTruthy();
    expect(getAllByText(new RegExp(`^${MARKED.counts.red} fix$`)).length).toBeGreaterThan(0);
    expect(queryByLabelText(/^\d+ fps$/)).toBeNull(); // the fps and swing-name chips are gone
    ['Address', 'Lead arm', 'Top', 'Shaft down', 'Impact', 'Shaft through', 'Finish']
      .forEach((n) => expect(getByLabelText(new RegExp(`^${n}(,|$)`))).toBeTruthy());
    ['Takeaway', 'Transition', 'Trail arm'].forEach((n) => expect(queryByLabelText(new RegExp(`^${n}(,|$)`))).toBeNull());
    expect(getByLabelText(/^Impact, Fix/)).toBeTruthy(); // worst status dot + word (D14)
    openDetail(u);
    fireEvent.press(getByLabelText(/^Impact(,|$)/));
    expect(getAllByText(T.atCheckpoint('Impact')).length).toBe(1);
    expect(getAllByText(labelOf('spine_loss')).length).toBeGreaterThan(0);
  });

  test('the priority list and the folded greens together show every check once', async () => {
    const { findByText, getByTestId } = setup();
    await findByText(VERDICT);
    fireEvent.press(getByTestId('results-good-fold'));
    const rows = within(getByTestId('results-priority')).getAllByLabelText(/^(Posture at address|Hands between the planes|Halfway back|Shaft direction|Downswing path|Clubhead on the plane|Hands height|Hands toward|Shaft angle|Spine angle|Hips hold|Head stays|Tempo|Finish balance)/);
    expect(rows.length).toBeGreaterThanOrEqual(15);
  });

  test('tapping a timeline step shows that checkpoint and resets the nudge', async () => {
    const u = setup();
    const { findByText, getByLabelText, getByText } = u;
    await findByText(VERDICT);
    openDetail(u);
    fireEvent.press(getByLabelText(/^Impact(,|$)/));
    fireEvent.press(getByLabelText(/^Address(,|$)/));
    expect(getByText(T.atCheckpoint('Address'))).toBeTruthy();
    fireEvent.press(getByLabelText(T.nextFrame));
    expect(getByText(/\(\+1\)/)).toBeTruthy();
    fireEvent.press(getByLabelText(/^Top(,|$)/));
    expect(getByText(T.atCheckpoint('Top'))).toBeTruthy();
    expect(() => getByText(/\(\+1\)/)).toThrow();
  });

  test('the frame nudge stops at +-2 (stills exist only there)', async () => {
    const { findByText, getByLabelText, getByText } = setup();
    await findByText(VERDICT);
    for (let i = 0; i < 4; i += 1) fireEvent.press(getByLabelText(T.nextFrame));
    expect(getByText(/\(\+2\)/)).toBeTruthy();
    for (let i = 0; i < 6; i += 1) fireEvent.press(getByLabelText(T.prevFrame));
    expect(getByText(/\(-2\)/)).toBeTruthy();
  });

  test('tapping a check selects it', async () => {
    const u = setup();
    const { findByText, getAllByLabelText } = u;
    await findByText(VERDICT);
    openDetail(u);
    fireEvent.press(getAllByLabelText(/^Spine angle kept/).pop());
    expect(getAllByLabelText(/^Spine angle kept/).pop().props.accessibilityState.selected).toBe(true);
  });

  test('a row in the priority list jumps to its checkpoint', async () => {
    const u = setup();
    const { findByText, getByLabelText, getAllByLabelText, getByText } = u;
    await findByText(VERDICT);
    openDetail(u);
    fireEvent.press(getByLabelText(/^Address(,|$)/));
    fireEvent.press(getAllByLabelText(/^Hands height at impact/)[0]); // the priority list
    expect(getByText(T.atCheckpoint('Impact'))).toBeTruthy();
  });

  test('D21: the hero names what the main fault is likely also causing, in one line', async () => {
    const { findByText, getByTestId } = setup();
    await findByText(VERDICT);
    expect(MARKED.main.consequences).toContain('early_extension');
    expect(getByTestId('results-also-causing').props.children).toBe('Likely also causing: flat backswing, top position and 3 more');
  });

  test('D24: the practice card under the drills opens, remembers, and slots the main drill into Block', async () => {
    const { findByText, getByLabelText, queryByText, getByText } = setup();
    await findByText(VERDICT);
    expect(queryByText(T.practice.blocks[1].body)).toBeNull();
    fireEvent.press(getByLabelText(T.practice.show));
    expect(store.setPracticeOpen).toHaveBeenCalledWith(true);
    T.practice.blocks.forEach((b) => expect(getByText(b.name)).toBeTruthy());
    expect(getByText(T.practice.drillIn('Let the arms hang'))).toBeTruthy();
    fireEvent.press(getByLabelText(T.practice.hide));
    expect(store.setPracticeOpen).toHaveBeenLastCalledWith(false);
  });

  test('D24: the practice card opens as it was left', async () => {
    store.getSwingProfile.mockReturnValueOnce({ practiceOpen: true });
    const { findByText, getByText } = setup();
    await findByText(VERDICT);
    expect(getByText(T.practice.blocks[3].body)).toBeTruthy();
  });

  test('D23: the swing pattern row shows back, down and through; a cell opens its checkpoint', async () => {
    const { findByText, getByTestId, getByLabelText, getByText } = setup();
    await findByText(VERDICT);
    openDetail({ getByTestId });
    expect(getByTestId('results-swing-pattern')).toBeTruthy();
    expect(getByText(T.patternTitle)).toBeTruthy();
    // owner swing: flat halfway back (Fix), the shaft-down head hidden, nothing placed at shaft through
    expect(getByLabelText(/^Back: Fix\./)).toBeTruthy();
    expect(getByLabelText(/^Down: —\./)).toBeTruthy();
    fireEvent.press(getByLabelText(/^Through: —\./));
    expect(getByText(T.atCheckpoint('Shaft through'))).toBeTruthy();
  });

  test('no consequence line when nothing later is significant', async () => {
    const lone = { ...MARKED, main: { ...MARKED.main, consequences: [] } };
    const { findByText, queryByTestId } = setup({ analysis: lone });
    await findByText(VERDICT);
    expect(queryByTestId('results-also-causing')).toBeNull();
  });

  test('shows the drills for the main fault and expands the rest', async () => {
    const evidence = MARKED.checks.filter((c) => c.cluster === 'early_extension');
    const ee = { ...MARKED, main: { ...MARKED.main, fault: 'early_extension', label: 'Early extension', evidence, consequences: [] } };
    const { findByText, getByText, queryByText, getByLabelText } = setup({ analysis: ee });
    await findByText('Early extension.');
    expect(getByText(T.practiseTitle)).toBeTruthy();
    expect(getByText('The chair')).toBeTruthy();
    expect(queryByText('Club behind the heels')).toBeNull();
    fireEvent.press(getByLabelText(T.moreDrills(2)));
    expect(getByText('Club behind the heels')).toBeTruthy();
  });

  test('D16: club checks with no clubhead placed offer "Place clubhead", which opens Edit marks on that checkpoint', async () => {
    const { findByText, getAllByLabelText, navigation } = setup({ analysis: UNMARKED });
    await findByText(VERDICT);
    const cta = getAllByLabelText(/^Place clubhead: Halfway back/);
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
    await findByText(VERDICT);
    expect(getAllByText('Hidden').length).toBeGreaterThan(0);
    expect(queryByLabelText(/^Place clubhead: Downswing path/)).toBeNull();
  });

  test('approximate clips say so in the hero and the banner, and flag cm values', async () => {
    const approx = { ...MARKED, approximate: true, checks: MARKED.checks.map((c) => (c.unit === 'cm' ? { ...c, approximate: true } : c)) };
    const { findByText, getByText, getAllByText } = setup({ analysis: approx });
    await findByText(VERDICT);
    expect(getAllByText(T.approxChip).length).toBeGreaterThan(1); // the hero chip and the cm values
    expect(getByText(T.approxBanner)).toBeTruthy();
    expect(getAllByText(/approx\./).length).toBeGreaterThan(2);
  });

  test('Edit marks from the header menu and from the button both open on the current checkpoint; Rename saves', async () => {
    const { findByText, getByLabelText, getByPlaceholderText, navigation } = setup();
    await findByText(VERDICT);
    fireEvent.press(getByLabelText(T.editMarks));
    expect(navigation.navigate).toHaveBeenLastCalledWith('SwingEditMarks', { swingId: 's1', checkpoint: 'address' }); // the screen opens on the main fault
    fireEvent.press(getByLabelText(T.menu));
    fireEvent.press(getByLabelText(T.rename));
    fireEvent.changeText(getByPlaceholderText(T.renamePlaceholder), 'Range · 7-iron');
    await act(async () => { fireEvent.press(getByLabelText(T.save)); });
    expect(store.renameSwing).toHaveBeenCalledWith('s1', 'Range · 7-iron');
  });

  test('Export swing in the header menu builds the zip and opens the share sheet; a failure says so', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { findByText, getByLabelText } = setup();
    await findByText(VERDICT);
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
    await findByText(VERDICT);
    await waitFor(() => expect(ensureStills).toHaveBeenCalled());
    const first = MARKED.checkpoints.impact.i; // the first paint, before the screen moves to the main fault
    expect(ensureStills).toHaveBeenCalledWith('s1', [first - 2, first - 1, first, first + 1, first + 2]);
    const frame = MARKED.checkpoints.address.i;
    await waitFor(() => expect(getByLabelText(new RegExp(`^Address still, frame ${frame}`)).props.source).toEqual({ uri: 'file:///doc/swings/s1/frames/556.jpg' }));
  });

  test('reloads the analysis when it comes back into focus (after Edit marks)', async () => {
    const { findByText, navigation } = setup();
    await findByText(VERDICT);
    const focus = navigation.addListener.mock.calls.filter(([n]) => n === 'focus').pop()[1];
    store.readAnalysis.mockClear();
    await act(async () => { focus(); });
    expect(store.readAnalysis).toHaveBeenCalled();
  });
});

describe('SwingResultsScreen: the club chip (D19)', () => {
  test('the club picker is gone from a ready swing', async () => {
    const { findByText, queryByTestId, queryByLabelText } = setup();
    await findByText(VERDICT);
    expect(queryByTestId('results-club-picker')).toBeNull();
    expect(queryByLabelText('Driver')).toBeNull();
  });
});

describe('SwingResultsScreen: after the marking pass (D26)', () => {
  test('never shows results for a swing whose pass is not done: it resumes the marking canvas', async () => {
    const { queryByText, navigation } = setup({ row: { ...ROW, marked: { state: 'partial', count: 3 } } });
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('SwingEditMarks', { swingId: 's1', mode: 'pass' }));
    expect(queryByText(VERDICT)).toBeNull();
    expect(store.readAnalysis).not.toHaveBeenCalled();
  });

  test('a row from before the flow is judged by its marks.json: P8 was never marked, so the pass resumes', async () => {
    const { navigation } = setup({ row: { ...ROW, marked: undefined } }); // OWNER_MARKS: five of the six corrected
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('SwingEditMarks', { swingId: 's1', mode: 'pass' }));
  });

  test('a chip says how many positions are not confirmed; none when all six are', async () => {
    const { findByText, getByTestId } = setup({ row: { ...ROW, marked: { state: 'done', count: 4 } } });
    await findByText(VERDICT);
    expect(getByTestId('results-unconfirmed')).toBeTruthy();
    expect(getByTestId('results-unconfirmed').props.children.props.children).toBe(T.unconfirmedChip(2));
    const all = setup();
    await all.findAllByText(VERDICT);
    expect(all.queryByTestId('results-unconfirmed')).toBeNull();
  });

  test('the marks card shows the six chapters with their status; a chapter opens the canvas there in edit mode', async () => {
    const u = setup({ marks: { ...OWNER_MARKS, pass: { state: 'done', skipped: ['shaftThrough'] } } });
    await u.findByText(VERDICT);
    openDetail(u);
    const card = u.getByTestId('results-marks');
    expect(within(card).getByText(SWING_STRINGS.mark.counts(0, 1, 5))).toBeTruthy(); // OWNER_MARKS predate the confirmed flag
    fireEvent.press(within(card).getByTestId('chapter-top'));
    expect(u.navigation.navigate).toHaveBeenLastCalledWith('SwingEditMarks', { swingId: 's1', checkpoint: 'top' });
  });

  test('"Finish frame looks wrong? Fix it" opens the canvas at the automatic finish', async () => {
    const u = setup();
    await u.findByText(VERDICT);
    openDetail(u);
    fireEvent.press(u.getByTestId('results-fix-finish'));
    expect(u.navigation.navigate).toHaveBeenLastCalledWith('SwingEditMarks', { swingId: 's1', checkpoint: 'finish' });
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
    const { findByText, getByText, queryByText, navigation } = setup({ row: PENDING, analysis: UNMARKED });

    expect(await findByText(T.stages.reading)).toBeTruthy();
    expect(getByText(T.stages.pose)).toBeTruthy();
    expect(getByText(T.stages.planes)).toBeTruthy();
    expect(getByText(T.processingTitle)).toBeTruthy();
    await act(async () => { onProgress({ stage: 'pose', done: 120, total: 300, probe: { height: 720, containerFps: 30, captureFps: 240, durationMs: 4100 } }); });
    expect(getByText('120 / 300')).toBeTruthy();
    expect(getByText(/720p · 240 fps · 4\.1 s/)).toBeTruthy();
    expect(getByText(SWING_STRINGS.privacy)).toBeTruthy();

    await act(async () => { finish({ analysis: UNMARKED, pass2: 'done' }); });
    expect(navigation.replace).toHaveBeenCalledWith('SwingEditMarks', { swingId: 's1', mode: 'pass' });
    expect(queryByText(VERDICT)).toBeNull();
  });

  test('processing shows only the stages: no verdict, timeline, checks, club picker or marks', async () => {
    runAnalysis.mockReturnValue(new Promise(() => {}));
    const { findByText, queryByText, queryByTestId, queryAllByText } = setup({ row: PENDING, analysis: MARKED });
    await findByText(T.stages.reading);
    expect(queryByText(T.mainTitle)).toBeNull();
    expect(queryAllByText(SWING_STRINGS.checkpoint.impact)).toHaveLength(0);
    expect(queryByText(T.allChecks)).toBeNull();
    expect(queryByText(T.marksTitle)).toBeNull();
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
    const { findByText, unmount } = setup({ row: PENDING });
    await findByText(T.stages.reading);
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
