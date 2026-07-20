import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { HoleFlyover } from '../HoleFlyover';

// The map itself is a WebView/iframe — out of scope for this test.
jest.mock('../HoleMapView', () => ({ HoleMapView: () => null }));
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
  centerDistance: 326.4, position: [38.5577, -0.1491],
  visible: true, onClose: jest.fn(),
};

describe('HoleFlyover sheet chrome', () => {
  it('shows hole meta and live centre distance in the sheet header', () => {
    const { getByText } = render(<HoleFlyover {...props} />);
    getByText('Hole 7');
    getByText('Par 4 · SI 5');
    getByText('326 m');
  });

  it('renders a grabber and fires onClose from the close button', () => {
    const { getByTestId } = render(<HoleFlyover {...props} />);
    getByTestId('flyover-grabber');
    fireEvent.press(getByTestId('flyover-close'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('omits meta it was not given', () => {
    const { queryByText, getByText } = render(
      <HoleFlyover {...props} par={undefined} strokeIndex={undefined} centerDistance={null} />,
    );
    getByText('Hole 7');
    expect(queryByText(/Par/)).toBeNull();
    expect(queryByText(/ m$/)).toBeNull();
  });
});
