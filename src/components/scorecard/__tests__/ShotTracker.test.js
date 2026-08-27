import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { ShotTracker } from '../ShotTracker';

// Controllable shot list for shotsForHole / getShots.
let mockShots = [];
jest.mock('../../../store/shotStore', () => ({
  subscribeShots: () => () => {},
  getShotsVersion: () => 1,
  getShots: () => mockShots,
  shotsForHole: () => mockShots,
  logShot: jest.fn(async () => ({ id: 'new' })),
  logMeasuredShot: jest.fn(async () => ({ originId: 'o1', shotId: 's9' })),
  setShotClub: jest.fn(),
  setShotPos: jest.fn(),
  deleteShot: jest.fn(),
}));

// Keep the wheel trivial: surface whether it's open + its label, and let a
// press stand in for "Delete".
jest.mock('../ClubWheel', () => {
  const { Text } = require('react-native');
  return {
    ClubWheel: ({ visible, seqLabel, onDelete }) => (
      visible ? <Text onPress={onDelete}>{`wheel:${seqLabel}`}</Text> : null
    ),
  };
});

jest.mock('../../../hooks/useAppSettings', () => ({
  useAppSettings: () => ({ units: 'meters', bag: undefined, clubDistances: {} }),
}));

const { logShot, logMeasuredShot, deleteShot } = require('../../../store/shotStore');

const base = {
  roundId: 'r1', roundIndex: 0, holeNumber: 7,
  pos: null, teePos: [38.55, -0.14], aimPos: null,
  targetPos: [38.556, -0.147], targetMeters: 150,
  tappedShotIndex: null, onConsumeShotTap: jest.fn(),
};

beforeEach(() => { mockShots = []; logShot.mockClear(); deleteShot.mockClear(); });

describe('ShotTracker FAB', () => {
  it('renders the club FAB', () => {
    const { getByLabelText } = render(<ShotTracker {...base} aimPos={[38.554, -0.142]} />);
    getByLabelText('Mark a shot at your location');
  });

  it('adds a shot at GPS on press, not at the aim ring', async () => {
    const { getByLabelText } = render(
      <ShotTracker {...base} aimPos={[38.5541, -0.1421]} pos={[38.5531, -0.1411]} />
    );
    await act(async () => {
      fireEvent.press(getByLabelText('Mark a shot at your location'));
    });
    expect(logShot).toHaveBeenCalledWith(expect.objectContaining({ pos: [38.5531, -0.1411] }));
  });

  it('falls back to the aim ring when there is no GPS fix', async () => {
    const { getByLabelText } = render(<ShotTracker {...base} aimPos={[38.5541, -0.1421]} />);
    await act(async () => {
      fireEvent.press(getByLabelText('Mark a shot at your location'));
    });
    expect(logShot).toHaveBeenCalledWith(expect.objectContaining({ pos: [38.5541, -0.1421] }));
  });

  it('adds a shot at the aim ring on long-press', async () => {
    const { getByLabelText } = render(
      <ShotTracker {...base} aimPos={[38.5541, -0.1421]} pos={[38.5531, -0.1411]} />
    );
    await act(async () => {
      fireEvent(getByLabelText('Mark a shot at your location'), 'longPress');
    });
    expect(logShot).toHaveBeenCalledWith(expect.objectContaining({ pos: [38.5541, -0.1421] }));
  });

  it('marks the first shot at the tee with a club, without seeding a spot', async () => {
    const { getByLabelText } = render(<ShotTracker {...base} pos={[38.5501, -0.1401]} />);
    await act(async () => {
      fireEvent.press(getByLabelText('Mark a shot at your location'));
    });
    expect(logShot).toHaveBeenCalledTimes(1);
    expect(logShot).toHaveBeenCalledWith(expect.objectContaining({ pos: [38.5501, -0.1401] }));
  });

  it('does nothing when there is no aim ring and no GPS', async () => {
    const { getByLabelText } = render(<ShotTracker {...base} />);
    await act(async () => {
      fireEvent.press(getByLabelText('Mark a shot at your location'));
    });
    expect(logShot).not.toHaveBeenCalled();
  });

  it('opens the club wheel for a tapped pin index', () => {
    mockShots = [
      { id: 't', lat: 38.55, lng: -0.14, club: null },
      { id: 's2', lat: 38.554, lng: -0.142, club: '7i' },
    ];
    const { getByText } = render(<ShotTracker {...base} tappedShotIndex={1} />);
    getByText('wheel:Shot 2');
  });

  it('deletes the tapped shot from the wheel', () => {
    mockShots = [
      { id: 't', lat: 38.55, lng: -0.14, club: null },
      { id: 's2', lat: 38.554, lng: -0.142, club: '7i' },
    ];
    const { getByText } = render(<ShotTracker {...base} tappedShotIndex={1} />);
    fireEvent.press(getByText('wheel:Shot 2'));
    expect(deleteShot).toHaveBeenCalledWith('s2');
    expect(deleteShot).toHaveBeenCalledTimes(1); // the earlier spot is a real shot, not an orphan
  });

  it('logs a start→end segment when two rings are set', async () => {
    const onCollapseTargets = jest.fn();
    const { getByLabelText } = render(
      <ShotTracker {...base} aimPos={[38.554, -0.142]}
        aimRings={[[38.550, -0.140], [38.554, -0.142]]} onCollapseTargets={onCollapseTargets} />,
    );
    await act(async () => { fireEvent.press(getByLabelText('Mark a shot at your location')); });
    expect(logMeasuredShot).toHaveBeenCalledWith(expect.objectContaining({
      start: [38.550, -0.140], end: [38.554, -0.142],
    }));
    expect(onCollapseTargets).toHaveBeenCalledWith([[38.554, -0.142]]);
  });
});
