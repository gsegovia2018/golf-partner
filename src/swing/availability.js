// Can this build record and analyse swings? A seam over the native bridge
// (src/swing/native.js), which owns the contract version: REQUIRED_API_VERSION
// is read from the bridge itself, so the two can never disagree. The require is
// lazy and inside a try, so the app still runs with a binary that lacks the
// module, and on web.
//
// Returns { supported: true } or { supported: false, reason }:
//   'web'    this platform has no analyzer: iOS, or a browser that lacks what the web
//            build needs (native.web.js decides; plan 2026-10-23-swing-analyzer-web)
//   'update' Android, but the installed binary lacks the module or speaks an
//            older apiVersion: the user needs a new build (plan R8)

import { Platform } from 'react-native';
import { browserCanAnalyse } from './web/support';

export function getSwingAvailability() {
  if (Platform.OS === 'web') return browserCanAnalyse() ? { supported: true } : { supported: false, reason: 'web' };
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
  const required = native?.REQUIRED_API_VERSION ?? native?.default?.REQUIRED_API_VERSION;
  if (typeof version !== 'number' || typeof required !== 'number' || version < required) {
    return { supported: false, reason: 'update' };
  }
  return { supported: true };
}
