// Can this build record and analyse swings? A seam over the native module that
// another PR owns (src/swing/native.js). The require is lazy and inside a try,
// so the app runs before the module exists, with a binary that lacks it, and on
// web. Metro treats a require inside try/catch as an optional dependency.
//
// Returns { supported: true } or { supported: false, reason }:
//   'web'    this platform never has the module (web, iOS)
//   'update' Android, but the installed binary lacks the module or speaks an
//            older apiVersion: the user needs a new build (plan R8)

import { Platform } from 'react-native';

export const REQUIRED_API_VERSION = 1;

export function getSwingAvailability() {
  if (Platform.OS !== 'android') return { supported: false, reason: 'web' };
  let native = null;
  try {
    // eslint-disable-next-line global-require
    native = require('./native');
  } catch {
    return { supported: false, reason: 'update' };
  }
  const api = native?.apiVersion ?? native?.default?.apiVersion;
  const version = typeof api === 'function' ? api() : api;
  if (typeof version !== 'number' || version < REQUIRED_API_VERSION) {
    return { supported: false, reason: 'update' };
  }
  return { supported: true };
}
