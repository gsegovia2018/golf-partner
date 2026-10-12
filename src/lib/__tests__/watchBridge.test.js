const mockNative = { setState: jest.fn(), addListener: jest.fn(() => ({ remove: jest.fn() })) };
let mockModule = mockNative;
jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => mockModule }));

// Loads a fresh module graph; the module reads Platform.OS lazily, so the OS
// is set on the same react-native instance it will see.
const load = (os = 'android') => {
  jest.resetModules();
  require('react-native').Platform.OS = os;
  return require('../watchBridge');
};

beforeEach(() => {
  mockNative.setState.mockClear();
  mockNative.addListener.mockClear();
  mockModule = mockNative;
});

test('android with the module: stringifies state and wires onCommand', () => {
  const { setWatchState, addWatchCommandListener, isWatchBridgeSupported } = load();
  expect(isWatchBridgeSupported()).toBe(true);
  setWatchState({ v: 1 });
  expect(mockNative.setState).toHaveBeenCalledWith('{"v":1}', true);
  setWatchState({ v: 1 }, { urgent: false });
  expect(mockNative.setState).toHaveBeenLastCalledWith('{"v":1}', false);
  const cb = jest.fn();
  addWatchCommandListener(cb);
  const handler = mockNative.addListener.mock.calls[0][1];
  expect(mockNative.addListener.mock.calls[0][0]).toBe('onCommand');
  handler({ json: '{"a":1}' });
  handler({});
  expect(cb).toHaveBeenCalledTimes(1);
  expect(cb).toHaveBeenCalledWith('{"a":1}');
});

test('module missing: silent no-op', () => {
  mockModule = null;
  const { setWatchState, addWatchCommandListener, isWatchBridgeSupported } = load();
  expect(isWatchBridgeSupported()).toBe(false);
  expect(() => setWatchState({ v: 1 })).not.toThrow();
  expect(() => addWatchCommandListener(() => {}).remove()).not.toThrow();
});

test('not android: no-op even when a module exists', () => {
  const { setWatchState } = load('web');
  setWatchState({ v: 1 });
  expect(mockNative.setState).not.toHaveBeenCalled();
});
