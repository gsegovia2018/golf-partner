import React, {
  useEffect, useRef, useState, useCallback, useMemo, useSyncExternalStore,
} from 'react';
import { useFocusEffect, CommonActions } from '@react-navigation/native';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, Platform, Animated,
  ActivityIndicator, Alert,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import { haptic } from '../lib/haptics';

import { Feather } from '@expo/vector-icons';
import * as ScreenOrientation from 'expo-screen-orientation';

import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { autoAdvanceAction } from '../lib/autoAdvance';
import { getAppSettings } from '../store/settingsStore';
import { useAppSettings } from '../hooks/useAppSettings';
import {
  loadTournament, subscribeTournamentChanges,
  calcBestWorstBall, DEFAULT_SETTINGS,
  roundPairClinched, setScoringModeRoundPatches,
  isRoundComplete, isTournamentFinished,
  getActiveTournamentSnapshot, getTournament, getTournamentSnapshot,
  deriveMeIdFromAuth,
} from '../store/tournamentStore';
import { isOnline } from '../lib/connectivity';
import { mutate } from '../store/mutate';
import { fetchPlayers } from '../store/libraryStore';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import MediaLightbox from '../components/MediaLightbox';
import BottomSheet from '../components/BottomSheet';
import SyncStatusSheet from '../components/SyncStatusSheet';
import useMediaAttachFlow from '../hooks/useMediaAttachFlow';
import { useRoundMedia } from '../hooks/useRoundMedia';
import { useOfficialRound } from '../hooks/useOfficialRound';
import ScoringModeChangeBanner from '../components/ScoringModeChangeBanner';
import { setupSignature, describeSetupChange } from './setupChangeNotice';
import ScoringModeChangeSheet from '../components/ScoringModeChangeSheet';
import { fallbackNoticeText } from '../components/scoringModes';
import { cardDiscrepancyHoles, officialHolesFromCourse } from '../store/officialScoring';
import { buildLeaderboard } from '../store/officialLeaderboard';
import { attestCard } from '../store/officialStore';
import { notifyRoundFinished } from '../store/notificationStore';
import { normalizeRoundNotes } from '../store/roundNotes';
import {
  DEFAULT_SHOT,
  CELEBRATION_TIERS,
  celebrationFor,
} from '../components/scorecard/constants';
import {
  reconcileShotDetail, roundScoringMode, roundBestBallValues,
  clampScoreInput, resolvePlayerHandicap, holeCountOf,
} from '../store/scoring';
import {
  discrepancies, roundCells, scorerKeyOf, shownScores, unverifiedCells,
} from '../engine/cards';
import { getRoundState } from '../engine/store/roundState';
import {
  closeLive, getLastError, onSynced, openLive, pull, reconnect, schedulePush,
} from '../engine/store/replicator';
import { useRoundCards, useSyncStatus } from '../hooks/useRoundCards';
import { makeScorecardStyles } from '../components/scorecard/styles';
import { HoleView } from '../components/scorecard/HoleView';
import { GridView, resolveScorecardRows } from '../components/scorecard/GridView';
import { useRoundRoster } from '../hooks/useRoundRoster';
import ConflictWizardSheet from '../components/scorecard/ConflictWizardSheet';
import { FlagFinderView } from '../components/scorecard/FlagFinderView';
import TourOverlay from '../components/tour/TourOverlay';
import { SCORECARD_TOUR_STEPS } from '../components/tour/tourSteps';
import {
  findCourseGeometry, subscribeCourseGeometry, getCourseGeometryVersion,
} from '../lib/geo';
import { compassLikelyAvailable } from '../hooks/useCompassHeading';

// Stable empty roster so the useRoundRoster memo below does not see a new
// array identity on every render while the tournament is still loading.
const EMPTY_PLAYERS = [];
// Same reason, for the two maps official mode never fills in.
const EMPTY_SCORES = {};
const EMPTY_SHOT_DETAILS = {};




function usePrevious(value) {
  const ref = useRef(value);
  useEffect(() => { ref.current = value; }, [value]);
  return ref.current;
}

// How far this phone had already scored when a round is re-opened. The only
// evidence a fresh session has is MY OWN published card — never the shown
// card, which also carries whatever a peer published while this phone was
// closed. `myScores` is my card's entries as { [playerId]: { [hole]: n } }.
export function resumeVerifiedUpTo(holes, players, myScores) {
  let last = 0;
  for (const h of holes ?? []) {
    const marked = (players ?? []).some((p) => myScores?.[p.id]?.[h.number] != null);
    if (!marked) break;
    last = h.number;
  }
  return last;
}

// Where a re-opened round lands. A live round resumes at the first hole THIS
// phone hasn't marked — NOT at the first hole empty on the merged card. A
// scorer who opens the round after a peer filled the front nine still owes
// their own entries for those holes; landing where the peer's card ends would
// skip them past work only they can do.
// A round already complete — or a finished tournament — has nothing left to
// enter and still opens on the last hole, the way it always did.
export function resumeHole(holes, verifiedUpTo, { complete = false } = {}) {
  const lastHole = holes[holes.length - 1].number;
  if (complete) return lastHole;
  return holes.find((h) => h.number > verifiedUpTo)?.number ?? lastHole;
}

// Clamp a raw entered stroke count for one hole to the recordable range
// [1, pickup], per the silent-clamp product decision. Shared by both entry
// paths (setScore text field + stepScore +/-) so they can never diverge, and
// exported so the clamp — including the handicap-fallback edge case — is unit
// testable without mounting the whole screen. Handicap is resolved via the
// SAME resolvePlayerHandicap fallback the store setter uses: a round with no
// per-player handicap entry (legacy / pre-normalization) falls back to the
// player's base handicap, NOT scratch, so a legitimately high score with real
// extra shots isn't over-clamped. Returns the raw value untouched when the
// hole can't be found (defensive) — including a cleared cell (null/undefined),
// which clampScoreInput itself passes through.
export function clampEnteredScore(round, players, playerId, holeNumber, rawValue) {
  const hole = round?.holes?.find((h) => h.number === holeNumber);
  if (!hole) return rawValue;
  return clampScoreInput(
    rawValue, hole.par, resolvePlayerHandicap(round, players, playerId), hole.strokeIndex,
    holeCountOf(round),
  );
}

export function getScorecardBackTarget({
  official,
  viewOnly,
  canGoBack,
  requestedBackTarget,
}) {
  if (official) return 'previous';
  if (requestedBackTarget === 'tournament') return 'tournament';
  if (requestedBackTarget === 'home') return 'home';
  if (viewOnly) return 'home';
  return canGoBack ? 'previous' : 'tournament';
}

export function buildScorecardTournamentBackState(state) {
  return {
    ...state,
    routes: [
      { name: 'Main', params: { screen: 'Home', params: { viewMode: 'list' } } },
      { name: 'Tournament', params: { viewMode: 'tournament' } },
    ],
    index: 1,
  };
}

export function shouldMarkTournamentFinishedFromScorecard({ tournament }) {
  if (!tournament || tournament.kind === 'official') return false;
  return tournament.kind === 'game';
}

export function canShowQuickFinish({ tournament, official, viewOnly }) {
  return !official && !viewOnly && tournament?.kind === 'game';
}

// The one adapter from the engine's `discrepancies(round)` output to the
// ConflictWizardSheet row shape. Every conflict surface — the leave-hole
// prompt, the peer-arrival prompt and the finish gate — filters this list
// rather than deriving its own rows, so a resolution recorded on any phone
// clears the row everywhere on the next render.
// `authorId` on a candidate is the engine's scorerKey; the sheet renders the
// ones in `localAuthorIds` as "You". A blank is not an opinion (blank rule),
// so `blankAuthors` is always empty here.
export function buildConflictRows({ disputes, cells, round, players, names }) {
  const rows = [];
  for (const { hole, rows: holeRows } of disputes ?? []) {
    for (const { playerId, values } of holeRows) {
      rows.push({
        playerId,
        hole,
        par: round?.holes?.[hole - 1]?.par ?? null,
        playerName: (players ?? []).find((p) => p.id === playerId)?.name ?? 'Player',
        currentValue: cells?.[playerId]?.[String(hole)]?.shown ?? null,
        candidates: values.map((v) => ({
          value: v.value,
          ts: v.ts,
          authorId: v.scorerKey,
          authorName: v.name ?? names?.[v.scorerKey] ?? 'Another phone',
        })),
        blankAuthors: [],
      });
    }
  }
  return rows;
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
  const requestedBackTarget = route.params?.backTarget ?? null;
  const routeTournamentId = official ? null : route.params?.tournamentId ?? null;
  const initialTournament = useMemo(
    () => (official
      ? null
      : routeTournamentId
        ? getTournamentSnapshot(routeTournamentId)
        : getActiveTournamentSnapshot()),
    [official, routeTournamentId],
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
  // Notes object: { round: string, hole: { [holeNumber]: string } }.
  const [notes, setNotes] = useState(() => {
    return normalizeRoundNotes(initialRound?.notes);
  });
  // Mirrored so retrySave can re-push the round note without being
  // re-created on every keystroke.
  const notesRef = useRef(notes);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [flagFinderOpen, setFlagFinderOpen] = useState(false);
  const [view, setView] = useState('hole'); // 'grid' | 'hole'
  const [currentHole, setCurrentHole] = useState(1);
  const currentHoleRef = useRef(1);
  useEffect(() => { currentHoleRef.current = currentHole; }, [currentHole]);
  // Where a blocked hole change is going: the leave-hole conflict prompt has
  // to hold the move until the scorer answers it. Null means "next hole".
  const pendingHoleRef = useRef(null);
  const autoAdvanceTimer = useRef(null);
  useEffect(() => () => { if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current); }, []);
  // goToNextHole is declared later (it needs state defined further down) but
  // setScore/stepScore — declared earlier — must schedule against it. A ref
  // sidesteps the ordering conflict instead of hoisting goToNextHole up.
  const goToNextHoleRef = useRef(() => {});
  const [refreshing, setRefreshing] = useState(false);
  const [saveError, setSaveError] = useState(false);
  // 'loading' until the first loadTournament resolves; 'error' if it returned
  // null (or threw); 'ready' once a tournament is in hand.
  const [loadState, setLoadState] = useState(() => (initialTournament && initialRound ? 'ready' : 'loading'));
  // Live replication status from the card engine
  // ('idle' | 'pending' | 'syncing' | 'error').
  const syncStatus = useSyncStatus();
  // Round-complete celebration overlay before navigating to the summary.
  const [roundCompleteVisible, setRoundCompleteVisible] = useState(false);
  const [finishBusy, setFinishBusy] = useState(false);
  // The finish gate sets this to { hole, playerId } to send the user to a
  // conflicted hole; HoleView consumes it to open the resolve sheet.
  const [conflictFocus, setConflictFocus] = useState(null);
  const clearConflictFocus = useCallback(() => setConflictFocus(null), []);
  // Finish-time conflict summary sheet (Task 5) — open while handleFinish is
  // blocked on unresolved score conflicts after the final flush.
  const [finishConflictsOpen, setFinishConflictsOpen] = useState(false);
  // Mid-round conflict prompt: 'leave' = leave-hole verification for one hole,
  // 'peer' = a synced conflict that surfaced from another scorer's entries.
  const [holeConflictPrompt, setHoleConflictPrompt] = useState(null); // { source, hole? }
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
  // Keyed debounce timers for notes: key is 'round' or `h<holeNumber>`, so a
  // hole-note edit and a round-note edit never cancel each other's save.
  const notesSaveTimeoutsRef = useRef({});
  // Serializes the setup-blob writes (notes, "who am I", finished stamps) so
  // concurrent edits never race over the same tournament blob.
  const saveChainRef = useRef(Promise.resolve());
  // True while a note edit has not been written yet: a reload that lands in
  // that window must not put the pre-keystroke text back on screen.
  const notesDirtyRef = useRef(false);
  const scoreAnims = useRef({});
  const hasAutoJumpedRef = useRef(false);
  const [celebration, setCelebration] = useState({
    playerId: null, holeNumber: null, label: null, delta: null,
  });
  const celebrationAnim = useRef(new Animated.Value(0)).current;
  const reducedMotion = useReducedMotion();
  const [lightboxItems, setLightboxItems] = useState([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxVisible, setLightboxVisible] = useState(false);
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

  // The setup layer only: roster, rounds, courses, handicaps, notes. Scores
  // and shot detail come from the card engine (useRoundCards below) and are
  // never read out of the tournament blob here.
  //
  // `refreshRemote: false` re-reads the local cache WITHOUT kicking a remote
  // fetch. Every reload driven by a store change event must use it: the fetch
  // saves, the save emits another change event, and that event reloads and
  // fetches again.
  const reload = useCallback(async ({ refreshRemote = true } = {}) => {
    // Official mode does not use the casual tournament blob — its data
    // comes from useOfficialRound (Supabase RPC). The casual load path is
    // skipped entirely; the official-derived tournament is wired in below.
    if (official) return;
    let t;
    try {
      t = routeTournamentId
        ? await getTournament(routeTournamentId, { refreshRemote })
        : await loadTournament({ refreshRemote });
    } catch (e) {
      console.warn('ScorecardScreen: tournament load failed', e);
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
    setTournament(t);
    // Normalize notes to the { round, hole } object shape. Legacy data may
    // have stored a bare string — treat that as the round-level note. A note
    // still being typed outranks the snapshot until its save has landed.
    if (!notesDirtyRef.current) setNotes(normalizeRoundNotes(t.rounds[idx]?.notes));
    return t;
  }, [paramRoundIndex, official, routeTournamentId]);

  useEffect(() => {
    const unsub = subscribeTournamentChanges((changedId) => {
      // Ignore other tournaments entirely — a Home list refresh used to
      // re-render the live scorecard. An ABSENT id is the store's "unspecified"
      // broadcast (active-tournament switch, delete): always reload on those.
      const myId = routeTournamentId ?? tournamentRef.current?.id;
      if (changedId && myId && changedId !== myId) return;
      reload({ refreshRemote: false });
    });
    return unsub;
  }, [reload, routeTournamentId]);

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

  // Append a setup-blob save to the serial chain. Each unit reads
  // tournamentRef at execution time (after preceding units have committed),
  // so it sees a fresh baseline.
  const enqueueSave = useCallback((unit) => {
    const nextSave = saveChainRef.current
      .then(unit)
      .then((result) => {
        setSaveError(false);
        return result;
      })
      .catch((e) => {
        // A local save failing (e.g. AsyncStorage full) is rare but must not
        // be silent — the user would believe the edit was recorded.
        console.warn('ScorecardScreen: save failed', e);
        setSaveError(true);
        throw e;
      });
    saveChainRef.current = nextSave.catch(() => undefined);
    return nextSave;
  }, []);

  // Author identity for score writes. Declared BEFORE autoSave/resolveConflict
  // because those useCallbacks list `authorId` in their dependency arrays,
  // which React evaluates at render time — declaring it further down would be a
  // temporal-dead-zone ReferenceError that crashes the scorecard on mount.
  // Row order puts "me" first (playersMeFirst), so meId decides where every
  // card sits. It MUST be known on the very first paint: the async fallbacks
  // below (pickMe from the roster match, and the legacy path that only settles
  // after a fetchPlayers() round-trip) used to land AFTER the rows had already
  // rendered in roster order, visibly reshuffling the cards mid-round —
  // "jumping between players" while someone else was scoring.
  //
  // deriveMeIdFromAuth is pure and needs only the roster's embedded user_id
  // plus the signed-in account, both available synchronously here, so derive
  // it at render time instead of waiting on a round-trip. The async paths
  // still run (they persist meId and cover legacy rounds whose players predate
  // user_id), but in the normal case they now agree with what is already on
  // screen instead of moving it.
  const meId = useMemo(() => {
    if (tournament?.meId) return tournament.meId;
    if (!tournament || !user?.id) return null;
    return deriveMeIdFromAuth(tournament, user.id)?.meId ?? null;
  }, [tournament, user?.id]);
  // Latch the last known meId so a transient identity blip mid-round (a
  // fetch-derived blob that lost meId while the auth session is offline)
  // can't flip score stamping back to the device id — the same physical
  // round must never write under two author ids. Render-time ref write is
  // deliberate: an effect would lag one render, and a tap during that
  // render would stamp the device id.
  const lastMeIdRef = useRef(null);
  if (meId) lastMeIdRef.current = meId;

  // Debounced note save shared by round-level and per-hole notes. `key`
  // identifies the debounce timer ('round' or `h<n>`); `mutation` carries the
  // scope-specific `note.set` fields.
  const scheduleNoteSave = useCallback((key, mutation) => {
    if (notesSaveTimeoutsRef.current[key]) {
      clearTimeout(notesSaveTimeoutsRef.current[key]);
    }
    // Hold notesDirtyRef across the debounce window too, so a reload that
    // arrives between keystroke and timeout doesn't wipe the in-progress
    // text from React state.
    notesDirtyRef.current = true;
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
      }).finally(() => {
        if (Object.keys(notesSaveTimeoutsRef.current).length === 0) {
          notesDirtyRef.current = false;
        }
      });
    }, 400);
  }, [roundIndex, enqueueSave]);

  // Re-attempt after a failed write. Score entries live in the card engine,
  // which retries its own pushes with backoff — all this has to re-drive is
  // the round note and a push kick.
  const retrySave = useCallback(() => {
    const roundNote = notesRef.current?.round;
    if (roundNote != null) {
      scheduleNoteSave('round', { scope: 'round', text: roundNote });
    }
    schedulePush();
  }, [scheduleNoteSave]);

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

  // Persist which player is "me" (drives shot-detail tracking). Routed
  // through the serial save chain like every other whole-blob writer: an
  // in-flight score-save unit clones and re-persists the tournament it
  // captured at execution time, so a pick running OUTSIDE the chain could
  // land between that capture and its saveLocal and be overwritten by the
  // pre-pick meId. Inside the chain, the pick commits tournamentRef first
  // and the next unit diffs from the post-pick state.
  const pickMe = useCallback((playerId) => enqueueSave(async () => {
    if (!tournamentRef.current) return null;
    const t = await mutate(tournamentRef.current, {
      type: 'tournament.setMe',
      meId: playerId,
    });
    tournamentRef.current = t;
    setTournament(t);
    return t;
  }), [enqueueSave]);

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

  // Hoist memoised derivations above the early return so the hook order
  // stays stable while the tournament loads.
  const round = tournament?.rounds?.[roundIndex] ?? null;
  // A roster player this round still references but `tournament.players` has
  // lost is named back from the local player library — see recoverRoundRoster
  // (store/scoring.js). Without it the slot renders with no name at all.
  const players = useRoundRoster(round, tournament?.players ?? EMPTY_PLAYERS);

  // ── The card engine: the single source of every casual score on screen ──
  // One card per scorer, my unpublished draft on top, agreements anchored to
  // card versions (docs/superpowers/plans/2026-09-04-scorecard-cards-engine.md).
  // There is no React copy of the scores and no dirty set: `state` IS the data.
  const tid = official ? null : tournament?.id ?? null;
  const { state: cardState, actions } = useRoundCards(tid, round?.id ?? null);
  const playerIds = useMemo(() => players.map((p) => p.id), [players]);
  const holeNumbers = useMemo(() => (round?.holes ?? []).map((h) => h.number), [round]);
  // scorerKey → display name, for "who said what" in the discrepancy sheet.
  // A card names the roster player it scores as; anything else is a phone we
  // cannot put a name to (plan §3.1).
  const names = useMemo(() => {
    const out = {};
    for (const [authorIdKey, card] of Object.entries(cardState.cardsByAuthor)) {
      const scorerKey = scorerKeyOf(card, authorIdKey);
      const player = players.find((p) => p.id === card?.scorer?.playerId);
      out[scorerKey] = player?.name ?? 'Another phone';
    }
    return out;
  }, [cardState.cardsByAuthor, players]);
  const ctx = useMemo(() => ({ ...cardState, names }), [cardState, names]);
  // The identity my own card scores under: the signed-in user if known, else
  // this device. The wizard renders it as "You".
  const myScorerKey = useMemo(
    () => scorerKeyOf(cardState.cardsByAuthor[cardState.myAuthorId], cardState.myAuthorId),
    [cardState.cardsByAuthor, cardState.myAuthorId],
  );
  const localAuthorIds = useMemo(() => [myScorerKey].filter(Boolean), [myScorerKey]);

  const cells = useMemo(
    () => roundCells(ctx, playerIds, holeNumbers),
    [ctx, playerIds, holeNumbers],
  );
  // What MY phone counts in every mode (R6): my draft, then my published
  // entry, then a peer's — see cards.js `shown`.
  const cardScores = useMemo(
    () => shownScores(ctx, playerIds, holeNumbers),
    [ctx, playerIds, holeNumbers],
  );
  // Cells only a peer has marked. They render as a greyed ghost with the
  // scorer's name, never as a value of mine (R3).
  const unverified = useMemo(
    () => unverifiedCells(ctx, playerIds, holeNumbers),
    [ctx, playerIds, holeNumbers],
  );
  const disputes = useMemo(
    () => discrepancies(ctx, playerIds, holeNumbers),
    [ctx, playerIds, holeNumbers],
  );
  // The card as I have marked it: `shown` minus the cells only a peer marked.
  // This is what the hole pages render and what score entry steps from, so a
  // peer's value can never pre-fill a cell I still owe.
  const myScores = useMemo(() => {
    // Official has its own self/marker model, and a view-only round is being
    // read, not scored — both keep the merged card with no ghosting.
    if (official || viewOnly) return null;
    const out = {};
    for (const [playerId, byHole] of Object.entries(cells)) {
      for (const [h, cell] of Object.entries(byHole)) {
        if (cell.shown == null || cell.status === 'unverified') continue;
        if (!out[playerId]) out[playerId] = {};
        out[playerId][h] = cell.shown;
      }
    }
    return out;
  }, [official, viewOnly, cells]);
  // Ghost labels, `{ [playerId]: { [hole]: scorerName } }`, alongside the
  // ghost values the hole page reads out of `scores`.
  const ghostAuthors = useMemo(() => {
    const out = {};
    for (const { playerId, hole, scorerKey } of unverified) {
      if (!out[playerId]) out[playerId] = {};
      out[playerId][String(hole)] = names[scorerKey] ?? 'Another phone';
    }
    return out;
  }, [unverified, names]);
  // Disputed cells and holes. Both are memoised on a content signature, not
  // on `disputes`, so an unrelated tap does not hand every hole page a fresh
  // Set and re-render all 18 of them (see holePagePropsEqual).
  const disputeSignature = disputes
    .map(({ hole, rows }) => rows.map((r) => `${r.playerId}:${hole}`).join(','))
    .join('|');
  const conflictCells = useMemo(
    () => new Set(disputeSignature ? disputeSignature.split(/[|,]/) : []),
    [disputeSignature],
  );
  const conflictHoles = useMemo(
    () => new Set([...conflictCells].map((k) => Number(k.split(':')[1]))),
    [conflictCells],
  );

  // Every score on screen. Official mode keeps its own RPC-derived map.
  const scores = official ? (officialScores ?? EMPTY_SCORES) : cardScores;
  // Shot detail for my card: what I published, with the hole I am on
  // overlaid from the draft. Keyed by player like `scores` for generality,
  // though in practice only "me" has entries.
  const shotDetails = useMemo(() => {
    if (official) return EMPTY_SHOT_DETAILS;
    const out = {};
    const put = (h, playerId, detail) => {
      if (detail == null) return;
      if (!out[playerId]) out[playerId] = {};
      out[playerId][h] = detail;
    };
    const myCard = cardState.cardsByAuthor[cardState.myAuthorId];
    for (const [h, holeEntry] of Object.entries(myCard?.holes ?? {})) {
      for (const [playerId, detail] of Object.entries(holeEntry.shots ?? {})) put(h, playerId, detail);
    }
    for (const [h, holeDraft] of Object.entries(cardState.draft ?? {})) {
      for (const [playerId, detail] of Object.entries(holeDraft.shots ?? {})) put(h, playerId, detail);
    }
    return out;
  }, [official, cardState.cardsByAuthor, cardState.myAuthorId, cardState.draft]);

  // Flag finder header icon: shown only when the round's course has mapped
  // geometry (holes/pins) and the device has a compass worth trying. Geometry
  // hydrates asynchronously from Supabase, so subscribe the same way
  // useGpsDistances does — the bundled seed resolves first, live data swaps
  // in via geomVersion.
  const geomVersion = useSyncExternalStore(subscribeCourseGeometry, getCourseGeometryVersion);
  const hasCourseGeometry = useMemo(
    () => !!findCourseGeometry(round?.courseName),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [round?.courseName, geomVersion],
  );
  const showFlagFinder = hasCourseGeometry && compassLikelyAvailable();

  // Lock a freshly opened finished round to view-only. "Finished" means
  // either this specific round has every player scored on every hole, OR the
  // parent tournament/game was explicitly archived (`finishedAt` set) — a
  // game can be finished early without filling in the remaining holes.
  // Re-runs only when the displayed round changes (different round id), so
  // local edits made after "Edit round" don't silently re-lock when the last
  // score lands.
  useEffect(() => {
    if (official) return;
    if (!round || !players.length || !cardState.loaded) return;
    if (viewOnlyInitRoundIdRef.current === round.id) return;
    viewOnlyInitRoundIdRef.current = round.id;
    const finished = isRoundComplete({ ...round, scores }, players) || !!tournament?.finishedAt;
    setViewOnly(finished);
  }, [official, round, players, scores, cardState.loaded, tournament?.finishedAt]);

  // Where a re-opened round lands: the first hole MY card has not marked.
  // Runs once per round, and only once the cards are off disk — before that
  // my card looks empty and every round would open on hole 1.
  useEffect(() => {
    if (official || hasAutoJumpedRef.current) return;
    if (!round?.holes?.length || !players.length || !cardState.loaded) return;
    hasAutoJumpedRef.current = true;
    const myCard = cardState.cardsByAuthor[cardState.myAuthorId];
    const mine = {};
    for (const [h, holeEntry] of Object.entries(myCard?.holes ?? {})) {
      for (const [playerId, value] of Object.entries(holeEntry.entries ?? {})) {
        if (!mine[playerId]) mine[playerId] = {};
        mine[playerId][h] = value;
      }
    }
    const marked = resumeVerifiedUpTo(round.holes, players, mine);
    setCurrentHole(resumeHole(round.holes, marked, {
      complete: isRoundComplete({ ...round, scores }, players) || !!tournament?.finishedAt,
    }));
  }, [official, round, players, scores, cardState, tournament?.finishedAt]);
  const settings = useMemo(
    () => ({
      ...DEFAULT_SETTINGS,
      ...(tournament?.settings ?? {}),
      ...(tournament && round ? roundBestBallValues(tournament, round) : {}),
    }),
    [tournament, round],
  );
  // Guard on `tournament` (not just call roundScoringMode unconditionally) so
  // this stays `undefined` before the tournament loads — the mode-change
  // notice effect below relies on that undefined→defined transition NOT
  // counting as a "mode changed" edge (roundScoringMode always falls back to
  // 'stableford', which would otherwise fire a false notice on cold loads of
  // tournaments whose real mode isn't stableford).
  const settingsMode = tournament ? roundScoringMode(tournament, round) : undefined;
  const currentMode = settingsMode ?? 'stableford';
  const prevSettingsMode = usePrevious(settingsMode);
  const [noticeMessage, setNoticeMessage] = useState(null);
  const [roundDecisionNotice, setRoundDecisionNotice] = useState(null);
  const [reopenPrompt, setReopenPrompt] = useState(false);
  const dismissModeNotice = useCallback(() => setNoticeMessage(null), []);

  // Setup that changed under us from ANOTHER phone (plan §6, fix 1): roster,
  // order, teams, course, handicaps. The scorecard cannot edit those itself,
  // so while it is focused any such change in the tournament it renders came
  // in through the setup sync from a peer. The baseline is the signature
  // seen right after the focus reload (this phone's own edits made on other
  // screens arrive with that reload and must not read as a peer's); the one
  // setup edit this screen can dispatch, the scoring-mode change, stamps
  // `localSetupEditRef` so the pairs it rebuilds are not announced either.
  const [setupNotice, setSetupNotice] = useState(null);
  const dismissSetupNotice = useCallback(() => setSetupNotice(null), []);
  const setupBaselineRef = useRef(null);
  const localSetupEditRef = useRef(0);
  useEffect(() => {
    if (official || !tournament || !setupBaselineRef.current) return;
    const sig = setupSignature(tournament, roundIndex);
    const msg = describeSetupChange(setupBaselineRef.current, sig);
    setupBaselineRef.current = sig;
    if (!msg) return;
    if (Date.now() - localSetupEditRef.current < 5000) return;
    setSetupNotice(msg);
  }, [official, tournament, roundIndex]);
  const dismissRoundDecisionNotice = useCallback(() => setRoundDecisionNotice(null), []);
  const openModeSheet = useCallback(() => setReopenPrompt(true), []);

  useEffect(() => {
    if (prevSettingsMode && settingsMode && prevSettingsMode !== settingsMode) {
      setNoticeMessage(fallbackNoticeText(prevSettingsMode, settingsMode));
    }
  }, [prevSettingsMode, settingsMode]);

  const isBestBall = roundScoringMode(tournament, round) === 'bestball';
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

  // Name the scorer this device writes as, so "who said what" resolves to a
  // roster player and two devices on one account fold into one scorer
  // (plan §3.1). Idempotent — the store ignores an unchanged identity.
  useEffect(() => {
    if (official || !tid) return;
    const playerId = meId ?? lastMeIdRef.current ?? null;
    if (!playerId && !user?.id) return;
    actions.identify({ playerId, userId: user?.id ?? null }).catch(() => {});
  }, [official, tid, meId, user?.id, actions]);

  // Replication for the open tournament: one realtime channel while the
  // screen is mounted, a pull on focus and every 20 s while focused and
  // online. Pushes are the replicator's own business (started in App.js) and
  // span every live game, not just this one.
  useFocusEffect(
    useCallback(() => {
      if (official || !tid || !round?.id) return undefined;
      openLive(tid);
      const pullNow = () => { if (isOnline()) pull(tid, round.id).catch(() => {}); };
      pullNow();
      const interval = setInterval(pullNow, 20000);
      return () => clearInterval(interval);
    }, [official, tid, round?.id]),
  );
  // Setup (roster, teams, courses, notes) refreshes on focus only — never on
  // a timer while a scorecard is open (plan §6.1).
  useFocusEffect(useCallback(() => {
    // Re-arm the setup-change baseline from what the focus reload brings in:
    // teams or roster edited on this phone's other screens are not "another
    // phone". Until the reload lands, nothing is compared.
    setupBaselineRef.current = null;
    reload().then((t) => {
      if (t) setupBaselineRef.current = setupSignature(t, paramRoundIndex ?? t.currentRound ?? 0);
    }).catch(() => {});
  }, [reload, paramRoundIndex]));
  useEffect(() => () => { closeLive(); }, []);

  // Hold time and haptic come from the tier, not from a chain here. The old
  // chain ended in `else 1800 // HOLE IN ONE`, which silently gave NOELADA the
  // longest hold of any tier, and it fired haptic('success') for every result
  // including a double bogey.
  // `toPar`, not `delta`: `stepScore` already has a `delta` in scope that means
  // the stepper increment (±1), and the two must never be confused. The state
  // field stays `delta` because CelebrationToast reads it under that name.
  const triggerCelebration = useCallback((playerId, holeNumber, label, toPar) => {
    const tier = CELEBRATION_TIERS[label] ?? CELEBRATION_TIERS.BIRDIE;
    haptic(tier.haptic);
    celebrationAnim.stopAnimation();
    celebrationAnim.setValue(0);
    setCelebration({ playerId, holeNumber, label, delta: toPar });
    // Reduced motion: cut to shown, hold, cut away — the spring/scale/ring
    // ride on this value, so zero-duration steps suppress all of them while
    // the overlay (and its live-region announcement) still happens.
    Animated.sequence([
      reducedMotion
        ? Animated.timing(celebrationAnim, { toValue: 1, duration: 0, useNativeDriver: true })
        : Animated.spring(celebrationAnim, {
          toValue: 1, friction: 6, tension: 80, useNativeDriver: true,
        }),
      Animated.delay(tier.holdMs),
      Animated.timing(celebrationAnim, {
        toValue: 0, duration: reducedMotion ? 0 : 420, useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setCelebration({ playerId: null, holeNumber: null, label: null, delta: null });
    });
  }, [celebrationAnim, reducedMotion]);

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

  // Official-only: ranked NET Stableford leaderboard rows built from the
  // flat members / scores lists, using the round's real course holes for
  // par/stroke-index (see officialLeaderboard.js). Discrepancy holes are
  // excluded from each total and flagged on the row. Casual mode never
  // builds this.
  const officialLeaderboard = useMemo(() => {
    if (!official) return [];
    return buildLeaderboard({
      members: officialData.members ?? [],
      scores: officialData.scores ?? [],
      holes: officialHolesFromCourse(officialData.round?.course),
      format: 'net_stableford',
    });
  }, [official, officialData.members, officialData.scores, officialData.round]);

  // Live rows for every conflict surface, from the one adapter. Derived from
  // `disputes`, so a row disappears as soon as the cell is agreed — by this
  // phone or by any other.
  const conflictRows = useMemo(
    () => buildConflictRows({ disputes, cells, round, players, names }),
    [disputes, cells, round, players, names],
  );
  // Agree a cell: the engine records the agreement against the exact card
  // versions it settles, so it lapses precisely when one of them republishes.
  const resolveConflict = useCallback((playerId, holeNumber, value) => {
    actions.resolve({ playerId, hole: holeNumber, value }).catch((e) => {
      console.warn('ScorecardScreen: resolve failed', e);
      setSaveError(true);
    });
  }, [actions]);

  // Every draft write runs on one serial chain. Two things depend on it: a
  // burst of taps must not interleave with the seeding read below, and a
  // publication must never overtake a tap it should have carried.
  const draftChainRef = useRef(Promise.resolve());
  const queueDraft = useCallback((unit) => {
    const next = draftChainRef.current.then(unit).then(
      (result) => { setSaveError(false); return result; },
      (e) => {
        // A local write failing (e.g. AsyncStorage full) is rare but must not
        // be silent — the user would believe the score was recorded.
        console.warn('ScorecardScreen: card write failed', e);
        setSaveError(true);
        throw e;
      },
    );
    draftChainRef.current = next.catch(() => undefined);
    return next;
  }, []);

  // Re-opening a hole I already published starts its draft from what I
  // published: a publication is the WHOLE hole (R7), so a draft holding only
  // the one cell I just changed would drop every other entry off the card.
  // Runs inside the draft chain, so it sees every write before it.
  const seedDraftFromCard = useCallback(async (holeNumber) => {
    if (!tid || !round?.id) return;
    const h = String(holeNumber);
    const st = getRoundState(tid, round.id);
    if (st.draft?.[h]) return;
    const mineHole = st.cardsByAuthor[st.myAuthorId]?.holes?.[h];
    if (!mineHole) return;
    for (const [playerId, value] of Object.entries(mineHole.entries ?? {})) {
      await actions.setDraftEntry(holeNumber, playerId, value);
    }
    for (const [playerId, detail] of Object.entries(mineHole.shots ?? {})) {
      await actions.setDraftShot(holeNumber, playerId, detail);
    }
  }, [tid, round?.id, actions]);

  const setShot = useCallback((playerId, holeNumber, patch) => {
    if (viewOnly || official) return;
    const current = shotDetails[playerId]?.[holeNumber] ?? DEFAULT_SHOT;
    const detail = { ...DEFAULT_SHOT, ...current, ...patch };
    queueDraft(async () => {
      await seedDraftFromCard(holeNumber);
      await actions.setDraftShot(holeNumber, playerId, detail);
    }).catch(() => {});
  }, [viewOnly, official, shotDetails, queueDraft, seedDraftFromCard, actions]);

  // When the me-player's strokes change, trim that hole's shot detail so the
  // logged putts/penalties/sand shots never exceed the new stroke total. A
  // cleared score (hold-to-clear / pickup un-toggle) deletes the detail
  // outright — it described strokes that no longer exist.
  // Returns what to write alongside the entry: `undefined` for "leave it
  // alone" (other players, no detail, already valid), null to delete it, or
  // the trimmed detail.
  const reconcileMeShot = useCallback((playerId, holeNumber, newStrokes) => {
    if (official || playerId !== meId) return undefined;
    const current = shotDetails[playerId]?.[holeNumber];
    if (!current) return undefined;
    if (newStrokes == null) return null;
    const reconciled = reconcileShotDetail(current, newStrokes);
    return reconciled === current ? undefined : reconciled;
  }, [official, meId, shotDetails]);

  // Schedule after each score write; a follow-up tap on the same hole resets
  // the timer so quick +/- adjustments land before the page flips. A write
  // for a hole other than the one on screen (a Grid-view edit elsewhere, or
  // a synced remote write) must NOT touch a countdown already pending for
  // the viewed hole — see autoAdvanceAction's 'ignore' case.
  const maybeAutoAdvance = useCallback((nextScores, holeNumber) => {
    // Scramble modes store scores under the team captain only; rowPlayers
    // collapses to those captain-keyed team units so holeComplete checks the
    // rows that actually hold scores (plain `players` would never be "every
    // player scored" in a scramble round, leaving auto-advance permanently
    // inert there).
    const { rowPlayers } = resolveScorecardRows({ round, settings, players, meId });
    const action = autoAdvanceAction({
      enabled: getAppSettings().autoAdvanceHole,
      holeNumber,
      currentHole: currentHoleRef.current,
      maxHole: round?.holes?.length ?? 18,
      // Casual mode judges "hole complete" on MY card: a peer's unverified
      // entries must not complete the hole for a scorer who hasn't marked
      // everyone yet (they'd be advanced past their own blank cells).
      scores: nextScores,
      players: rowPlayers,
    });
    if (action === 'ignore') return;
    if (autoAdvanceTimer.current) { clearTimeout(autoAdvanceTimer.current); autoAdvanceTimer.current = null; }
    if (action === 'cancel') return;
    autoAdvanceTimer.current = setTimeout(() => {
      if (currentHoleRef.current === holeNumber) goToNextHoleRef.current();
    }, 1200);
  }, [round, players, settings, meId]);

  // One entry, written to the private draft for the hole. It reaches nobody
  // until the scorer leaves the hole (R1, R2).
  const writeEntry = useCallback((playerId, holeNumber, value, shotDetail) => {
    lastWriteRef.current.set(`${playerId}:${holeNumber}`, value ?? null);
    queueDraft(async () => {
      await seedDraftFromCard(holeNumber);
      await actions.setDraftEntry(holeNumber, playerId, value ?? null);
      if (shotDetail !== undefined) {
        await actions.setDraftShot(holeNumber, playerId, shotDetail);
      }
    }).catch(() => {});
  }, [queueDraft, seedDraftFromCard, actions]);

  // The card the scorer can SEE for a cell — my entries, plus anything
  // already agreed. Entry has to start from that: stepping "+" on a ghosted
  // cell must open at par like any other blank, not at the peer's number.
  const visibleScores = official ? scores : (myScores ?? scores);

  // What this screen last wrote for a cell, held only until the store echoes
  // it back. Entry is synchronous; the draft write is not, so two quick taps
  // on the stepper would otherwise both step from the same pre-tap value.
  // It is an input buffer, never a render source — the cards are still drawn
  // from the engine alone.
  const lastWriteRef = useRef(new Map());
  useEffect(() => {
    for (const [key, value] of lastWriteRef.current) {
      const [playerId, h] = key.split(':');
      if ((visibleScores[playerId]?.[h] ?? null) === (value ?? null)) {
        lastWriteRef.current.delete(key);
      }
    }
  }, [visibleScores]);
  const currentEntry = useCallback((playerId, holeNumber) => {
    const key = `${playerId}:${holeNumber}`;
    if (lastWriteRef.current.has(key)) return lastWriteRef.current.get(key);
    return visibleScores[playerId]?.[holeNumber];
  }, [visibleScores]);

  const setScore = useCallback((playerId, holeNumber, value) => {
    if (!official && viewOnly) return;
    const rawParsed = value === '' ? undefined : parseInt(value, 10) || undefined;
    const holePar = round?.holes?.find((h) => h.number === holeNumber)?.par ?? 4;
    // Clamp a raw typed entry to [1, pickup] right here — the product
    // decision is a silent clamp (no interruption), and doing it before the
    // write below means the field itself shows the corrected number instead
    // of briefly displaying "44" for a fat-fingered "4". This call is also
    // what protects the OFFICIAL-mode path, which writes via officialWrite
    // straight to the RPC layer.
    const parsed = clampEnteredScore(round, players, playerId, holeNumber, rawParsed);
    const current = currentEntry(playerId, holeNumber);

    // Official mode routes the write through the RPC layer; casual mode
    // writes the private draft for this hole.
    if (official) officialWrite(playerId, holeNumber, parsed);
    else writeEntry(playerId, holeNumber, parsed, reconcileMeShot(playerId, holeNumber, parsed));

    if (parsed != null && parsed !== current) {
      const label = celebrationFor(holePar, parsed);
      if (label) triggerCelebration(playerId, holeNumber, label, parsed - holePar);
    }
    maybeAutoAdvance({
      ...visibleScores,
      [playerId]: { ...visibleScores[playerId], [holeNumber]: parsed },
    }, holeNumber);
  }, [round, players, triggerCelebration, official, officialWrite, writeEntry,
    reconcileMeShot, viewOnly, maybeAutoAdvance, visibleScores, currentEntry]);

  const stepScore = useCallback((playerId, holeNumber, delta) => {
    if (!official && viewOnly) return;
    haptic('light');
    const anim = getScoreAnim(playerId);
    anim.setValue(1.18);
    Animated.spring(anim, { toValue: 1, friction: 5, useNativeDriver: true }).start();

    const holePar = round?.holes?.find((h) => h.number === holeNumber)?.par ?? 4;
    const current = currentEntry(playerId, holeNumber);
    // First interaction on an un-scored hole: + lands on par, - lands on birdie.
    // After that, +/- step by one as usual. Minimum is 1 stroke; clamped to
    // the pickup ceiling too, so holding + past pickup can't run away to an
    // arbitrarily large gross stroke count.
    const rawNewStrokes = current == null
      ? (delta > 0 ? holePar : Math.max(1, holePar - 1))
      : Math.max(1, current + delta);
    const newStrokes = clampEnteredScore(round, players, playerId, holeNumber, rawNewStrokes);

    if (official) officialWrite(playerId, holeNumber, newStrokes);
    else writeEntry(playerId, holeNumber, newStrokes, reconcileMeShot(playerId, holeNumber, newStrokes));

    if (newStrokes !== current) {
      const label = celebrationFor(holePar, newStrokes);
      if (label) triggerCelebration(playerId, holeNumber, label, newStrokes - holePar);
    }
    maybeAutoAdvance({
      ...visibleScores,
      [playerId]: { ...visibleScores[playerId], [holeNumber]: newStrokes },
    }, holeNumber);
  }, [round, players, triggerCelebration, getScoreAnim, official, officialWrite, writeEntry,
    reconcileMeShot, viewOnly, maybeAutoAdvance, visibleScores, currentEntry]);

  const appSettings = useAppSettings();
  const showRunning = appSettings.showRunningScore && !appSettings.noSpoilers;

  useEffect(() => {
    if (!appSettings.keepAwake) return undefined;
    activateKeepAwakeAsync('scorecard').catch(() => {});
    return () => { try { deactivateKeepAwake('scorecard'); } catch { /* not held */ } };
  }, [appSettings.keepAwake]);

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
    const mode = roundScoringMode(tournament, round) === 'bestball' ? 'bestball' : 'stableford';
    const liveRound = { ...round, scores };
    lastClinchedPairRef.current = roundPairClinched(liveRound, players, settings, mode);
  }, [round, tournament, players, scores, settings]);

  const advanceHole = useCallback(() => {
    haptic('medium');
    // A manual tap here (or the auto-advance timer itself firing) should
    // cancel any other pending auto-advance — no double-hops.
    if (autoAdvanceTimer.current) { clearTimeout(autoAdvanceTimer.current); autoAdvanceTimer.current = null; }
    const maxHole = round?.holes?.length ?? 18;
    setCurrentHole((h) => Math.min(maxHole, h + 1));
    if (!round || !tournament) return;
    const mode = roundScoringMode(tournament, round) === 'bestball' ? 'bestball' : 'stableford';
    const clinched = roundPairClinched({ ...round, scores }, players, settings, mode);
    if (clinched != null && lastClinchedPairRef.current == null) {
      const pair = round.pairs?.[clinched];
      if (pair) {
        setRoundDecisionNotice(roundDecisionNoticeForPair(pair));
      }
    }
    lastClinchedPairRef.current = clinched;
  }, [round, tournament, players, scores, settings]);

  // Conflicts already prompted this session (playerId:hole). Declared here so
  // the leave-hole check can seed it before the mid-round sheet opens; the
  // auto-surface effect that reads/writes it lives below.
  const seenConflictKeysRef = useRef(new Set());

  // Move to the hole the blocked navigation was heading for.
  const proceedFromLeave = useCallback(() => {
    const target = pendingHoleRef.current;
    pendingHoleRef.current = null;
    if (target == null) advanceHole();
    else setCurrentHole(target);
  }, [advanceHole]);

  // Leaving a hole is publication (R1, R2, R7): the whole hole goes out as
  // one packet, and only then are the cards compared. Any cell on the hole I
  // just left where my published value disagrees with a peer's opens the
  // sheet BEFORE the pager moves. Returns whether the move may proceed.
  const leaveHole = useCallback(async (leavingHole) => {
    if (official || viewOnly || !round || !tid) return true;
    try {
      await queueDraft(() => actions.publishHole(leavingHole));
    } catch {
      // The publication did not land on disk; moving on would hide that.
      return false;
    }
    const st = getRoundState(tid, round.id);
    const rows = discrepancies({ ...st, names }, playerIds, [leavingHole]);
    if (!rows.length) return true;
    haptic('medium');
    for (const row of rows[0].rows) {
      seenConflictKeysRef.current.add(`${row.playerId}:${leavingHole}`);
    }
    setHoleConflictPrompt({ source: 'leave', hole: leavingHole });
    return false;
  }, [official, viewOnly, round, tid, queueDraft, actions, names, playerIds]);

  const goToNextHole = useCallback(async () => {
    pendingHoleRef.current = null;
    if (await leaveHole(currentHoleRef.current)) advanceHole();
  }, [leaveHole, advanceHole]);
  useEffect(() => { goToNextHoleRef.current = goToNextHole; }, [goToNextHole]);

  // Both the "Go to hole" picker and the pager's swipe settle land here, so
  // a swipe publishes exactly like tapping Next.
  const goToHole = useCallback(async (h) => {
    const leaving = currentHoleRef.current;
    if (h === leaving) return;
    haptic('light');
    if (autoAdvanceTimer.current) { clearTimeout(autoAdvanceTimer.current); autoAdvanceTimer.current = null; }
    pendingHoleRef.current = h;
    if (await leaveHole(leaving)) {
      pendingHoleRef.current = null;
      setCurrentHole(h);
    }
  }, [leaveHole]);

  // A peer's card or an agreement arrived: every newly disagreeing cell opens
  // one batched sheet. Nothing publishes here — arrivals never touch my draft.
  useEffect(() => {
    if (official || viewOnly || !round) return;
    const fresh = [];
    for (const { hole, rows } of disputes) {
      for (const row of rows) {
        const key = `${row.playerId}:${hole}`;
        if (!seenConflictKeysRef.current.has(key)) fresh.push(key);
      }
    }
    if (!fresh.length) return;
    // Never steal the screen from a prompt that is already up; the peer sheet
    // derives its rows live, so anything new folds into it on its own.
    if (finishConflictsOpen) return;
    if (holeConflictPrompt) {
      if (holeConflictPrompt.source === 'peer') {
        for (const key of fresh) seenConflictKeysRef.current.add(key);
      }
      return;
    }
    for (const key of fresh) seenConflictKeysRef.current.add(key);
    setHoleConflictPrompt({ source: 'peer', holes: disputes.length });
  }, [disputes, official, viewOnly, round, finishConflictsOpen, holeConflictPrompt]);

  // A reconnect pushed and pulled everything at once: open ONE sheet for the
  // whole backlog rather than letting each arriving row race the effect above.
  const disputesRef = useRef(disputes);
  useEffect(() => { disputesRef.current = disputes; }, [disputes]);
  useEffect(() => {
    if (official || viewOnly) return undefined;
    return onSynced(() => {
      const holes = disputesRef.current.length;
      if (!holes) return;
      setHoleConflictPrompt((prev) => prev ?? { source: 'peer', holes });
    });
  }, [official, viewOnly]);

  // Rows for the mid-round conflict sheet, filtered live out of the one
  // adapter so a resolution from either phone removes its row on the next
  // render. 'leave' shows the hole just published; 'peer' shows everything.
  const holeConflictRows = useMemo(() => {
    if (!holeConflictPrompt) return [];
    if (holeConflictPrompt.source === 'leave') {
      return conflictRows.filter((r) => r.hole === holeConflictPrompt.hole);
    }
    return conflictRows;
  }, [holeConflictPrompt, conflictRows]);

  // Once every row of an open mid-round prompt is settled — by this phone or
  // by a peer's agreement arriving — the sheet closes on its own. There is no
  // "all agreed" screen to dismiss: a leave prompt resumes the navigation it
  // was holding, a peer prompt simply goes away.
  useEffect(() => {
    if (!holeConflictPrompt || holeConflictRows.length > 0) return;
    const leave = holeConflictPrompt.source === 'leave';
    setHoleConflictPrompt(null);
    if (leave) proceedFromLeave();
    else pendingHoleRef.current = null;
  }, [holeConflictPrompt, holeConflictRows, proceedFromLeave]);

  // Back from the scorecard. The live center-tab action requests Tournament so
  // the user lands on the active round summary while a round is live. Other
  // in-progress casual scorecards usually have Tournament underneath in the
  // stack, so pop instead of navigating to a fresh Tournament route. Official
  // rounds come from JoinOfficial and need their own pop behavior preserved.
  const goBack = useCallback(() => {
    const target = getScorecardBackTarget({
      official,
      viewOnly,
      canGoBack: typeof navigation.canGoBack === 'function' && navigation.canGoBack(),
      requestedBackTarget,
    });
    if (target === 'previous') {
      navigation.goBack();
      return;
    }
    if (target === 'home') {
      navigation.navigate('Main', { screen: 'Home', params: { viewMode: 'list' } });
      return;
    }
    if (target === 'tournament' && typeof navigation.dispatch === 'function') {
      navigation.dispatch((state) => ({
        type: 'RESET',
        payload: buildScorecardTournamentBackState(state),
      }));
      return;
    }
    navigation.navigate('Tournament');
  }, [navigation, official, viewOnly, requestedBackTarget]);

  // Finish flow: invoked from the last-hole "Finish" button or the game-level
  // header flag. Shows a brief celebration, then routes to the round report.
  // Single-round games are explicitly archived so partial rounds count as done.
  const handleFinish = useCallback(async () => {
    if (finishBusy) return;
    const t = tournamentRef.current;
    const r = t?.rounds?.[roundIndex];
    if (!t || !r) { goBack(); return; }

    // Finish publishes the hole the scorer is standing on (R9), then pushes
    // and pulls once so the gate below sees every other phone's card.
    setFinishBusy(true);
    try {
      if (!official) {
        await queueDraft(() => actions.publishHole(currentHoleRef.current));
        if (isOnline()) await reconnect().catch(() => {});
      }
    } catch (err) {
      // A failed local write must not abort the finish silently — surface it
      // exactly like the finalize step's catch below.
      const message = err?.message ?? 'Could not finish this game.';
      if (Platform.OS === 'web') window.alert(message);
      else Alert.alert('Finish failed', message);
      return;
    } finally {
      setFinishBusy(false);
    }

    // A round cannot finish while a hole still has two cards disagreeing —
    // every hole must end on one agreed value. Cells only one scorer marked
    // are listed for information and never block (blank rule). The summary
    // sheet re-triggers handleFinish once the disputes are settled.
    if (!official && tid) {
      const st = getRoundState(tid, r.id);
      if (discrepancies({ ...st, names }, playerIds, holeNumbers).length > 0) {
        setFinishConflictsOpen(true);
        return;
      }
    }

    const freshT = tournamentRef.current ?? t;
    // Completion is judged on what this phone shows, not on the setup blob:
    // scores live in the card engine now.
    const liveRound = { ...r, scores };
    const players = freshT.players ?? [];
    const liveTournament = {
      ...freshT,
      rounds: freshT.rounds.map((rr, i) => (i === roundIndex ? liveRound : rr)),
    };
    const roundDone = isRoundComplete(liveRound, players);
    const tournamentDone = isTournamentFinished(liveTournament);
    const shouldMarkFinished = shouldMarkTournamentFinishedFromScorecard({
      tournament: freshT,
      tournamentDone,
    });

    // Finishing closes the scorecard, so the post-round screen must not sit
    // on top of it: reset the stack to Home → destination so Back lands on
    // Home rather than reopening the finished scorecard.
    const goAfterFinish = (name, params) => {
      navigation.dispatch(CommonActions.reset({
        index: 1,
        routes: [{ name: 'Main' }, { name, params }],
      }));
    };
    const goToSummary = () => goAfterFinish('RoundSummary', {
      tournamentId: freshT.id,
      roundId: liveRound.id,
    });

    setFinishBusy(true);
    try {
      // Stamp WHEN this round was finished. The feed orders on it, so it is
      // written once — a later edit by anyone (score fix, note, handicap)
      // must not resurface the round at the top of the feed. Official rounds
      // finish through attestation, not here.
      if (!official && freshT.kind !== 'official' && !liveRound.finishedAt) {
        const roundFinishedAt = new Date().toISOString();
        await enqueueSave(async () => {
          const base = tournamentRef.current ?? liveTournament;
          if (!base) return null;
          const updated = await mutate(base, {
            type: 'round.setFinished',
            roundId: liveRound.id,
            finishedAt: roundFinishedAt,
          });
          tournamentRef.current = updated;
          setTournament(updated);
          return updated;
        });
      }

      if (shouldMarkFinished && !freshT.finishedAt) {
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
      if (!official && freshT.kind !== 'official') {
        notifyRoundFinished({
          tournamentId: freshT.id,
          roundId: liveRound.id,
          roundIndex,
          tournamentName: freshT.name,
          courseName: liveRound.courseName,
        }).catch(() => {});
      }

      haptic('success');
      setRoundCompleteVisible(true);
      setTimeout(() => {
        setRoundCompleteVisible(false);
        setFinishBusy(false);
        if (tournamentDone && freshT.kind !== 'game' && !official) {
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
          if (!official && freshT.kind !== 'official') {
            goAfterFinish('MyStats', {
              tab: 'reportCard',
              roundKey: `${freshT.id}:${roundIndex}`,
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
  }, [roundIndex, navigation, goBack, official, finishBusy, enqueueSave, queueDraft, actions,
    tid, names, playerIds, holeNumbers, scores]);

  // The finish sheet closes itself the moment the last dispute is agreed (on
  // this phone or a peer's) and carries on with the finish — no "all agreed"
  // screen to tap through.
  useEffect(() => {
    if (!finishConflictsOpen || conflictRows.length > 0) return;
    setFinishConflictsOpen(false);
    handleFinish();
  }, [finishConflictsOpen, conflictRows, handleFinish]);

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

  const { openCaptureMenu: openCapturePicker, sheets: mediaSheets } = useMediaAttachFlow({
    tournament,
    defaultRoundIndex: roundIndex,
    defaultHoleIndex: typeof currentHole === 'number' ? currentHole - 1 : null,
    allowBatch: false,
    extraActions: roundMediaCount > 0 ? [{
      key: 'view',
      icon: 'image',
      label: `View this round's memories (${roundMediaCount})`,
      onPress: () => {
        setLightboxItems(roundMediaItems);
        setLightboxIndex(0);
        setLightboxVisible(true);
      },
    }] : [],
  });

  // Explicit load failure — never a blank screen. Keep a working back button.
  if (loadState === 'error' && !tournament) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        <View style={s.header}>
          <IconButton icon="chevron-left" onPress={goBack} accessibilityLabel="Back" />
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
            <Feather name="rotate-ccw" size={14} color={theme.text.inverse} />
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
          <IconButton icon="chevron-left" onPress={goBack} accessibilityLabel="Back" />
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
        <IconButton icon="chevron-left" onPress={goBack} accessibilityLabel="Back" />
        <Text style={s.headerTitle}>Scorecard</Text>
        <View style={s.headerRight}>
          <IconButton
            onPress={() => setSyncSheetOpen(true)}
            accessibilityLabel="Sync status"
          >
            <SyncIndicator status={syncStatus} saveError={saveError} theme={theme} s={s} />
          </IconButton>
          {!official && viewOnly && (
            <TouchableOpacity
              onPress={() => setViewOnly(false)}
              style={s.editRoundBtn}
              accessibilityRole="button"
              accessibilityLabel="Edit round"
            >
              <Feather name="edit-2" size={14} color={theme.accent.primary} style={{ marginRight: 4 }} />
              <Text style={s.editRoundBtnText}>Edit round</Text>
            </TouchableOpacity>
          )}
          <IconButton
            icon={viewSwitchIcon}
            onPress={() => setView(nextView)}
            accessibilityLabel={viewSwitchLabel}
          />
          {official && !appSettings.noSpoilers && (
            <IconButton
              icon="award"
              onPress={() => setOfficialLeaderboardOpen(true)}
              accessibilityLabel="View official leaderboard"
            />
          )}
          {showNotesControls && (
            <IconButton
              icon={hasCurrentNotes ? 'edit-3' : 'edit-2'}
              onPress={() => setNotesOpen(true)}
              dot={hasCurrentNotes}
              accessibilityLabel={hasCurrentNotes ? 'Open notes' : 'Add notes'}
            />
          )}
          {showFlagFinder && (
            <IconButton
              icon="flag"
              onPress={() => setFlagFinderOpen(true)}
              accessibilityLabel="Find the flag"
            />
          )}
          <IconButton
            icon="camera"
            onPress={openCapturePicker}
            accessibilityLabel="Attach a memory"
          />
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
      <ScoringModeChangeBanner
        message={setupNotice}
        onDismiss={dismissSetupNotice}
        icon="users"
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
          localSetupEditRef.current = Date.now(); // our own pairs rebuild, not a peer's
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
          myScores={myScores}
          ghostAuthors={ghostAuthors}
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
          conflictHoles={conflictHoles}
          conflictCells={conflictCells}
          conflictRows={conflictRows}
          localAuthorIds={localAuthorIds}
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

      {view === 'hole' && (
        <TourOverlay chapter="scorecard" steps={SCORECARD_TOUR_STEPS} />
      )}

      {/* Notes modal — per-hole note + shared round note */}
      {showNotesControls && (
        <BottomSheet visible={notesOpen} onClose={() => setNotesOpen(false)} sheetStyle={s.notesSheet}>
          <View style={s.notesHandle} />
          <View style={s.notesHeader}>
            <Text style={s.notesTitle}>Notes</Text>
            <IconButton icon="x" onPress={() => setNotesOpen(false)} />
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
        </BottomSheet>
      )}

      {mediaSheets}
      <MediaLightbox
        visible={lightboxVisible}
        items={lightboxItems}
        initialIndex={lightboxIndex}
        onClose={() => setLightboxVisible(false)}
      />
      <SyncStatusSheet
        visible={syncSheetOpen}
        onClose={() => setSyncSheetOpen(false)}
        status={official ? undefined : syncStatus}
        lastError={official ? null : getLastError()}
        cardsPending={!official && cardState.pending.cards}
        unsentHole={!official && cardState.draft?.[String(currentHole)] ? currentHole : null}
      />
      <FlagFinderView
        visible={flagFinderOpen}
        courseName={round.courseName}
        holeNumber={currentHole}
        onClose={() => setFlagFinderOpen(false)}
      />
      <ConflictWizardSheet
        visible={finishConflictsOpen}
        onClose={() => setFinishConflictsOpen(false)}
        rows={conflictRows}
        localAuthorIds={localAuthorIds}
        onPick={(playerId, hole, value) => resolveConflict(playerId, hole, value)}
        primaryLabel="Finish round"
        onPrimary={() => {
          setFinishConflictsOpen(false);
          handleFinish();
        }}
      />
      {holeConflictPrompt && (() => {
        const pending = holeConflictRows.length > 0;
        const leave = holeConflictPrompt.source === 'leave';
        const close = () => {
          pendingHoleRef.current = null;
          setHoleConflictPrompt(null);
        };
        return (
          <ConflictWizardSheet
            visible
            onClose={close}
            rows={holeConflictRows}
            localAuthorIds={localAuthorIds}
            onPick={(playerId, hole, value) => resolveConflict(playerId, hole, value)}
            // Leaving a hole must never trap the scorer: the primary stays
            // available while conflicts remain and still advances. The peer
            // prompt has nowhere to go, so it only offers Done once settled.
            allowPrimaryWhilePending={leave}
            primaryLabel={leave ? (pending ? 'Continue anyway' : 'Continue') : 'Done'}
            onPrimary={() => { close(); if (leave) proceedFromLeave(); }}
          />
        );
      })()}

      {roundCompleteVisible && (
        <View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={s.roundCompleteRoot}
        >
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

      {/* Official leaderboard (Task 17). Official-only; built from the flat
          members / scores lists via buildLeaderboard, ranked by NET
          Stableford points (Task 7). Holes still in discrepancy are
          excluded from both gross and points, and flag the row below. */}
      {official && (
        <BottomSheet
          visible={officialLeaderboardOpen}
          onClose={() => setOfficialLeaderboardOpen(false)}
          sheetStyle={s.notesSheet}
        >
          <View style={s.notesHandle} />
          <View style={s.notesHeader}>
            <Text style={s.notesTitle}>Leaderboard</Text>
            <IconButton
              icon="x"
              onPress={() => setOfficialLeaderboardOpen(false)}
              accessibilityLabel="Close leaderboard"
            />
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
                    {row.discrepancy ? ' ⚠' : ''}
                  </Text>
                  <Text style={s.officialLbThru}>
                    {row.thru > 0 ? `thru ${row.thru} · gross ${row.gross}` : '—'}
                  </Text>
                  <Text style={s.officialLbGross}>{row.points} pts</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </BottomSheet>
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
