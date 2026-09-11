import React from 'react';
import { render } from '@testing-library/react-native';
import { useRoundTracking, roundTrackingText, NOTIFICATION_MIN_DELTA_M } from '../useRoundTracking';
import { setRoundTracking } from '../../lib/roundTracking';

jest.mock('../../lib/roundTracking', () => ({ setRoundTracking: jest.fn() }));

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

beforeEach(() => { setRoundTracking.mockClear(); });

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
