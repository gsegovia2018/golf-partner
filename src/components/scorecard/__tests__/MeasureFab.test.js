import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { MeasureFab } from '../MeasureFab';

jest.mock('../../../store/shotStore', () => ({
  logMeasuredShot: jest.fn(async () => ({ originId: 'o1', originCreated: true, shotId: 's1' })),
  deleteShot: jest.fn(),
  setShotClub: jest.fn(),
  getShots: () => [],
  shotsForHole: () => [],
  chainEndNear: () => null,
  subscribeShots: () => () => {},
  getShotsVersion: () => 1,
}));
let mockStops = [];
jest.mock('../../../store/shotProposalStore', () => ({
  getRoundStops: () => mockStops,
  loadShotProposals: jest.fn(),
  markProposalAdded: jest.fn(),
}));
let mockTrail = false;
jest.mock('../../../hooks/useAppSettings', () => ({
  useAppSettings: () => ({ units: 'meters', bag: undefined, clubDistances: {}, recordGpsTrail: mockTrail }),
}));
let mockFeat = null;
jest.mock('../../../lib/geo', () => ({
  ...jest.requireActual('../../../lib/geo'),
  holeFeatures: () => mockFeat,
}));
jest.mock('../ClubWheel', () => ({ ClubWheel: () => null }));
jest.mock('../../../hooks/usePlayConditions', () => ({ usePlayConditions: () => ({ plays: (d) => d }) }));
jest.mock('../../../store/clubGuess', () => {
  const actual = jest.requireActual('../../../store/clubGuess');
  return { ...actual, guessClub: jest.fn(actual.guessClub) };
});
const { guessClub } = require('../../../store/clubGuess');

const { logMeasuredShot, deleteShot, setShotClub } = require('../../../store/shotStore');
const { markProposalAdded } = require('../../../store/shotProposalStore');

const START = [38.5500, -0.1400];
const FAR = [38.5520, -0.1420]; // ~280 m
const base = {
  roundId: 'r1', roundIndex: 0, holeNumber: 7,
  fix: { position: START, accuracy: 8 }, targetMeters: 150, onOpenMap: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStops = [];
  mockTrail = false;
  mockFeat = null;
});

describe('MeasureFab', () => {
  it('guesses its club through the shared guessClub (same plays-like and driver rule)', () => {
    render(<MeasureFab {...base} courseName="Test Course" offTee />);
    expect(guessClub).toHaveBeenCalledWith(expect.objectContaining({ meters: 150, courseName: 'Test Course', fromTee: false }));
  });

  it('arms on tap with a good fix', () => {
    const { getByLabelText } = render(<MeasureFab {...base} />);
    fireEvent.press(getByLabelText('Measure my shot'));
    getByLabelText('Ball is here — save the measured shot');
  });

  it('opens the map instead when the fix is unusable', () => {
    const { getByLabelText } = render(<MeasureFab {...base} fix={{ position: null, accuracy: null }} />);
    fireEvent.press(getByLabelText('Measure my shot'));
    expect(base.onOpenMap).toHaveBeenCalled();
  });

  it('ignores tap ② under 20 m, saves once far enough', async () => {
    const { getByLabelText, rerender } = render(<MeasureFab {...base} />);
    fireEvent.press(getByLabelText('Measure my shot'));
    await act(async () => { fireEvent.press(getByLabelText('Ball is here — save the measured shot')); });
    expect(logMeasuredShot).not.toHaveBeenCalled();          // still at START (0 m)
    rerender(<MeasureFab {...base} fix={{ position: FAR, accuracy: 8 }} />);
    await act(async () => { fireEvent.press(getByLabelText('Ball is here — save the measured shot')); });
    expect(logMeasuredShot).toHaveBeenCalledWith(expect.objectContaining({ start: START, end: FAR }));
  });

  it('saves to the hole it was armed on, even after the pager swipes away', async () => {
    const { getByLabelText, rerender } = render(<MeasureFab {...base} holeNumber={7} />);
    fireEvent.press(getByLabelText('Measure my shot'));
    rerender(<MeasureFab {...base} holeNumber={8} fix={{ position: FAR, accuracy: 8 }} />);
    await act(async () => { fireEvent.press(getByLabelText('Ball is here — save the measured shot')); });
    expect(logMeasuredShot).toHaveBeenCalledWith(expect.objectContaining({ holeNumber: 7 }));
  });

  it('requires a confirm tap when the fix degrades past 25 m by save time', async () => {
    const { getByLabelText, getByText, rerender } = render(<MeasureFab {...base} />);
    fireEvent.press(getByLabelText('Measure my shot')); // armed at ±8 m
    rerender(<MeasureFab {...base} fix={{ position: FAR, accuracy: 40 }} />);
    await act(async () => { fireEvent.press(getByLabelText('Ball is here — save the measured shot')); });
    expect(logMeasuredShot).not.toHaveBeenCalled();
    getByText(/GPS loose ±40 m — tap again to save/);
    await act(async () => { fireEvent.press(getByLabelText('Ball is here — save the measured shot')); });
    expect(logMeasuredShot).toHaveBeenCalledWith(expect.objectContaining({ start: START, end: FAR }));
  });

  it('clears the saved toast on its own instead of sitting there all round', async () => {
    jest.useFakeTimers();
    try {
      const { getByLabelText, queryByLabelText, rerender } = render(<MeasureFab {...base} />);
      fireEvent.press(getByLabelText('Measure my shot'));
      rerender(<MeasureFab {...base} fix={{ position: FAR, accuracy: 8 }} />);
      await act(async () => { fireEvent.press(getByLabelText('Ball is here — save the measured shot')); });
      getByLabelText('Undo measured shot');
      act(() => { jest.advanceTimersByTime(8000); });
      expect(queryByLabelText('Undo measured shot')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('undo deletes both created spots', async () => {
    const { getByLabelText, rerender } = render(<MeasureFab {...base} />);
    fireEvent.press(getByLabelText('Measure my shot'));
    rerender(<MeasureFab {...base} fix={{ position: FAR, accuracy: 8 }} />);
    await act(async () => { fireEvent.press(getByLabelText('Ball is here — save the measured shot')); });
    await act(async () => { fireEvent.press(getByLabelText('Undo measured shot')); });
    expect(deleteShot).toHaveBeenCalledWith('s1');
    expect(deleteShot).toHaveBeenCalledWith('o1');
  });
});

describe('MeasureFab keeps going', () => {
  const SAVE = 'Ball is here — save the measured shot';
  const FAR2 = [38.5535, -0.1435]; // ~210 m past FAR
  const MID = [38.5510, -0.1410];  // on the way from START to FAR

  it('tap ② saves and starts the next shot from that ball', async () => {
    const { getByLabelText, rerender } = render(<MeasureFab {...base} />);
    fireEvent.press(getByLabelText('Measure my shot'));
    rerender(<MeasureFab {...base} fix={{ position: FAR, accuracy: 8 }} />);
    await act(async () => { fireEvent.press(getByLabelText(SAVE)); });
    rerender(<MeasureFab {...base} fix={{ position: FAR2, accuracy: 8 }} />);
    await act(async () => { fireEvent.press(getByLabelText(SAVE)); });
    expect(logMeasuredShot).toHaveBeenNthCalledWith(1, expect.objectContaining({ start: START, end: FAR }));
    expect(logMeasuredShot).toHaveBeenNthCalledWith(2, expect.objectContaining({ start: FAR, end: FAR2 }));
  });

  it('stops after a save on the green', async () => {
    mockFeat = { green: null, greenCenter: FAR };
    const { getByLabelText, queryByLabelText, getByText, rerender } = render(<MeasureFab {...base} />);
    fireEvent.press(getByLabelText('Measure my shot'));
    rerender(<MeasureFab {...base} fix={{ position: FAR, accuracy: 8 }} />);
    await act(async () => { fireEvent.press(getByLabelText(SAVE)); });
    expect(queryByLabelText(SAVE)).toBeNull();
    getByText(/saved · on the green/);
    getByLabelText('Measure my shot');
  });

  it('× cancels the shot being measured and keeps what was saved', async () => {
    const { getByLabelText, getByText, rerender } = render(<MeasureFab {...base} />);
    fireEvent.press(getByLabelText('Measure my shot'));
    rerender(<MeasureFab {...base} fix={{ position: FAR, accuracy: 8 }} />);
    await act(async () => { fireEvent.press(getByLabelText(SAVE)); });
    fireEvent.press(getByLabelText('Cancel measuring'));
    expect(logMeasuredShot).toHaveBeenCalledTimes(1);
    expect(deleteShot).not.toHaveBeenCalled();
    getByText('Measuring stopped');
    getByLabelText('Measure my shot');
  });

  it('Undo takes the save back, restores a reused spot club and re-opens that shot', async () => {
    logMeasuredShot.mockResolvedValueOnce({ originId: 'o1', originCreated: false, prevClub: null, shotId: 's1' });
    const { getByLabelText, getByText, rerender } = render(<MeasureFab {...base} />);
    fireEvent.press(getByLabelText('Measure my shot'));
    rerender(<MeasureFab {...base} fix={{ position: FAR, accuracy: 8 }} />);
    await act(async () => { fireEvent.press(getByLabelText(SAVE)); });
    fireEvent.press(getByText('Undo'));
    expect(deleteShot).toHaveBeenCalledWith('s1');
    expect(deleteShot).not.toHaveBeenCalledWith('o1');
    expect(setShotClub).toHaveBeenCalledWith('o1', null);
    await act(async () => { fireEvent.press(getByLabelText(SAVE)); });
    expect(logMeasuredShot).toHaveBeenLastCalledWith(expect.objectContaining({ start: START, end: FAR }));
  });

  it('with the trail on, offers to split at a stop on the way', async () => {
    mockTrail = true;
    const { getByLabelText, getByText, rerender } = render(<MeasureFab {...base} />);
    fireEvent.press(getByLabelText('Measure my shot'));
    mockStops = [{ id: 'st1', start: Date.now() + 1000, end: Date.now() + 41000, lat: MID[0], lng: MID[1], status: 'open' }];
    rerender(<MeasureFab {...base} fix={{ position: FAR, accuracy: 8 }} />);
    await act(async () => { fireEvent.press(getByLabelText(SAVE)); });
    expect(logMeasuredShot).not.toHaveBeenCalled();
    getByText(/You stood 40 s at .*Split there\?/);
    await act(async () => { fireEvent.press(getByText('Split')); });
    expect(logMeasuredShot).toHaveBeenNthCalledWith(1, expect.objectContaining({ start: START, end: MID }));
    expect(logMeasuredShot).toHaveBeenNthCalledWith(2, expect.objectContaining({ start: MID, end: FAR }));
    expect(markProposalAdded).toHaveBeenCalledWith('r1', 0, 'st1', 'o1');
  });

  it('"No" saves the one long shot', async () => {
    mockTrail = true;
    const { getByLabelText, getByText, rerender } = render(<MeasureFab {...base} />);
    fireEvent.press(getByLabelText('Measure my shot'));
    mockStops = [{ id: 'st1', start: Date.now() + 1000, end: Date.now() + 41000, lat: MID[0], lng: MID[1], status: 'open' }];
    rerender(<MeasureFab {...base} fix={{ position: FAR, accuracy: 8 }} />);
    await act(async () => { fireEvent.press(getByLabelText(SAVE)); });
    await act(async () => { fireEvent.press(getByText('No')); });
    expect(logMeasuredShot).toHaveBeenCalledTimes(1);
    expect(logMeasuredShot).toHaveBeenCalledWith(expect.objectContaining({ start: START, end: FAR }));
  });
});
