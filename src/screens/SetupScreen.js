import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Image,
  StyleSheet, ScrollView, Alert, Platform, Share,
} from 'react-native';
import Switch from '../components/ui/Switch';
import ScreenContainer from '../components/ScreenContainer';

import { Feather } from '@expo/vector-icons';
import { useFocusEffect, CommonActions } from '@react-navigation/native';
import {
  createTournament, buildTeamsForMode, teamShapeOf, DEFAULT_SETTINGS, GAME_DEFAULT_SETTINGS,
  deriveRoundPlayingHandicap, generateInviteCode, buildJoinLink, rosterCap, roundScoringMode,
} from '../store/tournamentStore';
import { defaultHoles, fetchPlayers, fetchMyPlayers, getCachedMyPlayers } from '../store/libraryStore';
import { middleTee } from '../store/tees';
import { canSaveCourse } from '../lib/courseLibrary';
import { consumePendingPlayers, consumePendingCourses } from '../lib/selectionBridge';
import { isOnline } from '../lib/connectivity';
import { applyCoursePick, applyLayoutChoice } from '../lib/roundCourse';
import RoundLayoutSelect from '../components/RoundLayoutSelect';
import { useTheme } from '../theme/ThemeContext';
import { semantic } from '../theme/tokens';
import { useAuth } from '../context/AuthContext';
import ScoringModePicker, { isScoringModeAllowed, fallbackScoringMode, TeamsSettingsFields } from '../components/ScoringModePicker';
import RoundTeeAssignments from '../components/RoundTeeAssignments';
import PostCreateInviteModal from '../components/PostCreateInviteModal';
import { getScoringMode, needsManualTeamSetup, scoringModeUsesTeams, isScrambleMode } from '../components/scoringModes';
import StakesSheet, { stakesSummary } from '../components/StakesSheet';
import WizardProgress from '../components/setup/WizardProgress';
import WizardNav from '../components/setup/WizardNav';
import {
  wizardSteps,
  isStepValid,
  shouldOfferPostCreateEditorInvite,
  initialStepIndex,
  setupPrefillState,
} from './setupWizard';
import { mutate } from '../store/mutate';
import { announceLeagueCard, announceLeagueCardFor, recordLeagueFinal } from '../store/leagueStore';
import { enqueueLeagueFinal, isRetryableFinalError } from '../lib/leagueFinalPending';
import { cardMonth } from '../store/leagueRules';
import { monthName } from '../store/leagueView';
import {
  applyLeagueHandicap, isLeagueLength, isLeagueRated, leagueCourse, leagueStrokes, setupPlayerTee,
  leagueCardsPatch, preselectedLeagueMissing,
} from '../store/leagueSetup';
import { leagueErrorText } from '../lib/leagueErrorText';
import { leagueCardRows, showsLeagueList } from '../store/leagueGameCards';
import { useSetupLeagues } from '../hooks/useSetupLeagues';
import { useLeagueCardsStatus } from '../hooks/useLeagueCardsStatus';
import { dismissLeagueOptIn } from '../lib/leagueOptIn';
import LeagueCardsList from '../components/league/LeagueCardsList';
import { useT, t as translate, t as tNow, formatNumber, formatDate } from '../i18n';
import { applyFinalStrokes, finalStrokeList, finalStrokesRecord } from '../store/leagueFinal';
import { circleText } from '../theme/circleText';

// Deep green used for the Review hero band — fixed in both themes so white
// hero text always has strong contrast.
const HERO_GREEN = '#024d36';

// Stable id for a round so React keys / removal survive reordering.
let _roundIdSeq = 0;
function newRoundId() { return `setup-r${Date.now()}-${_roundIdSeq++}`; }

// The league announce failed: start a normal game instead, or stay here.
async function askStartWithoutLeague(leagueName, reason) {
  const title = tNow('league.cards.failTitle');
  const message = tNow('league.setup.failMessage', { reason, league: leagueName });
  if (Platform.OS === 'web') return window.confirm(`${title}\n\n${message}`);
  return new Promise((resolve) => Alert.alert(
    title, message,
    [{ text: tNow('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
     { text: tNow('league.setup.startNormal'), onPress: () => resolve(true) }],
  ));
}

async function confirmDialog(title, message, confirmLabel = translate('setup.screen.remove')) {
  if (Platform.OS === 'web') return window.confirm(`${title}\n\n${message}`);
  return new Promise((resolve) => Alert.alert(
    title, message,
    [{ text: translate('setup.screen.cancel'), style: 'cancel', onPress: () => resolve(false) },
     { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) }],
  ));
}

function buildGameName(courseName) {
  const stamp = formatDate(new Date(), 'day');
  const trimmed = (courseName || '').trim();
  if (!trimmed) return translate('setup.screen.gameStamp', { stamp });
  // Keep the title short — golf course names can be very long and clip
  // in the tournament header. Trim to ~22 chars with an ellipsis when
  // combined with the date.
  const MAX = 22;
  const shortCourse = trimmed.length > MAX ? `${trimmed.slice(0, MAX - 1).trimEnd()}…` : trimmed;
  return translate('setup.screen.courseStamp', { course: shortCourse, stamp });
}

export default function SetupScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const { user } = useAuth();

  const kind = route?.params?.kind === 'game' ? 'game' : 'tournament';
  const isGame = kind === 'game';
  const {
    name: prefilledName,
    players: prefilledPlayers,
    rounds: prefilledRounds,
    settingsPatch,
    hasPrefilledPlayers,
  } = setupPrefillState(route?.params?.prefill);
  const initialSteps = wizardSteps(kind, prefilledPlayers.length);

  // A prefilled name (quick start → Edit details) seeds the field but does
  // not count as "touched": picking another course still renames the game.
  const [tournamentName, setTournamentName] = useState(() =>
    prefilledName || (isGame ? buildGameName('') : ''),
  );
  const [nameTouched, setNameTouched] = useState(false);
  // The focus effect below only runs on actual focus events (deps stay
  // limited to values that never change for this screen instance), so it
  // reads nameTouched through a ref rather than closing over a stale value
  // from mount.
  const nameTouchedRef = useRef(nameTouched);
  useEffect(() => { nameTouchedRef.current = nameTouched; }, [nameTouched]);
  const [players, setPlayers] = useState(() => prefilledPlayers);
  const [rounds, setRounds] = useState(() => prefilledRounds ?? [
    { id: newRoundId(), courseName: '', holes: defaultHoles(), tees: [], playerHandicaps: null, playerTees: null },
  ]);
  const [showStakes, setShowStakes] = useState(false);
  const [settings, setSettings] = useState(() => ({
    ...(isGame ? GAME_DEFAULT_SETTINGS : DEFAULT_SETTINGS),
    ...settingsPatch,
  }));
  const [rawStep, setStep] = useState(() => initialStepIndex(initialSteps, route?.params?.initialStep));
  const [postCreateInvite, setPostCreateInvite] = useState({
    visible: false,
    loading: false,
    link: '',
    error: '',
    tournament: null,
  });
  // Which round's course name is being edited inline (null = none).
  const [renamingIndex, setRenamingIndex] = useState(null);

  // League switch (before Start): leagues where I have no card this month.
  // A casual game, or round 1 of a casual tournament (R17; later rounds opt in
  // at Start Round N). The board's "Play with the app" passes leagueId to
  // preselect that league with the switch on.
  const leagueSetup = isGame || kind === 'tournament';
  const {
    leagues: setupLeagues, loading: leaguesLoading, error: leaguesError, retry: retryLeagues,
  } = useSetupLeagues(leagueSetup, user?.id ?? null);
  const [leaguePick, setLeaguePick] = useState(() => route?.params?.leagueId ?? null);
  const [leagueOn, setLeagueOn] = useState(() => !!route?.params?.leagueId);
  // The preselected league can't take a card (not in the eligible list): the
  // switch goes off instead of switching another league on.
  const pickMissing = preselectedLeagueMissing({
    leagues: setupLeagues, pickId: leaguePick, loading: leaguesLoading, error: leaguesError,
  });
  useEffect(() => {
    if (!pickMissing) return;
    setLeagueOn(false);
    setLeaguePick(null);
  }, [pickMissing]);
  const league = setupLeagues.find((l) => l.id === leaguePick) ?? setupLeagues[0] ?? null;
  const myPlayer = players.find((p) => p.user_id && p.user_id === user?.id) ?? null;
  const leagueOffered = leagueSetup && !!league && !!myPlayer;
  // Opened from the board's "Play with the app": this round is meant to count,
  // so a league that is still loading holds Start, and a failed read says so.
  const leagueIntended = leagueSetup && !!route?.params?.leagueId;
  // (Declared before the list status below; widened there.)
  const leagueCheckingLeagues = leagueIntended && !leagueOffered && leaguesLoading;
  const leagueFailed = leagueIntended && !leagueOffered && !leaguesLoading && leaguesError;
  const leagueEligibleRound = isLeagueLength(rounds[0]);
  // The league ranks by net differential: my tee needs a slope and a rating.
  const leagueRated = !leagueOffered || !leagueEligibleRound || isLeagueRated(rounds[0], myPlayer.id);
  // Several league cards per game (R16, D5 B): when another player of the game
  // is in this league too, a "League cards" list replaces the switch. Each
  // member decides on their own phone; only my row has a switch.
  const otherLinked = players.some((p) => p.user_id && p.user_id !== user?.id);
  const leagueStatus = useLeagueCardsStatus({ leagueId: league?.id ?? null, enabled: leagueOffered && otherLinked });
  const leagueRows = leagueCardRows({
    players, userId: user?.id ?? null, members: leagueStatus.members, round: rounds[0],
  });
  // The members' status read failed: fall back to the single switch for my
  // own card (it doesn't need that read) rather than starting a normal game.
  const leagueListMode = leagueOffered && otherLinked && !leagueStatus.error
    && (leagueStatus.loading || showsLeagueList(leagueRows));
  const leagueListBlocked = leagueListMode && leagueStatus.loading;
  const leagueActive = leagueOffered && leagueOn && !pickMissing && leagueEligibleRound && leagueRated && !leagueListBlocked;
  // A league card plays off the league handicap only: with my card on, my row
  // on round 1 shows it and offers no index or handicap edits. The tee stays
  // mine to pick until Start announces the card with it.
  const leagueLocks = leagueOffered && leagueOn && !pickMissing && leagueEligibleRound && league.leagueHandicap != null
    ? { [myPlayer.id]: { leagueHandicap: Number(league.leagueHandicap), teeLocked: false } }
    : undefined;
  // As the game's creator I can also count another member's card (the
  // server's announce_league_card_for): a switch on each "asked" row. The card
  // is theirs; they validate and submit it from their own phone.
  const [othersOn, setOthersOn] = useState(() => new Set());
  const toggleOther = (playerId, on) => setOthersOn((prev) => {
    const next = new Set(prev);
    if (on) next.add(playerId); else next.delete(playerId);
    return next;
  });
  const othersToCount = leagueListMode && !leagueListBlocked && !pickMissing && leagueEligibleRound
    ? leagueRows.filter((r) => r.kind === 'asked' && othersOn.has(r.playerId))
    : [];
  // A switch already on (the board's "Play with the app") waits for the list.
  const leagueChecking = leagueCheckingLeagues || (leagueListMode && leagueOn && leagueStatus.loading);
  const startBusyRef = useRef(false);
  const t = useT();

  // The league Final (LeagueFinalScreen): { leagueId, strokes by user id }.
  // Start raises round 0's playing handicaps by those strokes.
  const leagueFinal = route?.params?.leagueFinal ?? null;
  const finalStrokes = leagueFinal ? finalStrokeList(players, leagueFinal.strokes) : [];

  // A dedicated 'teams' step only earns its keep for multi-round tournaments
  // whose (default) scoring mode is played in teams — for a single round
  // there's nothing to keep "the same" across, so the inline controls on the
  // Scoring step remain the only place to set it.
  const showTeamsStep = !isGame && rounds.length > 1
    && scoringModeUsesTeams(settings.scoringMode, players.length);

  // The active step list depends on kind + player count (Scoring only exists
  // for 2+ players). When the roster shrinks the Scoring step away the array
  // gets shorter, so the active index is clamped synchronously here — not via
  // an effect, which would leave a one-render window where the index points
  // past the array and stepKey wrongly resolves to 'review'. stepKey is the
  // key of the currently displayed step.
  const steps = useMemo(
    () => wizardSteps(kind, players.length, { showTeamsStep }),
    [kind, players.length, showTeamsStep],
  );
  const step = Math.max(0, Math.min(rawStep, steps.length - 1));
  const stepKey = steps[step];

  // Whenever the player count makes the chosen scoring mode invalid, fall
  // back to a mode that is always valid for the current roster.
  useEffect(() => {
    if (!isScoringModeAllowed(settings.scoringMode, players.length)) {
      setSettings((prev) => ({ ...prev, scoringMode: fallbackScoringMode(players.length) }));
    }
  }, [players.length, settings.scoringMode]);

  // Pre-add the signed-in user to the roster — you're setting up an event
  // you'll play in, so you start in the "Who's playing?" list by default.
  // Runs once; the slot stays removable and the PlayerPicker won't add a
  // duplicate. My row comes from the device cache first: the network read
  // waits on a session refresh and the friends list, and on a slow or no
  // signal it landed late or never, so the game started without me.
  const mePreaddedRef = useRef(false);
  const skipMePreaddRef = useRef(hasPrefilledPlayers);
  useEffect(() => {
    if (skipMePreaddRef.current || mePreaddedRef.current || !user?.id) return;
    mePreaddedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const isMe = (p) => p.user_id === user.id;
        const cached = await getCachedMyPlayers(user.id);
        const me = cached?.find(isMe) ?? (await fetchMyPlayers()).find(isMe);
        if (cancelled || !me) return;
        setPlayers((prev) => {
          if (prev.length >= rosterCap(kind) || prev.some((p) => p.id === me.id)) return prev;
          return [{
            id: me.id,
            name: me.name,
            handicap: me.handicap,
            user_id: me.user_id ?? null,
            avatar_url: me.avatar_url ?? null,
            gender: me.gender ?? null,
          }, ...prev];
        });
      } catch (_) { /* offline / no own player row — add players manually */ }
    })();
    return () => { cancelled = true; };
    // `kind` is derived once from route params and never changes for the
    // life of this screen instance, but it's included here since the roster
    // cap check now reads it.
  }, [user?.id, kind]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;

    const picked = consumePendingPlayers();
    if (picked && picked.length > 0) {
      // Add the picks at once from the picker's snapshot: waiting on the
      // network here left a quick "Next" (or a slow connection) starting the
      // game without them.
      setPlayers((prev) => {
        const next = [...prev];
        for (const p of picked) {
          if (next.length >= rosterCap(kind) || next.find((x) => x.id === p.id)) continue;
          // Carry user_id / avatar_url so the embedded player links back to
          // a real account (feed attribution, friend stats). Guest players
          // added via the picker form simply have these undefined.
          next.push({
            id: p.id,
            name: p.name,
            handicap: p.handicap,
            user_id: p.user_id ?? null,
            avatar_url: p.avatar_url ?? null,
            gender: p.gender ?? null,
          });
        }
        return next;
      });
      // Then pick up renames / handicap edits made since the picker loaded,
      // in the background. Offline the snapshot simply stays.
      const pickedIds = new Set(picked.map((p) => p.id));
      fetchPlayers()
        .then((all) => {
          if (cancelled) return;
          setPlayers((prev) => prev.map((p) => {
            const latest = pickedIds.has(p.id) && all.find((x) => x.id === p.id);
            return latest ? { ...p, name: latest.name, handicap: latest.handicap } : p;
          }));
        })
        .catch(() => { /* keep snapshot */ });
    }

    const pc = consumePendingCourses();
    if (pc && pc.picks && pc.picks.length > 0) {
      const { startRoundIndex, picks } = pc;
      setRounds((prev) => {
        const next = [...prev];
        picks.forEach((pick, i) => {
          const idx = startRoundIndex + i;
          const base = idx < next.length
            ? next[idx]
            : { id: newRoundId(), manualHandicaps: {} };
          const applied = applyCoursePick(base, pick);
          if (idx < next.length) next[idx] = applied;
          else next.push(applied);
        });
        return next;
      });
      // Name a single game after its course — only a resolved 'course' pick
      // has a name now; a 'club' pick names the game when its layout is set.
      const first = picks[0];
      if (isGame && !nameTouchedRef.current && startRoundIndex === 0 && first?.kind === 'course') {
        setTournamentName(buildGameName(first.course.name));
      }
    }

    return () => { cancelled = true; };
    // `isGame` and `kind` are derived once from route params and never
    // change for the life of this screen instance; `nameTouched` is read
    // live via nameTouchedRef above instead of being a dependency.
  }, [isGame, kind]));

  const handleHolesSaved = useCallback((roundIndex, patch) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = { ...next[roundIndex], holes: patch.holes, tees: patch.tees };
      return next;
    });
  }, []);

  const handleRoundTeesChange = useCallback((roundIndex, patch) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = {
        ...next[roundIndex],
        playerTees: patch.playerTees,
        playerHandicaps: patch.playerHandicaps,
        manualHandicaps: { ...(patch.manualHandicaps ?? {}) },
      };
      return next;
    });
  }, []);

  async function removePlayer(id) {
    const player = players.find((p) => p.id === id);
    const ok = await confirmDialog(
      t('setup.screen.removePlayerTitle'),
      t(isGame ? 'setup.screen.removePlayerGame' : 'setup.screen.removePlayerTournament', {
        name: player?.name ?? t('setup.screen.thisPlayer'),
      }),
    );
    if (!ok) return;
    setPlayers((prev) => prev.filter((p) => p.id !== id));
  }

  function updateCourseName(index, value) {
    setRounds((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], courseName: value };
      return next;
    });
    if (isGame && !nameTouched && index === 0) {
      setTournamentName(buildGameName(value));
    }
  }

  // Resolve a club-picked round to one of the club's layouts.
  const chooseLayout = useCallback((roundIndex, layoutCourse) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = applyLayoutChoice(next[roundIndex], layoutCourse);
      return next;
    });
    if (isGame && !nameTouched && roundIndex === 0) {
      setTournamentName(buildGameName(layoutCourse.name));
    }
  }, [isGame, nameTouched]);

  function addRound() {
    setRounds((prev) => [...prev, { id: newRoundId(), courseName: '', holes: defaultHoles(), tees: [], playerHandicaps: null, playerTees: null, manualHandicaps: {} }]);
  }

  async function removeRound(index) {
    const round = rounds[index];
    // Setup-stage rounds carry no entered scores yet, but a course may have
    // been configured — still confirm so a stray tap doesn't wipe holes/tees.
    const hasCourse = !!(round?.courseName || '').trim();
    const ok = await confirmDialog(
      t('setup.screen.removeRoundTitle'),
      hasCourse
        ? t('setup.screen.removeRoundCourse', { n: index + 1, course: round.courseName })
        : t('setup.screen.removeRoundPlain', { n: index + 1 }),
    );
    if (!ok) return;
    setRounds((prev) => prev.filter((_, i) => i !== index));
    setRenamingIndex(null);
  }

  const missingCourseName = rounds.some((r) => !r.courseName.trim());
  const canStart = players.length >= 1 && !missingCourseName;

  const navigateToCreatedTournament = useCallback((tournament) => {
    // mutate(tournament.create) marks the new tournament active. A game is a single
    // round — jump straight to its scorecard, but seat the Tournament
    // (round details) view underneath so back from the scorecard returns
    // there instead of bouncing all the way to Home. A multi-round
    // tournament lands on the Tournament view directly.
    if (isGame) {
      navigation.dispatch((state) => {
        const routes = [
          ...state.routes.slice(0, -1), // drop the Setup wizard itself
          { name: 'Tournament' },
          { name: 'Scorecard', params: { roundIndex: 0 } },
        ];
        return CommonActions.reset({ ...state, routes, index: routes.length - 1 });
      });
    } else {
      navigation.replace('Tournament');
    }
    // Manual team selection: push the team editor for round 0 on top of the
    // destination above. Its Save goes back (navigation.goBack()), landing
    // the user on the scorecard/tournament view they'd normally reach. Keyed
    // on round 0's EFFECTIVE mode (its own override, or the tournament
    // default) — a per-round override on round 0 should route the same way
    // a tournament-wide mode of that shape would.
    const round0Mode = tournament?.rounds?.[0]?.scoringMode ?? tournament?.settings?.scoringMode;
    if (needsManualTeamSetup(
      round0Mode,
      tournament?.players?.length,
      tournament?.settings?.manualTeams,
    )) {
      navigation.navigate('EditTeams', { roundIndex: 0, tournamentId: tournament?.id });
    }
  }, [isGame, navigation]);

  function closePostCreateInvite() {
    const tournament = postCreateInvite.tournament;
    setPostCreateInvite({
      visible: false,
      loading: false,
      link: '',
      error: '',
      tournament: null,
    });
    if (tournament) navigateToCreatedTournament(tournament);
  }

  function requestClosePostCreateInvite() {
    if (postCreateInvite.loading) return;
    closePostCreateInvite();
  }

  async function sharePostCreateInvite() {
    if (!postCreateInvite.link) return;
    try {
      const label = tournamentName.trim() || t('setup.screen.myGame');
      await Share.share({
        message: t('setup.screen.inviteShare', { name: label, link: postCreateInvite.link }),
      });
    } catch (err) {
      const msg = err?.message ?? t('setup.screen.shareError');
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert(t('setup.screen.error'), msg);
    }
  }

  // One Start at a time: a league Start waits on the network, and a second
  // tap must not announce (or create) twice.
  async function handleStart() {
    if (startBusyRef.current) return;
    startBusyRef.current = true;
    try {
      await startGame();
    } finally {
      startBusyRef.current = false;
    }
  }

  // Announces my league card for the game about to be created (the ids come
  // from createTournament, nothing is saved or queued yet) and returns the
  // tournament with the league link and my league handicap on round 0. If the
  // announce fails, returns the plain tournament only when the user chooses a
  // normal game, else null.
  async function withLeagueCard(tournament, meId) {
    const r0 = tournament.rounds[0];
    try {
      const card = await announceLeagueCard({
        leagueId: league.id,
        source: 'app',
        course: leagueCourse(r0, meId),
        teeTime: new Date().toISOString(),
        tournamentId: tournament.id,
        roundId: r0.id,
        playerId: meId,
        scoringMode: roundScoringMode(tournament, r0),
      });
      const hcp = card.leagueHandicap ?? league.leagueHandicap;
      return {
        ...tournament,
        // `league` keeps builds before R16 reading the creator's card;
        // `leagueCards` is where every member's card of every round lives.
        league: { leagueId: league.id, cardId: card.id, playerId: meId },
        ...leagueCardsPatch({ leagueId: league.id, cardId: card.id, playerId: meId, roundId: r0.id }),
        rounds: tournament.rounds.map((r, i) => (
          i === 0 && hcp != null ? applyLeagueHandicap(r, meId, hcp) : r)),
      };
    } catch (err) {
      const ok = await askStartWithoutLeague(league.name, leagueErrorText(err) || t('league.setup.unreachable'));
      return ok ? tournament : null;
    }
  }

  // Announces the other members' cards I switched on, once mine is through.
  // A refusal (their month is taken, they already scored…) doesn't stop the
  // game: it starts with the cards that went through and says which didn't.
  async function withOthersLeagueCards(tournament, rows) {
    const r0 = tournament.rounds[0];
    let next = tournament;
    const failed = [];
    for (const row of rows) {
      try {
        const card = await announceLeagueCardFor({
          leagueId: league.id,
          userId: row.userId,
          course: leagueCourse(r0, row.playerId),
          tournamentId: tournament.id,
          roundId: r0.id,
          playerId: row.playerId,
          scoringMode: roundScoringMode(tournament, r0),
        });
        const patch = leagueCardsPatch({ leagueId: league.id, cardId: card.id, playerId: row.playerId, roundId: r0.id });
        next = {
          ...next,
          leagueCards: { ...(next.leagueCards ?? {}), ...patch.leagueCards },
          rounds: next.rounds.map((r, i) => (
            i === 0 && card.leagueHandicap != null ? applyLeagueHandicap(r, row.playerId, card.leagueHandicap) : r)),
        };
      } catch (err) {
        failed.push(`${row.name}: ${leagueErrorText(err) || t('league.setup.unreachable')}`);
      }
    }
    if (failed.length > 0) {
      const msg = t('league.cards.othersFailed', { list: failed.join('\n') });
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert(t('league.cards.othersFailedTitle'), msg);
    }
    return next;
  }

  async function startGame() {
    if (players.length < 1) {
      Alert.alert(t('setup.screen.missingInfo'), t('setup.screen.needPlayer'));
      return;
    }
    if (missingCourseName) {
      Alert.alert(t('setup.screen.missingInfo'), t('setup.screen.needCourseNames'));
      return;
    }

    // Stroke-index / tee-label validation (Task 13): the round-holes editor
    // (CourseEditorScreen opened WITHOUT a courseId from the "Configure
    // holes" row below) writes straight into round.holes/tees with no
    // save-guard of its own — a different path than the course-library
    // screens' canSaveCourse gate. Creation is a single discrete user
    // action (not a keystroke autosave), so — mirroring Task 5's pattern —
    // block it outright with an alert rather than silently dropping holes.
    const invalidRound = rounds.find((r) => !canSaveCourse(r.holes, r.tees).ok);
    if (invalidRound) {
      const { siIssues, dupes } = canSaveCourse(invalidRound.holes, invalidRound.tees);
      Alert.alert(
        t('setup.screen.fixCourse'),
        [...siIssues, ...(dupes.length > 0 ? [t('setup.screen.dupeTees', { labels: dupes.join(', ') })] : [])].join('\n'),
      );
      return;
    }

    // Pairs are built from each round's effective scoring mode (its own
    // override, or the tournament default) via buildTeamsForMode, which
    // covers every team shape (2x2 / 3+1 / 1x4) and falls back to one
    // singleton pair per player for solo modes. The matchplay bestBall/
    // worstBall special-case below is keyed on the tournament DEFAULT mode
    // only — per-round overrides don't change tournament-level settings
    // fields, only the built round's own scoringMode/pairs.
    const isMatchPlay = settings.scoringMode === 'matchplay';
    // With fixedTeams on, build each team SHAPE once and reuse it for every
    // round of that shape instead of re-randomizing per round. Rounds whose
    // effective mode maps to a different shape (e.g. a scramble3v1 override
    // in an otherwise 2x2 tournament) get their own cached build.
    const fixedPairsByShape = {};
    const pairsFor = (mode) => {
      if (!settings.fixedTeams) return buildTeamsForMode(mode, players);
      const shape = teamShapeOf(mode);
      if (!fixedPairsByShape[shape]) fixedPairsByShape[shape] = buildTeamsForMode(mode, players);
      return fixedPairsByShape[shape].map((pr) => [...pr]);
    };

    const builtRounds = rounds.map((r, i) => {
      const roundMode = r.scoringMode ?? settings.scoringMode;
      // Defensive: if a round somehow has no per-player tees (e.g. the round
      // object was built outside the Tees & Handicaps step), default every
      // player to the course's middle tee so playing handicaps are
      // tee-derived rather than the raw index. A course with no tees leaves
      // playerTees null (raw-index fallback is then correct).
      const defaultTee = middleTee(r.tees);
      const playerTees = r.playerTees ?? (defaultTee
        ? Object.fromEntries(players.map((p) => [
            p.id,
            { label: defaultTee.label, slope: defaultTee.slope, rating: defaultTee.rating },
          ]))
        : null);
      // Auto-derive WHS playing handicaps when the user never opened
      // Configure Holes (r.playerHandicaps still null). With playerTees
      // resolved above, deriveRoundPlayingHandicap yields the real per-tee
      // playing handicap rather than the raw index.
      const roundWithTees = { ...r, playerTees };
      const playerHandicaps = r.playerHandicaps
        ?? Object.fromEntries(players.map((p) => [
          p.id, deriveRoundPlayingHandicap(p.handicap, roundWithTees, p.id),
        ]));
      const built = {
        id: `r${i}`,
        courseId: r.courseId ?? null,
        courseName: r.courseName.trim(),
        holes: r.holes,
        tees: r.tees ?? [],
        playerHandicaps,
        playerTees,
        manualHandicaps: { ...(r.manualHandicaps ?? {}) },
        notes: '',
        ...(r.scoringMode ? { scoringMode: r.scoringMode } : {}),
        pairs: pairsFor(roundMode),
        scores: {},
      };
      return i === 0 && leagueFinal ? applyFinalStrokes(built, players, leagueFinal.strokes) : built;
    });

    // The creator is "me": match the signed-in account to its player slot so
    // shot tracking is pre-assigned. Resolved here, at creation, from data
    // already in hand — no network — so it works offline and the scorecard
    // never has to fall back to the "which player are you?" picker.
    const meId = players.find((p) => p.user_id && p.user_id === user?.id)?.id ?? null;

    let tournament = createTournament({
      kind,
      name: tournamentName.trim() || (isGame ? t('setup.screen.defaultGameName') : t('setup.screen.defaultTournamentName')),
      players,
      meId,
      rounds: builtRounds,
      settings: isMatchPlay
        ? { ...settings, scoringMode: 'matchplay', bestBallValue: 1, worstBallValue: 0 }
        : {
            ...settings,
            bestBallValue: parseInt(settings.bestBallValue, 10) || 1,
            worstBallValue: parseInt(settings.worstBallValue, 10) || 1,
          },
    });

    if (leagueFinal) tournament = { ...tournament, leagueFinal: { leagueId: leagueFinal.leagueId } };

    // League card: announced on the server BEFORE the game is saved or
    // queued, so announced_at always precedes the first score.
    if (leagueActive && meId) {
      tournament = await withLeagueCard(tournament, meId);
      if (!tournament) return;
    }
    if (othersToCount.length > 0) tournament = await withOthersLeagueCards(tournament, othersToCount);

    try {
      await mutate(tournament, { type: 'tournament.create', tournament });
      // I saw my league switch and left it off: the scorecard won't ask again.
      // Not while the list was still blocked: I never got to decide.
      if (leagueOffered && !leagueActive && !leagueListBlocked && meId) {
        await dismissLeagueOptIn(tournament.id, tournament.rounds[0].id);
      }

      if (leagueFinal) {
        // The create is only queued for sync, so the tournaments row may not
        // be on the server yet: that case is retried quietly in the background.
        const strokes = finalStrokesRecord(players, leagueFinal.strokes);
        try {
          await recordLeagueFinal(leagueFinal.leagueId, tournament.id, strokes);
        } catch (finalErr) {
          if (isRetryableFinalError(finalErr)) {
            await enqueueLeagueFinal({ leagueId: leagueFinal.leagueId, tournamentId: tournament.id, strokes });
          } else {
            const msg = t('league.setup.finalTold', { error: finalErr?.message ?? t('league.setup.finalTryAgain') });
            if (Platform.OS === 'web') window.alert(msg);
            else Alert.alert(t('league.setup.finalTitle'), msg);
          }
        }
      }

      // Offline the invite link can't be made, and the sheet would spin until
      // the request fails, at the tee. Skip it: Home and the game's Players
      // screen offer the invite later.
      if (isOnline() && shouldOfferPostCreateEditorInvite(kind, players, user?.id)) {
        setPostCreateInvite({
          visible: true,
          loading: true,
          link: '',
          error: '',
          tournament,
        });
        try {
          const { editorCode } = await generateInviteCode(tournament.id);
          const origin = Platform.OS === 'web' && typeof window !== 'undefined'
            ? window.location.origin
            : '';
          setPostCreateInvite({
            visible: true,
            loading: false,
            link: buildJoinLink(origin, editorCode),
            error: '',
            tournament,
          });
        } catch (inviteErr) {
          setPostCreateInvite({
            visible: true,
            loading: false,
            link: '',
            error: inviteErr?.message ?? t('setup.screen.inviteError'),
            tournament,
          });
        }
        return;
      }

      navigateToCreatedTournament(tournament);
    } catch (err) {
      const msg = err?.message ?? t('setup.screen.createError');
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert(t('setup.screen.error'), msg);
    }
  }

  // ---- Wizard navigation -------------------------------------------------

  function handleBack() {
    // Step 0's back exits the screen entirely; later steps go back one step.
    if (step === 0) navigation.goBack();
    else setStep((p) => p - 1);
  }

  function handleNext() {
    if (stepKey === 'review') handleStart();
    else setStep((p) => Math.min(p + 1, steps.length - 1));
  }

  function goToStep(key) {
    const idx = steps.indexOf(key);
    if (idx >= 0) setStep(idx);
  }

  const isLastStep = stepKey === 'review';
  const nextEnabled = isStepValid(stepKey, { players, rounds })
    && (!isLastStep || (canStart && !leagueChecking));
  const nextLabel = isLastStep
    ? (isGame ? t('setup.screen.startGame') : t('setup.screen.startTournament'))
    : t('setup.screen.next');

  // ---- Step bodies -------------------------------------------------------

  const renderPlayersStep = () => {
    const cap = rosterCap(kind);
    const remaining = Math.max(0, cap - players.length);
    // Render only a small, bounded number of empty "ADD PLAYER" tiles — the
    // grid is a launcher into the picker, not a per-seat form. A game's cap
    // of 4 means `remaining` is already small, so show them all (preserves
    // the original look); a tournament's cap of 24 would otherwise render
    // ~23 dashed tiles, so cap the visible empties to one. Either way it
    // drops to 0 once the roster is full. The picker can still add players
    // right up to `cap` — this only affects how many launcher tiles show.
    const emptySlots = isGame ? remaining : Math.min(remaining, 1);
    return (
      <>
        <Text style={s.stepOverline}>{t('setup.screen.playersOverline')}</Text>
        <Text style={s.stepPrompt}>{t('setup.screen.playersPrompt')}</Text>
        <Text style={s.stepSubtitle}>
          {isGame
            ? t('setup.screen.playersSubGame', { cap })
            : t('setup.screen.playersSubTournament', { cap })}
        </Text>
        <View style={s.slotGrid}>
          {players.map((p) => (
            <View key={p.id} style={s.slotFilled}>
              <TouchableOpacity
                style={s.slotRemove}
                onPress={() => removePlayer(p.id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="x" size={13} color={theme.destructive} />
              </TouchableOpacity>
              <View style={s.slotAvatar}>
                {p.avatar_url
                  ? <Image source={{ uri: p.avatar_url }} style={s.slotAvatarImg} />
                  : <Text style={s.slotAvatarText}>{(p.name ?? '?').slice(0, 2).toUpperCase()}</Text>}
              </View>
              <Text style={s.slotName} numberOfLines={1}>{p.name}</Text>
              <Text style={s.slotHcp}>{t('setup.screen.hcp', { value: p.handicap })}</Text>
            </View>
          ))}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <TouchableOpacity
              key={`empty-${i}`}
              style={s.slotEmpty}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('PlayerPicker', {
                alreadySelectedIds: players.map((pl) => pl.id),
                kind,
              })}
            >
              <View style={s.slotPlus}>
                <Feather name="plus" size={16} color={theme.accent.primary} />
              </View>
              <Text style={s.slotEmptyLabel}>{t('setup.screen.addPlayer')}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </>
    );
  };

  const renderCourseStep = () => (
    <>
      <Text style={s.stepOverline}>{isGame ? t('setup.screen.courseOverline') : t('setup.screen.roundsOverline')}</Text>
      <Text style={s.stepPrompt}>{t('setup.screen.coursePrompt')}</Text>
      <Text style={s.stepSubtitle}>
        {isGame
          ? t('setup.screen.courseSubGame')
          : t('setup.screen.courseSubTournament')}
      </Text>
      {!isGame && (
        <View style={s.nameGroup}>
          <Text style={s.nameLabel}>{t('setup.screen.tournamentName')}</Text>
          <TextInput
            style={s.nameInput}
            value={tournamentName}
            onChangeText={(v) => { setTournamentName(v); setNameTouched(true); }}
            placeholder={t('setup.screen.defaultTournamentName')}
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
          />
        </View>
      )}
      {rounds.map((r, i) => {
        const totalPar = r.holes.reduce((sum, h) => sum + h.par, 0);
        const hasCourse = !!r.courseName.trim();
        const isRenaming = renamingIndex === i;
        return (
          <View key={r.id ?? `round-${i}`} style={s.courseBlock}>
            <View style={s.roundHeader}>
              {!isGame && <Text style={s.roundLabel}>{t('setup.screen.round', { n: i + 1 })}</Text>}
              {rounds.length > 1 && (
                <TouchableOpacity onPress={() => removeRound(i)} style={s.removeRoundBtn}>
                  <Feather name="trash-2" size={14} color={theme.destructive} />
                  <Text style={s.removeRoundText}>{t('setup.screen.remove')}</Text>
                </TouchableOpacity>
              )}
            </View>

            {hasCourse ? (
              <View style={s.courseCard}>
                <View style={s.courseCardTop}>
                  {isRenaming ? (
                    <>
                      <View style={s.coursePin}>
                        <Feather name="map-pin" size={15} color={theme.accent.primary} />
                      </View>
                      <TextInput
                        style={s.courseNameInput}
                        value={r.courseName}
                        onChangeText={(v) => updateCourseName(i, v)}
                        onBlur={() => setRenamingIndex(null)}
                        onSubmitEditing={() => setRenamingIndex(null)}
                        autoFocus
                        placeholder={t('setup.screen.courseName')}
                        placeholderTextColor={theme.text.muted}
                        keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                        selectionColor={theme.accent.primary}
                      />
                    </>
                  ) : (
                    <TouchableOpacity
                      style={s.courseIdentity}
                      activeOpacity={0.7}
                      onPress={() => navigation.navigate('CoursePicker', { roundIndex: i, rounds: !isGame })}
                    >
                      <View style={s.coursePin}>
                        <Feather name="map-pin" size={15} color={theme.accent.primary} />
                      </View>
                      <Text style={s.courseCardName} numberOfLines={1}>{r.courseName}</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={s.coursePencil}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={() => setRenamingIndex(isRenaming ? null : i)}
                  >
                    <Feather
                      name={isRenaming ? 'check' : 'edit-2'}
                      size={14}
                      color={isRenaming ? theme.accent.primary : theme.text.muted}
                    />
                  </TouchableOpacity>
                </View>

                <View style={s.courseStats}>
                  <View style={s.courseStat}>
                    <Text style={s.courseStatValue}>{totalPar}</Text>
                    <Text style={s.courseStatLabel}>{t('setup.screen.statPar')}</Text>
                  </View>
                  <View style={s.courseStat}>
                    <Text style={s.courseStatValue}>{r.holes.length}</Text>
                    <Text style={s.courseStatLabel}>{t('setup.screen.statHoles')}</Text>
                  </View>
                  <View style={s.courseStat}>
                    <Text style={s.courseStatValue}>{r.tees?.length ?? 0}</Text>
                    <Text style={s.courseStatLabel}>{t('setup.screen.statTees', { count: r.tees?.length ?? 0 })}</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={s.courseConfigRow}
                  onPress={() =>
                    navigation.navigate('CourseEditor', {
                      roundIndex: i,
                      courseName: r.courseName || t('setup.screen.round', { n: i + 1 }),
                      initialHoles: r.holes,
                      initialTees: r.tees ?? [],
                      onSave: handleHolesSaved,
                      courseId: r.courseId ?? null,
                    })
                  }
                >
                  <Feather name="settings" size={14} color={theme.accent.primary} />
                  <Text style={s.courseConfigText}>{t('setup.screen.configureHoles')}</Text>
                  <Feather name="chevron-right" size={16} color={theme.text.muted} style={{ marginLeft: 'auto' }} />
                </TouchableOpacity>
              </View>
            ) : r.club ? (
              <View style={s.layoutCard}>
                <RoundLayoutSelect
                  club={r.club}
                  layouts={r.clubLayouts || []}
                  value={r.layoutId ?? null}
                  onChange={(layoutCourse) => chooseLayout(i, layoutCourse)}
                  onChangeClub={() => navigation.navigate('CoursePicker', { roundIndex: i, rounds: !isGame })}
                />
              </View>
            ) : (
              <TouchableOpacity
                style={s.courseEmpty}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('CoursePicker', { roundIndex: i, rounds: !isGame })}
              >
                <View style={s.courseEmptyPin}>
                  <Feather name="map-pin" size={20} color={theme.accent.primary} />
                </View>
                <Text style={s.courseEmptyTitle}>{t('setup.screen.pickCourse')}</Text>
                <Text style={s.courseEmptyHint}>{t('setup.screen.pickCourseHint')}</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}
      {!isGame && (
        <TouchableOpacity style={s.addRoundBtn} onPress={addRound}>
          <Feather name="plus-circle" size={14} color={theme.accent.primary} style={{ marginRight: 6 }} />
          <Text style={s.addRoundBtnText}>{t('setup.screen.addRound')}</Text>
        </TouchableOpacity>
      )}
    </>
  );

  const renderScoringStep = () => (
    <>
      <Text style={s.stepOverline}>{t('setup.screen.scoringOverline')}</Text>
      <Text style={s.stepPrompt}>{t('setup.screen.scoringPrompt')}</Text>
      <Text style={s.stepSubtitle}>
        {rounds.length > 1
          ? t('setup.screen.scoringSubRounds')
          : t('setup.screen.scoringSubOne')}
      </Text>
      {rounds.length <= 1 ? (
        <ScoringModePicker
          value={settings.scoringMode}
          onChange={(mode) => setSettings((prev) => ({ ...prev, scoringMode: mode }))}
          playerCount={players.length}
          settings={settings}
          onSettingsChange={setSettings}
          // One round: "same teams every round" has nothing to apply to.
          hideFixedTeams
        />
      ) : rounds.map((r, i) => (
        <View key={r.id ?? `scoring-round-${i}`} style={s.teesRoundBlock}>
          <Text style={[s.roundLabel, s.teesRoundLabel]}>{t('setup.screen.roundCourse', { n: i + 1, course: r.courseName || t('setup.screen.courseFallback') })}</Text>
          <View style={s.teesRoundCard}>
            <ScoringModePicker
              value={r.scoringMode ?? settings.scoringMode}
              onChange={(mode) => {
                setRounds((prev) => prev.map((x, j) => (j === i ? { ...x, scoringMode: mode } : x)));
                // Round 1's format doubles as the tournament default so the
                // review label and rounds left untouched stay coherent.
                if (i === 0) setSettings((prev) => ({ ...prev, scoringMode: mode }));
              }}
              playerCount={players.length}
              settings={settings}
              onSettingsChange={setSettings}
              hideTeamsControls={showTeamsStep}
            />
          </View>
        </View>
      ))}
    </>
  );

  const renderTeamsStep = () => (
    <>
      <Text style={s.stepOverline}>{t('setup.screen.teamsOverline')}</Text>
      <Text style={s.stepPrompt}>{t('setup.screen.teamsPrompt')}</Text>
      <Text style={s.stepSubtitle}>
        {t('setup.screen.teamsSub')}
      </Text>
      <TeamsSettingsFields
        value={settings.scoringMode}
        playerCount={players.length}
        settings={settings}
        onSettingsChange={setSettings}
      />
    </>
  );

  const renderTeesStep = () => (
    <>
      <Text style={s.stepOverline}>{t('setup.screen.teesOverline')}</Text>
      <Text style={s.stepPrompt}>{t('setup.screen.teesPrompt')}</Text>
      <Text style={s.stepSubtitle}>
        {t('setup.screen.teesSub')}
      </Text>
      {rounds.map((r, i) => (
        <View key={r.id ?? `round-${i}`} style={s.teesRoundBlock}>
          {!isGame && <Text style={[s.roundLabel, s.teesRoundLabel]}>{t('setup.screen.round', { n: i + 1 })}</Text>}
          <View style={s.teesRoundCard}>
            <RoundTeeAssignments
              round={r}
              players={players}
              theme={theme}
              onChange={(patch) => handleRoundTeesChange(i, patch)}
              leagueLocks={i === 0 ? leagueLocks : undefined}
            />
          </View>
        </View>
      ))}
    </>
  );

  const renderAddRatingLink = (unratedTee) => (
    <TouchableOpacity
      onPress={() => navigation.navigate('CourseEditor', {
        roundIndex: 0,
        courseName: rounds[0].courseName || t('setup.screen.round', { n: 1 }),
        initialHoles: rounds[0].holes,
        initialTees: rounds[0].tees ?? [],
        onSave: handleHolesSaved,
        courseId: rounds[0].courseId ?? null,
      })}
      activeOpacity={0.7}
      accessibilityRole="link"
      style={{ paddingVertical: 6 }}
    >
      <Text style={[s.leagueSub, { color: theme.accent.primary, fontFamily: 'PlusJakartaSans-Bold' }]}>
        {unratedTee ? t('league.setup.addRatingTee', { tee: unratedTee }) : t('league.setup.addRating')}
      </Text>
    </TouchableOpacity>
  );

  const renderLeaguePicker = () => (setupLeagues.length > 1 ? (
    <View style={s.leaguePicker}>
      {setupLeagues.map((l) => {
        const on = l.id === league.id;
        return (
          <TouchableOpacity
            key={l.id}
            style={[s.leagueChip, on && s.leagueChipOn]}
            onPress={() => setLeaguePick(l.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[s.leagueChipText, on && s.leagueChipTextOn]} numberOfLines={1}>{l.name}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  ) : null);

  // The "League cards" list (D5 B): my row carries my switch and the same
  // reasons the single switch gives; the other members are asked on their phone.
  const renderLeagueList = () => {
    const monthKey = cardMonth(new Date());
    const month = monthName(monthKey);
    const hcp = league.leagueHandicap;
    const unratedTee = !leagueRated ? setupPlayerTee(rounds[0], myPlayer.id)?.label ?? null : null;
    let sub;
    if (!leagueEligibleRound) sub = t('league.setup.eighteenOnly');
    else if (!leagueRated) {
      sub = unratedTee ? t('league.setup.unratedTees', { tee: unratedTee, month }) : t('league.setup.unratedTee', { month });
    } else if (hcp == null) sub = t('league.cards.meSubNoHcp', { month });
    else {
      sub = t('league.cards.meSub', {
        month,
        strokes: leagueStrokes(rounds[0], myPlayer.id, hcp),
        hcp: formatNumber(hcp, { decimals: 1 }),
      });
    }
    const state = leagueStatus.loading ? 'loading' : leagueStatus.error ? 'error' : 'ready';
    return (
      <LeagueCardsList
        title={t('league.cards.title', { league: league.name })}
        state={state}
        rows={leagueRows}
        monthKey={monthKey}
        onRetry={leagueStatus.retry}
        me={{
          sub,
          value: leagueActive,
          onChange: setLeagueOn,
          disabled: !leagueEligibleRound || !leagueRated,
          label: t('league.cards.switchLabel', { league: league.name }),
          extra: leagueEligibleRound && !leagueRated ? renderAddRatingLink(unratedTee) : null,
        }}
        others={leagueEligibleRound ? {
          isOn: (row) => othersOn.has(row.playerId),
          onChange: (row, on) => toggleOther(row.playerId, on),
          label: (row) => t('league.cards.otherSwitchLabel', { name: row.name, league: league.name }),
        } : null}
      >
        {renderLeaguePicker()}
      </LeagueCardsList>
    );
  };

  const renderLeagueSwitch = () => {
    const hcp = league.leagueHandicap;
    const month = monthName(cardMonth(new Date()));
    let sub;
    const unratedTee = !leagueRated ? setupPlayerTee(rounds[0], myPlayer.id)?.label ?? null : null;
    if (!leagueEligibleRound) sub = t('league.setup.eighteenOnly');
    else if (!leagueRated) {
      sub = unratedTee ? t('league.setup.unratedTees', { tee: unratedTee, month }) : t('league.setup.unratedTee', { month });
    } else if (!leagueOn) sub = null;
    else if (hcp == null) sub = t('league.setup.subNoHcp', { month });
    else {
      const strokes = leagueStrokes(rounds[0], myPlayer.id, hcp);
      sub = t('league.setup.sub', { month, strokes, hcp: formatNumber(hcp, { decimals: 1 }) });
    }
    return (
      <View style={s.leagueCard}>
        <View style={s.leagueRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.leagueTitle}>{t('league.cards.switchLabel', { league: league.name })}</Text>
            {!!sub && <Text style={s.leagueSub}>{sub}</Text>}
            {leagueEligibleRound && !leagueRated && renderAddRatingLink(unratedTee)}
          </View>
          <Switch
            value={leagueActive}
            onValueChange={setLeagueOn}
            disabled={!leagueEligibleRound || !leagueRated}
            accessibilityLabel={t('league.cards.switchLabel', { league: league.name })}
            trackColor={{ true: theme.accent.primary }}
          />
        </View>
        {renderLeaguePicker()}
      </View>
    );
  };

  const renderReviewStep = () => {
    const hasScoringStep = steps.includes('scoring');
    // For a solo game there is no scoring choice — show a neutral label
    // rather than whatever mode happens to be left in settings.
    const scoringLabel = hasScoringStep
      ? t(getScoringMode(settings.scoringMode)?.labelKey ?? 'setup.screen.soloPlay')
      : t('setup.screen.soloPlay');
    const soloLeagueHcp = players.length === 1 ? leagueLocks?.[players[0].id]?.leagueHandicap : null;
    const playerSummary = players.length !== 1
      ? t('setup.screen.playerSummaryMany', { count: players.length })
      : soloLeagueHcp != null
        ? t('setup.screen.playerSummaryOneLeague', { name: players[0].name, hcp: formatNumber(soloLeagueHcp, { decimals: 1 }) })
        : t('setup.screen.playerSummaryOne', { name: players[0].name, hcp: players[0].handicap });
    const courseSummary = isGame
      ? (rounds[0]?.courseName || t('setup.screen.noCourse'))
      : t('setup.screen.roundsCount', { count: rounds.length });
    return (
      <>
        {/* Green hero recap */}
        <View style={s.reviewHero}>
          <Text style={s.reviewHeroOverline}>{t('setup.screen.reviewOverline')}</Text>
          <TextInput
            style={s.reviewNameInput}
            value={tournamentName}
            onChangeText={(v) => { setTournamentName(v); setNameTouched(true); }}
            placeholder={isGame ? t('setup.screen.gameNamePlaceholder') : t('setup.screen.tournamentNamePlaceholder')}
            placeholderTextColor="rgba(255,255,255,0.5)"
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor="#ffffff"
          />
          <View style={s.reviewChipRow}>
            <View style={s.reviewChip}>
              <Text style={s.reviewChipText}>
                {t('setup.screen.playersChip', { count: players.length })}
              </Text>
            </View>
            <View style={s.reviewChip}>
              <Text style={s.reviewChipText}>{scoringLabel}</Text>
            </View>
          </View>
        </View>

        <Text style={s.stepOverline}>{t('setup.screen.tapToEdit')}</Text>
        <View style={s.reviewList}>
          <TouchableOpacity
            style={[s.reviewRow, s.reviewRowDivider]}
            onPress={() => goToStep('players')}
          >
            <Feather name="users" size={14} color={theme.text.primary} style={s.reviewRowIcon} />
            <View style={{ flex: 1 }}>
              <Text style={s.reviewRowTitle}>{t('setup.screen.reviewPlayers')}</Text>
              <Text style={s.reviewRowSub}>{playerSummary}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={theme.text.muted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.reviewRow, s.reviewRowDivider]}
            onPress={() => goToStep(isGame ? 'course' : 'rounds')}
          >
            <Feather name="map-pin" size={14} color={theme.text.primary} style={s.reviewRowIcon} />
            <View style={{ flex: 1 }}>
              <Text style={s.reviewRowTitle}>{isGame ? t('setup.screen.reviewCourse') : t('setup.screen.reviewRounds')}</Text>
              <Text style={s.reviewRowSub}>{courseSummary}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={theme.text.muted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.reviewRow, (showTeamsStep || players.length >= 2) && s.reviewRowDivider]}
            onPress={() => goToStep('scoring')}
            disabled={!hasScoringStep}
          >
            <Feather name="target" size={14} color={theme.text.primary} style={s.reviewRowIcon} />
            <View style={{ flex: 1 }}>
              <Text style={s.reviewRowTitle}>{t('setup.screen.reviewScoring')}</Text>
              <Text style={s.reviewRowSub}>{scoringLabel}</Text>
            </View>
            {hasScoringStep && (
              <Feather name="chevron-right" size={18} color={theme.text.muted} />
            )}
          </TouchableOpacity>

          {showTeamsStep && (
            <TouchableOpacity
              style={[s.reviewRow, players.length >= 2 && s.reviewRowDivider]}
              onPress={() => goToStep('teams')}
            >
              <Feather name="users" size={14} color={theme.text.primary} style={s.reviewRowIcon} />
              <View style={{ flex: 1 }}>
                <Text style={s.reviewRowTitle}>{t('setup.screen.reviewTeams')}</Text>
                <Text style={s.reviewRowSub}>
                  {settings.fixedTeams ? t('setup.screen.sameTeams') : t('setup.screen.randomTeams')}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={theme.text.muted} />
            </TouchableOpacity>
          )}

          {players.length >= 2 && (
            <TouchableOpacity style={s.reviewRow} onPress={() => setShowStakes(true)} testID="review-stakes">
              <Feather name="credit-card" size={14} color={theme.text.primary} style={s.reviewRowIcon} />
              <View style={{ flex: 1 }}>
                <Text style={s.reviewRowTitle}>{t('stakes.title')}</Text>
                <Text style={s.reviewRowSub}>{stakesSummary(settings.stakes, t)}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={theme.text.muted} />
            </TouchableOpacity>
          )}
        </View>

        {leagueOffered && (leagueListMode ? renderLeagueList() : renderLeagueSwitch())}

        {leagueCheckingLeagues && <Text style={s.leagueSub}>{t('league.cards.checking')}</Text>}
        {leagueFailed && (
          <View style={s.leagueCard}>
            <Text style={s.leagueSub}>{t('league.setup.loadFailed')}</Text>
            <TouchableOpacity onPress={retryLeagues} accessibilityRole="button" style={{ paddingVertical: 6 }}>
              <Text style={[s.leagueSub, { color: theme.accent.primary, fontFamily: 'PlusJakartaSans-Bold' }]}>{t('league.setup.retry')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {finalStrokes.length > 0 && (
          <View style={[s.leagueCard, { paddingVertical: 12 }]}>
            <Text style={s.leagueTitle}>{t('league.setup.finalApplied')}</Text>
            {finalStrokes.map(({ player, extra }) => (
              <Text key={player.id} style={s.leagueSub}>{t('league.setup.finalExtra', { name: player.name, extra })}</Text>
            ))}
          </View>
        )}

        {!canStart && (
          <Text style={s.errorText}>
            {players.length < 1
              ? t('setup.screen.errNeedPlayer')
              : t('setup.screen.errNeedCourse')}
          </Text>
        )}
      </>
    );
  };

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      <WizardProgress step={step} totalSteps={steps.length} onBack={handleBack} />

      <ScrollView
        style={s.scrollView}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
      >
        {stepKey === 'players' && renderPlayersStep()}
        {(stepKey === 'course' || stepKey === 'rounds') && renderCourseStep()}
        {stepKey === 'scoring' && renderScoringStep()}
        {stepKey === 'teams' && renderTeamsStep()}
        {stepKey === 'tees' && renderTeesStep()}
        {stepKey === 'review' && renderReviewStep()}
      </ScrollView>

      <WizardNav
        isFirstStep={step === 0}
        isLastStep={isLastStep}
        nextEnabled={nextEnabled}
        nextLabel={nextLabel}
        onBack={handleBack}
        onNext={handleNext}
      />

      <StakesSheet
        visible={showStakes}
        value={settings.stakes}
        playerCount={players.length}
        noSkins={rounds.every((r) => isScrambleMode(r.scoringMode ?? settings.scoringMode))}
        onSave={(stakes) => { setSettings((prev) => ({ ...prev, stakes })); setShowStakes(false); }}
        onClose={() => setShowStakes(false)}
      />

      <PostCreateInviteModal
        visible={postCreateInvite.visible}
        loading={postCreateInvite.loading}
        link={postCreateInvite.link}
        error={postCreateInvite.error}
        onRequestClose={requestClosePostCreateInvite}
        onShare={sharePostCreateInvite}
      />
    </ScreenContainer>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    container: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: theme.bg.primary,
    },
    scrollView: {
      flex: 1,
    },
    content: {
      padding: 20,
      paddingBottom: 40,
    },

    /* Step heading */
    stepOverline: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.accent.primary,
      fontSize: 11,
      letterSpacing: 1.8,
      textTransform: 'uppercase',
      marginBottom: 6,
    },
    stepPrompt: {
      fontFamily: 'PlayfairDisplay-Bold',
      fontSize: 26,
      color: theme.text.primary,
      letterSpacing: -0.3,
    },
    stepSubtitle: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.secondary,
      fontSize: 13,
      marginTop: 6,
      marginBottom: 18,
    },

    /* Players slot grid */
    slotGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },
    slotFilled: {
      position: 'relative',
      width: '48%',
      marginBottom: 10,
      minHeight: 116,
      backgroundColor: theme.bg.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      padding: 14,
      alignItems: 'center',
      justifyContent: 'center',
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    slotRemove: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: theme.bg.secondary,
      borderWidth: 1,
      borderColor: theme.border.default,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2,
    },
    slotAvatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.isDark ? theme.bg.secondary : '#006747',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      marginBottom: 8,
    },
    slotAvatarImg: { width: '100%', height: '100%' },
    slotAvatarText: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: semantic.winner.dark,
      fontSize: 15,
      ...circleText,
    },
    slotName: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.primary,
      fontSize: 14,
    },
    slotHcp: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.secondary,
      fontSize: 12,
      marginTop: 3,
    },
    slotEmpty: {
      width: '48%',
      marginBottom: 10,
      minHeight: 116,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: theme.accent.primary + '40',
      borderStyle: 'dashed',
      backgroundColor: theme.accent.light,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 14,
    },
    slotPlus: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1.5,
      borderColor: theme.accent.primary,
      borderStyle: 'dashed',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    slotEmptyLabel: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.accent.primary,
      fontSize: 11,
      letterSpacing: 0.8,
    },

    /* Tournament name (rounds step) */
    nameGroup: { marginBottom: 18 },
    nameLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.secondary,
      fontSize: 13,
      letterSpacing: 0.5,
      marginBottom: 8,
    },
    nameInput: {
      backgroundColor: theme.bg.card,
      color: theme.text.primary,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      padding: 13,
      fontSize: 15,
      fontFamily: 'PlusJakartaSans-Bold',
      ...(theme.isDark ? {} : theme.shadow.card),
    },

    /* Rounds */
    courseBlock: {
      marginBottom: 12,
    },
    roundHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    roundLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.secondary,
      fontSize: 13,
      letterSpacing: 0.5,
    },
    removeRoundBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 4,
      paddingHorizontal: 10,
    },
    removeRoundText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.destructive,
      fontSize: 13,
      marginLeft: 4,
    },

    /* Course card */
    courseCard: {
      backgroundColor: theme.bg.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      overflow: 'hidden',
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    // The filled course card relies on its children for padding; the layout
    // dropdown card holds RoundLayoutSelect directly, so it needs its own.
    layoutCard: {
      backgroundColor: theme.bg.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      padding: 14,
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    courseCardTop: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 13,
    },
    courseIdentity: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
    },
    coursePin: {
      width: 32,
      height: 32,
      borderRadius: 9,
      backgroundColor: theme.accent.light,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 10,
    },
    courseCardName: {
      flex: 1,
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.primary,
      fontSize: 15,
    },
    courseNameInput: {
      flex: 1,
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.primary,
      fontSize: 15,
      padding: 0,
      borderBottomWidth: 1,
      borderBottomColor: theme.accent.primary,
    },
    coursePencil: {
      width: 30,
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 6,
    },
    courseStats: {
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 13,
      paddingBottom: 13,
    },
    courseStat: {
      flex: 1,
      backgroundColor: theme.bg.secondary,
      borderRadius: 10,
      paddingVertical: 8,
      alignItems: 'center',
    },
    courseStatValue: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.primary,
      fontSize: 15,
    },
    courseStatLabel: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.muted,
      fontSize: 9,
      letterSpacing: 0.6,
      marginTop: 2,
    },
    courseConfigRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 12,
      paddingHorizontal: 13,
      borderTopWidth: 1,
      borderTopColor: theme.border.subtle,
    },
    courseConfigText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.accent.primary,
      fontSize: 14,
    },
    courseEmpty: {
      backgroundColor: theme.bg.card,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: theme.accent.primary + '40',
      borderStyle: 'dashed',
      paddingVertical: 26,
      paddingHorizontal: 16,
      alignItems: 'center',
    },
    courseEmptyPin: {
      width: 44,
      height: 44,
      borderRadius: 13,
      backgroundColor: theme.accent.light,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    courseEmptyTitle: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.accent.primary,
      fontSize: 14,
    },
    courseEmptyHint: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.muted,
      fontSize: 12,
      marginTop: 3,
    },

    /* Add Round */
    addRoundBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border.default,
      borderStyle: 'dashed',
      backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.primary,
      padding: 14,
      marginTop: 4,
    },
    addRoundBtnText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.accent.primary,
      fontSize: 14,
      textAlign: 'center',
    },

    /* Tees step */
    teesRoundBlock: { marginTop: 8, marginBottom: 16 },
    teesRoundLabel: { marginBottom: 8 },
    teesRoundCard: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      padding: 16,
      ...(theme.isDark ? {} : theme.shadow.card),
    },

    /* Empty / error states */
    errorText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.destructive,
      fontSize: 12,
      marginBottom: 8,
      marginTop: 8,
    },

    /* Review hero */
    reviewHero: {
      backgroundColor: HERO_GREEN,
      borderRadius: 20,
      padding: 20,
      marginBottom: 20,
    },
    reviewHeroOverline: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: 'rgba(255,255,255,0.55)',
      fontSize: 10,
      letterSpacing: 1.6,
    },
    reviewNameInput: {
      fontFamily: 'PlayfairDisplay-Bold',
      color: '#ffffff',
      fontSize: 24,
      letterSpacing: -0.3,
      marginTop: 6,
      paddingVertical: 4,
    },
    reviewChipRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 12,
    },
    reviewChip: {
      backgroundColor: 'rgba(255,255,255,0.14)',
      borderRadius: 999,
      paddingVertical: 6,
      paddingHorizontal: 12,
    },
    reviewChipText: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: '#ffffff',
      fontSize: 11,
    },

    /* Review tap-to-edit list */
    reviewList: {
      backgroundColor: theme.bg.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      overflow: 'hidden',
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    reviewRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
    },
    reviewRowDivider: {
      borderBottomWidth: 1,
      borderBottomColor: theme.border.subtle,
    },
    reviewRowIcon: {
      marginRight: 12,
    },
    reviewRowTitle: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.primary,
      fontSize: 14,
    },
    reviewRowSub: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.secondary,
      fontSize: 12,
      marginTop: 2,
    },

    /* League switch (review step) */
    leagueCard: {
      backgroundColor: theme.bg.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingHorizontal: 14,
      marginTop: 16,
    },
    leagueRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
    leagueTitle: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 14 },
    leagueSub: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 4,
    },
    leaguePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 13 },
    leagueChip: {
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
      borderWidth: 1, borderColor: theme.border.default, maxWidth: '100%',
    },
    leagueChipOn: { backgroundColor: theme.accent.light, borderColor: theme.accent.primary },
    leagueChipText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 12 },
    leagueChipTextOn: { color: theme.accent.primary },

  });
}
