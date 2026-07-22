import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { HoleFlyover } from '../HoleFlyover';
import { updateAppSettings, __resetAppSettingsForTests } from '../../../store/settingsStore';

jest.mock('../../../store/profileStore', () => ({
  loadProfile: jest.fn(),
  upsertProfile: jest.fn(),
}));

// The map itself is a WebView/iframe — out of scope for this test. Captured
// as a jest.fn so tests can inspect the `data` prop it was called with.
const mockHoleMapView = jest.fn(() => null);
jest.mock('../HoleMapView', () => ({ HoleMapView: (props) => mockHoleMapView(props) }));
jest.mock('../../../lib/geo', () => ({
  ...jest.requireActual('../../../lib/geo'),
  holeFeatures: () => ({
    start: [38.5577, -0.1491], greenCenter: [38.5551, -0.1475],
    green: [], greenFront: null, greenBack: null, pin: null, hazards: [],
  }),
  subscribeCourseGeometry: () => () => {},
  getCourseGeometryVersion: () => 1,
}));

const props = {
  courseName: 'Villaitana Levante', holeNumber: 7, par: 4, strokeIndex: 5,
  position: [38.5577, -0.1491],
  visible: true, onClose: jest.fn(),
};

describe('HoleFlyover sheet chrome', () => {
  it('shows hole meta in the sheet header without a distance readout', () => {
    const { getByText, queryByText } = render(<HoleFlyover {...props} />);
    getByText('Hole 7');
    getByText('Par 4 · SI 5');
    expect(queryByText(/\d+ m$/)).toBeNull();
  });

  it('renders a grabber and fires onClose from the close button', () => {
    const { getByTestId } = render(<HoleFlyover {...props} />);
    getByTestId('flyover-grabber');
    fireEvent.press(getByTestId('flyover-close'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('omits meta it was not given', () => {
    const { queryByText, getByText } = render(
      <HoleFlyover {...props} par={undefined} strokeIndex={undefined} />,
    );
    getByText('Hole 7');
    expect(queryByText(/Par/)).toBeNull();
  });

  it('gives the map an onShotTap handler when a round is active', () => {
    mockHoleMapView.mockClear();
    render(<HoleFlyover {...props} roundId="r1" roundIndex={0} />);
    const last = mockHoleMapView.mock.calls[mockHoleMapView.mock.calls.length - 1][0];
    expect(typeof last.onShotTap).toBe('function');
  });

  describe('yards mode', () => {
    afterEach(() => {
      __resetAppSettingsForTests();
    });

    it('passes units: yards through to the map data after seeding the setting', async () => {
      await updateAppSettings({ units: 'yards' });
      mockHoleMapView.mockClear();
      render(<HoleFlyover {...props} />);
      const lastCall = mockHoleMapView.mock.calls[mockHoleMapView.mock.calls.length - 1][0];
      expect(lastCall.data.units).toBe('yards');
    });
  });
});
