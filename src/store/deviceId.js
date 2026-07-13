import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@golf_device_author_id';
let _cached = null;

// Synchronous best-effort id for author stamping; hydrated once on first call.
export function getDeviceAuthorId() {
  if (_cached) return _cached;
  _cached = `dev-${Math.random().toString(36).slice(2)}`;
  AsyncStorage.getItem(KEY).then((v) => {
    if (v) _cached = v; else AsyncStorage.setItem(KEY, _cached);
  }).catch(() => {});
  return _cached;
}
