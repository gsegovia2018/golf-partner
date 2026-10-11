import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

// JS side of the Wear OS companion bridge (modules/golf-watch-bridge). The
// native module publishes the state JSON to the watch's Data Layer and emits
// the watch's commands back. Android only, and only in a build that includes
// the module: on web, iOS, or an older APK everything here is a silent no-op,
// so OTA updates are safe against binaries without the module.
//
// Native API: setState(json: string, urgent: boolean); event `onCommand` with
// { json: string }. `urgent` asks the Data Layer to deliver now rather than
// batch; a distance-only refresh does not need it.
// Contract: docs/superpowers/plans/2026-10-11-wear-os-watch-companion.md

let native;
function nativeModule() {
  if (native === undefined) {
    native = Platform.OS === 'android' ? requireOptionalNativeModule('GolfWatchBridge') : null;
  }
  return native;
}

export const isWatchBridgeSupported = () => nativeModule() != null;

export function setWatchState(state, { urgent = true } = {}) {
  const mod = nativeModule();
  if (!mod) return;
  try {
    mod.setState(JSON.stringify(state), urgent);
  } catch {
    // The watch is optional; a failed push must never reach the scorecard.
  }
}

// cb receives the raw command JSON string. Returns a subscription with remove().
export function addWatchCommandListener(cb) {
  const mod = nativeModule();
  if (!mod?.addListener) return { remove() {} };
  return mod.addListener('onCommand', (event) => {
    if (typeof event?.json === 'string') cb(event.json);
  });
}

export function __resetWatchBridgeForTests() {
  native = undefined;
}
