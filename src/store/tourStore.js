import { getAppSettings, updateAppSettings } from './settingsStore';

// Coach-marks tour gating (spec: docs/superpowers/specs/2026-07-22-onboarding-design.md).
// A chapter shows while its flag is null/missing; completing or skipping
// stamps an ISO timestamp, synced cross-device through profiles.settings.

export function shouldShowTour(chapter) {
  const tour = getAppSettings().tour ?? {};
  return tour[chapter] == null;
}

export async function completeTour(chapter) {
  await updateAppSettings({ tour: { [chapter]: new Date().toISOString() } });
}

export async function resetTour() {
  await updateAppSettings({ tour: { home: null, scorecard: null } });
}
