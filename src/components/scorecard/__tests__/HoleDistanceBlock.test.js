import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { HoleDistanceBlock } from '../HoleDistanceBlock';
import { updateAppSettings, __resetAppSettingsForTests } from '../../../store/settingsStore';
import { __getRegisteredTourKeysForTests, __resetTourTargetsForTests } from '../../tour/tourTargets';

jest.mock('../../../theme/ThemeContext', () => ({
  useTheme: () => {
    const { light, semantic, typography, fonts, spacing, radius } = jest.requireActual('../../../theme/tokens');
    return { theme: { ...light, semantic, typography, fonts, spacing, radius, mode: 'light', isDark: false } };
  },
}));

jest.mock('../../../store/profileStore', () => ({
  loadProfile: jest.fn(),
  upsertProfile: jest.fn(),
}));

// Controllable marked-shot list so we can assert the header ignores a far
// shot while off the hole. Empty by default = same as the real empty store.
let mockShots = [];
jest.mock('../../../store/shotStore', () => ({
  subscribeShots: () => () => {},
  getShotsVersion: () => 1,
  getShots: () => [],
  shotsForHole: () => mockShots,
}));

const gpsBase = (over = {}, dist = {}) => ({
  available: true,
  accuracy: 8,
  source: 'gps',
  position: [38.5577, -0.1491],
  distances: {
    front: 312.4, center: 326.2, back: 339.1, pin: null, kind: 'hole',
    hazards: [],
    ...dist,
  },
  ...over,
});

describe('HoleDistanceBlock', () => {
  it('renders nothing when gps is unavailable', () => {
    const { toJSON } = render(<HoleDistanceBlock gps={{ available: false, distances: null, accuracy: null, position: null }} onPress={() => {}} />);
    expect(toJSON()).toBeNull();
  });

  it('registers itself as the hole-distances tour target', () => {
    __resetTourTargetsForTests();
    render(<HoleDistanceBlock gps={gpsBase()} onPress={() => {}} />);
    expect(__getRegisteredTourKeysForTests()).toContain('hole-distances');
  });

  it('shows centre hero plus front/back line', () => {
    const { getByText } = render(<HoleDistanceBlock gps={gpsBase()} onPress={() => {}} />);
    getByText('326');
    getByText(/F 312\s+B 339/);
  });

  it('shows a recommended club (label only, no symbol) on the live GPS block', () => {
    // center 326m with default bag + no logged shots picks the driver by nominal.
    const { getByText, queryByText } = render(<HoleDistanceBlock gps={gpsBase()} onPress={() => {}} />);
    getByText('Driver');
    expect(queryByText(/≈/)).toBeNull();
  });

  it('excludes the driver from the recommendation once the fix is past the tee', () => {
    // Same 326 m target that picks Driver on the tee: past the tee box the
    // longest remaining default-bag club (3 Wood) wins instead.
    const { getByText, queryByText } = render(
      <HoleDistanceBlock gps={gpsBase({ offTee: true })} onPress={() => {}} />,
    );
    getByText('3 Wood');
    expect(queryByText('Driver')).toBeNull();
  });

  it('shows one joined hazard line when both kinds are ahead', () => {
    const gps = gpsBase({}, { hazards: [
      { kind: 'bunker', reach: 96.2, carry: 118.4 },
      { kind: 'water', reach: 120.7, carry: 139.2 },
    ] });
    const { getByText } = render(<HoleDistanceBlock gps={gps} onPress={() => {}} />);
    getByText('Bunker 96–118 · Water 121–139');
  });

  it('shows only the nearest hazard of each kind', () => {
    const gps = gpsBase({}, { hazards: [{ kind: 'bunker', reach: 96, carry: 118 }, { kind: 'bunker', reach: 140, carry: 160 }] });
    const { getByText, queryByText } = render(<HoleDistanceBlock gps={gps} onPress={() => {}} />);
    getByText('Bunker 96–118');
    expect(queryByText(/140/)).toBeNull();
  });

  it('shows the NEAREST GREEN overline for nearest-mode courses', () => {
    const { getByText } = render(<HoleDistanceBlock gps={gpsBase({}, { kind: 'nearest' })} onPress={() => {}} />);
    getByText('NEAREST GREEN');
  });

  it('shows accuracy caption on a poor fix', () => {
    const { getByText } = render(<HoleDistanceBlock gps={gpsBase({ accuracy: 31 })} onPress={() => {}} />);
    getByText('±31m');
  });

  it('renders nothing for a far off-course GPS reading (never a giant distance)', () => {
    const { toJSON, queryByText } = render(
      <HoleDistanceBlock gps={gpsBase({}, { center: 4620 })} onPress={() => {}} />,
    );
    expect(toJSON()).toBeNull();
    expect(queryByText('4620')).toBeNull();
  });

  it('shows a getting-fix state before the first fix', () => {
    const { getByText } = render(
      <HoleDistanceBlock gps={{ available: true, distances: null, accuracy: null, position: null }} onPress={() => {}} />,
    );
    getByText('Getting GPS fix');
  });

  it('fires onPress from every state (block is the map entry)', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(<HoleDistanceBlock gps={gpsBase()} onPress={onPress} />);
    fireEvent.press(getByLabelText('Open hole map'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('compact mode renders a single-line distance and no front/back line', () => {
    const { getByText, queryByText } = render(
      <HoleDistanceBlock compact gps={gpsBase()} onPress={() => {}} />,
    );
    getByText('326m');
    expect(queryByText(/F 312/)).toBeNull();
  });

  it('compact mode fires onPress via the "Hole map" label', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(
      <HoleDistanceBlock compact gps={gpsBase()} onPress={onPress} />,
    );
    fireEvent.press(getByLabelText('Hole map'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('compact mode does NOT register the hole-distances tour target', () => {
    __resetTourTargetsForTests();
    render(<HoleDistanceBlock compact gps={gpsBase()} onPress={() => {}} />);
    expect(__getRegisteredTourKeysForTests()).not.toContain('hole-distances');
  });

  it('compact mode renders nothing when gps is unavailable', () => {
    const { toJSON } = render(
      <HoleDistanceBlock compact gps={{ available: false, distances: null, accuracy: null, position: null }} onPress={() => {}} />,
    );
    expect(toJSON()).toBeNull();
  });

  it('renders a tee-sourced block as distance only — no FROM TEE label, no club', () => {
    const gps = gpsBase({ source: 'tee', accuracy: null, position: null });
    const { getByText, queryByText } = render(<HoleDistanceBlock gps={gps} onPress={() => {}} />);
    getByText('326');
    getByText(/F 312\s+B 339/);
    expect(queryByText('FROM TEE')).toBeNull();
    expect(queryByText(/≈/)).toBeNull(); // no recommended-club line
    expect(queryByText(/±/)).toBeNull();
    expect(queryByText('Getting GPS fix')).toBeNull();
  });

  it('tee-sourced block shows hazards but never an off-course line', () => {
    const gps = gpsBase(
      { source: 'tee', accuracy: null, position: null },
      { center: 4620, hazards: [{ kind: 'water', reach: 180.2, carry: 210.6 }] },
    );
    const { getByText, queryByText } = render(<HoleDistanceBlock gps={gps} onPress={() => {}} />);
    getByText('Water 180–211');
    getByText('4620');
    expect(queryByText(/Off course/)).toBeNull();
  });

  it('FROM TEE block is still the map entry point', () => {
    const onPress = jest.fn();
    const gps = gpsBase({ source: 'tee', accuracy: null, position: null });
    const { getByLabelText } = render(<HoleDistanceBlock gps={gps} onPress={onPress} />);
    fireEvent.press(getByLabelText('Open hole map'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  describe('GPS status line', () => {
    const teeGps = (fixState) => gpsBase({ source: 'tee', accuracy: null, position: null, fixState });

    it('shows "GPS OK · far away" when a fix is held but the player is off the hole', () => {
      const { getByText } = render(<HoleDistanceBlock gps={teeGps('ok')} onPress={() => {}} />);
      getByText('GPS OK · far away');
    });

    it('shows "Locating GPS…" while a fix is still being acquired', () => {
      const { getByText } = render(<HoleDistanceBlock gps={teeGps('acquiring')} onPress={() => {}} />);
      getByText('Locating GPS…');
    });

    it('shows "Location off" when permission is denied', () => {
      const { getByText } = render(<HoleDistanceBlock gps={teeGps('denied')} onPress={() => {}} />);
      getByText('Location off');
    });

    it('shows no status line when GPS is disabled in settings', () => {
      const { queryByText } = render(<HoleDistanceBlock gps={teeGps('disabled')} onPress={() => {}} />);
      expect(queryByText('GPS OK · far away')).toBeNull();
      expect(queryByText('Locating GPS…')).toBeNull();
      expect(queryByText('Location off')).toBeNull();
    });

    it('shows no status line on the live on-hole view (the arrow already signals GPS)', () => {
      const { queryByText } = render(<HoleDistanceBlock gps={gpsBase({ fixState: 'ok' })} onPress={() => {}} />);
      expect(queryByText('GPS OK · far away')).toBeNull();
    });

    it('tapping "Location off" opens the OS location settings, not the map', () => {
      const spy = jest.spyOn(Linking, 'openSettings').mockImplementation(() => Promise.resolve());
      const onPress = jest.fn();
      const { getByLabelText } = render(<HoleDistanceBlock gps={teeGps('denied')} onPress={onPress} />);
      fireEvent.press(getByLabelText('Location off — open settings'));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(onPress).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('yards mode', () => {
    afterEach(() => {
      __resetAppSettingsForTests();
    });

    it('renders the hero distance and unit in yards when the setting is yards', async () => {
      await updateAppSettings({ units: 'yards' });
      const gps = gpsBase({}, { center: 150 });
      const { getByText } = render(<HoleDistanceBlock gps={gps} onPress={() => {}} />);
      getByText('164'); // 150m * 1.09361 rounded
      getByText('yd');
    });

    it('shows the accuracy caption converted to yards, not raw meters', async () => {
      await updateAppSettings({ units: 'yards' });
      const { getByText, queryByText } = render(<HoleDistanceBlock gps={gpsBase({ accuracy: 31 })} onPress={() => {}} />);
      getByText('±34yd'); // 31m * 1.09361 rounded
      expect(queryByText('±31m')).toBeNull();
    });
  });
});
