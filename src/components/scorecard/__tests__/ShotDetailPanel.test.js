import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ShotDetailPanel } from '../ShotDetailPanel';
import { ShotDetailSection } from '../ShotDetailSection';
import { updateAppSettings, __resetAppSettingsForTests } from '../../../store/settingsStore';

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
  test('drive distance row renders on par 4/5, not on par 3', () => {
    const p4 = render(<ShotDetailPanel hole={par4} detail={{}} onChange={jest.fn()} strokes={null} />);
    expect(p4.getByText('Drive distance')).toBeTruthy();
    const p3 = render(<ShotDetailPanel hole={par3} detail={{}} onChange={jest.fn()} strokes={null} />);
    expect(p3.queryByText('Drive distance')).toBeNull();
  });
  test('miss-lie chips appear only after a miss direction', () => {
    const fairway = render(
      <ShotDetailPanel hole={par4} detail={{ drive: 'fairway' }} onChange={jest.fn()} strokes={null} />,
    );
    expect(fairway.queryByText('Drive finished in')).toBeNull();
    const miss = render(
      <ShotDetailPanel hole={par4} detail={{ drive: 'left' }} onChange={jest.fn()} strokes={null} />,
    );
    expect(miss.getByText('Drive finished in')).toBeTruthy();
  });
  test('selecting a drive lie patches driveLie; changing direction clears it', () => {
    const onChange = jest.fn();
    const miss = render(
      <ShotDetailPanel hole={par4} detail={{ drive: 'left' }} onChange={onChange} strokes={null} />,
    );
    fireEvent.press(miss.getByLabelText('Drive lie Sand'));
    expect(onChange).toHaveBeenCalledWith({ driveLie: 'sand' });
    fireEvent.press(miss.getByLabelText('Driver Fairway'));
    expect(onChange).toHaveBeenCalledWith({ drive: 'fairway', driveLie: null });
  });
  test('approach lie chips show once a bucket is picked; default reads fairway', () => {
    const noBucket = render(
      <ShotDetailPanel hole={par4} detail={{}} onChange={jest.fn()} strokes={null} />,
    );
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
    expect(withBucket.getByText('Approach lie')).toBeTruthy();
    expect(withBucket.getByLabelText('Approach lie Fairway').props.accessibilityState.selected).toBe(true);
    fireEvent.press(withBucket.getByLabelText('Approach lie Rough'));
    expect(onChange).toHaveBeenCalledWith({ approachLie: 'rough' });
  });
  test('approach lie hidden on par 3s', () => {
    const p3 = render(
      <ShotDetailPanel hole={par3} detail={{ approachBucket: '100-150' }} onChange={jest.fn()} strokes={null} />,
    );
    expect(p3.queryByText('Approach lie')).toBeNull();
  });
  test('clearing the approach bucket clears approachLie too', () => {
    const onChange = jest.fn();
    const r = render(
      <ShotDetailPanel
        hole={par4}
        detail={{ approachBucket: '100-150', approachLie: 'rough' }}
        onChange={onChange}
        strokes={null}
      />,
    );
    fireEvent.press(r.getByLabelText('Approach 100-150'));
    expect(onChange).toHaveBeenCalledWith({ approachBucket: null, approachResult: null, approachLie: null });
  });
});

describe('stat group toggles', () => {
  const hole = { number: 1, par: 4 };

  it('hides putting rows when putting is off', () => {
    const r = render(<ShotDetailPanel hole={hole} detail={{ putts: 2 }} onChange={jest.fn()} strokes={5}
      statGroups={{ putting: false }} />);
    expect(r.queryByText('Putts')).toBeNull();
    expect(r.queryByText('First putt')).toBeNull();
    expect(r.getByText('Tee penalties')).toBeTruthy(); // others untouched
  });

  it('hides tee-shot rows when teeShot is off', () => {
    const r = render(<ShotDetailPanel hole={hole} detail={{}} onChange={jest.fn()} strokes={5}
      statGroups={{ teeShot: false }} />);
    expect(r.queryByText('Tee club')).toBeNull();
    expect(r.queryByText('Drive distance')).toBeNull();
  });

  it('hides approach rows when approach is off', () => {
    const r = render(<ShotDetailPanel hole={hole} detail={{ approachBucket: '50-100' }} onChange={jest.fn()} strokes={5}
      statGroups={{ approach: false }} />);
    expect(r.queryByText('Approach')).toBeNull();
    expect(r.queryByText('Where did it finish?')).toBeNull();
  });

  it('hides short-game and penalties rows per group', () => {
    const r = render(<ShotDetailPanel hole={hole} detail={{}} onChange={jest.fn()} strokes={5}
      statGroups={{ shortGame: false, penalties: false }} />);
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
