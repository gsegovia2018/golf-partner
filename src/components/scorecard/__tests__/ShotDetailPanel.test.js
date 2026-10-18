import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { ShotDetailPanel } from '../ShotDetailPanel';
import { ShotDetailSection } from '../ShotDetailSection';
import { clearedReasonPatch } from '../../../store/missReasons';
import { isRoundMuted, muteRound } from '../../../store/missReasonsMute';
import { updateAppSettings, __resetAppSettingsForTests } from '../../../store/settingsStore';

// ShotDetailExplainer reads its dismissed state from AsyncStorage in a
// useEffect; flush that pending promise (inside act) after every render so
// its follow-up setState doesn't land outside act().
const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));

jest.mock('../../../store/missReasonsMute', () => ({
  isRoundMuted: jest.fn(() => Promise.resolve(false)),
  muteRound: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../../store/swingStore', () => ({
  hydrateSwingProfile: jest.fn(() => Promise.resolve()),
  getSwingProfile: jest.fn(() => ({ handedness: 'right' })),
  subscribeSwings: jest.fn(() => () => {}),
  getSwingsVersion: jest.fn(() => 0),
}));

jest.mock('../../../store/profileStore', () => ({
  loadProfile: jest.fn(),
  upsertProfile: jest.fn(),
}));

jest.mock('../../../theme/ThemeContext', () => ({
  useTheme: () => {
    const { light, semantic, typography, fonts, spacing, radius } = jest.requireActual('../../../theme/tokens');
    return {
      theme: {
        ...light,
        semantic,
        masters: semantic.masters,
        destructive: semantic.destructive.light,
        scoreColor: (level) => semantic.score[level].light,
        typography,
        fonts,
        spacing,
        radius,
        mode: 'light',
        isDark: false,
      },
    };
  },
}));

const par4 = { number: 1, par: 4, strokeIndex: 5 };
const par3 = { number: 2, par: 3, strokeIndex: 9 };

describe('ShotDetailPanel drive + approach lie inputs', () => {
  test('drive distance row renders on par 4/5, not on par 3', async () => {
    const p4 = render(<ShotDetailPanel hole={par4} detail={{}} onChange={jest.fn()} strokes={null} />);
    await flush();
    expect(p4.getByText('Drive distance')).toBeTruthy();
    const p3 = render(<ShotDetailPanel hole={par3} detail={{}} onChange={jest.fn()} strokes={null} />);
    await flush();
    expect(p3.queryByText('Drive distance')).toBeNull();
  });
  test('miss-lie chips appear only after a miss direction', async () => {
    const fairway = render(
      <ShotDetailPanel hole={par4} detail={{ drive: 'fairway' }} onChange={jest.fn()} strokes={null} />,
    );
    await flush();
    expect(fairway.queryByText('Drive finished in')).toBeNull();
    const miss = render(
      <ShotDetailPanel hole={par4} detail={{ drive: 'left' }} onChange={jest.fn()} strokes={null} />,
    );
    await flush();
    expect(miss.getByText('Drive finished in')).toBeTruthy();
  });
  test('selecting a drive lie patches driveLie; changing direction clears it', async () => {
    const onChange = jest.fn();
    const miss = render(
      <ShotDetailPanel hole={par4} detail={{ drive: 'left' }} onChange={onChange} strokes={null} />,
    );
    await flush();
    fireEvent.press(miss.getByLabelText('Drive lie Sand'));
    expect(onChange).toHaveBeenCalledWith({ driveLie: 'sand' });
    fireEvent.press(miss.getByLabelText('Driver Fairway'));
    expect(onChange).toHaveBeenCalledWith({ drive: 'fairway', driveLie: null, ...clearedReasonPatch('drive') });
  });
  test('a missed drive can still be marked as finishing on a fairway', async () => {
    const onChange = jest.fn();
    const miss = render(
      <ShotDetailPanel hole={par4} detail={{ drive: 'right' }} onChange={onChange} strokes={null} />,
    );
    await flush();
    fireEvent.press(miss.getByLabelText('Drive lie Fairway'));
    expect(onChange).toHaveBeenCalledWith({ driveLie: 'fairway' });
  });
  test('approach lie chips show once a bucket is picked; default reads fairway', async () => {
    const noBucket = render(
      <ShotDetailPanel hole={par4} detail={{}} onChange={jest.fn()} strokes={null} />,
    );
    await flush();
    expect(noBucket.queryByText('Approach lie')).toBeNull();
    const onChange = jest.fn();
    const withBucket = render(
      <ShotDetailPanel
        hole={par4}
        detail={{ approachBucket: '100-150' }}
        onChange={onChange}
        strokes={null}
      />,
    );
    await flush();
    expect(withBucket.getByText('Approach lie')).toBeTruthy();
    expect(withBucket.getByLabelText('Approach lie Fairway').props.accessibilityState.selected).toBe(true);
    fireEvent.press(withBucket.getByLabelText('Approach lie Rough'));
    expect(onChange).toHaveBeenCalledWith({ approachLie: 'rough' });
  });
  test('par-4 approach lie defaults to the drive terrain; tapping stores explicitly', async () => {
    const onChange = jest.fn();
    const missedDrive = render(
      <ShotDetailPanel
        hole={par4}
        detail={{ approachBucket: '100-150', drive: 'left' }}
        onChange={onChange}
        strokes={null}
      />,
    );
    await flush();
    expect(missedDrive.getByLabelText('Approach lie Rough').props.accessibilityState.selected).toBe(true);
    fireEvent.press(missedDrive.getByLabelText('Approach lie Fairway'));
    expect(onChange).toHaveBeenCalledWith({ approachLie: 'fairway' });

    const sandDrive = render(
      <ShotDetailPanel
        hole={par4}
        detail={{ approachBucket: '100-150', drive: 'left', driveLie: 'sand' }}
        onChange={jest.fn()}
        strokes={null}
      />,
    );
    await flush();
    expect(sandDrive.getByLabelText('Approach lie Sand').props.accessibilityState.selected).toBe(true);
  });
  test('par-5 approach lie keeps the fairway default after a missed drive', async () => {
    const par5 = { number: 3, par: 5, strokeIndex: 1 };
    const r = render(
      <ShotDetailPanel
        hole={par5}
        detail={{ approachBucket: '100-150', drive: 'left' }}
        onChange={jest.fn()}
        strokes={null}
      />,
    );
    await flush();
    expect(r.getByLabelText('Approach lie Fairway').props.accessibilityState.selected).toBe(true);
  });
  test('approach lie hidden on par 3s', async () => {
    const p3 = render(
      <ShotDetailPanel hole={par3} detail={{ approachBucket: '100-150' }} onChange={jest.fn()} strokes={null} />,
    );
    await flush();
    expect(p3.queryByText('Approach lie')).toBeNull();
  });
  test('clearing the approach bucket clears approachLie too', async () => {
    const onChange = jest.fn();
    const r = render(
      <ShotDetailPanel
        hole={par4}
        detail={{ approachBucket: '100-150', approachLie: 'rough' }}
        onChange={onChange}
        strokes={null}
      />,
    );
    await flush();
    fireEvent.press(r.getByLabelText('Approach 100-150'));
    expect(onChange).toHaveBeenCalledWith({
      approachBucket: null, approachResult: null, approachMiss: null, approachBunker: false, approachLie: null,
      ...clearedReasonPatch('approach'),
    });
  });
});

describe('ShotDetailPanel approach finish grid', () => {
  const par4 = { number: 1, par: 4 };
  const withBucket = (extra = {}) => ({ approachBucket: '100-150', ...extra });

  test('on-green tap records a green result and clears any miss', async () => {
    const onChange = jest.fn();
    const r = render(
      <ShotDetailPanel hole={par4} detail={withBucket()} onChange={onChange} strokes={null} />,
    );
    await flush();
    fireEvent.press(r.getByLabelText('Approach finish On green'));
    expect(onChange).toHaveBeenCalledWith({
      approachResult: 'green', approachMiss: null, approachBunker: false,
      ...clearedReasonPatch('approach', { keepSituation: true }),
    });
  });

  test('a direction records a miss with that direction', async () => {
    const onChange = jest.fn();
    const r = render(
      <ShotDetailPanel hole={par4} detail={withBucket()} onChange={onChange} strokes={null} />,
    );
    await flush();
    fireEvent.press(r.getByLabelText('Approach finish Left'));
    expect(onChange).toHaveBeenCalledWith({ approachMiss: 'left', approachResult: 'miss' });
  });

  test('bunker combines with an existing direction, staying a miss', async () => {
    const onChange = jest.fn();
    const r = render(
      <ShotDetailPanel
        hole={par4}
        detail={withBucket({ approachMiss: 'long', approachResult: 'miss' })}
        onChange={onChange}
        strokes={null}
      />,
    );
    await flush();
    fireEvent.press(r.getByLabelText('Approach finish Bunker'));
    expect(onChange).toHaveBeenCalledWith({ approachBunker: true, approachResult: 'miss' });
  });

  test('picking a direction while on green flips the result to a miss', async () => {
    const onChange = jest.fn();
    const r = render(
      <ShotDetailPanel
        hole={par4}
        detail={withBucket({ approachResult: 'green' })}
        onChange={onChange}
        strokes={null}
      />,
    );
    await flush();
    fireEvent.press(r.getByLabelText('Approach finish Right'));
    expect(onChange).toHaveBeenCalledWith({ approachMiss: 'right', approachResult: 'miss' });
  });

  test('finish grid hidden on par 3s', async () => {
    const r = render(
      <ShotDetailPanel hole={{ number: 2, par: 3 }} detail={withBucket()} onChange={jest.fn()} strokes={null} />,
    );
    await flush();
    expect(r.queryByText('Where did it finish?')).toBeNull();
  });
});

describe('stat group toggles', () => {
  const hole = { number: 1, par: 4 };

  it('hides putting rows when putting is off', async () => {
    const r = render(<ShotDetailPanel hole={hole} detail={{ putts: 2 }} onChange={jest.fn()} strokes={5}
      statGroups={{ putting: false }} />);
    await flush();
    expect(r.queryByText('Putts')).toBeNull();
    expect(r.queryByText('First putt')).toBeNull();
    expect(r.getByText('Tee penalties')).toBeTruthy(); // others untouched
  });

  it('hides tee-shot rows when teeShot is off', async () => {
    const r = render(<ShotDetailPanel hole={hole} detail={{}} onChange={jest.fn()} strokes={5}
      statGroups={{ teeShot: false }} />);
    await flush();
    expect(r.queryByText('Tee club')).toBeNull();
    expect(r.queryByText('Drive distance')).toBeNull();
  });

  it('hides approach rows when approach is off', async () => {
    const r = render(<ShotDetailPanel hole={hole} detail={{ approachBucket: '50-100' }} onChange={jest.fn()} strokes={5}
      statGroups={{ approach: false }} />);
    await flush();
    expect(r.queryByText('Approach')).toBeNull();
    expect(r.queryByText('Where did it finish?')).toBeNull();
  });

  it('hides short-game and penalties rows per group', async () => {
    const r = render(<ShotDetailPanel hole={hole} detail={{}} onChange={jest.fn()} strokes={5}
      statGroups={{ shortGame: false, penalties: false }} />);
    await flush();
    expect(r.queryByText('Sand shots')).toBeNull();
    expect(r.queryByText('Tee penalties')).toBeNull();
    expect(r.queryByText('Other penalties')).toBeNull();
  });
});

describe('yards mode', () => {
  afterEach(() => {
    __resetAppSettingsForTests();
  });

  test('drive distance hint and bucket labels switch to yards', async () => {
    await updateAppSettings({ units: 'yards' });
    const r = render(<ShotDetailPanel hole={par4} detail={{}} onChange={jest.fn()} strokes={null} />);
    await flush();
    expect(r.getAllByText('yards').length).toBeGreaterThan(0);
    expect(r.getByText('165-195')).toBeTruthy();
    expect(r.queryByText('150-180')).toBeNull();
  });
});

describe('ShotDetailSection stat group gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetAppSettingsForTests();
  });

  it('renders nothing when every stat group is off', async () => {
    await updateAppSettings({ statGroups: {
      putting: false, teeShot: false, approach: false, shortGame: false, penalties: false,
    } });
    const { toJSON } = render(
      <ShotDetailSection hole={{ number: 1, par: 4 }} detail={{}} onChange={jest.fn()}
        strokes={4} collapsed={false} onToggle={jest.fn()} />,
    );
    expect(toJSON()).toBeNull();
  });
});

describe('ShotDetailPanel miss reasons', () => {
  const withBucket = (extra = {}) => ({ approachBucket: '100-150', ...extra });
  const DRIVE_TITLE = 'Why did the drive go left?';
  const renderPanel = async (props = {}) => {
    const onChange = jest.fn();
    const r = render(
      <ShotDetailPanel hole={par4} detail={{}} onChange={onChange} strokes={null} roundId="r1" {...props} />,
    );
    await flush();
    return { ...r, onChange };
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    isRoundMuted.mockImplementation(() => Promise.resolve(false));
    __resetAppSettingsForTests();
    await updateAppSettings({ missReasons: 'ask' });
  });

  test('opens on a tapped drive miss', async () => {
    const r = await renderPanel();
    fireEvent.press(r.getByLabelText('Driver Left'));
    expect(r.getByText(DRIVE_TITLE)).toBeTruthy();
  });

  test('opens on a tapped approach miss', async () => {
    const r = await renderPanel({ detail: withBucket() });
    fireEvent.press(r.getByLabelText('Approach finish Left'));
    // onChange is a mock, so the detail (and the title) stays unchanged: the
    // footer proves the sheet is open.
    expect(r.getByText('Not this round')).toBeTruthy();
  });

  test('opens on a tapped bunker', async () => {
    const r = await renderPanel({ detail: withBucket() });
    fireEvent.press(r.getByLabelText('Approach finish Bunker'));
    expect(r.getByText('Not this round')).toBeTruthy();
  });

  test('does not open on fairway, super or on green', async () => {
    const r = await renderPanel({ detail: withBucket() });
    fireEvent.press(r.getByLabelText('Driver Fairway'));
    fireEvent.press(r.getByLabelText('Driver Super'));
    fireEvent.press(r.getByLabelText('Approach finish On green'));
    expect(r.queryByText('Not this round')).toBeNull();
  });

  test('does not open when a miss is toggled off', async () => {
    const r = await renderPanel({ detail: { drive: 'left' } });
    fireEvent.press(r.getByLabelText('Driver Left'));
    expect(r.queryByText(DRIVE_TITLE)).toBeNull();
  });

  test('never opens when a miss arrives through the detail prop', async () => {
    const r = await renderPanel({ detail: withBucket() });
    r.rerender(
      <ShotDetailPanel hole={par4} onChange={jest.fn()} strokes={null} roundId="r1"
        detail={withBucket({ drive: 'left', approachMiss: 'left', approachResult: 'miss' })} />,
    );
    await flush();
    expect(r.queryByText(/^Why did/)).toBeNull();
    expect(r.getAllByText('Why?')).toHaveLength(2);
  });

  test('short game: chip only, tap opens short mode', async () => {
    const r = await renderPanel({ detail: { putts: 2 }, strokes: 6 });
    expect(r.queryByText('Why no up & down?')).toBeNull();
    fireEvent.press(r.getByText('Why?'));
    expect(r.getByText('Why no up & down?')).toBeTruthy();
  });

  test('short chip is hidden for a save or a par', async () => {
    const save = await renderPanel({ detail: { putts: 1, recoveryOutcome: 'up-and-down' }, strokes: 4 });
    expect(save.queryByText('Why?')).toBeNull();
    const par = await renderPanel({ detail: { putts: 2 }, strokes: 4 });
    expect(par.queryByText('Why?')).toBeNull();
  });

  test.each(['manual', 'off'])('setting %s suppresses auto-open', async (mode) => {
    await updateAppSettings({ missReasons: mode });
    const r = await renderPanel();
    fireEvent.press(r.getByLabelText('Driver Left'));
    expect(r.queryByText(DRIVE_TITLE)).toBeNull();
  });

  test('manual still opens from a chip', async () => {
    await updateAppSettings({ missReasons: 'manual' });
    const r = await renderPanel({ detail: { drive: 'left' } });
    fireEvent.press(r.getByText('Why?'));
    expect(r.getByText(DRIVE_TITLE)).toBeTruthy();
  });

  test('a muted round suppresses auto-open', async () => {
    isRoundMuted.mockImplementation(() => Promise.resolve(true));
    const r = await renderPanel();
    fireEvent.press(r.getByLabelText('Driver Left'));
    expect(r.queryByText(DRIVE_TITLE)).toBeNull();
  });

  test('read-only suppresses auto-open and hides the unanswered chip', async () => {
    const r = await renderPanel({ readOnly: true, detail: { drive: 'left' } });
    fireEvent.press(r.getByLabelText('Driver Right'));
    expect(r.queryByText(/^Why /)).toBeNull();
    expect(r.queryByText('Why?')).toBeNull();
  });

  test('read-only shows an answered summary that does not open anything', async () => {
    const r = await renderPanel({
      readOnly: true, detail: { drive: 'right', driveStart: 'right', driveContact: 'fat' },
    });
    fireEvent.press(r.getByText('Push · Heavy'));
    expect(r.queryByText(/^Why /)).toBeNull();
  });

  test('answered chip shows the summary', async () => {
    const r = await renderPanel({
      detail: withBucket({
        approachMiss: 'right', approachResult: 'miss', approachStart: 'right', approachContact: 'fat',
      }),
    });
    expect(r.getByText('Push · Heavy')).toBeTruthy();
    expect(r.queryByText('Why?')).toBeNull();
  });

  test('chips hidden when the group is off or the setting is off', async () => {
    const detail = withBucket({ drive: 'left', approachMiss: 'left', approachResult: 'miss' });
    const off = await renderPanel({ detail, statGroups: { teeShot: false, approach: false } });
    expect(off.queryByText('Why?')).toBeNull();
    await updateAppSettings({ missReasons: 'off' });
    const none = await renderPanel({ detail });
    expect(none.queryByText('Why?')).toBeNull();
  });

  test('no drive chip on a par 3', async () => {
    const r = await renderPanel({ hole: par3, detail: { drive: 'left' } });
    expect(r.queryByText('Why?')).toBeNull();
  });

  test('"Not this round" mutes the round and stops auto-open', async () => {
    const r = await renderPanel();
    fireEvent.press(r.getByLabelText('Driver Left'));
    fireEvent.press(r.getByText('Not this round'));
    await flush();
    expect(muteRound).toHaveBeenCalledWith('r1');
    expect(r.queryByText(DRIVE_TITLE)).toBeNull();
    fireEvent.press(r.getByLabelText('Driver Right'));
    expect(r.queryByText('Why did the drive go right?')).toBeNull();
  });
});

describe('ShotDetailPanel focus', () => {
  const T = (over = {}) => ({
    shot: 'approach', bucket: null, kind: 'swing', lie: null,
    title: { key: 'shots.why.chip' }, cue: { key: 'shots.why.done' }, ...over,
  });
  const withBucket = (extra = {}) => ({ approachBucket: '100-150', ...extra });
  const DRIVE_TITLE = 'Why did the drive go left?';
  const renderPanel = async (props = {}) => {
    const onChange = jest.fn();
    const r = render(
      <ShotDetailPanel hole={par4} detail={{}} onChange={onChange} strokes={null} roundId="r1"
        focusTarget={T()} {...props} />,
    );
    await flush();
    return { ...r, onChange };
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    isRoundMuted.mockImplementation(() => Promise.resolve(false));
    __resetAppSettingsForTests();
    await updateAppSettings({ missReasons: 'manual' });
  });

  describe('strip', () => {
    test('shows the title and the cue on a par 4 for an approach target', async () => {
      const r = await renderPanel();
      expect(r.getByTestId('focus-strip')).toBeTruthy();
      expect(r.getAllByText('Why?').length).toBeGreaterThan(0);
      expect(r.getByLabelText('Focus: Why? · Done')).toBeTruthy();
    });

    test('par 3: hidden when the hole bucket differs, shown with none / same / no focus bucket', async () => {
      const a = await renderPanel({ hole: par3, focusTarget: T({ bucket: '150-200' }), detail: withBucket() });
      expect(a.queryByTestId('focus-strip')).toBeNull();
      a.unmount();
      const b = await renderPanel({ hole: par3, focusTarget: T({ bucket: '150-200' }), detail: {} });
      expect(b.getByTestId('focus-strip')).toBeTruthy();
      b.unmount();
      const c = await renderPanel({ hole: par3, focusTarget: T({ bucket: '100-150' }), detail: withBucket() });
      expect(c.getByTestId('focus-strip')).toBeTruthy();
      c.unmount();
      const d = await renderPanel({ hole: par3, focusTarget: T(), detail: withBucket() });
      expect(d.getByTestId('focus-strip')).toBeTruthy();
    });

    test('drive target is hidden on a par 3, shown on a par 4', async () => {
      const a = await renderPanel({ hole: par3, focusTarget: T({ shot: 'drive' }) });
      expect(a.queryByTestId('focus-strip')).toBeNull();
      a.unmount();
      const b = await renderPanel({ focusTarget: T({ shot: 'drive' }) });
      expect(b.getByTestId('focus-strip')).toBeTruthy();
    });

    test.each(['short', 'putt'])('%s target shows on every hole', async (shot) => {
      const a = await renderPanel({ hole: par3, focusTarget: T({ shot, kind: 'outcome' }) });
      expect(a.getByTestId('focus-strip')).toBeTruthy();
      a.unmount();
      const b = await renderPanel({ focusTarget: T({ shot, kind: 'outcome' }) });
      expect(b.getByTestId('focus-strip')).toBeTruthy();
    });

    test('hidden when read-only, without a target, or when the group is off', async () => {
      expect((await renderPanel({ readOnly: true })).queryByTestId('focus-strip')).toBeNull();
      expect((await renderPanel({ focusTarget: null })).queryByTestId('focus-strip')).toBeNull();
      const off = await renderPanel({ statGroups: { approach: false } });
      expect(off.queryByTestId('focus-strip')).toBeNull();
    });
  });

  describe('lie chip', () => {
    const lieTarget = T({ kind: 'lie', lie: 'below-feet' });

    test('toggles approachSituation on a green hit', async () => {
      const r = await renderPanel({ focusTarget: lieTarget, detail: withBucket({ approachResult: 'green' }) });
      fireEvent.press(r.getByTestId('focus-lie-chip'));
      expect(r.onChange).toHaveBeenCalledWith({ approachSituation: ['below-feet'] });
    });

    test('toggles on a miss, keeps other tags, and clears to null', async () => {
      const miss = { approachResult: 'miss', approachMiss: 'left' };
      const a = await renderPanel({
        focusTarget: lieTarget, detail: withBucket({ ...miss, approachSituation: ['wind'] }),
      });
      fireEvent.press(a.getByTestId('focus-lie-chip'));
      expect(a.onChange).toHaveBeenCalledWith({ approachSituation: ['wind', 'below-feet'] });
      a.unmount();
      const b = await renderPanel({
        focusTarget: lieTarget, detail: withBucket({ ...miss, approachSituation: ['below-feet'] }),
      });
      fireEvent.press(b.getByTestId('focus-lie-chip'));
      expect(b.onChange).toHaveBeenCalledWith({ approachSituation: null });
    });

    test('shows the selected state and the label', async () => {
      const r = await renderPanel({
        focusTarget: lieTarget, detail: withBucket({ approachSituation: ['below-feet'] }),
      });
      expect(r.getByText('This shot')).toBeTruthy();
      expect(r.getByText('Ball below your feet')).toBeTruthy();
      expect(r.getByTestId('focus-lie-chip').props.accessibilityState.selected).toBe(true);
    });

    test('absent for a swing target', async () => {
      const r = await renderPanel({ detail: withBucket() });
      expect(r.queryByTestId('focus-lie-chip')).toBeNull();
    });

    test('absent when read-only', async () => {
      const r = await renderPanel({ focusTarget: lieTarget, detail: withBucket(), readOnly: true });
      expect(r.queryByTestId('focus-lie-chip')).toBeNull();
    });

    test('stays on a muted round', async () => {
      isRoundMuted.mockImplementation(() => Promise.resolve(true));
      const r = await renderPanel({ focusTarget: lieTarget, detail: withBucket() });
      expect(r.getByTestId('focus-lie-chip')).toBeTruthy();
    });
  });

  describe('focused auto-open', () => {
    test.each(['swing', 'decision'])('%s target opens the sheet on an approach miss in manual', async (kind) => {
      const r = await renderPanel({ focusTarget: T({ kind }), detail: withBucket() });
      fireEvent.press(r.getByLabelText('Approach finish Right'));
      expect(r.getByText('Not this round')).toBeTruthy();
    });

    test('a drive miss does not open it when the target is approach', async () => {
      const r = await renderPanel();
      fireEvent.press(r.getByLabelText('Driver Left'));
      expect(r.queryByText(DRIVE_TITLE)).toBeNull();
    });

    test('a drive target opens on a drive miss', async () => {
      const r = await renderPanel({ focusTarget: T({ shot: 'drive' }) });
      fireEvent.press(r.getByLabelText('Driver Left'));
      expect(r.getByText(DRIVE_TITLE)).toBeTruthy();
    });

    test('a hit does not open it', async () => {
      const r = await renderPanel({ detail: withBucket() });
      fireEvent.press(r.getByLabelText('Approach finish On green'));
      expect(r.queryByText('Not this round')).toBeNull();
    });

    test('never in off', async () => {
      await updateAppSettings({ missReasons: 'off' });
      const r = await renderPanel({ detail: withBucket() });
      fireEvent.press(r.getByLabelText('Approach finish Right'));
      expect(r.queryByText('Not this round')).toBeNull();
    });

    test('never on a muted round', async () => {
      isRoundMuted.mockImplementation(() => Promise.resolve(true));
      const r = await renderPanel({ detail: withBucket() });
      fireEvent.press(r.getByLabelText('Approach finish Right'));
      expect(r.queryByText('Not this round')).toBeNull();
    });

    test('never when read-only', async () => {
      const r = await renderPanel({ detail: withBucket(), readOnly: true });
      fireEvent.press(r.getByLabelText('Approach finish Right'));
      expect(r.queryByText('Not this round')).toBeNull();
    });

    test('a lie or outcome target does not open it in manual', async () => {
      const a = await renderPanel({ focusTarget: T({ kind: 'lie', lie: 'uphill' }), detail: withBucket() });
      fireEvent.press(a.getByLabelText('Approach finish Right'));
      expect(a.queryByText('Not this round')).toBeNull();
      a.unmount();
      const b = await renderPanel({ focusTarget: T({ kind: 'outcome' }), detail: withBucket() });
      fireEvent.press(b.getByLabelText('Approach finish Right'));
      expect(b.queryByText('Not this round')).toBeNull();
    });
  });
});
