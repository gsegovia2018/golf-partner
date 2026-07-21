import React, { useState, useSyncExternalStore } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAppSettings } from '../../hooks/useAppSettings';
import { isSettingsHydrated, subscribeSettingsHydration } from '../../store/settingsStore';
import { shouldShowTour, completeTour } from '../../store/tourStore';
import CoachMarks from './CoachMarks';

// Gates a CoachMarks chapter: settings must be hydrated (so a reinstall
// doesn't flash the tour at a veteran before the server copy lands), the
// user must be a signed-in non-guest, and the chapter flag must be unset.
// Dismissal is local-first: the overlay drops immediately; the flag write
// rides the normal settings pipeline (offline-safe).
export default function TourOverlay({ chapter, steps }) {
  const { user } = useAuth();
  useAppSettings(); // re-render when synced flags arrive
  const hydrated = useSyncExternalStore(subscribeSettingsHydration, isSettingsHydrated, isSettingsHydrated);
  const [dismissed, setDismissed] = useState(false);

  const eligible = hydrated && !dismissed && !!user && !user.is_anonymous && shouldShowTour(chapter);
  if (!eligible) return null;

  const finish = () => { setDismissed(true); completeTour(chapter); };
  return <CoachMarks steps={steps} onDone={finish} onSkip={finish} />;
}
