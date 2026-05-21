import React, { useEffect, useRef, useState, useCallback, useMemo, startTransition } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, Modal, Pressable, KeyboardAvoidingView, Platform, Animated,
  useWindowDimensions, ActivityIndicator,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import * as Haptics from 'expo-haptics';

import { Feather } from '@expo/vector-icons';
import * as ScreenOrientation from 'expo-screen-orientation';

import { getShowRunningScore, setShowRunningScore } from '../lib/prefs';
import { playersMeFirst, pairsMeFirst } from '../lib/playerOrder';
import {
  loadTournament, subscribeTournamentChanges,
  calcStablefordPoints, calcBestWorstBall, pickupStrokes, DEFAULT_SETTINGS,
  matchPlayHolePts, calcExtraShots,
  sindicatoHolePoints, sindicatoRoundTally,
  roundPairLeaderboard, roundPairClinched,
  isRoundComplete, isTournamentFinished,
  subscribeSyncStatus,
} from '../store/tournamentStore';
import { mutate } from '../store/mutate';
import { fetchPlayers } from '../store/libraryStore';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import PullToRefresh from '../components/PullToRefresh';
import MediaLightbox from '../components/MediaLightbox';
import AttachMediaSheet from '../components/AttachMediaSheet';
import CaptureMenuSheet from '../components/CaptureMenuSheet';
import SyncStatusSheet from '../components/SyncStatusSheet';
import { pickMedia, attachMedia } from '../lib/mediaCapture';
import { useRoundMedia } from '../hooks/useRoundMedia';
import { useOfficialRound } from '../hooks/useOfficialRound';
import DiscrepancySheet from '../components/DiscrepancySheet';
import ScoringModeChangeBanner from '../components/ScoringModeChangeBanner';
import ScoringModeChangeSheet from '../components/ScoringModeChangeSheet';
import { fallbackNoticeText } from '../components/scoringModes';
import { scoreCellState, cardDiscrepancyHoles } from '../store/officialScoring';
import { buildLeaderboard } from '../store/officialLeaderboard';
import { attestCard } from '../store/officialStore';
import { notifyRoundFinished } from '../store/notificationStore';
import { Alert } from 'react-native';
import {
  DEFAULT_SHOT,
  CELEBRATION_TIERS, celebrationFor,
} from '../components/scorecard/constants';
import { ShotDetailPanel } from '../components/scorecard/ShotDetailPanel';
import { RoundSummary } from '../components/scorecard/RoundSummary';
import { makeScorecardStyles } from '../components/scorecard/styles';

// Web-only CSS scroll-snap. On native, `pagingEnabled` is handled by the
// platform. On web, react-native-web 0.21's `pagingEnabled` only sets
// `scroll-snap-align: start` on its auto-wrapper — missing
// `scroll-snap-stop: always`, so a fast swipe can carry past one page.
// We disable the auto-wrapper on web (pagingEnabled={false}) and apply
// the snap properties directly on the ScrollView + each page.
const PAGER_SNAP_TYPE_STYLE = Platform.OS === 'web' ? { scrollSnapType: 'x mandatory', overflowX: 'auto' } : null;
const PAGER_PAGE_SNAP_STYLE = Platform.OS === 'web' ? { scrollSnapAlign: 'start', scrollSnapStop: 'always' } : null;

// Belt-and-braces: inject the snap rules via a real <style> tag so they
// apply even if RNW's atomic-CSS pipeline ever filters an unknown CSS
// property. Targeted by a data attribute we set on each page.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const id = 'golf-partner-pager-snap-stop';
  if (!document.getElementById(id)) {
    const styleEl = document.createElement('style');
    styleEl.id = id;
    styleEl.textContent = '[data-pagerpage="1"]{scroll-snap-align:start !important;scroll-snap-stop:always !important;}';
    document.head.appendChild(styleEl);
  }
}

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
  // The hook is always called (Rules of Hooks); it no-ops on null token.
  const officialData = useOfficialRound({
    token: official ? officialToken : null,
    roundId: official ? officialRoundId : null,
  });
  const { user } = useAuth();
  const [tournament, setTournament] = useState(null);
  const [scores, setScores] = useState({});
  // Per-player, per-hole shot detail. In practice only the "me" player has
  // entries, but it is keyed by playerId like `scores` for generality.
  const [shotDetails, setShotDetails] = useState({});
  // Notes object: { round: string, hole: { [holeNumber]: string } }.
  const [notes, setNotes] = useState({});
  const [view, setView] = useState('hole'); // 'grid' | 'hole'
  const [currentHole, setCurrentHole] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [saveError, setSaveError] = useState(false);
  // 'loading' until the first loadTournament resolves; 'error' if it returned
  // null (or threw); 'ready' once a tournament is in hand.
  const [loadState, setLoadState] = useState('loading');
  // Live sync status from the store ('idle' | 'syncing' | 'pending' | 'error').
  const [syncStatus, setSyncStatus] = useState('idle');
  // Round-complete celebration overlay before navigating to the summary.
  const [roundCompleteVisible, setRoundCompleteVisible] = useState(false);
  // Official mode (Task 16): attest-my-card request in flight, and the last
  // attest error message (RPC can reject with "resolve discrepancies first").
  const [attestBusy, setAttestBusy] = useState(false);
  // Official-only: whether the official gross leaderboard sheet is open.
  const [officialLeaderboardOpen, setOfficialLeaderboardOpen] = useState(false);
  const [attestError, setAttestError] = useState(null);
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
  // Tracks whether the user has an unsaved edit (scores or notes) that a
  // subscription-driven reload must not clobber. Set when a debounce is
  // scheduled, cleared after the save finishes.
  const pendingSaveRef = useRef(false);
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
    const idx = paramRoundIndex ?? t.currentRound;
    const round = t.rounds[idx];
    const roundScores = round?.scores ?? {};
    setTournament(t);
    if (!preserveLocalEdits) {
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
      setShotDetails(round?.shotDetails ?? {});
      // Normalize notes to the { round, hole } object shape. Legacy data may
      // have stored a bare string — treat that as the round-level note.
      const rawNotes = round?.notes;
      setNotes(
        rawNotes && typeof rawNotes === 'object'
          ? rawNotes
          : (typeof rawNotes === 'string' && rawNotes ? { round: rawNotes } : {})
      );

      // Only on first load: jump to the first hole with no scores entered.
      if (!hasAutoJumpedRef.current && round?.holes?.length) {
        hasAutoJumpedRef.current = true;
        const firstEmpty = round.holes.find((h) =>
          t.players.every((p) => roundScores[p.id]?.[h.number] == null)
        );
        if (firstEmpty) setCurrentHole(firstEmpty.number);
        else setCurrentHole(round.holes[round.holes.length - 1].number);
      }
    }
  }, [paramRoundIndex, official]);

  useEffect(() => {
    reload();
    const unsub = subscribeTournamentChanges(() => {
      reload({ preserveLocalEdits: pendingSaveRef.current });
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
    saveChainRef.current = saveChainRef.current
      .then(unit)
      .then(() => { setSaveError(false); })
      .catch((e) => {
        // A local save failing (e.g. AsyncStorage full) is rare but must not
        // be silent — the user would believe the score was recorded.
        console.warn('ScorecardScreen: save failed', e);
        setSaveError(true);
      })
      .finally(() => {
        inflightSavesRef.current -= 1;
        if (
          inflightSavesRef.current === 0
          && !saveTimeoutRef.current
          && Object.keys(notesSaveTimeoutsRef.current).length === 0
        ) {
          pendingSaveRef.current = false;
        }
      });
  }, []);

  const autoSave = useCallback((newScores) => {
    if (!tournamentRef.current) return;
    enqueueSave(async () => {
      // Diff against the latest committed tournament — not the baseline at
      // schedule time — so chained saves apply incremental deltas rather
      // than redundantly re-mutating already-persisted cells.
      if (!tournamentRef.current) return;
      const t0 = tournamentRef.current;
      const round = t0.rounds[roundIndex];
      if (!round) return;
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
    });
  }, [roundIndex, enqueueSave]);

  // Keep the latest scores/notes in refs so retrySave can re-push them
  // without being re-created on every keystroke.
  const scoresRef = useRef(scores);
  useEffect(() => { scoresRef.current = scores; }, [scores]);
  // `${playerId}:${holeNumber}` keys for score cells edited locally and not yet
  // confirmed saved. Scores only — shot-detail saves rely on pendingSaveRef.
  const dirtyCellsRef = useRef(new Set());
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
    setNotes((prev) => ({ ...prev, round: value }));
    scheduleNoteSave('round', { scope: 'round', text: value });
  }, [scheduleNoteSave]);

  const saveHoleNote = useCallback((holeNumber, value) => {
    setNotes((prev) => ({
      ...prev,
      hole: { ...(prev.hole ?? {}), [holeNumber]: value },
    }));
    scheduleNoteSave(`h${holeNumber}`, { scope: 'hole', hole: holeNumber, text: value });
  }, [scheduleNoteSave]);

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
    setShotDetails((prev) => {
      const current = prev[playerId]?.[holeNumber] ?? DEFAULT_SHOT;
      const detail = { ...DEFAULT_SHOT, ...current, ...patch };
      const next = {
        ...prev,
        [playerId]: { ...prev[playerId], [holeNumber]: detail },
      };
      saveShot(playerId, holeNumber, detail);
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
  const settings = useMemo(
    () => ({ ...DEFAULT_SETTINGS, ...(tournament?.settings ?? {}) }),
    [tournament?.settings],
  );
  const settingsMode = tournament?.settings?.scoringMode;
  const currentMode = settingsMode ?? 'stableford';
  const prevSettingsMode = usePrevious(settingsMode);
  const [noticeMessage, setNoticeMessage] = useState(null);
  const [reopenPrompt, setReopenPrompt] = useState(false);
  const dismissModeNotice = useCallback(() => setNoticeMessage(null), []);
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
  // otherwise match the signed-in user to a linked library player. If no
  // match, meId stays null and the scorecard shows the "who are you?" picker.
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
    if (!official) return true;
    // Once this device's holder has attested their card (Task 16) the official
    // branch is read-only for them — no more edits to any card on this device.
    if (officialData.hasAttested) return false;
    return officialData.editableSource(playerId) !== null;
  }, [official, officialData]);

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

    // Official mode routes the write through the RPC layer; casual mode
    // diffs and persists through the tournament-blob `mutate` chain.
    if (official) officialWrite(playerId, holeNumber, parsed);
    else autoSave(next);
    if (parsed != null && parsed !== current) {
      const label = celebrationFor(holePar, parsed);
      if (label) triggerCelebration(playerId, holeNumber, label);
    }
  }, [round, autoSave, triggerCelebration, official, officialWrite]);

  const stepScore = useCallback((playerId, holeNumber, delta) => {
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

    if (official) officialWrite(playerId, holeNumber, newStrokes);
    else autoSave(next);
    if (newStrokes !== current) {
      const label = celebrationFor(holePar, newStrokes);
      if (label) triggerCelebration(playerId, holeNumber, label);
    }
  }, [round, autoSave, triggerCelebration, getScoreAnim, official, officialWrite]);

  // Totals computed once per (round, players, scores) change. The per-hole
  // pager pages do NOT read this — it only feeds the outside totals strip.
  // In match play, pts tallies per-hole wins (1/0/half) instead of Stableford.
  const playerTotalsMap = useMemo(() => {
    const map = new Map();
    if (!round) return map;
    const isMatchPlay = settings.scoringMode === 'matchplay';
    const isSindicato = settings.scoringMode === 'sindicato';
    const playerHandicaps = round.playerHandicaps ?? {};
    players.forEach((player) => {
      const handicap = playerHandicaps[player.id] ?? player.handicap ?? 0;
      let pts = 0;
      let str = 0;
      let parPlayed = 0;
      round.holes.forEach((hole) => {
        const sc = scores[player.id]?.[hole.number];
        if (sc) {
          str += sc;
          parPlayed += hole.par;
          if (isMatchPlay) {
            pts += matchPlayHolePts(hole, player.id, players, scores, playerHandicaps) ?? 0;
          } else if (isSindicato) {
            pts += sindicatoHolePoints(hole, players, scores, playerHandicaps)?.[player.id] ?? 0;
          } else {
            pts += calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
          }
        }
      });
      map.set(player.id, { pts, str, parPlayed });
    });
    return map;
  }, [round, players, scores, settings.scoringMode]);

  const playerTotals = useCallback(
    (player) => playerTotalsMap.get(player.id) ?? { pts: 0, str: 0, parPlayed: 0 },
    [playerTotalsMap],
  );

  const goToPrevHole = useCallback(() => {
    haptic('medium');
    setCurrentHole((h) => Math.max(1, h - 1));
  }, []);

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
  const clinchInitRef = useRef(false);

  // Initialize the clinch ref once per mount so re-entering an already
  // clinched round does not pop the alert again. Re-runs only if round id
  // changes (different round opened in the same screen instance).
  useEffect(() => {
    if (!round || !tournament) return;
    if (clinchInitRef.current) return;
    clinchInitRef.current = true;
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
        const names = pair.map((p) => p.name).join(' & ');
        const title = '🏆 Round clinched';
        const message = `${names} cannot be caught in this round.`;
        if (Platform.OS === 'web') window.alert(`${title}\n${message}`);
        else Alert.alert(title, message);
      }
    }
    lastClinchedPairRef.current = clinched;
  }, [round, tournament, players, scores]);

  const goToHole = useCallback((h) => {
    haptic('light');
    setCurrentHole(h);
  }, []);

  // Back from the scorecard should land on the tournament/round info view
  // (leaderboard + round pager), not the Play tab list. Official rounds
  // come from JoinOfficial and need their own pop behavior preserved.
  const goBack = useCallback(() => {
    if (official) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Tournament');
  }, [navigation, official]);

  // Finish flow: invoked from the last-hole "Finish" button. Shows a brief
  // "round complete" celebration, then routes to that round's summary. When
  // every round of the tournament is complete, also offers to archive it.
  const handleFinish = useCallback(() => {
    const t = tournamentRef.current;
    const r = t?.rounds?.[roundIndex];
    if (!t || !r) { goBack(); return; }

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

    const liveRound = { ...r, scores };
    const players = t.players ?? [];
    const liveTournament = {
      ...t,
      rounds: t.rounds.map((rr, i) => (i === roundIndex ? liveRound : rr)),
    };
    const roundDone = isRoundComplete(liveRound, players);
    const tournamentDone = isTournamentFinished(liveTournament);

    const goToSummary = () => {
      navigation.navigate('RoundSummary', {
        tournamentId: t.id,
        roundId: r.id,
      });
    };

    haptic('success');
    setRoundCompleteVisible(true);
    setTimeout(() => {
      setRoundCompleteVisible(false);
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
  }, [roundIndex, scores, navigation, goBack, official]);

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

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {/* Header with inline view toggle (small, doesn't take a full row) */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
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
          <View style={s.togglePill}>
            <TouchableOpacity
              style={[s.toggleBtn, view === 'hole' && s.toggleBtnActive]}
              onPress={() => setView('hole')}
              accessibilityLabel="Hole by hole view"
            >
              <Feather
                name="circle"
                size={12}
                color={view === 'hole' ? theme.text.inverse : theme.text.muted}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.toggleBtn, view === 'grid' && s.toggleBtnActive]}
              onPress={() => setView('grid')}
              accessibilityLabel="All holes grid view"
            >
              <Feather
                name="grid"
                size={12}
                color={view === 'grid' ? theme.text.inverse : theme.text.muted}
              />
            </TouchableOpacity>
          </View>
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
      <ScoringModeChangeSheet
        visible={reopenPrompt}
        playerCount={(tournament?.players ?? []).length}
        defaultMode={currentMode}
        title="Change scoring mode"
        onConfirm={async (chosenMode) => {
          setReopenPrompt(false);
          if (chosenMode === currentMode) return;
          await mutate(tournament, {
            type: 'tournament.setScoringMode',
            scoringMode: chosenMode,
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
          onRoundNoteChange={saveRoundNote}
          onHoleNoteChange={saveHoleNote}
          onPrev={goToPrevHole}
          onNext={goToNextHole}
          onGoToHole={goToHole}
          onGoBack={goBack}
          onFinish={handleFinish}
          holeCount={holeCount}
          playerTotals={playerTotals}
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
          refreshing={refreshing}
          onRefresh={onRefresh}
          meId={meId}
        />
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

// Memoized per-hole page. Extracted so a swipe that only changes the
// outside `currentHole` indicator does NOT re-render the other 17 pages
// in the pager — that's the main source of swipe lag.
const HolePage = React.memo(function HolePage({
  pageHole, width, height, courseName, roundIndex,
  round, players, scores,
  shotDetails, meId, onSetShot,
  theme, s,
  onStep, onSetScore, editable, getScoreAnim,
  showRunning, playerTotals,
  mode,
  official, officialDiscrepancy, onOpenDiscrepancy,
}) {
  const pairs = round.pairs ?? [];
  const isSolo = players.length === 1;
  // Hero card layout (big +/-, centered strokes) for solo, 2-4 player
  // Stableford, and Match Play. Keep the compact pair UI only for classic
  // 4-player Best Ball where pair colors carry meaning.
  const useHeroCards = mode !== 'bestball';
  const orderedPlayers = !useHeroCards && pairs.length === 2
    ? pairsMeFirst(pairs, meId).map((pp) => players.find((p) => p.id === pp.id)).filter(Boolean)
    : playersMeFirst(players, meId);

  return (
    <View
      style={[{ width, height }, PAGER_PAGE_SNAP_STYLE]}
      dataSet={Platform.OS === 'web' ? { pagerpage: '1' } : undefined}
    >
      {/* Hole header */}
      <View style={s.holeHeaderCard}>
        <View style={s.holeHeaderLeft}>
          <Text style={s.holeHeaderRound}>{courseName} -- Round {roundIndex + 1}</Text>
          <View style={s.holeNumberRow}>
            <Text style={s.holeNumberLabel}>HOLE</Text>
            <Text style={s.holeNumber}>{pageHole.number}</Text>
          </View>
        </View>
        <View style={s.holeHeaderRight}>
          <View style={s.holeMetaItem}>
            <Text style={s.holeMetaLabel}>PAR</Text>
            <Text style={s.holeMetaValue}>{pageHole.par}</Text>
          </View>
          <View style={s.holeMetaItem}>
            <Text style={s.holeMetaLabel}>SI</Text>
            <Text style={s.holeMetaValue}>{pageHole.strokeIndex}</Text>
          </View>
        </View>
      </View>

      {/* Player score cards — scroll if they overflow, which happens once
          2+ hero cards are stacked on a short screen. */}
      <ScrollView
        style={s.flex}
        contentContainerStyle={s.playerCardsContent}
        keyboardShouldPersistTaps="handled"
      >
        {orderedPlayers.map((player, idx) => {
          const pairIndex = pairs.findIndex((pair) => pair.some((pp) => pp.id === player.id));
          const pairColor = isSolo
            ? theme.accent.primary
            : pairIndex === 0 ? theme.pairA : pairIndex === 1 ? theme.pairB : theme.text.muted;
          const isFirstOfPair = pairs.length === 2 && (idx === 0 || idx === 2);
          const pairLabelText = pairIndex === 0 ? 'Pair A' : 'Pair B';

          const handicap = round.playerHandicaps?.[player.id] ?? player.handicap;
          const strokes = scores[player.id]?.[pageHole.number];
          const pts = strokes == null ? null
            : mode === 'matchplay'
              ? matchPlayHolePts(pageHole, player.id, players, scores, round.playerHandicaps ?? {})
              : mode === 'sindicato'
                ? (sindicatoHolePoints(pageHole, players, scores, round.playerHandicaps ?? {})?.[player.id] ?? null)
                : calcStablefordPoints(pageHole.par, strokes, handicap, pageHole.strokeIndex);

          const ptsColor = pts == null ? theme.text.muted
            : pts >= 3 ? theme.scoreColor('excellent')
            : pts >= 2 ? theme.scoreColor('good')
            : pts === 1 ? theme.scoreColor('neutral')
            : theme.scoreColor('poor');

          const extraShots = handicap >= pageHole.strokeIndex ? (Math.floor(handicap / 18) + (handicap % 18 >= pageHole.strokeIndex ? 1 : 0)) : 0;

          const pickup = pickupStrokes(pageHole.par, handicap, pageHole.strokeIndex);
          const isPickup = strokes != null && strokes >= pickup;
          // Per-card write permission. Casual mode passes no `editable` prop
          // (or one that returns true). In official mode a read-only card
          // renders the score without +/- steppers or the pickup toggle.
          const canEdit = editable ? editable(player.id) : true;

          // Official mode: classify this player's hole from the raw two-row
          // score data so the hero card can show an agreed / waiting /
          // discrepancy badge. Casual mode leaves officialState null.
          let officialState = null;     // 'empty' | 'waiting' | 'agreed' | 'discrepancy'
          let canResolveHere = false;   // viewer owns an entry → can open sheet
          if (official && officialDiscrepancy) {
            const { self, marker } = officialDiscrepancy.cellEntries(player.id, pageHole.number);
            officialState = scoreCellState(self, marker);
            // The viewer can act on a card they own an entry for (self or
            // marker). canEdit already encodes editableSource !== null.
            canResolveHere = canEdit;
          }

          if (useHeroCards) {
            const totals = playerTotals(player);
            const vsPar = totals.parPlayed > 0 ? totals.str - totals.parPlayed : 0;
            const vsParLabel = totals.parPlayed === 0 ? '—'
              : vsPar === 0 ? 'E'
              : vsPar > 0 ? `+${vsPar}` : String(vsPar);
            const vsParColor = totals.parPlayed === 0 ? theme.text.muted
              : vsPar <= -1 ? theme.scoreColor('excellent')
              : vsPar === 0 ? theme.scoreColor('good')
              : vsPar <= 2 ? theme.scoreColor('neutral')
              : theme.scoreColor('poor');

            // A discrepancy card the viewer can act on opens the resolve
            // sheet on tap. Other states (or read-only viewers) keep the
            // card non-interactive — the badge alone communicates state.
            const heroTappable = officialState === 'discrepancy' && canResolveHere;
            const HeroCard = heroTappable ? Pressable : View;
            const heroCardProps = heroTappable
              ? {
                onPress: () => onOpenDiscrepancy?.(player.id, pageHole.number),
                accessibilityLabel: `Resolve ${player.name}'s score on hole ${pageHole.number}`,
              }
              : {};

            return (
              <React.Fragment key={player.id}>
              <HeroCard style={s.soloHeroCard} {...heroCardProps}>
                <View style={s.soloHeroHeader}>
                  <View style={s.soloHeroNameWrap}>
                    <View style={s.soloHeroNameRow}>
                      <Text style={s.soloHeroName}>{player.name}</Text>
                      {round.playerTees?.[player.id]?.label ? (
                        <Text style={s.teeBadge}>{round.playerTees[player.id].label}</Text>
                      ) : null}
                      {/* Official discrepancy badge: green check (agreed),
                          grey clock (waiting), red dot (discrepancy). No
                          badge for 'empty' or in casual mode. */}
                      {officialState === 'agreed' && (
                        <Feather name="check-circle" size={14} color={theme.scoreColor('good')} />
                      )}
                      {officialState === 'waiting' && (
                        <Feather name="clock" size={14} color={theme.text.muted} />
                      )}
                      {officialState === 'discrepancy' && (
                        <Feather name="alert-circle" size={14} color={theme.destructive} />
                      )}
                    </View>
                    <Text style={s.soloHeroHcp}>
                      HCP {handicap}{extraShots > 0 ? `  ·  +${extraShots} on this hole` : ''}
                    </Text>
                  </View>
                  {/* Pickup toggle is a write action — hide on read-only cards. */}
                  {canEdit && (
                    <TouchableOpacity
                      style={[s.pickupBtn, isPickup && s.pickupBtnActive]}
                      onPress={() => onSetScore(player.id, pageHole.number, isPickup ? pageHole.par : pickup)}
                      activeOpacity={0.7}
                      accessibilityLabel={isPickup ? `Picked up at ${pickup} strokes — tap to clear` : `Pickup at ${pickup} strokes`}
                    >
                      <Feather
                        name="arrow-up-circle"
                        size={16}
                        color={isPickup ? theme.text.inverse : theme.text.muted}
                      />
                    </TouchableOpacity>
                  )}
                </View>

                <View style={s.soloScoreRow}>
                  {/* Steppers only on cards this device may write. A
                      read-only card (official mode: not self / not markee)
                      shows the score with no +/- and no long-press-to-clear. */}
                  {canEdit && (
                    <TouchableOpacity
                      style={s.soloStepBtn}
                      onPress={() => onStep(player.id, pageHole.number, -1)}
                      accessibilityLabel={`Decrease strokes on hole ${pageHole.number}`}
                    >
                      <Feather name="minus" size={24} color={theme.text.primary} />
                    </TouchableOpacity>
                  )}
                  <Pressable
                    onLongPress={() => {
                      if (canEdit && strokes != null) {
                        haptic('medium');
                        onSetScore(player.id, pageHole.number, '');
                      }
                    }}
                    delayLongPress={350}
                    accessibilityLabel={`Strokes on hole ${pageHole.number}${canEdit && strokes != null ? ' — long-press to clear' : ''}`}
                  >
                    <Animated.View style={[s.soloScoreDisplay, { transform: [{ scale: getScoreAnim(player.id) }] }]}>
                      <Text style={[s.soloScoreNum, strokes == null && s.scoreDisplayNumEmpty]}>
                        {strokes ?? '—'}
                      </Text>
                      <Text style={s.soloScoreLabel}>
                        {strokes == null ? 'STROKES' : canEdit ? 'HOLD TO CLEAR' : 'STROKES'}
                      </Text>
                    </Animated.View>
                  </Pressable>
                  {canEdit && (
                    <TouchableOpacity
                      style={s.soloStepBtn}
                      onPress={() => onStep(player.id, pageHole.number, 1)}
                      accessibilityLabel={`Increase strokes on hole ${pageHole.number}`}
                    >
                      <Feather name="plus" size={24} color={theme.text.primary} />
                    </TouchableOpacity>
                  )}
                </View>

                {pts !== null && (
                  <View style={[s.soloPtsBadge, { borderColor: ptsColor }]}>
                    <Text style={[s.soloPtsText, { color: ptsColor }]}>
                      {pts} {pts === 1 ? 'point' : 'points'}
                    </Text>
                  </View>
                )}

                {showRunning && (
                  <View style={s.soloStatsRow}>
                    <View style={s.soloStatItem}>
                      <Text style={s.soloStatLabel}>STROKES</Text>
                      <Text style={s.soloStatValue}>{totals.str || '—'}</Text>
                    </View>
                    <View style={s.soloStatDivider} />
                    <View style={s.soloStatItem}>
                      <Text style={s.soloStatLabel}>POINTS</Text>
                      <Text style={[s.soloStatValue, { color: theme.accent.primary }]}>{totals.pts}</Text>
                    </View>
                    <View style={s.soloStatDivider} />
                    <View style={s.soloStatItem}>
                      <Text style={s.soloStatLabel}>vs PAR</Text>
                      <Text style={[s.soloStatValue, { color: vsParColor }]}>{vsParLabel}</Text>
                    </View>
                  </View>
                )}
                {player.id === meId && (
                  <ShotDetailPanel
                    hole={pageHole}
                    detail={shotDetails[meId]?.[pageHole.number]}
                    onChange={(patch) => onSetShot(meId, pageHole.number, patch)}
                    strokes={scores?.[meId]?.[pageHole.number]}
                    theme={theme}
                    s={s}
                  />
                )}
              </HeroCard>
              </React.Fragment>
            );
          }

          return (
            <React.Fragment key={player.id}>
              {isFirstOfPair && (
                <Text style={[s.pairLabel, { color: pairColor, marginTop: idx === 0 ? 0 : 16 }]}>{pairLabelText}</Text>
              )}
              <View style={[s.playerCard, { borderLeftColor: pairColor, borderLeftWidth: 3 }]}>
                <View style={s.playerCardRow}>
                  <View style={s.playerCardLeft}>
                    <View style={[s.playerAvatar, { backgroundColor: pairColor }]}>
                      <Text style={s.playerAvatarText}>{player.name[0].toUpperCase()}</Text>
                    </View>
                    <View>
                      <View style={s.playerCardNameRow}>
                        <Text style={s.playerCardName}>{player.name}</Text>
                        {round.playerTees?.[player.id]?.label ? (
                          <Text style={s.teeBadge}>{round.playerTees[player.id].label}</Text>
                        ) : null}
                      </View>
                      <Text style={s.playerCardHcp}>HCP {handicap}{extraShots > 0 ? ` +${extraShots}` : ''}</Text>
                      {showRunning && (
                        <Text style={s.playerCardRunning}>
                          {playerTotals(player).pts} pts
                        </Text>
                      )}
                    </View>
                  </View>
                  <View style={s.playerCardRight}>
                    {/* Steppers / pickup only on cards this device may write. */}
                    {canEdit && (
                      <TouchableOpacity style={s.stepBtn} onPress={() => onStep(player.id, pageHole.number, -1)}>
                        <Feather name="minus" size={18} color={theme.text.primary} />
                      </TouchableOpacity>
                    )}
                    <Pressable
                      onLongPress={() => {
                        if (canEdit && strokes != null) {
                          haptic('medium');
                          onSetScore(player.id, pageHole.number, '');
                        }
                      }}
                      delayLongPress={350}
                      accessibilityLabel={`Strokes on hole ${pageHole.number}${canEdit && strokes != null ? ' — long-press to clear' : ''}`}
                    >
                      <Animated.View style={[s.scoreDisplay, { transform: [{ scale: getScoreAnim(player.id) }] }]}>
                        <Text style={[s.scoreDisplayNum, strokes == null && s.scoreDisplayNumEmpty]}>
                          {strokes ?? '—'}
                        </Text>
                        {pts !== null && (
                          <Text style={[s.scoreDisplayPts, { color: ptsColor }]}>
                            {pts} {pts === 1 ? 'pt' : 'pts'}
                          </Text>
                        )}
                      </Animated.View>
                    </Pressable>
                    {canEdit && (
                      <TouchableOpacity style={s.stepBtn} onPress={() => onStep(player.id, pageHole.number, 1)}>
                        <Feather name="plus" size={18} color={theme.text.primary} />
                      </TouchableOpacity>
                    )}
                    {canEdit && (
                      <TouchableOpacity
                        style={[s.pickupBtn, isPickup && s.pickupBtnActive]}
                        onPress={() => onSetScore(player.id, pageHole.number, isPickup ? pageHole.par : pickup)}
                        activeOpacity={0.7}
                        accessibilityLabel={isPickup ? `Picked up at ${pickup} strokes — tap to clear` : `Pickup at ${pickup} strokes`}
                      >
                        <Feather
                          name="arrow-up-circle"
                          size={16}
                          color={isPickup ? theme.text.inverse : theme.text.muted}
                        />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
                {player.id === meId && (
                  <ShotDetailPanel
                    hole={pageHole}
                    detail={shotDetails[meId]?.[pageHole.number]}
                    onChange={(patch) => onSetShot(meId, pageHole.number, patch)}
                    strokes={scores?.[meId]?.[pageHole.number]}
                    theme={theme}
                    s={s}
                  />
                )}
              </View>
            </React.Fragment>
          );
        })}
      </ScrollView>
    </View>
  );
});

// Prompt shown on the scorecard when shot-detail tracking can't tell which
// player is "me" (multi-player round, no signed-in match).
function MePicker({ players, onPickMe, theme, s }) {
  return (
    <View style={s.mePicker}>
      <View style={s.mePickerHeader}>
        <Feather name="target" size={14} color={theme.accent.primary} />
        <Text style={s.mePickerLabel}>Track your shots — which player are you?</Text>
      </View>
      <View style={s.mePickerChips}>
        {players.map((p) => (
          <TouchableOpacity
            key={p.id}
            style={s.mePickerChip}
            onPress={() => onPickMe(p.id)}
            activeOpacity={0.7}
          >
            <Text style={s.mePickerChipText}>{p.name.split(' ')[0]}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}


function HoleView({ round, roundIndex, players, scores, shotDetails, meId, onSetShot, onPickMe, notes, currentHole, hole, isBestBall, bbResult, settings, onStep, onSetScore, editable, onRoundNoteChange, onHoleNoteChange, onPrev, onNext, onGoToHole, onGoBack, onFinish, holeCount, playerTotals, showRunning, getScoreAnim, celebration, celebrationAnim, refreshing, onRefresh, official, officialDiscrepancy, officialEditableSource, officialSetScore, officialHasAttested, officialAttestBusy, officialAttestError, onAttest }) {
  const { theme } = useTheme();
  const isSindicato = settings?.scoringMode === 'sindicato';
  // Notes split: the current hole's note plus the shared round-level note.
  const holeNote = notes?.hole?.[currentHole] ?? '';
  const roundNote = notes?.round ?? '';
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [holePickerOpen, setHolePickerOpen] = useState(false);
  // Official mode: the hole + subject currently open in the resolve sheet.
  // { hole, subjectRosterId } or null. Casual mode never sets this.
  const [discrepancyTarget, setDiscrepancyTarget] = useState(null);
  const [pagerSize, setPagerSize] = useState({ width: 0, height: 0 });
  const pagerRef = useRef(null);
  const holeScrollOffset = useRef(0);
  const isUserScrollingHole = useRef(false);
  const holePagerInitialized = useRef(false);
  // True while a programmatic scrollTo animation is in flight. Stops
  // onScroll from committing mid-animation; user drag and momentum
  // are NOT suppressed.
  const suppressHoleOnScroll = useRef(false);
  const suppressHoleTimer = useRef(null);
  // True when the latest currentHole prop change was driven by our own
  // scroll (onScroll / onMomentumScrollEnd). The sync effect uses this
  // to skip scrollTo — the pager is already where it needs to be, and
  // a scrollTo would cause a visible mini-scroll after the gesture.
  const currentHoleFromScroll = useRef(false);

  useEffect(() => {
    if (currentHoleFromScroll.current) {
      currentHoleFromScroll.current = false;
      return;
    }
    if (!pagerRef.current || pagerSize.width <= 0) return;
    if (isUserScrollingHole.current) return;
    const target = (currentHole - 1) * pagerSize.width;
    if (Math.abs(holeScrollOffset.current - target) < 1) return;
    // Suppress onScroll commits while the animation runs.
    suppressHoleOnScroll.current = true;
    clearTimeout(suppressHoleTimer.current);
    suppressHoleTimer.current = setTimeout(() => {
      suppressHoleOnScroll.current = false;
    }, 450);
    pagerRef.current.scrollTo({ x: target, animated: holePagerInitialized.current });
    holeScrollOffset.current = target;
    holePagerInitialized.current = true;
  }, [currentHole, pagerSize.width]);

  if (!hole) return null;

  return (
    <View style={s.flex}>
      {/* Shot tracking needs to know which player is "me". Solo rounds and
          signed-in users are resolved automatically; otherwise prompt. */}
      {!meId && players.length > 1 && (
        <MePicker players={players} onPickMe={onPickMe} theme={theme} s={s} />
      )}

      {/* Horizontal pager: flex:1, one page per hole (swipe to change hole) */}
      <View
        style={s.pagerWrap}
        onLayout={(e) => {
          // Don't prefill holeScrollOffset from currentHole — on web the
          // ScrollView's contentOffset doesn't reliably position before
          // children lay out, and lying about the offset lets the sync
          // effect skip its scrollTo when auto-jumping to the first
          // unplayed hole. Leave the ref at its actual value so the
          // effect corrects it.
          const { width, height } = e.nativeEvent.layout;
          setPagerSize({ width, height });
        }}
      >
        {pagerSize.width > 0 && pagerSize.height > 0 && (
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled={Platform.OS !== 'web'}
            style={PAGER_SNAP_TYPE_STYLE}
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScrollBeginDrag={() => {
              isUserScrollingHole.current = true;
              suppressHoleOnScroll.current = false;
              clearTimeout(suppressHoleTimer.current);
            }}
            onScroll={(e) => {
              const x = e.nativeEvent.contentOffset.x;
              holeScrollOffset.current = x;
              // Skip only during a programmatic scrollTo animation; live
              // commit during user drag AND its momentum so the match
              // panel / totals / next-hole button update the whole swipe.
              if (suppressHoleOnScroll.current) return;
              const newHole = Math.round(x / pagerSize.width) + 1;
              if (newHole !== currentHole) {
                // Tag so the sync effect skips scrollTo — the pager is
                // already at `newHole`; a scrollTo would fight the scroll.
                currentHoleFromScroll.current = true;
                // Non-urgent: keep the native scroll running smoothly while
                // React reconciles match panel / totals / bottom button.
                startTransition(() => onGoToHole(newHole));
              }
            }}
            // Keep isUserScrollingHole true through the momentum phase so
            // the sync effect doesn't scrollTo on top of the inertia.
            onScrollEndDrag={() => {}}
            onMomentumScrollEnd={(e) => {
              const x = e.nativeEvent.contentOffset.x;
              holeScrollOffset.current = x;
              isUserScrollingHole.current = false;
              suppressHoleOnScroll.current = false;
              clearTimeout(suppressHoleTimer.current);
              const newHole = Math.round(x / pagerSize.width) + 1;
              if (newHole !== currentHole) {
                currentHoleFromScroll.current = true;
                onGoToHole(newHole);
              }
            }}
            contentOffset={{ x: (currentHole - 1) * pagerSize.width, y: 0 }}
          >
            {round.holes.map((pageHole) => (
              <HolePage
                key={pageHole.number}
                pageHole={pageHole}
                width={pagerSize.width}
                height={pagerSize.height}
                courseName={round.courseName}
                roundIndex={roundIndex}
                round={round}
                players={players}
                scores={scores}
                shotDetails={shotDetails}
                meId={meId}
                onSetShot={onSetShot}
                theme={theme}
                s={s}
                onStep={onStep}
                onSetScore={onSetScore}
                editable={editable}
                getScoreAnim={getScoreAnim}
                showRunning={showRunning}
                playerTotals={playerTotals}
                mode={settings?.scoringMode === 'matchplay' ? 'matchplay'
                  : settings?.scoringMode === 'sindicato' ? 'sindicato'
                  : isBestBall ? 'bestball' : 'stableford'}
                official={official}
                officialDiscrepancy={officialDiscrepancy}
                onOpenDiscrepancy={(subjectRosterId, holeNumber) =>
                  setDiscrepancyTarget({ hole: holeNumber, subjectRosterId })}
              />
            ))}
          </ScrollView>
        )}
      </View>

      {/* Unified round summary — pinned above the bottom controls. One panel
          renders every game mode (pairs / players / solo) from summaryState.
          Gated behind the showRunning eye toggle (mirrors old stableford/solo
          running-score visibility behaviour). */}
      {showRunning && (
        <RoundSummary
          mode={settings?.scoringMode ?? 'stableford'}
          round={round}
          players={players}
          scores={scores}
          settings={settings}
          currentHole={currentHole}
          meId={meId}
        />
      )}

      {/* Bottom controls: actions (notes / go-to-hole / next) */}
      <View style={s.bottomBar}>
        <View style={s.bottomActionsRow}>
          <TouchableOpacity
            style={s.notesPillBtn}
            onPress={() => setNotesOpen(true)}
            activeOpacity={0.7}
          >
            <Feather
              name={holeNote.trim() ? 'edit-3' : 'edit-2'}
              size={14}
              color={holeNote.trim() ? theme.accent.primary : theme.text.muted}
            />
            <Text style={[s.notesPillBtnText, holeNote.trim() && s.notesPillBtnTextActive]}>
              Notes
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.notesPillBtn}
            onPress={() => setHolePickerOpen(true)}
            activeOpacity={0.7}
            accessibilityLabel="Jump to hole"
          >
            <Feather name="list" size={14} color={theme.text.muted} />
            <Text style={s.notesPillBtnText}>Go to hole</Text>
          </TouchableOpacity>
          {(() => {
            // Last-hole affordance. Official mode (Task 16) replaces the casual
            // "Finish" with "Attest my card": disabled while the holder has
            // open discrepancies or a request is in flight, hidden once done.
            const onLastHole = currentHole >= holeCount;
            if (official && onLastHole) {
              const hasDiscrepancies = (officialDiscrepancy?.myHoles?.length ?? 0) > 0;
              const attestDisabled = hasDiscrepancies || officialAttestBusy
                || officialHasAttested;
              const label = officialHasAttested
                ? 'Attested'
                : officialAttestBusy ? 'Attesting…' : 'Attest my card';
              return (
                <TouchableOpacity
                  style={[s.saveBtn, attestDisabled && s.saveBtnDisabled]}
                  onPress={onAttest}
                  disabled={attestDisabled}
                  activeOpacity={0.8}
                  accessibilityLabel="Attest my card"
                >
                  <Text style={s.saveBtnText}>{label}</Text>
                  <Feather
                    name={officialHasAttested ? 'check-circle' : 'flag'}
                    size={18}
                    color={theme.text.inverse}
                  />
                </TouchableOpacity>
              );
            }
            return (
              <TouchableOpacity
                style={s.saveBtn}
                onPress={onLastHole ? onFinish : onNext}
                activeOpacity={0.8}
              >
                <Text style={s.saveBtnText}>
                  {onLastHole ? 'Finish' : `Hole ${currentHole + 1}`}
                </Text>
                <Feather
                  name={onLastHole ? 'flag' : 'chevron-right'}
                  size={18}
                  color={theme.text.inverse}
                />
              </TouchableOpacity>
            );
          })()}
        </View>
        {official && currentHole >= holeCount && (officialHasAttested
          || (officialDiscrepancy?.myHoles?.length ?? 0) > 0 || officialAttestError) && (
          <Text style={s.attestHint}>
            {officialHasAttested
              ? 'Attested — waiting for your party'
              : officialAttestError
                ? officialAttestError
                : 'Resolve discrepancies before attesting'}
          </Text>
        )}
      </View>

      {/* Notes modal — per-hole note + shared round note */}
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
                onChangeText={(text) => onHoleNoteChange(currentHole, text)}
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
                onChangeText={onRoundNoteChange}
              />
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Go-to-hole modal */}
      <Modal
        visible={holePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setHolePickerOpen(false)}
      >
        <Pressable style={s.notesBackdrop} onPress={() => setHolePickerOpen(false)}>
          <Pressable style={s.holePickerSheet} onPress={() => {}}>
            <Text style={s.notesTitle}>Jump to hole</Text>
            <View style={s.holePickerGrid}>
              {round.holes.map((h) => {
                const n = h.number;
                const hasAnyScore = players.some((p) => scores[p.id]?.[n] != null);
                const hasNote = !!(notes?.hole?.[n] ?? '').trim();
                // Official mode: red dot on holes where the token holder's
                // own self/marker entries disagree (their discrepancy holes).
                const hasDiscrepancy = official && officialDiscrepancy
                  ? officialDiscrepancy.myHoles.includes(n)
                  : false;
                return (
                  <TouchableOpacity
                    key={n}
                    style={[
                      s.holePickerBtn,
                      n === currentHole && s.holePickerBtnActive,
                      hasAnyScore && n !== currentHole && s.holePickerBtnDone,
                    ]}
                    onPress={() => { onGoToHole(n); setHolePickerOpen(false); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.holePickerBtnText, n === currentHole && s.holePickerBtnTextActive]}>{n}</Text>
                    {hasDiscrepancy ? (
                      // Discrepancy takes visual priority over a note dot.
                      <View
                        style={[s.holePickerNoteDot, { backgroundColor: theme.destructive }]}
                      />
                    ) : hasNote ? (
                      <View
                        style={[
                          s.holePickerNoteDot,
                          {
                            backgroundColor: n === currentHole
                              ? theme.text.inverse
                              : theme.accent.primary,
                          },
                        ]}
                      />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Official-mode discrepancy resolve sheet. Opened by tapping a hero
          card flagged 'discrepancy'. Casual mode never sets discrepancyTarget. */}
      {official && officialDiscrepancy && discrepancyTarget && (() => {
        const { hole: dHole, subjectRosterId } = discrepancyTarget;
        const { self, marker } = officialDiscrepancy.cellEntries(subjectRosterId, dHole);
        const subject = players.find((p) => p.id === subjectRosterId);
        const src = officialEditableSource ? officialEditableSource(subjectRosterId) : null;
        return (
          <DiscrepancySheet
            visible
            onClose={() => setDiscrepancyTarget(null)}
            hole={dHole}
            subjectName={subject?.name ?? 'Player'}
            selfStrokes={self}
            markerStrokes={marker}
            markerName={officialDiscrepancy.markerNameFor(subjectRosterId)}
            editableSource={src}
            onChange={(strokes) => {
              // Route the viewer's edit through the hook's setScore for the
              // entry they own. A pure read-only viewer (src === null) has no
              // editable side; onChange is then a no-op.
              if (src && officialSetScore) {
                officialSetScore(subjectRosterId, dHole, strokes, src);
              }
            }}
          />
        );
      })()}

      <CelebrationOverlay celebration={celebration} celebrationAnim={celebrationAnim} players={players} />
    </View>
  );
}

function pairLabel(pair) {
  return pair.map((p) => p.name.split(' ')[0]).join(' & ');
}

function holeTeamPts(holeData, team, bbVal, wbVal) {
  if (!holeData || holeData.bestWinner === null) return null;
  return (holeData.bestWinner === team ? bbVal : 0) + (holeData.worstWinner === team ? wbVal : 0);
}

function roundTeamPts(bbResult, team, bbVal, wbVal) {
  const { bestBall, worstBall } = bbResult;
  return (team === 1 ? bestBall.pair1 : bestBall.pair2) * bbVal
       + (team === 1 ? worstBall.pair1 : worstBall.pair2) * wbVal;
}

const MatchPanel = React.memo(function MatchPanel({ bbResult, currentHole, settings }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);
  const { pair1, pair2, holes } = bbResult;
  const { bestBallValue: bbVal, worstBallValue: wbVal } = settings;
  const holeData = holes.find((h) => h.number === currentHole);
  const p1Name = pairLabel(pair1);
  const p2Name = pairLabel(pair2);

  const p1Hole = holeTeamPts(holeData, 1, bbVal, wbVal);
  const p2Hole = holeTeamPts(holeData, 2, bbVal, wbVal);
  const p1Round = roundTeamPts(bbResult, 1, bbVal, wbVal);
  const p2Round = roundTeamPts(bbResult, 2, bbVal, wbVal);

  const holeWinner = p1Hole === null ? null : p1Hole > p2Hole ? 1 : p2Hole > p1Hole ? 2 : 0;
  const roundWinner = p1Round > p2Round ? 1 : p2Round > p1Round ? 2 : 0;

  // "Clinched" — lead is greater than anything the trailing pair could still
  // claw back on the remaining (un-fully-scored) holes.
  const holesRemaining = holes.filter((h) => h.bestWinner === null).length;
  const maxCatchup = holesRemaining * (bbVal + wbVal);
  const lead = Math.abs(p1Round - p2Round);
  const clinched = roundWinner !== 0 && lead > maxCatchup;
  const winnerName = roundWinner === 1 ? p1Name : roundWinner === 2 ? p2Name : null;

  return (
    <View style={s.matchPanel}>
      {clinched && winnerName && (
        <WinnerBadge name={winnerName} />
      )}

      {/* Column headers */}
      <View style={s.matchPanelHeaderRow}>
        <View style={s.matchPanelNameCol} />
        <Text style={s.matchPanelColLabel}>HOLE {currentHole}</Text>
        <Text style={s.matchPanelColLabel}>ROUND</Text>
      </View>

      {/* Pair 1 row */}
      <View style={s.matchPanelDataRow}>
        <View style={s.matchPanelNameWrap}>
          <Text style={[s.matchPanelName, roundWinner === 1 && { color: theme.accent.primary }]} numberOfLines={1}>
            {p1Name}
          </Text>
          {clinched && roundWinner === 1 && (
            <Feather name="award" size={14} color={theme.accent.primary} />
          )}
        </View>
        <Text style={[s.matchPanelStat, holeWinner === 1 && { color: theme.accent.primary }, holeWinner === 2 && { color: theme.destructive }]}>
          {p1Hole ?? '-'}
        </Text>
        <Text style={[s.matchPanelStat, s.matchPanelStatRound, roundWinner === 1 && { color: theme.accent.primary }]}>
          {p1Round}
        </Text>
      </View>

      {/* Pair 2 row */}
      <View style={s.matchPanelDataRow}>
        <View style={s.matchPanelNameWrap}>
          <Text style={[s.matchPanelName, roundWinner === 2 && { color: theme.accent.primary }]} numberOfLines={1}>
            {p2Name}
          </Text>
          {clinched && roundWinner === 2 && (
            <Feather name="award" size={14} color={theme.accent.primary} />
          )}
        </View>
        <Text style={[s.matchPanelStat, holeWinner === 2 && { color: theme.accent.primary }, holeWinner === 1 && { color: theme.destructive }]}>
          {p2Hole ?? '-'}
        </Text>
        <Text style={[s.matchPanelStat, s.matchPanelStatRound, roundWinner === 2 && { color: theme.accent.primary }]}>
          {p2Round}
        </Text>
      </View>
    </View>
  );
});

function WinnerBadge({ name }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);
  return (
    <View style={s.winnerBadgeRow}>
      <Feather name="award" size={14} color="#ffd700" />
      <Text style={s.winnerBadgeText}>
        {name} · CHAMPIONS
      </Text>
    </View>
  );
}

// Shown above the Stableford totals strip when the pair result is decided
// (every player has entered every hole, and one entry leads outright).
// Works for both random-partners (2 pair-of-2) and individual stableford
// (N pair-of-1) — single-member "pairs" naturally produce a per-player
// ranking through roundPairLeaderboard.
// Live Sindicato standings, pinned above the bottom controls — mirrors the
// best-ball MatchPanel / Stableford totals strip. Shows each player's running
// points (me first, then high to low) and the leader / clinch status.
function SindicatoPanel({ round, players, scores, meId }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);
  const tally = sindicatoRoundTally({ ...round, scores }, players);
  if (!tally) return null;
  const { totals, leaderIdx, lead, clinched, holesLeft } = tally;
  const firstName = (p) => p.name?.split(' ')[0] ?? '—';
  const leader = leaderIdx != null ? totals[leaderIdx].player : null;
  const status = clinched && leader
    ? `${firstName(leader)} has clinched`
    : leader
      ? `${firstName(leader)} leads by ${lead}${holesLeft > 0 ? ` · ${holesLeft} to play` : ''}`
      : `All level${holesLeft > 0 ? ` · ${holesLeft} to play` : ''}`;
  const me = totals.find((t) => t.player.id === meId);
  const orderedTotals = me ? [me, ...totals.filter((t) => t.player.id !== meId)] : totals;
  return (
    <View style={s.totalsStrip}>
      <Text style={s.totalStripLabel}>SINDICATO</Text>
      <View style={s.totalStripRow}>
        {orderedTotals.map(({ player, points }) => (
          <View key={player.id} style={s.totalStripPlayer}>
            <Text style={s.totalStripName}>{firstName(player)}</Text>
            <Text style={s.totalStripPts}>{points}</Text>
          </View>
        ))}
      </View>
      <Text style={s.sindicatoStatus}>{status}</Text>
    </View>
  );
}

function StablefordWinnerBanner({ round, scores, players }) {
  const pairs = round?.pairs ?? [];
  if (pairs.length < 2) return null;

  // Round is considered "decided" only once every player has entered scores
  // on every hole. Stableford has no clinching shortcut (a 5-point eagle
  // could always swing the result), so we wait until the round is complete.
  const allScored = players.every((p) =>
    round.holes.every((h) => scores[p.id]?.[h.number] != null)
  );
  if (!allScored) return null;

  const liveRound = { ...round, scores };
  const pairResults = roundPairLeaderboard(liveRound, players);
  if (pairResults.length < 2) return null;
  const [first, second] = pairResults;
  if (first.combinedPoints === second.combinedPoints) return null;

  const name = first.members.map((m) => m.player.name.split(' ')[0]).join(' & ');
  return <WinnerBadge name={name} />;
}

function SoloTotalsRibbon({ player, stats }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);
  const { pts, str, parPlayed } = stats;
  const vsPar = parPlayed > 0 ? str - parPlayed : 0;
  const vsParLabel = parPlayed === 0 ? '—'
    : vsPar === 0 ? 'E'
    : vsPar > 0 ? `+${vsPar}` : String(vsPar);
  const vsParColor = parPlayed === 0 ? theme.text.muted
    : vsPar <= -1 ? theme.scoreColor('excellent')
    : vsPar === 0 ? theme.scoreColor('good')
    : vsPar <= 2 ? theme.scoreColor('neutral')
    : theme.scoreColor('poor');

  return (
    <View style={s.soloRibbon}>
      <View style={s.soloRibbonHeader}>
        <Text style={s.soloRibbonName} numberOfLines={1}>{player.name}</Text>
        <Text style={s.soloRibbonLabel}>ROUND TOTALS</Text>
      </View>
      <View style={s.soloRibbonRow}>
        <View style={s.soloRibbonItem}>
          <Text style={s.soloRibbonItemLabel}>STROKES</Text>
          <Text style={s.soloRibbonStrokes}>{str || '—'}</Text>
        </View>
        <View style={s.soloRibbonItem}>
          <Text style={s.soloRibbonItemLabel}>POINTS</Text>
          <Text style={s.soloRibbonPts}>{pts}</Text>
        </View>
        <View style={s.soloRibbonItem}>
          <Text style={s.soloRibbonItemLabel}>vs PAR</Text>
          <Text style={[s.soloRibbonVsPar, { color: vsParColor }]}>{vsParLabel}</Text>
        </View>
      </View>
    </View>
  );
}


function CelebrationOverlay({ celebration, celebrationAnim, players }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);

  if (!celebration?.label) return null;
  const tier = CELEBRATION_TIERS[celebration.label] ?? CELEBRATION_TIERS.BIRDIE;
  const player = players.find((p) => p.id === celebration.playerId);
  const firstName = player?.name?.split(' ')[0] ?? '';

  const scrimOpacity = celebrationAnim.interpolate({
    inputRange: [0, 1], outputRange: [0, 0.55],
  });
  const cardOpacity = celebrationAnim;
  const cardScale = celebrationAnim.interpolate({
    inputRange: [0, 1], outputRange: [0.75, 1],
  });
  const cardTranslate = celebrationAnim.interpolate({
    inputRange: [0, 1], outputRange: [16, 0],
  });
  const ringScale = celebrationAnim.interpolate({
    inputRange: [0, 1], outputRange: [0.6, 1.35],
  });
  const ringOpacity = celebrationAnim.interpolate({
    inputRange: [0, 0.5, 1], outputRange: [0, 0.6, 0],
  });

  return (
    <View pointerEvents="none" style={s.celebrationRoot}>
      <Animated.View style={[s.celebrationScrim, { opacity: scrimOpacity }]} />
      <Animated.View
        style={[
          s.celebrationRing,
          {
            borderColor: tier.glow,
            opacity: ringOpacity,
            transform: [{ scale: ringScale }],
          },
        ]}
      />
      <Animated.View
        style={[
          s.celebrationCard,
          {
            opacity: cardOpacity,
            borderColor: tier.accent,
            shadowColor: tier.accent,
            transform: [{ scale: cardScale }, { translateY: cardTranslate }],
          },
        ]}
      >
        <View style={[s.celebrationIconWrap, { borderColor: tier.accent }]}>
          <Feather name={tier.icon} size={22} color={tier.accent} />
        </View>
        <Text style={[s.celebrationEyebrow, { color: tier.accent }]}>{tier.eyebrow}</Text>
        <Text style={s.celebrationLabelBig}>{celebration.label}</Text>
        {!!firstName && (
          <Text style={s.celebrationSubtitle}>
            {firstName} · Hole {celebration.holeNumber}
          </Text>
        )}
      </Animated.View>
    </View>
  );
}

// Column layout is computed once per block and passed to every row so every
// cell — header, par, SI, stroke input, pts — lines up perfectly.
function getSoloColumns(blockWidth) {
  // Block inner width after card padding + row margin (see soloNineBlock /
  // soloNineRow styles: 2+4 = 6 each side, 12 total). Caller already passed
  // inner width if available; when it hasn't been measured yet, fall back.
  const width = Math.max(260, blockWidth);
  // Label/agg columns are fixed so "Hole" / "YOU" / "OUT" always fit on one
  // line at the body font size. Hole cells flex in the remaining space.
  // Player labels use a 3-letter uppercase initial ("GUI", "MAR") so the
  // column stays narrow no matter how long names get.
  const narrow = width < 340;
  const labelW = narrow ? 38 : 42;
  const aggW = narrow ? 40 : 46;
  const holeW = (width - labelW - aggW) / 9;
  const labelFontSize = narrow ? 10 : 11;
  return { labelW, aggW, holeW, narrow, labelFontSize };
}

// Player label for the scorecard row: "You" for solo, 3-letter uppercase
// abbreviation for multi-player (classic scorecard convention).
function shortPlayerLabel(player, isSolo) {
  if (isSolo) return 'You';
  const name = player.name?.trim() ?? '';
  if (!name) return '—';
  return name.slice(0, 3).toUpperCase();
}

function NineBlock({
  holes, label, aggLabel, players, scores, onSetScore,
  playerHandicaps, mode, theme, s, columns, meId,
}) {
  const { labelW, aggW, holeW, labelFontSize } = columns;
  const labelFont = { fontSize: labelFontSize };
  const isSolo = players.length === 1;
  const displayPlayers = playersMeFirst(players, meId);

  // Refs for every stroke-entry cell, keyed `playerId:holeNumber`, plus the
  // flat tab order (player by player, hole by hole) so the keyboard "next"
  // key advances focus through the card.
  const cellRefs = useRef({});
  const cellKey = (playerId, holeNumber) => `${playerId}:${holeNumber}`;
  const focusOrder = [];
  displayPlayers.forEach((p) => holes.forEach((h) => focusOrder.push(cellKey(p.id, h.number))));
  const focusNext = (playerId, holeNumber) => {
    const idx = focusOrder.indexOf(cellKey(playerId, holeNumber));
    if (idx < 0 || idx + 1 >= focusOrder.length) return;
    const next = cellRefs.current[focusOrder[idx + 1]];
    if (next) next.focus();
  };

  const holePts = (hole, player, handicap) => {
    const str = scores[player.id]?.[hole.number];
    if (str == null) return null;
    if (mode === 'matchplay') {
      return matchPlayHolePts(hole, player.id, players, scores, playerHandicaps);
    }
    if (mode === 'sindicato') {
      return sindicatoHolePoints(hole, players, scores, playerHandicaps)?.[player.id] ?? null;
    }
    return calcStablefordPoints(hole.par, str, handicap, hole.strokeIndex);
  };
  const ptsColorFor = (pts) => pts == null ? theme.text.muted
    : pts >= 3 ? theme.scoreColor('excellent')
    : pts >= 2 ? theme.scoreColor('good')
    : pts === 1 ? theme.scoreColor('neutral')
    : theme.scoreColor('poor');

  const sumPar = holes.reduce((acc, h) => acc + h.par, 0);

  const labelCell = { width: labelW };
  const holeCell = { width: holeW };
  const aggCell = { width: aggW };

  const renderPlayerRows = (player, isFirst) => {
    const handicap = playerHandicaps[player.id] ?? player.handicap ?? 0;
    const sumStr = holes.reduce((acc, h) => {
      const v = scores[player.id]?.[h.number];
      return v ? acc + v : acc;
    }, 0);
    const sumPts = holes.reduce((acc, h) => acc + (holePts(h, player, handicap) ?? 0), 0);
    const rowLabel = shortPlayerLabel(player, isSolo);

    return (
      <React.Fragment key={player.id}>
        {/* strokes entry row */}
        <View style={[s.soloNineRow, s.soloNineRowYou, !isFirst && s.soloNinePlayerSeparator]}>
          <Text numberOfLines={1} style={[s.soloNineCell, s.soloNineLabelCell, labelCell, s.soloNineRowLabel, s.soloNineYouLabel, labelFont]}>
            {rowLabel}
          </Text>
          {holes.map((h) => {
            const extra = calcExtraShots(handicap, h.strokeIndex);
            return (
              <View key={h.number} style={[s.soloNineCell, holeCell, s.soloNineYouCell]}>
                <TextInput
                  ref={(el) => { cellRefs.current[cellKey(player.id, h.number)] = el; }}
                  style={s.soloNineStrokeInput}
                  keyboardType="numeric"
                  keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                  selectionColor={theme.accent.primary}
                  maxLength={2}
                  value={scores[player.id]?.[h.number] != null ? String(scores[player.id][h.number]) : ''}
                  onChangeText={(v) => onSetScore(player.id, h.number, v)}
                  placeholder="·"
                  placeholderTextColor={theme.text.muted}
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => focusNext(player.id, h.number)}
                />
                {extra > 0 && (
                  <View style={s.soloNineExtraDots} pointerEvents="none">
                    {Array.from({ length: Math.min(extra, 2) }).map((_, i) => (
                      <View key={i} style={[s.soloNineExtraDot, { backgroundColor: theme.accent.primary }]} />
                    ))}
                  </View>
                )}
              </View>
            );
          })}
          <Text numberOfLines={1} style={[s.soloNineCell, aggCell, s.soloNineAggDivider, s.soloNineAggStrokesTotal]}>{sumStr || '·'}</Text>
        </View>

        {/* pts row */}
        <View style={s.soloNineRow}>
          <Text numberOfLines={1} style={[s.soloNineCell, s.soloNineLabelCell, labelCell, s.soloNineRowLabel, labelFont]}>Pts</Text>
          {holes.map((h) => {
            const pts = holePts(h, player, handicap);
            return (
              <Text key={h.number} numberOfLines={1} style={[s.soloNineCell, holeCell, s.soloNinePtsText, { color: ptsColorFor(pts) }]}>
                {pts ?? '·'}
              </Text>
            );
          })}
          <Text numberOfLines={1} style={[s.soloNineCell, aggCell, s.soloNineAggDivider, s.soloNineAggPtsTotal]}>{sumPts}</Text>
        </View>
      </React.Fragment>
    );
  };

  return (
    <View style={s.soloNineBlock}>
      <Text style={s.soloNineLabel}>{label}</Text>

      {/* Hole header */}
      <View style={s.soloNineHeaderRow}>
        <Text numberOfLines={1} style={[s.soloNineCell, s.soloNineLabelCell, labelCell, s.soloNineHeaderText, s.soloNineHeaderLabel, labelFont]}>Hole</Text>
        {holes.map((h) => (
          <Text key={h.number} numberOfLines={1} style={[s.soloNineCell, holeCell, s.soloNineHeaderText]}>
            {h.number}
          </Text>
        ))}
        <Text numberOfLines={1} style={[s.soloNineCell, aggCell, s.soloNineHeaderText, s.soloNineHeaderAgg]}>{aggLabel}</Text>
      </View>

      {/* Par */}
      <View style={s.soloNineRow}>
        <Text numberOfLines={1} style={[s.soloNineCell, s.soloNineLabelCell, labelCell, s.soloNineRowLabel, labelFont]}>Par</Text>
        {holes.map((h) => (
          <Text key={h.number} numberOfLines={1} style={[s.soloNineCell, holeCell, s.soloNineParText]}>{h.par}</Text>
        ))}
        <Text numberOfLines={1} style={[s.soloNineCell, aggCell, s.soloNineAggDivider, s.soloNineAggText]}>{sumPar}</Text>
      </View>

      {/* SI */}
      <View style={[s.soloNineRow, s.soloNineRowSi]}>
        <Text numberOfLines={1} style={[s.soloNineCell, s.soloNineLabelCell, labelCell, s.soloNineRowLabel, s.soloNineSiLabel, labelFont]}>SI</Text>
        {holes.map((h) => (
          <Text key={h.number} numberOfLines={1} style={[s.soloNineCell, holeCell, s.soloNineSiText]}>{h.strokeIndex}</Text>
        ))}
        <Text style={[s.soloNineCell, aggCell, s.soloNineAggDivider]} />
      </View>

      {displayPlayers.map((player, i) => renderPlayerRows(player, i === 0))}
    </View>
  );
}

function ScorecardTable({ round, players, scores, onSetScore, mode, meId }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);
  const { width } = useWindowDimensions();

  // Landscape / large-phone / tablet — put FRONT + BACK side by side so the
  // whole card fits in one screenful without scrolling.
  const sideBySide = width >= 720;

  const holes = round.holes ?? [];
  const front = holes.slice(0, 9);
  const back = holes.slice(9, 18);
  const hasBack = back.length > 0;
  const playerHandicaps = round.playerHandicaps ?? {};
  const displayPlayers = playersMeFirst(players, meId);

  // Block inner width: viewport minus content padding (14*2) minus card
  // border (2) minus card padding (2*2). In side-by-side mode, each card
  // gets half the space minus the gap between them (16).
  const innerWidth = (() => {
    const available = width - 14 * 2 - 2 - 2 * 2 - 4 * 2;
    return sideBySide ? (available - 16) / 2 : available;
  })();
  const columns = getSoloColumns(innerWidth, players.length);

  const coursePar = holes.reduce((acc, h) => acc + h.par, 0);
  const isSolo = players.length === 1;

  // Per-player totals for the bottom bar / leaderboard strip.
  // Uses displayPlayers so the rendered leaderboard order is me-first.
  // Scoring functions (matchPlayHolePts, sindicatoHolePoints) still receive
  // the original `players` array to preserve index-based scoring correctness.
  const playerTotals = displayPlayers.map((p) => {
    const handicap = playerHandicaps[p.id] ?? p.handicap ?? 0;
    let str = 0;
    let pts = 0;
    let parPlayed = 0;
    for (const h of holes) {
      const v = scores[p.id]?.[h.number];
      if (!v) continue;
      str += v;
      parPlayed += h.par;
      if (mode === 'matchplay') {
        pts += matchPlayHolePts(h, p.id, players, scores, playerHandicaps) ?? 0;
      } else if (mode === 'sindicato') {
        pts += sindicatoHolePoints(h, players, scores, playerHandicaps)?.[p.id] ?? 0;
      } else {
        pts += calcStablefordPoints(h.par, v, handicap, h.strokeIndex);
      }
    }
    const vsPar = parPlayed > 0 ? str - parPlayed : 0;
    const vsParLabel = parPlayed === 0 ? '·'
      : vsPar === 0 ? 'E'
      : vsPar > 0 ? `+${vsPar}` : String(vsPar);
    return { player: p, str, pts, vsPar, vsParLabel };
  });
  const leader = [...playerTotals].sort((a, b) => b.pts - a.pts)[0];

  return (
    <View style={s.soloBoard}>
      <View style={sideBySide ? s.soloNinesRow : s.soloNinesStack}>
        <View style={sideBySide ? s.soloNineFlex : null}>
          <NineBlock
            holes={front}
            label="FRONT NINE"
            aggLabel="OUT"
            players={players}
            scores={scores}
            onSetScore={onSetScore}
            playerHandicaps={playerHandicaps}
            mode={mode}
            theme={theme}
            s={s}
            columns={columns}
            meId={meId}
          />
        </View>

        {hasBack && (
          <View style={sideBySide ? s.soloNineFlex : null}>
            <NineBlock
              holes={back}
              label="BACK NINE"
              aggLabel="IN"
              players={players}
              scores={scores}
              onSetScore={onSetScore}
              playerHandicaps={playerHandicaps}
              mode={mode}
              theme={theme}
              s={s}
              columns={columns}
              meId={meId}
            />
          </View>
        )}
      </View>

      {/* Round total — single bar for solo (course par + personal totals),
          compact per-player leaderboard for 2+ players. */}
      {isSolo ? (
        <View style={s.soloTotalBar}>
          <View style={s.soloTotalCol}>
            <Text style={s.soloTotalLabel}>PAR</Text>
            <Text style={s.soloTotalNumber}>{coursePar}</Text>
          </View>
          <View style={s.soloTotalDivider} />
          <View style={s.soloTotalCol}>
            <Text style={s.soloTotalLabel}>STROKES</Text>
            <Text style={s.soloTotalNumber}>{playerTotals[0].str || '·'}</Text>
          </View>
          <View style={s.soloTotalDivider} />
          <View style={s.soloTotalCol}>
            <Text style={s.soloTotalLabel}>POINTS</Text>
            <Text style={[s.soloTotalNumber, { color: theme.accent.primary }]}>{playerTotals[0].pts}</Text>
          </View>
          <View style={s.soloTotalDivider} />
          <View style={s.soloTotalCol}>
            <Text style={s.soloTotalLabel}>vs PAR</Text>
            <Text style={s.soloTotalNumber}>{playerTotals[0].vsParLabel}</Text>
          </View>
        </View>
      ) : (
        <View style={s.multiTotalCard}>
          <View style={s.multiTotalHeader}>
            <Text style={s.multiTotalLabel}>PAR {coursePar}</Text>
            <Text style={s.multiTotalLabel}>{
              mode === 'matchplay' ? 'MATCH PLAY'
                : mode === 'sindicato' ? 'SINDICATO'
                : 'STABLEFORD'
            }</Text>
          </View>
          <View style={s.multiTotalColHeader}>
            <Text style={s.multiTotalColHeaderLabel} />
            <Text style={[s.multiTotalColHeaderLabel, { width: 48, textAlign: 'right' }]}>STR</Text>
            <Text style={[s.multiTotalColHeaderLabel, { width: 40, textAlign: 'right' }]}>vs PAR</Text>
            <Text style={[s.multiTotalColHeaderLabel, { width: 46, textAlign: 'right' }]}>PTS</Text>
          </View>
          {playerTotals.map(({ player, str, pts, vsParLabel }) => {
            const isLeader = leader && player.id === leader.player.id && leader.pts > 0;
            return (
              <View key={player.id} style={s.multiTotalRow}>
                <Text numberOfLines={1} style={[s.multiTotalName, isLeader && s.multiTotalLeader]}>
                  {player.name?.split(' ')[0] ?? '—'}
                </Text>
                <Text style={s.multiTotalStr}>{str || '·'}</Text>
                <Text style={s.multiTotalVsPar}>{vsParLabel}</Text>
                <Text style={[s.multiTotalPts, isLeader && { color: theme.accent.primary }]}>{pts}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function GridView({ round, roundIndex, players, scores, isBestBall, bbResult, settings, onSetScore, refreshing, onRefresh, meId }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);
  const mode = settings?.scoringMode === 'matchplay' ? 'matchplay'
    : settings?.scoringMode === 'sindicato' ? 'sindicato'
    : isBestBall ? 'bestball'
    : 'stableford';
  // Classic pair-vs-pair best-ball scorecard (4 players). Everything else —
  // solo, 2-4 player stableford, 2-player match play — uses the compact
  // front-nine / back-nine card layout so one view works for all modes.
  const useClassicGrid = mode === 'bestball' && players.length === 4;

  // Cell refs for the classic grid so the keyboard "next" key advances down
  // a player's column (hole to hole).
  const gridCellRefs = useRef({});
  const gridCellKey = (playerId, holeNumber) => `${playerId}:${holeNumber}`;

  return (
    <PullToRefresh
      style={s.flex}
      contentContainerStyle={useClassicGrid ? s.gridContent : s.soloGridContent}
      automaticallyAdjustKeyboardInsets
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <View style={useClassicGrid ? s.gridHeaderRow : s.soloGridHeaderBar}>
        <View style={{ flex: 1 }}>
          {useClassicGrid ? (
            <>
              <Text style={s.title}>{round.courseName}</Text>
              <Text style={s.subtitle}>Round {roundIndex + 1}</Text>
            </>
          ) : (
            <Text style={s.soloGridHeaderTitle} numberOfLines={1}>
              {round.courseName} · Round {roundIndex + 1}
            </Text>
          )}
        </View>
      </View>

      {!useClassicGrid ? (
        <ScorecardTable
          round={round}
          players={players}
          scores={scores}
          onSetScore={onSetScore}
          mode={mode}
          meId={meId}
        />
      ) : (
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {(() => {
            const pairs = round.pairs ?? [];
            const hasPairs = pairs.length === 2;
            const orderedPlayers = hasPairs
              ? pairsMeFirst(pairs, meId).map((pp) => players.find((p) => p.id === pp.id)).filter(Boolean)
              : playersMeFirst(players, meId);

            const renderPlayerCell = (p, hole) => {
              const strokes = scores[p.id]?.[hole.number];
              const handicap = round.playerHandicaps?.[p.id] ?? p.handicap;
              const pts = strokes != null
                ? calcStablefordPoints(hole.par, strokes, handicap, hole.strokeIndex)
                : null;
              const ptsColor = pts == null ? theme.text.muted
                : pts >= 3 ? theme.scoreColor('excellent')
                : pts >= 2 ? theme.scoreColor('good')
                : pts === 1 ? theme.scoreColor('neutral')
                : theme.scoreColor('poor');
              return (
                <View key={p.id} style={[s.cell, s.playerCell, s.inputCell]}>
                  <TextInput
                    ref={(el) => { gridCellRefs.current[gridCellKey(p.id, hole.number)] = el; }}
                    style={s.scoreInput}
                    keyboardType="numeric"
                    keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                    selectionColor={theme.accent.primary}
                    maxLength={2}
                    value={strokes != null ? String(strokes) : ''}
                    onChangeText={(v) => onSetScore(p.id, hole.number, v)}
                    placeholder="-"
                    placeholderTextColor={theme.text.muted}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => {
                      const next = gridCellRefs.current[gridCellKey(p.id, hole.number + 1)];
                      if (next) next.focus();
                    }}
                  />
                  {pts !== null && (
                    <Text style={[s.pts, { color: ptsColor }]}>{pts}</Text>
                  )}
                </View>
              );
            };

            const pairHolePts = (pi, hole) => {
              const pair = pairs[pi];
              const members = pair.map((pp) => players.find((p) => p.id === pp.id)).filter(Boolean);
              let pts = 0;
              let hasAny = false;
              if (isBestBall && bbResult) {
                const hd = bbResult.holes.find((h) => h.number === hole.number);
                if (hd && hd.bestWinner !== null) {
                  hasAny = true;
                  pts = holeTeamPts(hd, pi + 1, settings.bestBallValue, settings.worstBallValue) ?? 0;
                }
              } else {
                members.forEach((m) => {
                  const str = scores[m.id]?.[hole.number];
                  if (str != null) {
                    hasAny = true;
                    const hcp = round.playerHandicaps?.[m.id] ?? m.handicap;
                    pts += calcStablefordPoints(hole.par, str, hcp, hole.strokeIndex);
                  }
                });
              }
              return { pts, hasAny };
            };

            const pairTotalRound = (pi) => {
              const pair = pairs[pi];
              const members = pair.map((pp) => players.find((p) => p.id === pp.id)).filter(Boolean);
              if (isBestBall && bbResult) {
                return roundTeamPts(bbResult, pi + 1, settings.bestBallValue, settings.worstBallValue);
              }
              let tot = 0;
              members.forEach((m) => {
                const hcp = round.playerHandicaps?.[m.id] ?? m.handicap;
                round.holes.forEach((hole) => {
                  const str = scores[m.id]?.[hole.number];
                  if (str) tot += calcStablefordPoints(hole.par, str, hcp, hole.strokeIndex);
                });
              });
              return tot;
            };

            return (
              <>
                {/* Header */}
                <View style={s.headerRow}>
                  <Text style={[s.cell, s.holeCell, s.headerText]}>Hole</Text>
                  <Text style={[s.cell, s.parCell, s.headerText]}>Par</Text>
                  <Text style={[s.cell, s.siCell, s.headerText]}>SI</Text>
                  {orderedPlayers.map((p) => (
                    <Text key={p.id} style={[s.cell, s.playerCell, s.headerText]} numberOfLines={1}>
                      {p.name.split(' ')[0]}
                    </Text>
                  ))}
                  {hasPairs && (
                    <Text style={[s.cell, s.pairCombinedCell, s.headerText]}>Pair</Text>
                  )}
                </View>

                {/* Hole rows */}
                {round.holes.map((hole) => {
                  const h1 = hasPairs ? pairHolePts(0, hole) : null;
                  const h2 = hasPairs ? pairHolePts(1, hole) : null;
                  return (
                    <View key={hole.number} style={[s.holeRow, hole.number % 2 === 0 && s.altRow]}>
                      <Text style={[s.cell, s.holeCell]}>{hole.number}</Text>
                      <Text style={[s.cell, s.parCell]}>{hole.par}</Text>
                      <Text style={[s.cell, s.siCell]}>{hole.strokeIndex}</Text>
                      {orderedPlayers.map((p) => renderPlayerCell(p, hole))}
                      {hasPairs && (
                        <View style={[s.cell, s.pairCombinedCell]}>
                          <Text style={[s.pairInlinePts, { color: h1.hasAny ? theme.pairA : theme.text.muted }]}>
                            {h1.hasAny ? h1.pts : '-'}
                          </Text>
                          <Text style={s.pairInlineSep}>·</Text>
                          <Text style={[s.pairInlinePts, { color: h2.hasAny ? theme.pairB : theme.text.muted }]}>
                            {h2.hasAny ? h2.pts : '-'}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })}

                {/* Totals row */}
                <View style={[s.holeRow, s.totalsRow]}>
                  <Text style={[s.cell, s.holeCell, s.totalText]}>Total</Text>
                  <Text style={[s.cell, s.parCell, s.totalText]}>
                    {round.holes.reduce((sum, h) => sum + h.par, 0)}
                  </Text>
                  <Text style={[s.cell, s.siCell]} />
                  {orderedPlayers.map((p) => {
                    let totalPts = 0;
                    let totalStr = 0;
                    const handicap = round.playerHandicaps?.[p.id] ?? p.handicap;
                    round.holes.forEach((hole) => {
                      const str = scores[p.id]?.[hole.number];
                      if (str) {
                        totalStr += str;
                        totalPts += calcStablefordPoints(hole.par, str, handicap, hole.strokeIndex);
                      }
                    });
                    const pi = hasPairs ? (pairs[0].some((pp) => pp.id === p.id) ? 0 : 1) : -1;
                    const ptsColor = pi === 0 ? theme.pairA : pi === 1 ? theme.pairB : theme.accent.primary;
                    return (
                      <View key={p.id} style={[s.cell, s.playerCell]}>
                        <Text style={[s.totalPts, { color: ptsColor }]}>{totalPts} pts</Text>
                        <Text style={s.totalStr}>{totalStr || '-'}</Text>
                      </View>
                    );
                  })}
                  {hasPairs && (
                    <View style={[s.cell, s.pairCombinedCell]}>
                      <Text style={[s.pairInlineTotal, { color: theme.pairA }]}>{pairTotalRound(0)}</Text>
                      <Text style={s.pairInlineSep}>·</Text>
                      <Text style={[s.pairInlineTotal, { color: theme.pairB }]}>{pairTotalRound(1)}</Text>
                    </View>
                  )}
                </View>
              </>
            );
          })()}
        </View>
      </ScrollView>
      )}

      {isBestBall && bbResult && <LiveMatchStrip bbResult={bbResult} settings={settings} />}
    </PullToRefresh>
  );
}

function LiveMatchStrip({ bbResult, settings }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);

  if (!bbResult) return null;
  const { pair1, pair2 } = bbResult;
  const { bestBallValue: bbVal, worstBallValue: wbVal } = settings;
  const p1Name = pairLabel(pair1);
  const p2Name = pairLabel(pair2);
  const p1Round = roundTeamPts(bbResult, 1, bbVal, wbVal);
  const p2Round = roundTeamPts(bbResult, 2, bbVal, wbVal);
  const roundWinner = p1Round > p2Round ? 1 : p2Round > p1Round ? 2 : 0;
  return (
    <View style={s.liveMatch}>
      <Text style={s.liveMatchTitle}>Match Score</Text>
      <View style={s.liveRow}>
        <Text style={[s.liveName, roundWinner === 1 && s.liveWin]}>{p1Name}</Text>
        <Text style={[s.liveScore, roundWinner === 1 && s.liveWin]}>{p1Round}</Text>
        <Text style={s.liveDash}>-</Text>
        <Text style={[s.liveScore, roundWinner === 2 && s.liveWin]}>{p2Round}</Text>
        <Text style={[s.liveName, s.liveNameRight, roundWinner === 2 && s.liveWin]}>{p2Name}</Text>
      </View>
    </View>
  );
}
