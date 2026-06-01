import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, Modal, Pressable, KeyboardAvoidingView, Platform, Animated,
  ActivityIndicator, Alert,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import * as Haptics from 'expo-haptics';

import { Feather } from '@expo/vector-icons';
import * as ScreenOrientation from 'expo-screen-orientation';

import { getShowRunningScore, setShowRunningScore } from '../lib/prefs';
import {
  loadTournament, subscribeTournamentChanges,
  calcBestWorstBall, DEFAULT_SETTINGS,
  roundPairClinched, setScoringModeRoundPatches,
  isRoundComplete, isTournamentFinished,
  subscribeSyncStatus,
  getActiveTournamentSnapshot,
} from '../store/tournamentStore';
import { mutate } from '../store/mutate';
import { fetchPlayers } from '../store/libraryStore';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import MediaLightbox from '../components/MediaLightbox';
import AttachMediaSheet from '../components/AttachMediaSheet';
import CaptureMenuSheet from '../components/CaptureMenuSheet';
import SyncStatusSheet from '../components/SyncStatusSheet';
import { pickMedia, attachMedia } from '../lib/mediaCapture';
import { useRoundMedia } from '../hooks/useRoundMedia';
import { useOfficialRound } from '../hooks/useOfficialRound';
import ScoringModeChangeBanner from '../components/ScoringModeChangeBanner';
import ScoringModeChangeSheet from '../components/ScoringModeChangeSheet';
import { fallbackNoticeText } from '../components/scoringModes';
import { cardDiscrepancyHoles } from '../store/officialScoring';
import { buildLeaderboard } from '../store/officialLeaderboard';
import { attestCard } from '../store/officialStore';
import { notifyRoundFinished } from '../store/notificationStore';
import { normalizeRoundNotes } from '../store/roundNotes';
import {
  DEFAULT_SHOT,
  celebrationFor,
} from '../components/scorecard/constants';
import { reconcileShotDetail, listRoundConflicts } from '../store/scoring';
import { makeScorecardStyles } from '../components/scorecard/styles';
import { HoleView } from '../components/scorecard/HoleView';
import { GridView } from '../components/scorecard/GridView';


const haptic = (style = 'light') => {
  if (Platform.OS === 'web') return;
  if (style === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  else if (style === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  else if (style === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
};


// Fallback 18-hole layout for official rounds whose `course` JSONB is empty
// or missing — keeps the scorecard usable until course data lands.
// TODO: official course data (Spec 2)
function defaultOfficialHoles() {
  return Array.from({ length: 18 }, (_, i) => ({
    number: i + 1,
    par: 4,
    strokeIndex: i + 1,
  }));
}

// Map an official round's `course` JSONB to the casual `round.holes` shape
// ({ number, par, strokeIndex }). The JSONB may store either a bare holes
// array or a { holes: [...] } object; tolerate both, fall back to default.
function officialHolesFromCourse(course) {
  const raw = Array.isArray(course)
    ? course
    : (Array.isArray(course?.holes) ? course.holes : null);
  if (!raw || raw.length === 0) return defaultOfficialHoles();
  return raw.map((h, i) => ({
    number: h.number ?? i + 1,
    par: h.par ?? 4,
    strokeIndex: h.strokeIndex ?? h.stroke_index ?? i + 1,
  }));
}


function usePrevious(value) {
  const ref = useRef(value);
  useEffect(() => { ref.current = value; }, [value]);
  return ref.current;
}

// Reconcile a reloaded scores blob with the local optimistic state. Clean
// cells take the blob value; a cell marked dirty keeps its local value until
// the blob agrees with it (its save has round-tripped). `dirtyKeys` holds
// `${playerId}:${holeNumber}` strings.
export function mergeScores(blobScores, localScores, dirtyKeys) {
  const out = {};
  const playerIds = new Set([
    ...Object.keys(blobScores ?? {}),
    ...Object.keys(localScores ?? {}),
  ]);
  for (const pid of playerIds) {
    const blobByHole = blobScores?.[pid] ?? {};
    const localByHole = localScores?.[pid] ?? {};
    const holes = new Set([...Object.keys(blobByHole), ...Object.keys(localByHole)]);
    const merged = {};
    for (const h of holes) {
      const key = `${pid}:${h}`;
      const blobVal = blobByHole[h];
      const localVal = localByHole[h];
      if (dirtyKeys.has(key) && blobVal !== localVal) {
        merged[h] = localVal;          // stale reload — protect the local edit
      } else {
        merged[h] = blobVal;           // clean cell, or save has round-tripped
      }
    }
    out[pid] = merged;
  }
  return out;
}

function sameShotDetail(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

// Same stale-reload protection as mergeScores, but for the "my shot detail"
// records stored at shotDetails[playerId][holeNumber]. In practice only meId
// writes these cells; the map stays player-keyed so legacy data and stats code
// keep their existing shape.
export function mergeShotDetails(blobShotDetails, localShotDetails, dirtyKeys) {
  const out = {};
  const playerIds = new Set([
    ...Object.keys(blobShotDetails ?? {}),
    ...Object.keys(localShotDetails ?? {}),
  ]);
  for (const pid of playerIds) {
    const blobByHole = blobShotDetails?.[pid] ?? {};
    const localByHole = localShotDetails?.[pid] ?? {};
    const holes = new Set([...Object.keys(blobByHole), ...Object.keys(localByHole)]);
    const merged = {};
    for (const h of holes) {
      const key = `${pid}:${h}`;
      const blobVal = blobByHole[h];
      const localVal = localByHole[h];
      if (dirtyKeys.has(key) && !sameShotDetail(blobVal, localVal)) {
        merged[h] = localVal;
      } else if (blobVal !== undefined) {
        merged[h] = blobVal;
      }
    }
    out[pid] = merged;
  }
  return out;
}

export function getScorecardBackTarget({ official, viewOnly, canGoBack }) {
  if (official) return 'previous';
  if (viewOnly) return 'home';
  return canGoBack ? 'previous' : 'tournament';
}

export function shouldApplyReloadSnapshot({
  preserveLocalEdits = false,
  pendingSave = false,
  hasTournament = false,
} = {}) {
  if (preserveLocalEdits) return false;
  if (pendingSave && hasTournament) return false;
  return true;
}

export function shouldMarkTournamentFinishedFromScorecard({ tournament }) {
  if (!tournament || tournament.kind === 'official') return false;
  return tournament.kind === 'game';
}

export function canShowQuickFinish({ tournament, official, viewOnly }) {
  return !official && !viewOnly && tournament?.kind === 'game';
}

export function roundDecisionNoticeForPair(pair) {
  const namedPlayers = Array.isArray(pair)
    ? pair.map((p) => p?.name).filter(Boolean)
    : [];
  const names = namedPlayers.join(' & ') || 'The leading side';
  const verb = namedPlayers.length > 1 ? 'have' : 'has';
  return {
    title: 'Round decided',
    message: `${names} ${verb} already won this round. You can keep scoring, but the round result will not change.`,
  };
}

export default function ScorecardScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);
  const paramRoundIndex = route.params?.roundIndex;
  // Official-tournament mode: when navigated from JoinOfficialScreen the
  // route carries { official: true, token, roundId }. In that mode the
  // screen scores an official round (Supabase RPC data layer) instead of
  // the casual tournament blob. Casual mode keeps `official` falsey and
  // every existing code path unchanged.
  const official = route.params?.official === true;
  const officialToken = route.params?.token ?? null;
  const officialRoundId = route.params?.roundId ?? null;
  const initialTournament = useMemo(
    () => (official ? null : getActiveTournamentSnapshot()),
    [official],
  );
  const initialRoundIndex = paramRoundIndex ?? initialTournament?.currentRound ?? 0;
  const initialRound = initialTournament?.rounds?.[initialRoundIndex] ?? null;
  // The hook is always called (Rules of Hooks); it no-ops on null token.
  const officialData = useOfficialRound({
    token: official ? officialToken : null,
    roundId: official ? officialRoundId : null,
  });
  const { user } = useAuth();
  const [tournament, setTournament] = useState(() => initialTournament);
  const [scores, setScores] = useState(() => initialRound?.scores ?? {});
  // Per-player, per-hole shot detail. In practice only the "me" player has
  // entries, but it is keyed by playerId like `scores` for generality.
  const [shotDetails, setShotDetails] = useState(() => initialRound?.shotDetails ?? {});
  // Notes object: { round: string, hole: { [holeNumber]: string } }.
  const [notes, setNotes] = useState(() => {
    return normalizeRoundNotes(initialRound?.notes);
  });
  const [notesOpen, setNotesOpen] = useState(false);
  const [view, setView] = useState('hole'); // 'grid' | 'hole'
  const [currentHole, setCurrentHole] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [saveError, setSaveError] = useState(false);
  // 'loading' until the first loadTournament resolves; 'error' if it returned
  // null (or threw); 'ready' once a tournament is in hand.
  const [loadState, setLoadState] = useState(() => (initialTournament && initialRound ? 'ready' : 'loading'));
  // Live sync status from the store ('idle' | 'syncing' | 'pending' | 'error').
  const [syncStatus, setSyncStatus] = useState('idle');
  // Round-complete celebration overlay before navigating to the summary.
  const [roundCompleteVisible, setRoundCompleteVisible] = useState(false);
  const [finishBusy, setFinishBusy] = useState(false);
  // The finish gate sets this to { hole, playerId } to send the user to a
  // conflicted hole; HoleView consumes it to open the resolve sheet.
  const [conflictFocus, setConflictFocus] = useState(null);
  const clearConflictFocus = useCallback(() => setConflictFocus(null), []);
  // Official mode (Task 16): attest-my-card request in flight, and the last
  // attest error message (RPC can reject with "resolve discrepancies first").
  const [attestBusy, setAttestBusy] = useState(false);
  // Official-only: whether the official gross leaderboard sheet is open.
  const [officialLeaderboardOpen, setOfficialLeaderboardOpen] = useState(false);
  const [attestError, setAttestError] = useState(null);
  // Casual-mode read-only lock for finished rounds. Initialized to true once
  // when a complete round is first loaded; "Edit round" in the header flips
  // it off for the rest of the session. Re-initializes when the user opens
  // a different round on this screen.
  const [viewOnly, setViewOnly] = useState(false);
  const viewOnlyInitRoundIdRef = useRef(null);
  const tournamentRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  // Keyed debounce timers for notes: key is 'round' or `h<holeNumber>`, so a
  // hole-note edit and a round-note edit never cancel each other's save.
  const notesSaveTimeoutsRef = useRef({});
  // Serializes score/note saves so concurrent edits never race over the same
  // tournament blob. Without this, two near-simultaneous setScore taps each
  // cloned the same tournamentRef baseline, and the later mutation's
  // saveLocal could overwrite the earlier one — dropping the first edit.
  const saveChainRef = useRef(Promise.resolve());
  const inflightSavesRef = useRef(0);
  // Tracks whether the user has an unsaved scorecard edit (scores, shot
  // details, or notes) that a subscription-driven reload must not clobber.
  // Set when a debounce/save is scheduled, cleared after the save finishes.
  const pendingSaveRef = useRef(false);
  // A reload can begin before the user edits, then resolve after the edit has
  // marked pendingSaveRef. Skip that stale snapshot and replay one fresh reload
  // after the save chain drains.
  const skippedReloadRef = useRef(false);
  const scoreAnims = useRef({});
  const hasAutoJumpedRef = useRef(false);
  const [celebration, setCelebration] = useState({ playerId: null, holeNumber: null, label: null });
  const celebrationAnim = useRef(new Animated.Value(0)).current;
  const [pickerAsset, setPickerAsset] = useState(null);
  const [lightboxItems, setLightboxItems] = useState([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [captureMenuVisible, setCaptureMenuVisible] = useState(false);
  const [syncSheetOpen, setSyncSheetOpen] = useState(false);
  const { items: roundMediaItems } = useRoundMedia(
    tournament?.id,
    tournament?.rounds?.[paramRoundIndex ?? tournament?.currentRound ?? 0]?.id,
  );
  const roundMediaCount = roundMediaItems.length;
  const roundIndex = paramRoundIndex ?? tournament?.currentRound ?? 0;

  useEffect(() => { tournamentRef.current = tournament; }, [tournament]);

  // The grid view is wide — let the user rotate to landscape to read it.
  // The hole view stays portrait. Either way, restore portrait on exit.
  useEffect(() => {
    if (view === 'grid') {
      ScreenOrientation.unlockAsync().catch(() => {});
    } else {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    }
  }, [view]);
  useEffect(() => () => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  const reload = useCallback(async ({ preserveLocalEdits = false } = {}) => {
    // Official mode does not use the casual tournament blob — its data
    // comes from useOfficialRound (Supabase RPC). The casual load path is
    // skipped entirely; the official-derived tournament is wired in below.
    if (official) return;
    let t;
    try {
      t = await loadTournament();
    } catch (e) {
      console.warn('ScorecardScreen: loadTournament failed', e);
      t = null;
    }
    if (!t) {
      // Only flip to the error state if there is nothing already on screen —
      // a transient subscription-driven reload should not blank a live round.
      if (!tournamentRef.current) setLoadState('error');
      return;
    }
    setLoadState('ready');
    const applySnapshot = shouldApplyReloadSnapshot({
      preserveLocalEdits,
      pendingSave: pendingSaveRef.current,
      hasTournament: !!tournamentRef.current,
    });
    if (!applySnapshot) {
      skippedReloadRef.current = true;
      return;
    }
    const idx = paramRoundIndex ?? t.currentRound;
    const round = t.rounds[idx];
    const roundScores = round?.scores ?? {};
    const roundShotDetails = round?.shotDetails ?? {};
    setTournament(t);
    // Merge rather than clobber: a stale reload (one that began around a tap
    // and resolved later) must not overwrite a newer local edit. mergeScores
    // keeps any dirty cell whose save has not yet round-tripped.
    // scoresRef.current is the reliable current-scores source here: score
    // handlers set it synchronously before calling setScores, and a useEffect
    // mirrors scores into it after every render — so it is always current.
    const merged = mergeScores(roundScores, scoresRef.current, dirtyCellsRef.current);
    // Drop dirty cells the blob has now caught up on.
    for (const key of [...dirtyCellsRef.current]) {
      const [pid, h] = key.split(':');
      if (roundScores?.[pid]?.[String(h)] === merged?.[pid]?.[String(h)]) {
        dirtyCellsRef.current.delete(key);
      }
    }
    scoresRef.current = merged;
    setScores(merged);
    const mergedShotDetails = mergeShotDetails(
      roundShotDetails,
      shotDetailsRef.current,
      dirtyShotKeysRef.current,
    );
    for (const key of [...dirtyShotKeysRef.current]) {
      const [pid, h] = key.split(':');
      if (sameShotDetail(roundShotDetails?.[pid]?.[String(h)], mergedShotDetails?.[pid]?.[String(h)])) {
        dirtyShotKeysRef.current.delete(key);
      }
    }
    shotDetailsRef.current = mergedShotDetails;
    setShotDetails(mergedShotDetails);
    // Normalize notes to the { round, hole } object shape. Legacy data may
    // have stored a bare string — treat that as the round-level note.
    setNotes(normalizeRoundNotes(round?.notes));

    // Only on first load: jump to the first hole with no scores entered.
    if (!hasAutoJumpedRef.current && round?.holes?.length) {
      hasAutoJumpedRef.current = true;
      const firstEmpty = round.holes.find((h) =>
        t.players.every((p) => roundScores[p.id]?.[h.number] == null)
      );
      if (firstEmpty) setCurrentHole(firstEmpty.number);
      else setCurrentHole(round.holes[round.holes.length - 1].number);
    }
  }, [paramRoundIndex, official]);

  useEffect(() => {
    reload();
    const unsub = subscribeTournamentChanges(() => {
      // A change event that fires while THIS screen has a save in flight is
      // the echo of our own saveLocal(). Re-reading the blob from disk and
      // setTournament()-ing a fresh object would churn tournament/round
      // identity on every +/- tap — re-rendering the whole pager and doing a
      // redundant disk read + remote fetch each time. Our own scores state
      // is already authoritative; skip the self-echo. A genuine remote change
      // is picked up by the next event once the save chain drains.
      if (pendingSaveRef.current) return;
      reload();
    });
    return unsub;
  }, [reload]);

  // Mirror the store's sync status into a header indicator.
  useEffect(() => subscribeSyncStatus(setSyncStatus), []);

  // Retry handler for the "couldn't load" error state. Official mode
  // re-fetches the RPC round state; casual mode re-runs loadTournament.
  const retryLoad = useCallback(() => {
    setLoadState('loading');
    if (official) officialData.refresh();
    else reload();
  }, [reload, official, officialData]);

  // Re-run the auto-jump to the first unplayed hole whenever the round
  // being displayed changes. Without this, switching from round 1 to
  // round 2 would leave the pager stuck on whatever hole was active
  // in round 1.
  useEffect(() => {
    hasAutoJumpedRef.current = false;
  }, [paramRoundIndex]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (official) await officialData.refresh();
      else await reload();
    } finally { setRefreshing(false); }
  }, [reload, official, officialData]);

  // Append a save unit to the serial chain. Each unit reads tournamentRef
  // at execution time (after preceding units have committed), so it sees a
  // fresh baseline. inflightSavesRef gates pendingSaveRef so a
  // subscription-driven reload won't clobber local edits while any save
  // unit is queued or running.
  const enqueueSave = useCallback((unit) => {
    inflightSavesRef.current += 1;
    pendingSaveRef.current = true;
    const nextSave = saveChainRef.current
      .then(unit)
      .then((result) => {
        setSaveError(false);
        return result;
      })
      .catch((e) => {
        // A local save failing (e.g. AsyncStorage full) is rare but must not
        // be silent — the user would believe the score was recorded.
        console.warn('ScorecardScreen: save failed', e);
        setSaveError(true);
        throw e;
      })
      .finally(() => {
        inflightSavesRef.current -= 1;
        if (
          inflightSavesRef.current === 0
          && !saveTimeoutRef.current
          && Object.keys(notesSaveTimeoutsRef.current).length === 0
        ) {
          pendingSaveRef.current = false;
          if (skippedReloadRef.current) {
            skippedReloadRef.current = false;
            reload();
          }
        }
      });
    saveChainRef.current = nextSave.catch(() => undefined);
    return nextSave;
  }, [reload]);

  const autoSave = useCallback((newScores) => {
    if (!tournamentRef.current) return Promise.resolve(null);
    return enqueueSave(async () => {
      // Diff against the latest committed tournament — not the baseline at
      // schedule time — so chained saves apply incremental deltas rather
      // than redundantly re-mutating already-persisted cells.
      if (!tournamentRef.current) return null;
      const t0 = tournamentRef.current;
      const round = t0.rounds[roundIndex];
      if (!round) return null;
      const prevScores = round.scores ?? {};

      const changedCells = [];
      const playerIds = new Set([...Object.keys(prevScores), ...Object.keys(newScores)]);
      for (const pid of playerIds) {
        const prevByHole = prevScores[pid] ?? {};
        const nextByHole = newScores[pid] ?? {};
        const holes = new Set([...Object.keys(prevByHole), ...Object.keys(nextByHole)]);
        for (const h of holes) {
          const before = prevByHole[h];
          const after = nextByHole[h];
          if (before !== after) changedCells.push({ playerId: pid, hole: Number(h), value: after ?? null });
        }
      }
      if (changedCells.length === 0) return;

      let t = t0;
      for (const cell of changedCells) {
        t = await mutate(t, {
          type: 'score.set',
          roundId: round.id,
          playerId: cell.playerId,
          hole: cell.hole,
          value: cell.value,
        });
        // Commit immediately so the next chained unit (or a notes save)
        // diffs/clones from this state, not from the pre-save baseline.
        tournamentRef.current = t;
      }
      return t;
    });
  }, [roundIndex, enqueueSave]);

  // Keep the latest scores/notes in refs so retrySave can re-push them
  // without being re-created on every keystroke.
  const scoresRef = useRef(scores);
  useEffect(() => { scoresRef.current = scores; }, [scores]);
  // `${playerId}:${holeNumber}` keys for score cells edited locally and not yet
  // confirmed saved.
  const dirtyCellsRef = useRef(new Set());
  const shotDetailsRef = useRef(shotDetails);
  useEffect(() => { shotDetailsRef.current = shotDetails; }, [shotDetails]);
  // Shot details are only written for "me", but keep the key generic because
  // round.shotDetails is stored as { [playerId]: { [holeNumber]: detail } }.
  const dirtyShotKeysRef = useRef(new Set());
  const notesRef = useRef(notes);
  useEffect(() => { notesRef.current = notes; }, [notes]);

  // Debounced note save shared by round-level and per-hole notes. `key`
  // identifies the debounce timer ('round' or `h<n>`); `mutation` carries the
  // scope-specific `note.set` fields.
  const scheduleNoteSave = useCallback((key, mutation) => {
    if (notesSaveTimeoutsRef.current[key]) {
      clearTimeout(notesSaveTimeoutsRef.current[key]);
    }
    // Hold pendingSaveRef during the debounce window too, so a reload that
    // arrives between keystroke and timeout doesn't wipe the in-progress
    // text from React state.
    pendingSaveRef.current = true;
    notesSaveTimeoutsRef.current[key] = setTimeout(() => {
      delete notesSaveTimeoutsRef.current[key];
      enqueueSave(async () => {
        if (!tournamentRef.current) return;
        const round = tournamentRef.current.rounds[roundIndex];
        if (!round) return;
        const t = await mutate(tournamentRef.current, {
          type: 'note.set',
          roundId: round.id,
          ...mutation,
        });
        tournamentRef.current = t;
      });
    }, 400);
  }, [roundIndex, enqueueSave]);

  // Re-attempt the last save after a permanent failure. Re-pushes the full
  // current scores + round note through the same diff-based save path.
  const retrySave = useCallback(() => {
    autoSave(scoresRef.current);
    const roundNote = notesRef.current?.round;
    if (roundNote != null) {
      scheduleNoteSave('round', { scope: 'round', text: roundNote });
    }
  }, [autoSave, scheduleNoteSave]);

  const saveRoundNote = useCallback((value) => {
    if (viewOnly || official) return;
    setNotes((prev) => ({ ...prev, round: value }));
    scheduleNoteSave('round', { scope: 'round', text: value });
  }, [scheduleNoteSave, viewOnly, official]);

  const saveHoleNote = useCallback((holeNumber, value) => {
    if (viewOnly || official) return;
    setNotes((prev) => ({
      ...prev,
      hole: { ...(prev.hole ?? {}), [holeNumber]: value },
    }));
    scheduleNoteSave(`h${holeNumber}`, { scope: 'hole', hole: holeNumber, text: value });
  }, [scheduleNoteSave, viewOnly, official]);

  // Resolve a casual score conflict: write the chosen value and clear the
  // marker. Updates `scores` state optimistically, then dispatches a
  // conflict.resolve mutation through the serial save chain.
  const resolveConflict = useCallback((playerId, holeNumber, value) => {
    if (!tournamentRef.current) return;
    setScores((prev) => ({
      ...prev,
      [playerId]: { ...(prev[playerId] ?? {}), [holeNumber]: value },
    }));
    pendingSaveRef.current = true;
    enqueueSave(async () => {
      if (!tournamentRef.current) return;
      const r = tournamentRef.current.rounds[roundIndex];
      if (!r) return;
      const t = await mutate(tournamentRef.current, {
        type: 'conflict.resolve',
        roundId: r.id,
        playerId,
        hole: holeNumber,
        value,
      });
      tournamentRef.current = t;
      setTournament(t);
    });
  }, [roundIndex, enqueueSave]);

  // Persist a single hole's shot detail for the "me" player. Routed through
  // the same serial save chain as scores so concurrent edits don't race.
  const saveShot = useCallback((playerId, holeNumber, detail) => {
    if (!tournamentRef.current) return;
    pendingSaveRef.current = true;
    enqueueSave(async () => {
      if (!tournamentRef.current) return;
      const r = tournamentRef.current.rounds[roundIndex];
      if (!r) return;
      const t = await mutate(tournamentRef.current, {
        type: 'shot.set',
        roundId: r.id,
        playerId,
        hole: holeNumber,
        detail,
      });
      tournamentRef.current = t;
    });
  }, [roundIndex, enqueueSave]);

  const setShot = useCallback((playerId, holeNumber, patch) => {
    if (viewOnly) return;
    setShotDetails((prev) => {
      const current = prev[playerId]?.[holeNumber] ?? DEFAULT_SHOT;
      const detail = { ...DEFAULT_SHOT, ...current, ...patch };
      const next = {
        ...prev,
        [playerId]: { ...prev[playerId], [holeNumber]: detail },
      };
      shotDetailsRef.current = next;
      dirtyShotKeysRef.current.add(`${playerId}:${holeNumber}`);
      saveShot(playerId, holeNumber, detail);
      return next;
    });
  }, [saveShot, viewOnly]);

  // When the me-player's strokes change, trim that hole's shot detail so the
  // logged putts/penalties/sand shots never exceed the new stroke total.
  // No-op for other players, holes with no detail, or already-valid detail.
  const reconcileMeShot = useCallback((playerId, holeNumber, newStrokes) => {
    if (playerId !== (tournamentRef.current?.meId ?? null)) return;
    setShotDetails((prev) => {
      const current = prev[playerId]?.[holeNumber];
      if (!current) return prev;
      const reconciled = reconcileShotDetail(current, newStrokes);
      if (reconciled === current) return prev;
      const next = {
        ...prev,
        [playerId]: { ...prev[playerId], [holeNumber]: reconciled },
      };
      shotDetailsRef.current = next;
      dirtyShotKeysRef.current.add(`${playerId}:${holeNumber}`);
      saveShot(playerId, holeNumber, reconciled);
      return next;
    });
  }, [saveShot]);

  // Persist which player is "me" (drives shot-detail tracking).
  const pickMe = useCallback(async (playerId) => {
    if (!tournamentRef.current) return;
    const t = await mutate(tournamentRef.current, {
      type: 'tournament.setMe',
      meId: playerId,
    });
    tournamentRef.current = t;
    setTournament(t);
  }, []);

  // --- Official mode: map RPC round state into the casual render shapes ---
  // The official data layer returns flat `members` / `scores` lists. The
  // existing render (HoleView / HolePage / GridView / totals) consumes a
  // casual `tournament` blob, a `players` array, and a per-player per-hole
  // `scores` map. We build those here and feed them into the SAME state the
  // casual path writes to, so every downstream read stays byte-identical.
  //
  // Player id == roster_id throughout official mode. `editableSource` from
  // the hook decides which cards this device may write.
  const officialTournament = useMemo(() => {
    if (!official || !officialData.round) return null;
    const holes = officialHolesFromCourse(officialData.round.course);
    const players = (officialData.members ?? []).map((m) => ({
      id: m.roster_id,
      name: m.display_name,
      handicap: m.handicap ?? 0,
    }));
    const playerHandicaps = {};
    (officialData.members ?? []).forEach((m) => {
      playerHandicaps[m.roster_id] = m.handicap ?? 0;
    });
    const r = officialData.round;
    return {
      id: r.tournament_id ?? r.id ?? 'official',
      kind: 'official',
      players,
      meId: officialData.myRosterId,
      settings: { ...DEFAULT_SETTINGS },
      currentRound: 0,
      rounds: [{
        id: r.id,
        courseName: r.course_name ?? r.name ?? 'Official Round',
        holes,
        playerHandicaps,
        pairs: [],
        scores: {},
        shotDetails: {},
        notes: {},
      }],
    };
  }, [official, officialData.round, officialData.members, officialData.myRosterId]);

  // Flatten official `scores` rows into the casual { [playerId]: { [hole]:
  // strokes } } map. A subject can have up to two rows per hole (its own
  // `self` entry and its marker's `marker` entry). For display we show, per
  // subject, the entry THIS device is responsible for — `self` for our own
  // card, `marker` for the player we mark — falling back to whichever row
  // exists. That mirrors what `setScore` would write, so the stepper and the
  // displayed number stay consistent on the writing device. (Cross-device
  // discrepancy surfacing is Task 15.)
  const officialScores = useMemo(() => {
    if (!official) return null;
    // chosen[pid][hole] = { strokes, source } — the row currently picked
    // for display. A later row replaces it only when it better matches the
    // device's preferred source for that subject.
    const chosen = {};
    for (const row of (officialData.scores ?? [])) {
      const pid = row.subject_roster_id;
      if (pid == null) continue;
      const wanted = officialData.editableSource(pid); // 'self' | 'marker' | null
      const byHole = (chosen[pid] = chosen[pid] ?? {});
      const prev = byHole[row.hole];
      if (
        prev === undefined
        // Upgrade to the preferred source if a non-preferred row was picked.
        || (wanted && row.source === wanted && prev.source !== wanted)
      ) {
        byHole[row.hole] = { strokes: row.strokes, source: row.source };
      }
    }
    // Flatten to the casual { [playerId]: { [hole]: strokes } } shape.
    const map = {};
    for (const pid of Object.keys(chosen)) {
      map[pid] = {};
      for (const hole of Object.keys(chosen[pid])) {
        map[pid][hole] = chosen[pid][hole].strokes;
      }
    }
    return map;
  }, [official, officialData.scores, officialData.editableSource]);

  // Wire the official-derived tournament + scores into the casual state the
  // render reads. Runs whenever the polled RPC data changes.
  useEffect(() => {
    if (!official) return;
    if (officialTournament) {
      setTournament(officialTournament);
      setLoadState('ready');
    } else if (officialData.error) {
      if (!tournamentRef.current) setLoadState('error');
    }
  }, [official, officialTournament, officialData.error]);

  useEffect(() => {
    if (!official || !officialScores) return;
    setScores(officialScores);
  }, [official, officialScores]);

  // Hoist memoised derivations above the early return so the hook order
  // stays stable while the tournament loads.
  const round = tournament?.rounds?.[roundIndex] ?? null;
  const players = tournament?.players ?? [];
  const meId = tournament?.meId ?? null;

  // Lock a freshly opened finished round to view-only. "Finished" means
  // either this specific round has every player scored on every hole, OR the
  // parent tournament/game was explicitly archived (`finishedAt` set) — a
  // game can be finished early without filling in the remaining holes.
  // Re-runs only when the displayed round changes (different round id), so
  // local edits made after "Edit round" don't silently re-lock when the last
  // score lands.
  useEffect(() => {
    if (official) return;
    if (!round || !players.length) return;
    if (viewOnlyInitRoundIdRef.current === round.id) return;
    viewOnlyInitRoundIdRef.current = round.id;
    const finished = isRoundComplete(round, players) || !!tournament?.finishedAt;
    setViewOnly(finished);
  }, [official, round, players, tournament?.finishedAt]);
  const settings = useMemo(
    () => ({ ...DEFAULT_SETTINGS, ...(tournament?.settings ?? {}) }),
    [tournament?.settings],
  );
  const settingsMode = tournament?.settings?.scoringMode;
  const currentMode = settingsMode ?? 'stableford';
  const prevSettingsMode = usePrevious(settingsMode);
  const [noticeMessage, setNoticeMessage] = useState(null);
  const [roundDecisionNotice, setRoundDecisionNotice] = useState(null);
  const [reopenPrompt, setReopenPrompt] = useState(false);
  const dismissModeNotice = useCallback(() => setNoticeMessage(null), []);
  const dismissRoundDecisionNotice = useCallback(() => setRoundDecisionNotice(null), []);
  const openModeSheet = useCallback(() => setReopenPrompt(true), []);

  useEffect(() => {
    if (prevSettingsMode && settingsMode && prevSettingsMode !== settingsMode) {
      setNoticeMessage(fallbackNoticeText(prevSettingsMode, settingsMode));
    }
  }, [prevSettingsMode, settingsMode]);

  const isBestBall = settings.scoringMode === 'bestball';
  const liveRound = useMemo(
    () => (round ? { ...round, scores } : null),
    [round, scores],
  );
  const bbResult = useMemo(
    () => (isBestBall && liveRound ? calcBestWorstBall(liveRound, players) : null),
    [isBestBall, liveRound, players],
  );

  // Best-effort default for the "me" player: a solo round is unambiguous;
  // otherwise match the signed-in user to their roster slot. The embedded
  // players carry user_id, so this resolves with no network and works
  // offline. If no match, meId stays null and the scorecard shows the
  // "who are you?" picker.
  const meDefaultedRef = useRef(false);
  useEffect(() => {
    if (meDefaultedRef.current || !tournament) return;
    const ps = tournament.players ?? [];
    if (tournament.meId || ps.length === 0) { meDefaultedRef.current = true; return; }
    if (ps.length === 1) {
      meDefaultedRef.current = true;
      pickMe(ps[0].id);
      return;
    }
    if (!user?.id) return;
    meDefaultedRef.current = true;
    // Local match first — embedded roster players carry user_id, so this
    // needs no network and works fully offline.
    const mine = ps.find((p) => p.user_id && p.user_id === user.id);
    if (mine) { pickMe(mine.id); return; }
    // Fallback for legacy rounds whose embedded players predate user_id:
    // resolve via the library when online. Offline this no-ops and the
    // picker handles it.
    fetchPlayers()
      .then((lib) => {
        const linked = lib.find((p) => p.user_id === user.id);
        if (linked && ps.some((p) => p.id === linked.id)) pickMe(linked.id);
      })
      .catch(() => {});
  }, [tournament, user, pickMe]);

  const triggerCelebration = useCallback((playerId, holeNumber, label) => {
    const holdMs =
      label === 'BIRDIE' ? 900 :
      label === 'EAGLE' ? 1200 :
      label === 'ALBATROSS' ? 1500 :
      1800; // HOLE IN ONE
    haptic('success');
    celebrationAnim.stopAnimation();
    celebrationAnim.setValue(0);
    setCelebration({ playerId, holeNumber, label });
    Animated.sequence([
      Animated.spring(celebrationAnim, {
        toValue: 1, friction: 6, tension: 80, useNativeDriver: true,
      }),
      Animated.delay(holdMs),
      Animated.timing(celebrationAnim, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) setCelebration({ playerId: null, holeNumber: null, label: null });
    });
  }, [celebrationAnim]);

  const getScoreAnim = useCallback((playerId) => {
    if (!scoreAnims.current[playerId]) scoreAnims.current[playerId] = new Animated.Value(1);
    return scoreAnims.current[playerId];
  }, []);

  // Per-card write permission. Casual mode: every card is editable. Official
  // mode: a device may only write its own card (`self`) and the one player
  // it is assigned to mark (`marker`); every other card is read-only.
  const editable = useCallback((playerId) => {
    if (!official) return !viewOnly;
    // Once this device's holder has attested their card (Task 16) the official
    // branch is read-only for them — no more edits to any card on this device.
    if (officialData.hasAttested) return false;
    return officialData.editableSource(playerId) !== null;
  }, [official, officialData, viewOnly]);

  // Official-mode write: persist one cell through the RPC data layer
  // instead of the casual `mutate` blob path. `editableSource` decides if
  // this device may write the subject's card — if not, the write is a
  // no-op (the card is read-only here). `strokes` of undefined clears.
  const officialWrite = useCallback((playerId, holeNumber, strokes) => {
    const source = officialData.editableSource(playerId);
    if (!source) return; // read-only card — should not be reached (steppers gated)
    officialData.setScore(playerId, holeNumber, strokes ?? null, source).catch((e) => {
      console.warn('ScorecardScreen: official setScore failed', e);
      setSaveError(true);
    });
  }, [officialData]);

  // ── Official discrepancy surfacing (Task 15) ───────────────────────────
  // The casual `scores` blob collapses each player/hole to ONE number, so it
  // can't show a self-vs-marker mismatch. These helpers read the raw two-row
  // `officialData.scores` list instead. All of this is official-only; casual
  // mode never touches `officialDiscrepancy`.
  const officialDiscrepancy = useMemo(() => {
    if (!official) return null;
    const rows = officialData.scores ?? [];
    const members = officialData.members ?? [];
    // Both entries for one subject on one hole: { self, marker } strokes.
    const cellEntries = (subjectRosterId, holeNumber) => {
      let self = null;
      let marker = null;
      for (const r of rows) {
        if (r.subject_roster_id !== subjectRosterId || r.hole !== holeNumber) continue;
        if (r.source === 'self') self = r.strokes;
        else if (r.source === 'marker') marker = r.strokes;
      }
      return { self, marker };
    };
    // Display name of whoever marks `subjectRosterId` (for labelling the
    // read-only side of the resolve sheet).
    const markerNameFor = (subjectRosterId) => {
      const m = members.find((x) => x.marks_roster_id === subjectRosterId && !x.withdrawn);
      return m?.display_name ?? 'Marker';
    };
    return {
      cellEntries,
      markerNameFor,
      // The token holder's own discrepancy holes — ascending hole numbers.
      myHoles: cardDiscrepancyHoles(rows, officialData.myRosterId),
    };
  }, [official, officialData.scores, officialData.members, officialData.myRosterId]);

  // Official-only: ranked gross leaderboard rows built from the flat
  // members / scores lists. Discrepancy holes are omitted from each total
  // (see officialLeaderboard.js). Casual mode never builds this.
  const officialLeaderboard = useMemo(() => {
    if (!official) return [];
    return buildLeaderboard({
      members: officialData.members ?? [],
      scores: officialData.scores ?? [],
    });
  }, [official, officialData.members, officialData.scores]);

  const setScore = useCallback((playerId, holeNumber, value) => {
    if (!official && viewOnly) return;
    const parsed = value === '' ? undefined : parseInt(value, 10) || undefined;
    const holePar = round?.holes?.find((h) => h.number === holeNumber)?.par ?? 4;
    const cur = scoresRef.current;
    const current = cur[playerId]?.[holeNumber];
    const next = {
      ...cur,
      [playerId]: { ...cur[playerId], [holeNumber]: parsed },
    };
    scoresRef.current = next;                                  // sync source of truth
    dirtyCellsRef.current.add(`${playerId}:${holeNumber}`);
    setScores(next);                                           // pre-computed value
    reconcileMeShot(playerId, holeNumber, parsed);

    // Official mode routes the write through the RPC layer; casual mode
    // diffs and persists through the tournament-blob `mutate` chain.
    if (official) officialWrite(playerId, holeNumber, parsed);
    else autoSave(next);
    if (parsed != null && parsed !== current) {
      const label = celebrationFor(holePar, parsed);
      if (label) triggerCelebration(playerId, holeNumber, label);
    }
  }, [round, autoSave, triggerCelebration, official, officialWrite, reconcileMeShot, viewOnly]);

  const stepScore = useCallback((playerId, holeNumber, delta) => {
    if (!official && viewOnly) return;
    haptic('light');
    const anim = getScoreAnim(playerId);
    anim.setValue(1.18);
    Animated.spring(anim, { toValue: 1, friction: 5, useNativeDriver: true }).start();

    const holePar = round?.holes?.find((h) => h.number === holeNumber)?.par ?? 4;
    const cur = scoresRef.current;
    const current = cur[playerId]?.[holeNumber];
    // First interaction on an un-scored hole: + lands on par, - lands on birdie.
    // After that, +/- step by one as usual. Minimum is 1 stroke.
    const newStrokes = current == null
      ? (delta > 0 ? holePar : Math.max(1, holePar - 1))
      : Math.max(1, current + delta);
    const next = {
      ...cur,
      [playerId]: { ...cur[playerId], [holeNumber]: newStrokes },
    };
    scoresRef.current = next;                                  // sync source of truth
    dirtyCellsRef.current.add(`${playerId}:${holeNumber}`);
    setScores(next);                                           // pre-computed value
    reconcileMeShot(playerId, holeNumber, newStrokes);

    if (official) officialWrite(playerId, holeNumber, newStrokes);
    else autoSave(next);
    if (newStrokes !== current) {
      const label = celebrationFor(holePar, newStrokes);
      if (label) triggerCelebration(playerId, holeNumber, label);
    }
  }, [round, autoSave, triggerCelebration, getScoreAnim, official, officialWrite, reconcileMeShot, viewOnly]);

  const [showRunning, setShowRunning] = useState(true);
  useEffect(() => {
    let cancelled = false;
    getShowRunningScore().then((v) => {
      if (!cancelled) setShowRunning(v);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const toggleRunning = useCallback(() => {
    setShowRunning((v) => {
      const next = !v;
      setShowRunningScore(next).catch(() => {});
      return next;
    });
  }, []);

  const lastClinchedPairRef = useRef(null);
  const clinchInitRoundIdRef = useRef(null);

  // Initialize the clinch ref once per round so re-entering an already
  // decided round does not show the notice again. Re-runs only if round id
  // changes (different round opened in the same screen instance).
  useEffect(() => {
    if (!round || !tournament) return;
    if (clinchInitRoundIdRef.current === round.id) return;
    clinchInitRoundIdRef.current = round.id;
    setRoundDecisionNotice(null);
    const mode = tournament.settings?.scoringMode === 'bestball' ? 'bestball' : 'stableford';
    const liveRound = { ...round, scores };
    lastClinchedPairRef.current = roundPairClinched(liveRound, players, tournament.settings, mode);
  }, [round, tournament, players, scores]);

  const goToNextHole = useCallback(() => {
    haptic('medium');
    const maxHole = round?.holes?.length ?? 18;
    setCurrentHole((h) => Math.min(maxHole, h + 1));
    if (!round || !tournament) return;
    const mode = tournament.settings?.scoringMode === 'bestball' ? 'bestball' : 'stableford';
    const liveRound = { ...round, scores };
    const clinched = roundPairClinched(liveRound, players, tournament.settings, mode);
    if (clinched != null && lastClinchedPairRef.current == null) {
      const pair = round.pairs?.[clinched];
      if (pair) {
        setRoundDecisionNotice(roundDecisionNoticeForPair(pair));
      }
    }
    lastClinchedPairRef.current = clinched;
  }, [round, tournament, players, scores]);

  const goToHole = useCallback((h) => {
    haptic('light');
    setCurrentHole(h);
  }, []);

  // Back from the scorecard. Finished casual rounds land on the app home
  // (Main → Home tab) so users aren't dumped back into the leaderboard of
  // a game they're already done with. In-progress casual rounds usually have
  // Tournament already underneath in the stack, so pop instead of navigating
  // to a fresh Tournament route; otherwise the next back can return here.
  // Official rounds come from JoinOfficial and need their own pop behavior
  // preserved.
  const goBack = useCallback(() => {
    const target = getScorecardBackTarget({
      official,
      viewOnly,
      canGoBack: typeof navigation.canGoBack === 'function' && navigation.canGoBack(),
    });
    if (target === 'previous') {
      navigation.goBack();
      return;
    }
    if (target === 'home') {
      navigation.navigate('Main', { screen: 'Home' });
      return;
    }
    navigation.navigate('Tournament');
  }, [navigation, official, viewOnly]);

  // Finish flow: invoked from the last-hole "Finish" button or the game-level
  // header flag. Shows a brief celebration, then routes to the round report.
  // Single-round games are explicitly archived so partial rounds count as done.
  const handleFinish = useCallback(async () => {
    if (finishBusy) return;
    const t = tournamentRef.current;
    const r = t?.rounds?.[roundIndex];
    if (!t || !r) { goBack(); return; }

    // A round cannot finish while a hole still has an unresolved score
    // conflict — every hole must end on one agreed value.
    const openConflicts = listRoundConflicts(r);
    if (openConflicts.length > 0) {
      const first = openConflicts[0];
      const name = (t.players ?? []).find((p) => p.id === first.playerId)?.name ?? 'a player';
      const title = 'Resolve conflict to finish';
      const message = openConflicts.length === 1
        ? `Hole ${first.hole} still has a conflicting score for ${name}. Every hole needs one agreed score before this round can finish.`
        : `${openConflicts.length} holes still have conflicting scores. Resolve them before this round can finish.`;
      const review = () => setConflictFocus({ hole: first.hole, playerId: first.playerId });
      if (Platform.OS === 'web') {
        if (window.confirm(`${title}\n\n${message}\n\nReview the conflict now?`)) review();
      } else {
        Alert.alert(title, message, [
          { text: 'Not now', style: 'cancel' },
          { text: 'Review conflict', onPress: review },
        ]);
      }
      return;
    }

    const liveRound = { ...r, scores };
    const players = t.players ?? [];
    const liveTournament = {
      ...t,
      rounds: t.rounds.map((rr, i) => (i === roundIndex ? liveRound : rr)),
    };
    const roundDone = isRoundComplete(liveRound, players);
    const tournamentDone = isTournamentFinished(liveTournament);
    const shouldMarkFinished = shouldMarkTournamentFinishedFromScorecard({
      tournament: t,
      tournamentDone,
    });

    const goToSummary = () => {
      navigation.navigate('RoundSummary', {
        tournamentId: t.id,
        roundId: r.id,
      });
    };

    setFinishBusy(true);
    try {
      if (!official) {
        await autoSave(scoresRef.current);
      }
      if (shouldMarkFinished && !t.finishedAt) {
        const finishedAt = new Date().toISOString();
        await enqueueSave(async () => {
          const base = tournamentRef.current ?? liveTournament;
          if (!base) return null;
          const updated = await mutate(base, {
            type: 'tournament.setFinished',
            finishedAt,
          });
          tournamentRef.current = updated;
          setTournament(updated);
          setViewOnly(true);
          return updated;
        });
      }

      // Notify the finisher's friends that a casual round wrapped up. Official
      // rounds notify server-side on attestation, so skip them here.
      // Best-effort — a failure never blocks finishing the round.
      if (!official && t.kind !== 'official') {
        notifyRoundFinished({
          tournamentId: t.id,
          roundId: r.id,
          roundIndex,
          tournamentName: t.name,
          courseName: r.courseName,
        }).catch(() => {});
      }

      haptic('success');
      setRoundCompleteVisible(true);
      setTimeout(() => {
        setRoundCompleteVisible(false);
        setFinishBusy(false);
        if (tournamentDone && t.kind !== 'game' && !official) {
          const title = '🏆 Tournament complete';
          const message = 'Every round is finished. Archive this tournament?';
          if (Platform.OS === 'web') {
            if (window.confirm(`${title}\n${message}`)) {
              navigation.navigate('Finished');
            } else {
              goToSummary();
            }
          } else {
            Alert.alert(title, message, [
              { text: 'View round summary', style: 'cancel', onPress: goToSummary },
              { text: 'Finish tournament', onPress: () => navigation.navigate('Finished') },
            ]);
          }
        } else {
          // Non-official rounds drop the finisher into their personal Report
          // Card for the round just played. collectMyRounds keys rounds as
          // `${tournamentId}:${roundIndex}` — match that here. The tournament-
          // complete / archive branch above keeps using goToSummary unchanged.
          if (!official && t.kind !== 'official') {
            navigation.navigate('MyStats', {
              tab: 'reportCard',
              roundKey: `${t.id}:${roundIndex}`,
            });
          } else {
            goToSummary();
          }
        }
      }, roundDone ? 1400 : 400);
    } catch (err) {
      setFinishBusy(false);
      const message = err?.message ?? 'Could not finish this game.';
      if (Platform.OS === 'web') window.alert(message);
      else Alert.alert('Finish failed', message);
    }
  }, [roundIndex, scores, navigation, goBack, official, finishBusy, autoSave, enqueueSave]);

  // Official mode (Task 16): attest the token holder's own card. Replaces the
  // casual "finish" affordance for official rounds. Disabled while the holder
  // still has open discrepancies; the RPC also rejects server-side with
  // "resolve discrepancies first" — surfaced as attestError.
  const handleAttest = useCallback(async () => {
    if (!official || attestBusy) return;
    setAttestBusy(true);
    setAttestError(null);
    try {
      await attestCard(officialToken, officialRoundId);
      haptic('success');
      // Refresh so `attestations` includes our roster id and the branch flips
      // to its attested, read-only state.
      await officialData.refresh();
    } catch (e) {
      setAttestError(e?.message ?? 'Could not attest your card.');
    } finally {
      setAttestBusy(false);
    }
  }, [official, attestBusy, officialToken, officialRoundId, officialData]);

  const openCapturePicker = useCallback(() => {
    setCaptureMenuVisible(true);
  }, []);

  const handleCaptureMenuSelect = useCallback(async ({ source, mediaTypes }) => {
    setCaptureMenuVisible(false);
    try {
      const asset = await pickMedia({ source, mediaTypes });
      if (asset) setPickerAsset(asset);
    } catch (e) {
      Alert.alert("Couldn't capture", String(e?.message ?? e));
    }
  }, []);

  const onAttachConfirm = useCallback(async ({ holeIndex, caption, uploaderLabel }) => {
    const asset = pickerAsset;
    setPickerAsset(null);
    if (!asset || !tournament || !round) return;
    try {
      await attachMedia({
        tournamentId: tournament.id,
        roundId: round.id,
        holeIndex,
        kind: asset.kind,
        localUri: asset.localUri,
        durationS: asset.durationS,
        caption,
        uploaderLabel,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
      });
    } catch (e) {
      Alert.alert("Couldn't attach", String(e?.message ?? e));
    }
  }, [pickerAsset, tournament, round]);

  // Explicit load failure — never a blank screen. Keep a working back button.
  if (loadState === 'error' && !tournament) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <Feather name="chevron-left" size={22} color={theme.accent.primary} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Scorecard</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={s.statusCenter}>
          <Feather name="alert-circle" size={44} color={theme.text.muted} />
          <Text style={s.statusTitle}>Couldn't load this round</Text>
          <Text style={s.statusSubtitle}>
            Check your connection and try again.
          </Text>
          <TouchableOpacity style={s.statusRetryBtn} onPress={retryLoad} activeOpacity={0.8}>
            <Feather name="rotate-ccw" size={15} color={theme.text.inverse} />
            <Text style={s.statusRetryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  // First load in progress — spinner + a working header back button.
  if (!tournament || !round) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <Feather name="chevron-left" size={22} color={theme.accent.primary} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Scorecard</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={s.statusCenter}>
          <ActivityIndicator color={theme.accent.primary} />
          <Text style={s.statusSubtitle}>Loading round…</Text>
        </View>
      </ScreenContainer>
    );
  }

  const holeCount = round.holes.length;
  const hole = round.holes.find((h) => h.number === currentHole);
  const showQuickFinish = canShowQuickFinish({ tournament, official, viewOnly });
  const showNotesControls = !official;
  const holeNote = notes?.hole?.[currentHole] ?? '';
  const roundNote = notes?.round ?? '';
  const hasCurrentNotes = showNotesControls && !!(holeNote.trim() || roundNote.trim());
  const nextView = view === 'hole' ? 'grid' : 'hole';
  const viewSwitchLabel = view === 'hole'
    ? 'Show full scorecard'
    : 'Show hole by hole scorecard';
  const viewSwitchIcon = view === 'hole' ? 'grid' : 'circle';

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {/* Header with compact scorecard view switch. */}
      <View style={s.header}>
        <TouchableOpacity onPress={goBack} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Scorecard</Text>
        <View style={s.headerRight}>
          <Pressable
            onPress={() => setSyncSheetOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Sync status"
          >
            <SyncIndicator status={syncStatus} saveError={saveError} theme={theme} s={s} />
          </Pressable>
          {!official && viewOnly && (
            <TouchableOpacity
              onPress={() => setViewOnly(false)}
              style={s.editRoundBtn}
              accessibilityRole="button"
              accessibilityLabel="Edit round"
            >
              <Feather name="edit-2" size={12} color={theme.accent.primary} style={{ marginRight: 4 }} />
              <Text style={s.editRoundBtnText}>Edit round</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => setView(nextView)}
            style={s.viewSwitchBtn}
            accessibilityRole="button"
            accessibilityLabel={viewSwitchLabel}
          >
            <Feather name={viewSwitchIcon} size={17} color={theme.accent.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={toggleRunning}
            style={s.cameraBtn}
            accessibilityLabel={showRunning ? 'Hide running score' : 'Show running score'}
          >
            <Feather name={showRunning ? 'eye-off' : 'eye'} size={18} color={theme.accent.primary} />
          </TouchableOpacity>
          {official && (
            <TouchableOpacity
              onPress={() => setOfficialLeaderboardOpen(true)}
              style={s.cameraBtn}
              accessibilityLabel="View official leaderboard"
            >
              <Feather name="award" size={20} color={theme.accent.primary} />
            </TouchableOpacity>
          )}
          {showNotesControls && (
            <TouchableOpacity
              onPress={() => setNotesOpen(true)}
              style={s.notesHeaderBtn}
              accessibilityRole="button"
              accessibilityLabel={hasCurrentNotes ? 'Open notes' : 'Add notes'}
            >
              <Feather name={hasCurrentNotes ? 'edit-3' : 'edit-2'} size={18} color={theme.accent.primary} />
              {hasCurrentNotes && <View style={s.notesHeaderDot} />}
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={openCapturePicker}
            style={s.cameraBtn}
            accessibilityLabel="Attach a memory"
          >
            <Feather name="camera" size={20} color={theme.accent.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {saveError && (
        <View style={s.saveErrorBanner}>
          <Feather name="alert-triangle" size={14} color={theme.text.inverse} />
          <Text style={s.saveErrorText}>
            Couldn't save your last change.
          </Text>
          <TouchableOpacity
            onPress={() => { setSaveError(false); retrySave(); }}
            accessibilityLabel="Retry saving"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={s.saveErrorAction}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setSaveError(false)}
            accessibilityLabel="Dismiss"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="x" size={14} color={theme.text.inverse} />
          </TouchableOpacity>
        </View>
      )}

      <ScoringModeChangeBanner
        message={noticeMessage}
        onPress={openModeSheet}
        onDismiss={dismissModeNotice}
      />
      {roundDecisionNotice && (
        <View
          style={s.roundDecisionBanner}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <View style={s.roundDecisionIconWrap}>
            <Feather name="award" size={17} color={theme.accent.primary} />
          </View>
          <View style={s.roundDecisionCopy}>
            <Text style={s.roundDecisionTitle}>{roundDecisionNotice.title}</Text>
            <Text style={s.roundDecisionMessage}>{roundDecisionNotice.message}</Text>
          </View>
          <TouchableOpacity
            onPress={dismissRoundDecisionNotice}
            style={s.roundDecisionCloseBtn}
            accessibilityRole="button"
            accessibilityLabel="Dismiss round decided notice"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="x" size={16} color={theme.text.secondary} />
          </TouchableOpacity>
        </View>
      )}
      <ScoringModeChangeSheet
        visible={reopenPrompt}
        playerCount={(tournament?.players ?? []).length}
        defaultMode={currentMode}
        title="Change scoring mode"
        onConfirm={async (chosenMode) => {
          setReopenPrompt(false);
          if (chosenMode === currentMode) return;
          // Rebuild round pairs so teams match the new mode (e.g. switching
          // into Best Ball assigns partnerships, switching out collapses them).
          const { patches: roundPatches } = setScoringModeRoundPatches(tournament, chosenMode);
          await mutate(tournament, {
            type: 'tournament.setScoringMode',
            scoringMode: chosenMode,
            roundPatches,
          });
        }}
        onCancel={() => setReopenPrompt(false)}
      />

      {view === 'hole' ? (
        <HoleView
          round={round}
          roundIndex={roundIndex}
          players={players}
          scores={scores}
          shotDetails={shotDetails}
          meId={meId}
          onSetShot={setShot}
          onPickMe={pickMe}
          notes={notes}
          currentHole={currentHole}
          hole={hole}
          isBestBall={isBestBall}
          bbResult={bbResult}
          settings={settings}
          onStep={stepScore}
          onSetScore={setScore}
          editable={editable}
          onNext={goToNextHole}
          onGoToHole={goToHole}
          onFinish={handleFinish}
          holeCount={holeCount}
          showQuickFinish={showQuickFinish}
          finishBusy={finishBusy}
          showRunning={showRunning}
          getScoreAnim={getScoreAnim}
          celebration={celebration}
          celebrationAnim={celebrationAnim}
          refreshing={refreshing}
          onRefresh={onRefresh}
          official={official}
          officialDiscrepancy={officialDiscrepancy}
          officialEditableSource={official ? officialData.editableSource : null}
          officialSetScore={official ? officialData.setScore : null}
          officialHasAttested={official ? officialData.hasAttested : false}
          officialAttestBusy={attestBusy}
          officialAttestError={attestError}
          onAttest={handleAttest}
          onResolveConflict={resolveConflict}
          focusConflict={conflictFocus}
          onFocusConflictHandled={clearConflictFocus}
        />
      ) : (
        <GridView
          round={round}
          roundIndex={roundIndex}
          players={players}
          scores={scores}
          isBestBall={isBestBall}
          bbResult={bbResult}
          settings={settings}
          onSetScore={setScore}
          editable={editable}
          refreshing={refreshing}
          onRefresh={onRefresh}
          meId={meId}
        />
      )}

      {/* Notes modal — per-hole note + shared round note */}
      {showNotesControls && (
        <Modal
          visible={notesOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setNotesOpen(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={s.notesModalKav}
          >
            <Pressable style={s.notesBackdrop} onPress={() => setNotesOpen(false)}>
              <Pressable style={s.notesSheet} onPress={() => {}}>
                <View style={s.notesHandle} />
                <View style={s.notesHeader}>
                  <Text style={s.notesTitle}>Notes</Text>
                  <TouchableOpacity onPress={() => setNotesOpen(false)} style={s.notesCloseBtn}>
                    <Feather name="x" size={18} color={theme.text.secondary} />
                  </TouchableOpacity>
                </View>
                <Text style={s.notesFieldLabel}>{`Hole ${currentHole}`}</Text>
                <TextInput
                  style={s.notesModalInputCompact}
                  placeholder={`Notes for hole ${currentHole}`}
                  placeholderTextColor={theme.text.muted}
                  keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                  selectionColor={theme.accent.primary}
                  multiline
                  value={holeNote}
                  onChangeText={(text) => saveHoleNote(currentHole, text)}
                />
                <Text style={[s.notesFieldLabel, s.notesFieldLabelSpaced]}>Round</Text>
                <TextInput
                  style={s.notesModalInputCompact}
                  placeholder="What happened this round?"
                  placeholderTextColor={theme.text.muted}
                  keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                  selectionColor={theme.accent.primary}
                  multiline
                  value={roundNote}
                  onChangeText={saveRoundNote}
                />
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </Modal>
      )}

      <CaptureMenuSheet
        visible={captureMenuVisible}
        onSelect={handleCaptureMenuSelect}
        onClose={() => setCaptureMenuVisible(false)}
        extraActions={roundMediaCount > 0 ? [{
          key: 'view',
          icon: 'image',
          label: `View this round's memories (${roundMediaCount})`,
          onPress: () => {
            setCaptureMenuVisible(false);
            setLightboxItems(roundMediaItems);
            setLightboxIndex(0);
            setLightboxVisible(true);
          },
        }] : []}
      />
      <AttachMediaSheet
        visible={!!pickerAsset}
        asset={pickerAsset}
        holes={round.holes ?? []}
        defaultHoleIndex={typeof currentHole === 'number' ? currentHole - 1 : null}
        onCancel={() => setPickerAsset(null)}
        onConfirm={onAttachConfirm}
      />
      <MediaLightbox
        visible={lightboxVisible}
        items={lightboxItems}
        initialIndex={lightboxIndex}
        onClose={() => setLightboxVisible(false)}
      />
      <SyncStatusSheet
        visible={syncSheetOpen}
        onClose={() => setSyncSheetOpen(false)}
      />

      {roundCompleteVisible && (
        <View pointerEvents="none" style={s.roundCompleteRoot}>
          <View style={s.roundCompleteScrim} />
          <View style={s.roundCompleteCard}>
            <View style={s.roundCompleteIconWrap}>
              <Feather name="flag" size={26} color={theme.accent.primary} />
            </View>
            <Text style={s.roundCompleteEyebrow}>ROUND COMPLETE</Text>
            <Text style={s.roundCompleteTitle}>Nice round!</Text>
          </View>
        </View>
      )}

      {/* Official gross leaderboard (Task 17). Official-only; built from the
          flat members / scores lists via buildLeaderboard. Holes still in
          discrepancy are omitted from each player's gross total. */}
      {official && (
        <Modal
          visible={officialLeaderboardOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setOfficialLeaderboardOpen(false)}
        >
          <Pressable
            style={s.notesBackdrop}
            onPress={() => setOfficialLeaderboardOpen(false)}
          >
            <Pressable style={s.notesSheet} onPress={() => {}}>
              <View style={s.notesHandle} />
              <View style={s.notesHeader}>
                <Text style={s.notesTitle}>Leaderboard</Text>
                <TouchableOpacity
                  onPress={() => setOfficialLeaderboardOpen(false)}
                  style={s.notesCloseBtn}
                  accessibilityLabel="Close leaderboard"
                >
                  <Feather name="x" size={18} color={theme.text.secondary} />
                </TouchableOpacity>
              </View>
              {officialLeaderboard.length === 0 ? (
                <Text style={s.statusSubtitle}>No scores yet.</Text>
              ) : (
                <ScrollView style={s.officialLbList}>
                  {officialLeaderboard.map((row, i) => (
                    <View key={row.rosterId} style={s.officialLbRow}>
                      <Text style={s.officialLbRank}>{i + 1}</Text>
                      <Text style={s.officialLbName} numberOfLines={1}>
                        {row.name}
                      </Text>
                      <Text style={s.officialLbThru}>
                        {row.thru > 0 ? `thru ${row.thru}` : '—'}
                      </Text>
                      <Text style={s.officialLbGross}>{row.gross}</Text>
                    </View>
                  ))}
                </ScrollView>
              )}
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </ScreenContainer>
  );
}

// Compact header sync/error indicator. Reflects the store's sync status and
// flips to an explicit error dot when a local save fails.
function SyncIndicator({ status, saveError, theme, s }) {
  if (saveError || status === 'error') {
    return (
      <View style={s.syncDot} accessibilityLabel="Sync error">
        <Feather name="alert-circle" size={14} color={theme.destructive} />
      </View>
    );
  }
  if (status === 'syncing') {
    return (
      <View style={s.syncDot} accessibilityLabel="Syncing">
        <ActivityIndicator size="small" color={theme.text.muted} />
      </View>
    );
  }
  if (status === 'pending') {
    return (
      <View style={s.syncDot} accessibilityLabel="Changes pending sync">
        <Feather name="cloud" size={14} color={theme.text.muted} />
      </View>
    );
  }
  return (
    <View style={s.syncDot} accessibilityLabel="Synced">
      <Feather name="check-circle" size={14} color={theme.accent.primary} />
    </View>
  );
}
