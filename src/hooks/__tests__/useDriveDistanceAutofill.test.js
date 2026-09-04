import React from 'react';
import { render } from '@testing-library/react-native';
import { useDriveDistanceAutofill } from '../useDriveDistanceAutofill';

// A marked tee shot, as shotStore holds it: spot 1 is the tee (the club played
// FROM there), spot 2 the landing. `step` converts metres to a latitude delta
// so the carry is exactly the distance asked for.
const A = { lat: 40.0, lng: -4.0 };
const step = (m) => m / 111320;
let mockShots = [];
const teeShot = (holeNumber, meters, roundId = 'r1', roundIndex = 0) => ([
  { roundId, roundIndex, holeNumber, seq: 1, club: 'driver', lat: A.lat, lng: A.lng },
  { roundId, roundIndex, holeNumber, seq: 2, club: null, lat: A.lat + step(meters), lng: A.lng },
]);

jest.mock('../../store/shotStore', () => ({
  subscribeShots: () => () => {},
  getShotsVersion: () => 1,
  getShots: () => mockShots,
}));

const HOLES = [{ number: 1, par: 4 }, { number: 2, par: 3 }];

function Probe(props) {
  useDriveDistanceAutofill({
    roundId: 'r1', roundIndex: 0, meId: 'me', holes: HOLES, ...props,
  });
  return null;
}

const renderProbe = (props) => {
  const onSetShot = jest.fn();
  const utils = render(<Probe onSetShot={onSetShot} {...props} />);
  return { onSetShot, ...utils };
};

beforeEach(() => { mockShots = []; });

describe('useDriveDistanceAutofill', () => {
  it('fills the drive bucket from the measured tee shot', () => {
    mockShots = teeShot(1, 195);
    const { onSetShot } = renderProbe({ shotDetails: {} });
    expect(onSetShot).toHaveBeenCalledWith('me', 1, { driveDistBucket: '180-210' });
  });

  it('leaves a bucket the player picked themselves alone', () => {
    mockShots = teeShot(1, 195);
    const { onSetShot } = renderProbe({
      shotDetails: { me: { 1: { driveDistBucket: '240+' } } },
    });
    expect(onSetShot).not.toHaveBeenCalled();
  });

  it('skips par 3s, which have no drive row', () => {
    mockShots = teeShot(2, 145);
    const { onSetShot } = renderProbe({ shotDetails: {} });
    expect(onSetShot).not.toHaveBeenCalled();
  });

  it('ignores shots from another round', () => {
    mockShots = teeShot(1, 195, 'other');
    const { onSetShot } = renderProbe({ shotDetails: {} });
    expect(onSetShot).not.toHaveBeenCalled();
  });

  it('writes once, not on every render', () => {
    mockShots = teeShot(1, 195);
    const onSetShot = jest.fn();
    const { rerender } = render(<Probe shotDetails={{}} onSetShot={onSetShot} />);
    // The write lands in the store, so the next render already sees it.
    rerender(<Probe shotDetails={{ me: { 1: { driveDistBucket: '180-210' } } }} onSetShot={onSetShot} />);
    expect(onSetShot).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a signed-in me, or when disabled', () => {
    mockShots = teeShot(1, 195);
    expect(renderProbe({ shotDetails: {}, meId: null }).onSetShot).not.toHaveBeenCalled();
    expect(renderProbe({ shotDetails: {}, enabled: false }).onSetShot).not.toHaveBeenCalled();
  });
});
