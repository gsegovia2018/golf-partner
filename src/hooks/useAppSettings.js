import { useSyncExternalStore } from 'react';
import { subscribeAppSettings, getAppSettings } from '../store/settingsStore';

// Reactive app-level settings. Named "app" settings to avoid colliding with
// tournament `settings` already used across screens.
export function useAppSettings() {
  return useSyncExternalStore(subscribeAppSettings, getAppSettings, getAppSettings);
}
