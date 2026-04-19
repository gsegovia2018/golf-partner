import { Platform } from 'react-native';

// NetInfo on native; navigator.onLine on web (with a window listener).
// `isOnline()` returns the last known state. `subscribe(fn)` fires fn(online:boolean)
// whenever the state changes. First event on subscribe is the current state.

let _online = true;
const _subs = new Set();

function _emit() {
  _subs.forEach((fn) => { try { fn(_online); } catch (_) {} });
}

function _set(next) {
  if (next === _online) return;
  _online = next;
  _emit();
}

if (Platform.OS === 'web') {
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    _online = typeof navigator !== 'undefined' ? navigator.onLine : true;
    window.addEventListener('online', () => _set(true));
    window.addEventListener('offline', () => _set(false));
  }
} else {
  // Lazy-require so web doesn't try to resolve the native module
  const NetInfo = require('@react-native-community/netinfo').default;
  NetInfo.fetch().then((s) => _set(!!s.isConnected));
  NetInfo.addEventListener((s) => _set(!!s.isConnected));
}

export function isOnline() {
  return _online;
}

export function subscribeConnectivity(fn) {
  _subs.add(fn);
  try { fn(_online); } catch (_) {}
  return () => _subs.delete(fn);
}
