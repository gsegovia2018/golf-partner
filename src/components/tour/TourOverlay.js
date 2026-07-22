import React, { useState, useSyncExternalStore } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { useAppSettings } from '../../hooks/useAppSettings';
import { isSettingsHydrated, subscribeSettingsHydration } from '../../store/settingsStore';
import { shouldShowTour, completeTour } from '../../store/tourStore';
import CoachMarks from './CoachMarks';

// Gates a CoachMarks chapter: settings must be hydrated (so a reinstall
// doesn't flash the tour at a veteran before the server copy lands), the
// user must be a signed-in non-guest, the chapter flag must be unset, and
// the host screen must currently have navigation focus — CoachMarks now
// renders in a full-window Modal (so it can spotlight the tab bar), and
// without a focus check a tour mounted on Home would keep floating over
// whatever screen the user navigates to next.
// Dismissal is local-first: the overlay drops immediately; the flag write
// rides the normal settings pipeline (offline-safe).
export default function TourOverlay({ chapter, steps }) {
  const { user } = useAuth();
  useAppSettings(); // re-render when synced flags arrive
  const hydrated = useSyncExternalStore(subscribeSettingsHydration, isSettingsHydrated, isSettingsHydrated);
  const [dismissed, setDismissed] = useState(false);
  const isFocused = useIsFocused();

  const eligible = hydrated && !dismissed && !!user && !user.is_anonymous && isFocused && shouldShowTour(chapter);
  if (!eligible) return null;

  const finish = () => { setDismissed(true); completeTour(chapter); };
  return <CoachMarks steps={steps} onDone={finish} onSkip={finish} />;
}
