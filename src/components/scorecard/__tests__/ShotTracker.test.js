import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ShotTracker } from '../ShotTracker';

// Controllable shot list for shotsForHole / getShots.
let mockShots = [];
jest.mock('../../../store/shotStore', () => ({
  subscribeShots: () => () => {},
  getShotsVersion: () => 1,
  getShots: () => mockShots,
  shotsForHole: () => mockShots,
  logShot: jest.fn(async () => ({ id: 'new' })),
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

const { logShot, deleteShot } = require('../../../store/shotStore');

const base = {
  roundId: 'r1', roundIndex: 0, holeNumber: 7,
  pos: null, teePos: [38.55, -0.14], aimPos: null,
  targetPos: [38.556, -0.147], targetMeters: 150,
  placing: false, onTogglePlacing: jest.fn(),
  pendingPoint: null, onConsumePoint: jest.fn(),
  tappedShotIndex: null, onConsumeShotTap: jest.fn(),
};

beforeEach(() => { mockShots = []; logShot.mockClear(); deleteShot.mockClear(); });

describe('ShotTracker FAB', () => {
  it('renders the club FAB', () => {
    const { getByLabelText } = render(<ShotTracker {...base} aimPos={[38.554, -0.142]} />);
    getByLabelText('Add a shot at the aim ring');
  });

  it('adds a shot at the aim ring on press', () => {
    const { getByLabelText } = render(<ShotTracker {...base} aimPos={[38.554, -0.142]} />);
    fireEvent.press(getByLabelText('Add a shot at the aim ring'));
    expect(logShot).toHaveBeenCalled();
  });

  it('adds a shot at GPS on long-press', () => {
    const { getByLabelText } = render(<ShotTracker {...base} pos={[38.553, -0.141]} />);
    fireEvent(getByLabelText('Add a shot at the aim ring'), 'longPress');
    expect(logShot).toHaveBeenCalled();
  });

  it('does nothing when there is no aim ring and no GPS', () => {
    const { getByLabelText } = render(<ShotTracker {...base} />);
    fireEvent.press(getByLabelText('Add a shot at the aim ring'));
    expect(logShot).not.toHaveBeenCalled();
  });

  it('opens the club wheel for a tapped pin index', () => {
    mockShots = [
      { id: 't', lat: 38.55, lng: -0.14, club: null },
      { id: 's2', lat: 38.554, lng: -0.142, club: '7i' },
    ];
    const { getByText } = render(<ShotTracker {...base} tappedShotIndex={1} />);
    getByText('wheel:Shot 1');
  });

  it('deletes the tapped shot from the wheel', () => {
    mockShots = [
      { id: 't', lat: 38.55, lng: -0.14, club: null },
      { id: 's2', lat: 38.554, lng: -0.142, club: '7i' },
    ];
    const { getByText } = render(<ShotTracker {...base} tappedShotIndex={1} />);
    fireEvent.press(getByText('wheel:Shot 1'));
    expect(deleteShot).toHaveBeenCalledWith('s2');
  });
});
