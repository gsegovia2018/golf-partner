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
  insertShotAfter: jest.fn(async () => ({ id: 'ins' })),
  deleteShot: jest.fn(),
}));

// Keep the wheel trivial: surface whether it's open + its label, and let a
// press stand in for "Delete".
jest.mock('../ClubWheel', () => {
  const { Text } = require('react-native');
  return {
    ClubWheel: ({ visible, seqLabel, onDelete, onMove, onInsert }) => (visible ? (
      <>
        <Text onPress={onDelete}>{`wheel:${seqLabel}`}</Text>
        {onMove && <Text onPress={onMove}>wheel-move</Text>}
        {onInsert && <Text onPress={onInsert}>wheel-insert</Text>}
      </>
    ) : null),
  };
});

jest.mock('../../../hooks/useAppSettings', () => ({
  useAppSettings: () => ({ units: 'meters', bag: undefined, clubDistances: {} }),
}));

const {
  logShot, logMeasuredShot, deleteShot, setShotPos, insertShotAfter,
} = require('../../../store/shotStore');

const base = {
  roundId: 'r1', roundIndex: 0, holeNumber: 7,
  pos: null, teePos: [38.55, -0.14], aimPos: null,
  targetPos: [38.556, -0.147], targetMeters: 150,
  tappedShotIndex: null, onConsumeShotTap: jest.fn(),
};

beforeEach(() => {
  mockShots = [];
  logShot.mockClear();
  deleteShot.mockClear();
  setShotPos.mockClear();
  insertShotAfter.mockClear();
});

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

// The ball is on the green and the rest of the hole is putts. Closing the
// chain at the green centre gives the approach its carry without a walk-up
// mark that would only ever be a putting spot.
describe('ShotTracker on-green close', () => {
  const approach = { id: 's2', lat: 38.5555, lng: -0.1465, club: '9i' }; // ~70 m out

  it('closes the hole at the green centre', async () => {
    mockShots = [{ id: 't', lat: 38.55, lng: -0.14, club: 'driver' }, approach];
    const { getByLabelText } = render(<ShotTracker {...base} />);
    await act(async () => {
      fireEvent.press(getByLabelText('Ball is on the green — finish the hole here'));
    });
    expect(logShot).toHaveBeenCalledWith(expect.objectContaining({
      pos: base.targetPos, club: null,
    }));
  });

  it('is not offered from the tee, where the green is out of reach', () => {
    mockShots = [{ id: 't', lat: 38.55, lng: -0.14, club: 'driver' }]; // ~900 m out
    const { queryByLabelText } = render(<ShotTracker {...base} />);
    expect(queryByLabelText('Ball is on the green — finish the hole here')).toBeNull();
  });

  it('is not offered once the chain is already closed', () => {
    mockShots = [approach, { id: 's3', lat: 38.556, lng: -0.147, club: null }];
    const { queryByLabelText } = render(<ShotTracker {...base} />);
    expect(queryByLabelText('Ball is on the green — finish the hole here')).toBeNull();
  });
});

describe('ShotTracker shot editing', () => {
  const shots = [
    { id: 't', lat: 38.55, lng: -0.14, club: 'driver' },
    { id: 's2', lat: 38.554, lng: -0.142, club: '7i' },
  ];

  it('moves a tapped shot to the aim ring', () => {
    mockShots = shots;
    const { getByText } = render(
      <ShotTracker {...base} tappedShotIndex={1} aimPos={[38.5545, -0.1425]} />,
    );
    fireEvent.press(getByText('wheel-move'));
    expect(setShotPos).toHaveBeenCalledWith('s2', [38.5545, -0.1425]);
  });

  it('inserts a forgotten shot after the tapped one, at the aim ring', async () => {
    mockShots = shots;
    const { getByText } = render(
      <ShotTracker {...base} tappedShotIndex={0} aimPos={[38.552, -0.141]} />,
    );
    await act(async () => { fireEvent.press(getByText('wheel-insert')); });
    expect(insertShotAfter).toHaveBeenCalledWith('t', [38.552, -0.141]);
  });

  it('with no aim ring, an inserted shot lands halfway to the next spot', async () => {
    mockShots = shots;
    const { getByText } = render(<ShotTracker {...base} tappedShotIndex={0} />);
    await act(async () => { fireEvent.press(getByText('wheel-insert')); });
    const [id, [lat, lng]] = insertShotAfter.mock.calls[0];
    expect(id).toBe('t');
    expect(lat).toBeCloseTo(38.552, 6);
    expect(lng).toBeCloseTo(-0.141, 6);
  });
});
