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
  chainEndNear: (...a) => jest.requireActual('../../../store/shotStore').chainEndNear(...a),
}));

// Keep the wheel trivial: surface whether it's open + its label, and let a
// press stand in for "Delete".
jest.mock('../ClubWheel', () => {
  const { Text } = require('react-native');
  return {
    wheelClubsFor: jest.requireActual('../ClubWheel').wheelClubsFor,
    ClubWheel: ({
      visible, seqLabel, pickClub = true, onDelete, onMove, onInsert, onRepeat,
    }) => (visible ? (
      <>
        <Text onPress={onDelete}>{`wheel:${seqLabel}`}</Text>
        {!pickClub && <Text>wheel-no-club</Text>}
        {onMove && <Text onPress={onMove}>wheel-move</Text>}
        {onInsert && <Text onPress={onInsert}>wheel-insert</Text>}
        {onRepeat && <Text onPress={onRepeat}>wheel-repeat</Text>}
      </>
    ) : null),
  };
});

jest.mock('../../../hooks/useAppSettings', () => ({
  useAppSettings: () => ({ units: 'meters', bag: undefined, clubDistances: {} }),
}));

const {
  logShot, logMeasuredShot, deleteShot, setShotPos, setShotClub, insertShotAfter,
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
  setShotClub.mockClear();
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

  it('hides the FABs while a seen-shot card holds the bottom of the map', () => {
    const { queryByLabelText } = render(<ShotTracker {...base} aimPos={[38.554, -0.142]} hideFabs />);
    expect(queryByLabelText('Mark a shot at your location')).toBeNull();
  });

  it('ignores a second tap while the first mark is still being written', async () => {
    let finish;
    logShot.mockImplementationOnce(() => new Promise((r) => { finish = () => r({ id: 'new' }); }));
    const { getByLabelText } = render(<ShotTracker {...base} pos={[38.5531, -0.1411]} />);
    await act(async () => {
      fireEvent.press(getByLabelText('Mark a shot at your location'));
      fireEvent.press(getByLabelText('Mark a shot at your location'));
    });
    expect(logShot).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    await act(async () => { fireEvent.press(getByLabelText('Mark a shot at your location')); });
    expect(logShot).toHaveBeenCalledTimes(2);
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

// A measured shot leaves the chain ending in an un-hit landing. Marking at the
// ball then means "I'm playing from that landing", not a second spot on it.
describe('ShotTracker mark at a measured landing', () => {
  const tee = { id: 't', lat: 38.55, lng: -0.14, club: 'driver' };
  const landing = { id: 'l', lat: 38.5530, lng: -0.1420, club: null };

  it('tags the landing instead of stacking a spot within 30 m of it', async () => {
    mockShots = [tee, landing];
    const { getByLabelText, getByText } = render(<ShotTracker {...base} pos={[38.5531, -0.1421]} />);
    await act(async () => { fireEvent.press(getByLabelText('Mark a shot at your location')); });
    expect(logShot).not.toHaveBeenCalled();
    expect(setShotClub).toHaveBeenCalledWith('l', expect.any(String));
    getByText('wheel:Shot 2');
  });

  it('logs a new spot when the mark is far from the landing', async () => {
    mockShots = [tee, landing];
    const { getByLabelText } = render(<ShotTracker {...base} pos={[38.5545, -0.1440]} />);
    await act(async () => { fireEvent.press(getByLabelText('Mark a shot at your location')); });
    expect(logShot).toHaveBeenCalledWith(expect.objectContaining({ pos: [38.5545, -0.1440] }));
  });

  it('logs a new spot when the last spot already carries a club (a re-tee)', async () => {
    mockShots = [tee];
    const { getByLabelText } = render(<ShotTracker {...base} pos={[38.5501, -0.1401]} />);
    await act(async () => { fireEvent.press(getByLabelText('Mark a shot at your location')); });
    expect(logShot).toHaveBeenCalledTimes(1);
    expect(setShotClub).not.toHaveBeenCalled();
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

  // The green spot is where the first putt was struck: no club to pick.
  it('opens the green spot without a club wheel, only Move and Delete', () => {
    mockShots = [approach, { id: 'g', lat: base.targetPos[0], lng: base.targetPos[1], club: null }];
    const { getByText, queryByText } = render(
      <ShotTracker {...base} tappedShotIndex={1} aimPos={[38.5561, -0.1471]} />,
    );
    getByText('wheel:On the green');
    getByText('wheel-no-club');
    getByText('wheel-move');
    expect(queryByText('wheel-insert')).toBeNull();
  });

  it('uses the green outline when the map has one', () => {
    // ~25 m from the centre, but inside the outline.
    const green = [[38.5550, -0.1480], [38.5550, -0.1460], [38.5570, -0.1460], [38.5570, -0.1480]];
    mockShots = [approach, { id: 'g', lat: 38.5558, lng: -0.1469, club: null }];
    const { getByText } = render(<ShotTracker {...base} tappedShotIndex={1} greenPolygon={green} />);
    getByText('wheel-no-club');
  });

  it('a mark on the green after closing it does not give the green spot a club', async () => {
    mockShots = [approach, { id: 'g', lat: base.targetPos[0], lng: base.targetPos[1], club: null }];
    const { getByLabelText, getByText } = render(<ShotTracker {...base} pos={[38.5561, -0.1471]} />);
    await act(async () => { fireEvent.press(getByLabelText('Mark a shot at your location')); });
    expect(logShot).not.toHaveBeenCalled();
    expect(setShotClub).not.toHaveBeenCalled();
    getByText('wheel-no-club');
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

  it('moves a tapped shot to the live fix when there is one', () => {
    mockShots = shots;
    const { getByText } = render(
      <ShotTracker {...base} tappedShotIndex={1} aimPos={[38.5545, -0.1425]} pos={[38.5542, -0.1422]} />,
    );
    fireEvent.press(getByText('wheel-move'));
    expect(setShotPos).toHaveBeenCalledWith('s2', [38.5542, -0.1422]);
  });

  it('with no fix, moves a tapped shot to the aim ring', () => {
    mockShots = shots;
    const { getByText } = render(
      <ShotTracker {...base} tappedShotIndex={1} aimPos={[38.5545, -0.1425]} />,
    );
    fireEvent.press(getByText('wheel-move'));
    expect(setShotPos).toHaveBeenCalledWith('s2', [38.5545, -0.1425]);
  });

  it('after the last spot, an inserted shot lands at the live fix', async () => {
    mockShots = shots;
    const { getByText } = render(
      <ShotTracker {...base} tappedShotIndex={1} aimPos={[38.555, -0.143]} pos={[38.5548, -0.1428]} />,
    );
    await act(async () => { fireEvent.press(getByText('wheel-insert')); });
    expect(insertShotAfter).toHaveBeenCalledWith('s2', [38.5548, -0.1428]);
  });

  it('after the last spot with no fix, an inserted shot lands at the aim ring', async () => {
    mockShots = shots;
    const { getByText } = render(
      <ShotTracker {...base} tappedShotIndex={1} aimPos={[38.555, -0.143]} />,
    );
    await act(async () => { fireEvent.press(getByText('wheel-insert')); });
    expect(insertShotAfter).toHaveBeenCalledWith('s2', [38.555, -0.143]);
  });

  it('between two spots, an inserted shot lands halfway, over the fix and the aim ring', async () => {
    mockShots = shots;
    const { getByText } = render(
      <ShotTracker {...base} tappedShotIndex={0} aimPos={[38.555, -0.143]} pos={[38.5548, -0.1428]} />,
    );
    await act(async () => { fireEvent.press(getByText('wheel-insert')); });
    const [id, [lat, lng]] = insertShotAfter.mock.calls[0];
    expect(id).toBe('t');
    expect(lat).toBeCloseTo(38.552, 6);
    expect(lng).toBeCloseTo(-0.141, 6);
  });

  it('offers +1 from here only while the score says shots are missing', async () => {
    mockShots = shots;
    const { queryByText, rerender, getByText } = render(<ShotTracker {...base} tappedShotIndex={1} />);
    expect(queryByText('wheel-repeat')).toBeNull();
    rerender(<ShotTracker {...base} tappedShotIndex={1} missing={1} />);
    await act(async () => { fireEvent.press(getByText('wheel-repeat')); });
    const [id, pos, club] = insertShotAfter.mock.calls[0];
    expect(id).toBe(shots[1].id);
    expect(pos).toEqual([shots[1].lat, shots[1].lng]);
    expect(club).toBe(shots[1].club ?? null);
  });
});
