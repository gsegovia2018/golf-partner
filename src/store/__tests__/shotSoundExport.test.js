import { soundExportRound, SOUND_EXPORT_SCHEMA } from '../shotSoundExport';

jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ Directory: jest.fn(), File: jest.fn(), Paths: {} }));

test('each stop carries my answer and its sound level, with every event', () => {
  const events = [
    { type: 'start', t: 0 },
    { type: 'strike', t: 150000, gyroPeak: 5, accPeak: 2, clip: '150000.wav' },
    { type: 'stop', t: 600000 },
  ];
  const stops = [
    { id: '100000', start: 100000, end: 160000, status: 'added' },
    { id: '300000', start: 300000, end: 340000, status: 'dismissed' },
  ];
  const body = soundExportRound({ session: 't1-r0|0', stops, events });
  expect(body.schema).toBe(SOUND_EXPORT_SCHEMA);
  expect(body.session).toBe('t1-r0|0');
  expect(body.stops.map((s) => [s.status, s.sound])).toEqual([['added', 'shot'], ['dismissed', 'quiet']]);
  expect(body.events).toBe(events);
});

test('no proposals on this phone: the events still go', () => {
  const body = soundExportRound({ session: 'x', stops: null, events: [{ type: 'start', t: 1 }] });
  expect(body.stops).toEqual([]);
  expect(body.events).toHaveLength(1);
});
