import { Platform } from 'react-native';
import { getSwingAvailability } from '../availability';

// availability.js requires ./native lazily at call time, so each test registers
// its own virtual mock (the module does not exist until the native PR lands) and
// clears the module registry so the previous test's require is not reused.
const realOS = Platform.OS;
beforeEach(() => { jest.resetModules(); Platform.OS = 'android'; });
afterEach(() => { Platform.OS = realOS; });

describe('getSwingAvailability', () => {
  test('web / iOS never support it', () => {
    Platform.OS = 'web';
    expect(getSwingAvailability()).toEqual({ supported: false, reason: 'web' });
    Platform.OS = 'ios';
    expect(getSwingAvailability()).toEqual({ supported: false, reason: 'web' });
  });

  test('Android without the native module (before its PR, or an old binary) says update', () => {
    jest.doMock('../native', () => { throw new Error("Cannot find module './native'"); }, { virtual: true });
    expect(getSwingAvailability()).toEqual({ supported: false, reason: 'update' });
  });

  test('Android with a compatible apiVersion is supported', () => {
    jest.doMock('../native', () => ({ REQUIRED_API_VERSION: 1, apiVersion: 1 }), { virtual: true });
    expect(getSwingAvailability()).toEqual({ supported: true });
  });

  test('accepts a default export and a function apiVersion', () => {
    jest.doMock('../native', () => ({ default: { REQUIRED_API_VERSION: 1, apiVersion: () => 2 } }), { virtual: true });
    expect(getSwingAvailability()).toEqual({ supported: true });
  });

  test('an older apiVersion says update', () => {
    jest.doMock('../native', () => ({ REQUIRED_API_VERSION: 1, apiVersion: 0 }), { virtual: true });
    expect(getSwingAvailability()).toEqual({ supported: false, reason: 'update' });
  });

  test('a module without apiVersion says update', () => {
    jest.doMock('../native', () => ({ REQUIRED_API_VERSION: 1 }), { virtual: true });
    expect(getSwingAvailability()).toEqual({ supported: false, reason: 'update' });
  });
});
