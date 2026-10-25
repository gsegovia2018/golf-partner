import React from 'react';
import { render } from '@testing-library/react-native';
import { useRoundTracking, roundTrackingText, NOTIFICATION_MIN_DELTA_M } from '../useRoundTracking';
import { setRoundTracking } from '../../lib/roundTracking';
import { setActiveTrailRound, flushTrails } from '../../store/gpsTrailStore';
import { setShotListening } from '../../lib/shotSense';
import { useAppSettings } from '../useAppSettings';

jest.mock('../../lib/roundTracking', () => ({ setRoundTracking: jest.fn() }));
jest.mock('../../lib/shotSense', () => ({ setShotListening: jest.fn() }));
jest.mock('../useAppSettings', () => ({ useAppSettings: jest.fn(() => ({})) }));
jest.mock('../../store/gpsTrailStore', () => ({
  setActiveTrailRound: jest.fn().mockResolvedValue(),
  flushTrails: jest.fn().mockResolvedValue({ uploaded: 0, failed: false }),
}));

function Probe(props) {
  useRoundTracking(props);
  return null;
}

const base = {
  active: true,
  courseName: 'Lomas-Bosque',
  holeNumber: 7,
  source: 'gps',
  units: 'meters',
  distances: { front: 131, center: 143, back: 156 },
};

beforeEach(() => {
  setShotListening.mockClear();
  useAppSettings.mockReturnValue({});
  setRoundTracking.mockClear();
  setActiveTrailRound.mockClear();
  flushTrails.mockClear();
});

describe('roundTrackingText', () => {
  test('live fix: hole and centre in the title, front/back and course in the body', () => {
    expect(roundTrackingText(base)).toEqual({
      title: 'Hole 7 · 143 m to the centre',
      body: '131 m front · 156 m back · Lomas-Bosque',
      center: 143,
    });
  });

  test('tee fallback says so, and yards follow the units setting', () => {
    const t = roundTrackingText({ ...base, source: 'tee', units: 'yards', distances: { front: 350, center: 366, back: 380 } });
    expect(t.title).toBe('Hole 7 · 400 yd from the tee');
    expect(t.body).toBe('383 yd front · 416 yd back · Lomas-Bosque');
  });

  test('no distance yet: acquiring text with the course and a tap hint', () => {
    expect(roundTrackingText({ ...base, distances: null })).toEqual({
      title: 'Hole 7 · Getting GPS fix',
      body: 'Lomas-Bosque · tap to open the scorecard',
      center: null,
    });
  });
});

test('sends text when active, ignores a centre move under the threshold, follows a larger one', () => {
  const view = render(<Probe {...base} />);
  expect(setRoundTracking).toHaveBeenCalledTimes(1);
  expect(setRoundTracking).toHaveBeenLastCalledWith({
    title: 'Hole 7 · 143 m to the centre',
    body: '131 m front · 156 m back · Lomas-Bosque',
  });

  const small = NOTIFICATION_MIN_DELTA_M - 1;
  view.rerender(<Probe {...base} distances={{ front: 131 - small, center: 143 - small, back: 156 - small }} />);
  expect(setRoundTracking).toHaveBeenCalledTimes(1);

  view.rerender(<Probe {...base} distances={{ front: 120, center: 132, back: 145 }} />);
  expect(setRoundTracking).toHaveBeenCalledTimes(2);
  expect(setRoundTracking).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Hole 7 · 132 m to the centre' }));
});

test('a hole change updates even when the distance barely moved', () => {
  const view = render(<Probe {...base} />);
  view.rerender(<Probe {...base} holeNumber={8} distances={{ front: 130, center: 142, back: 155 }} />);
  expect(setRoundTracking).toHaveBeenCalledTimes(2);
  expect(setRoundTracking).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Hole 8 · 142 m to the centre' }));
});

test('inactive stops tracking; so does unmount', () => {
  const view = render(<Probe {...base} />);
  view.rerender(<Probe {...base} active={false} />);
  expect(setRoundTracking).toHaveBeenLastCalledWith(null);

  setRoundTracking.mockClear();
  view.rerender(<Probe {...base} />);
  expect(setRoundTracking).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Hole 7 · 143 m to the centre' }));
  view.unmount();
  expect(setRoundTracking).toHaveBeenLastCalledWith(null);
});

describe('GPS trail round', () => {
  const trail = { userId: 'u1', tournamentId: 't-1', roundId: 'r0', roundIndex: 0 };
  const flushed = () => new Promise((r) => setTimeout(r, 0));

  test('active with a trail names the round; a fresh object with the same ids does not restart it', () => {
    const view = render(<Probe {...base} trail={trail} />);
    expect(setActiveTrailRound).toHaveBeenCalledTimes(1);
    expect(setActiveTrailRound).toHaveBeenLastCalledWith(trail);
    view.rerender(<Probe {...base} trail={{ ...trail }} distances={{ front: 100, center: 110, back: 120 }} />);
    expect(setActiveTrailRound).toHaveBeenCalledTimes(1);
  });

  test('tracking stopping clears the round and uploads the trail', async () => {
    const view = render(<Probe {...base} trail={trail} />);
    view.rerender(<Probe {...base} trail={trail} active={false} />);
    expect(setActiveTrailRound).toHaveBeenLastCalledWith(null);
    await flushed();
    expect(flushTrails).toHaveBeenCalledTimes(1);
  });

  test('unmount clears the round and uploads the trail', async () => {
    const view = render(<Probe {...base} trail={trail} />);
    view.unmount();
    expect(setActiveTrailRound).toHaveBeenLastCalledWith(null);
    await flushed();
    expect(flushTrails).toHaveBeenCalledTimes(1);
  });

  test('no trail (not a player on this phone) or inactive → no round is named', () => {
    render(<Probe {...base} trail={null} />);
    render(<Probe {...base} active={false} trail={trail} />);
    expect(setActiveTrailRound).not.toHaveBeenCalled();
  });
});

describe('shot listening', () => {
  const trail = { userId: 'u1', tournamentId: 't-1', roundId: 'r0', roundIndex: 0 };
  const on = { recordGpsTrail: true, listenForShots: true };

  test('listens under the round proposal key while the trail records, stops on unmount', () => {
    useAppSettings.mockReturnValue(on);
    const view = render(<Probe {...base} trail={trail} />);
    expect(setShotListening).toHaveBeenCalledTimes(1);
    expect(setShotListening).toHaveBeenLastCalledWith('r0|0', 'Listening for shots');
    view.rerender(<Probe {...base} trail={{ ...trail }} />);
    expect(setShotListening).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(setShotListening).toHaveBeenLastCalledWith(null);
  });

  test('needs both settings, a trail and an active round', () => {
    useAppSettings.mockReturnValue({ recordGpsTrail: true });
    render(<Probe {...base} trail={trail} />);
    useAppSettings.mockReturnValue({ listenForShots: true });
    render(<Probe {...base} trail={trail} />);
    useAppSettings.mockReturnValue(on);
    render(<Probe {...base} trail={null} />);
    render(<Probe {...base} active={false} trail={trail} />);
    expect(setShotListening).not.toHaveBeenCalled();
  });
});
