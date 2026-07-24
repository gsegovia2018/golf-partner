import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { MeasureFab } from '../MeasureFab';

jest.mock('../../../store/shotStore', () => ({
  logMeasuredShot: jest.fn(async () => ({ originId: 'o1', shotId: 's1' })),
  deleteShot: jest.fn(),
  getShots: () => [],
  subscribeShots: () => () => {},
  getShotsVersion: () => 1,
}));
jest.mock('../../../hooks/useAppSettings', () => ({
  useAppSettings: () => ({ units: 'meters', bag: undefined, clubDistances: {} }),
}));
jest.mock('../ClubWheel', () => ({ ClubWheel: () => null }));

const { logMeasuredShot, deleteShot } = require('../../../store/shotStore');

const START = [38.5500, -0.1400];
const FAR = [38.5520, -0.1420]; // ~280 m
const base = {
  roundId: 'r1', roundIndex: 0, holeNumber: 7,
  fix: { position: START, accuracy: 8 }, targetMeters: 150, onOpenMap: jest.fn(),
};

beforeEach(() => { jest.clearAllMocks(); });

describe('MeasureFab', () => {
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
