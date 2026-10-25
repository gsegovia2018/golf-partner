import { AppState } from 'react-native';
import {
  parseShotSenseEvents, sessionFolder, setShotListening, readShotSenseEvents, __resetShotSenseForTests,
} from '../shotSense';

const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeModule() {
  let running = null;
  return {
    start: jest.fn(async (session) => { running = session; return true; }),
    stop: jest.fn(async () => { running = null; }),
    running: jest.fn(() => running),
    readEvents: jest.fn(async () => '{"type":"start","t":5}\n{"type":"strike","t":9,"gyroPeak":4}\n{"type":"str'),
  };
}

afterEach(() => __resetShotSenseForTests());

test('parses one event per line and skips a cut-off line', () => {
  expect(parseShotSenseEvents('{"type":"start","t":1}\n\n{"type":"alive","t":2}\n{"ty')).toEqual([
    { type: 'start', t: 1 }, { type: 'alive', t: 2 },
  ]);
  expect(parseShotSenseEvents(null)).toEqual([]);
});

test('session folder names match the native ones', () => {
  expect(sessionFolder('t1-r0|0')).toBe('t1-r0_0');
});

test('reads the native log through the module', async () => {
  const mod = fakeModule();
  __resetShotSenseForTests(mod);
  expect(await readShotSenseEvents('k')).toEqual([{ type: 'start', t: 5 }, { type: 'strike', t: 9, gyroPeak: 4 }]);
});

test('starts, ignores the same session, stops', async () => {
  const mod = fakeModule();
  __resetShotSenseForTests(mod);
  setShotListening('a|0', 'Listening');
  await flush();
  setShotListening('a|0', 'Listening');
  await flush();
  expect(mod.start).toHaveBeenCalledTimes(1);
  expect(mod.start).toHaveBeenCalledWith('a|0', 'Listening');
  setShotListening(null);
  await flush();
  expect(mod.stop).toHaveBeenCalledTimes(1);
});

test('a start refused in the background is retried when the app is back', async () => {
  const mod = fakeModule();
  mod.start.mockResolvedValueOnce(false);
  const handlers = [];
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_, h) => { handlers.push(h); return { remove: jest.fn() }; });
  __resetShotSenseForTests(mod);
  setShotListening('a|0', 'Listening');
  await flush();
  expect(mod.start).toHaveBeenCalledTimes(1);
  handlers.forEach((h) => h('active'));
  await flush();
  expect(mod.start).toHaveBeenCalledTimes(2);
  spy.mockRestore();
});

test('without the module everything is a no-op', async () => {
  __resetShotSenseForTests(null);
  expect(() => setShotListening('a|0', 'x')).not.toThrow();
  expect(await readShotSenseEvents('nothing')).toEqual([]);
});
