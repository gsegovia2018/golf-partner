// Why an analysis failed, kept with the swing (swingStore's `errorDetail`) so the
// error screen can say it and the golfer can send it: until now every native
// error became "failed" and its cause was thrown away (issue: a Pixel 10 Pro
// that never analysed a clip, with nothing to go on).
import { Platform } from 'react-native';

const MAX_MESSAGE = 400;

// A native/web rejection -> the D12 code the screens know, plus the detail.
// `stage`: where runAnalysis was ('reading' | 'pose' | 'planes').
export function failureOf(err, stage) {
  const code = typeof err?.code === 'string' ? err.code : null;
  return {
    error: code === 'ERR_UNSUPPORTED_VIDEO' ? 'video' : 'failed',
    detail: {
      code,
      message: String(err?.message ?? err ?? '').slice(0, MAX_MESSAGE),
      stage: stage ?? null,
      at: new Date().toISOString(),
    },
  };
}

// The phone, as React Native knows it (no extra native module, so an OTA has it).
export function deviceLine() {
  const c = Platform.constants ?? {};
  const name = [c.Manufacturer, c.Brand !== c.Manufacturer ? c.Brand : null, c.Model].filter(Boolean).join(' ');
  const os = Platform.OS === 'android' ? `Android ${c.Release ?? '?'} (API ${Platform.Version})` : `${Platform.OS} ${Platform.Version ?? ''}`.trim();
  return [name || null, os].filter(Boolean).join(' · ');
}

// The plain-text report the error screen shares: what failed, where, on what.
export function failureReport({ swingId, detail, apiVersion = null, appVersion = null, source = null }) {
  return [
    'Golf Partner · swing analysis failed',
    `Error: ${detail?.code ?? 'unknown'}${detail?.stage ? ` (while ${detail.stage})` : ''}`,
    detail?.message ? `Message: ${detail.message}` : null,
    `Device: ${deviceLine()}`,
    `App: ${appVersion ?? '?'} · swing module v${apiVersion ?? '?'}`,
    source ? `Clip: ${source}` : null,
    `Swing: ${swingId}`,
    detail?.at ? `When: ${detail.at}` : null,
  ].filter(Boolean).join('\n');
}
