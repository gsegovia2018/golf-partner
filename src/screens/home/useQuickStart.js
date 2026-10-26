import { useEffect, useState, useCallback, useRef } from 'react';
import { Share } from 'react-native';
import { afterTabSettles } from '../../navigation/tabSettle';
import { pushTournamentScorecard } from '../../navigation/openScorecard';
import {
  GAME_DEFAULT_SETTINGS, generateInviteCode, buildJoinLink, lastTeeForPlayerOnCourse,
} from '../../store/tournamentStore';
import {
  fetchMyPlayers, getCachedMyPlayers, getCachedQuickStartCourseList, loadQuickStartCourses as loadQuickStartCourseList,
} from '../../store/libraryStore';
import {
  buildQuickStartGameName,
  buildQuickStartRound,
  buildQuickStartTournamentDraft,
  resolveQuickStartPlayerTees,
} from '../../lib/quickStartGame';
import { mutate } from '../../store/mutate';
import { shouldOfferPostCreateEditorInvite } from '../setupWizard';
import { useT } from '../../i18n';
import { showError, currentOrigin } from './homeShared';

const NO_INVITE = { visible: false, loading: false, link: '', error: '', tournament: null };

// Quick start: the favourite courses and my players (device copy first, then
// the network), Start / Edit details, and the editor invite offered after a
// group game is created. `onCreated` puts the new game into Home's state.
export function useQuickStart({ navigation, currentUserId, onCreated }) {
  const tx = useT();
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;
  const quickStartCourseLoadRef = useRef(0);
  const quickStartPlayerLoadRef = useRef(0);
  const quickStartStartingRef = useRef(false);
  const [quickStartCourses, setQuickStartCourses] = useState([]);
  const [quickStartCoursesLoading, setQuickStartCoursesLoading] = useState(false);
  const [quickStartPlayers, setQuickStartPlayers] = useState([]);
  const [quickStartPlayersLoading, setQuickStartPlayersLoading] = useState(false);
  const [quickStartPlayersError, setQuickStartPlayersError] = useState(null);
  const [quickStartStarting, setQuickStartStarting] = useState(false);
  const [postCreateInvite, setPostCreateInvite] = useState(NO_INVITE);

  const loadQuickStartCourses = useCallback(async () => {
    const requestId = quickStartCourseLoadRef.current + 1;
    quickStartCourseLoadRef.current = requestId;
    const userId = currentUserId;
    if (!userId) {
      setQuickStartCourses([]);
      setQuickStartCoursesLoading(false);
      return;
    }
    setQuickStartCoursesLoading(true);
    // The device's list first, like the players below: the network load is
    // two round-trips and painted "Cargando campos favoritos" well after the
    // rest of Home.
    const cached = await getCachedQuickStartCourseList();
    if (cached.length > 0 && quickStartCourseLoadRef.current === requestId && currentUserIdRef.current === userId) {
      setQuickStartCourses(cached);
    }
    try {
      const library = await loadQuickStartCourseList({ userId });
      if (quickStartCourseLoadRef.current !== requestId || currentUserIdRef.current !== userId) return;
      setQuickStartCourses(library?.courses ?? []);
    } catch (_) {
      if (quickStartCourseLoadRef.current !== requestId || currentUserIdRef.current !== userId) return;
      setQuickStartCourses([]);
    } finally {
      if (quickStartCourseLoadRef.current !== requestId || currentUserIdRef.current !== userId) return;
      setQuickStartCoursesLoading(false);
    }
  }, [currentUserId]);

  const loadQuickStartPlayers = useCallback(async () => {
    const requestId = quickStartPlayerLoadRef.current + 1;
    quickStartPlayerLoadRef.current = requestId;
    const userId = currentUserId;
    if (!userId) {
      setQuickStartPlayers([]);
      setQuickStartPlayersError(null);
      setQuickStartPlayersLoading(false);
      return;
    }
    setQuickStartPlayersLoading(true);
    setQuickStartPlayersError(null);
    // The cached list first, so the sheet pre-selects me without waiting on
    // the network read (late or never on a slow signal).
    const cached = await getCachedMyPlayers(userId);
    if (cached && quickStartPlayerLoadRef.current === requestId && currentUserIdRef.current === userId) {
      setQuickStartPlayers(cached);
    }
    try {
      const players = await fetchMyPlayers();
      if (quickStartPlayerLoadRef.current !== requestId || currentUserIdRef.current !== userId) return;
      setQuickStartPlayers(players);
    } catch (err) {
      if (quickStartPlayerLoadRef.current !== requestId || currentUserIdRef.current !== userId) return;
      if (!cached) setQuickStartPlayersError(err?.message ?? tx('home.error.loadPlayers'));
    } finally {
      if (quickStartPlayerLoadRef.current !== requestId || currentUserIdRef.current !== userId) return;
      setQuickStartPlayersLoading(false);
    }
  }, [currentUserId, tx]);

  useEffect(() => {
    loadQuickStartCourses();
    loadQuickStartPlayers();
    const unsubscribe = navigation.addListener('focus', () => afterTabSettles(() => {
      loadQuickStartCourses();
      loadQuickStartPlayers();
    }));
    return unsubscribe;
  }, [loadQuickStartCourses, loadQuickStartPlayers, navigation]);

  async function resolveQuickStartTees(course, players) {
    const lastTeeEntries = await Promise.all(players.map(async (player) => {
      if (!course?.id || !player?.id) return [player?.id, null];
      try {
        return [player.id, await lastTeeForPlayerOnCourse(course.id, player.id)];
      } catch (_) {
        return [player.id, null];
      }
    }));
    const lastTeeByPlayer = Object.fromEntries(
      lastTeeEntries.filter(([playerId]) => playerId),
    );
    return resolveQuickStartPlayerTees({
      course,
      players,
      currentUserId,
      lastTeeByPlayer,
    });
  }

  function quickStartPlayersWithFallback(players) {
    const selectedPlayers = Array.isArray(players) ? players.filter(Boolean) : [];
    if (selectedPlayers.length > 0) return selectedPlayers;
    const me = quickStartPlayers.find((p) => p?.user_id === currentUserId || p?.userId === currentUserId);
    return me ? [me] : [];
  }

  const navigateToCreatedGame = useCallback(() => {
    pushTournamentScorecard(navigation, { roundIndex: 0 });
  }, [navigation]);

  function closePostCreateInvite() {
    const created = postCreateInvite.tournament;
    setPostCreateInvite(NO_INVITE);
    if (created) navigateToCreatedGame();
  }

  function requestClosePostCreateInvite() {
    if (postCreateInvite.loading) return;
    closePostCreateInvite();
  }

  async function sharePostCreateInvite() {
    if (!postCreateInvite.link) return;
    try {
      const label = postCreateInvite.tournament?.name ?? tx('home.share.myGame');
      await Share.share({
        message: tx('home.share.joinMessage', { name: label, link: postCreateInvite.link }),
      });
    } catch (err) {
      showError(err?.message ?? tx('home.error.shareInvite'));
    }
  }

  async function handleQuickStartStart({ course, players }) {
    if (quickStartStartingRef.current) return;
    if (!course) {
      showError(tx('home.error.chooseCourseStart'));
      return;
    }
    const selectedPlayers = Array.isArray(players) ? players.filter(Boolean) : [];
    if (selectedPlayers.length === 0) {
      showError(tx('home.error.selectPlayer'));
      return;
    }
    quickStartStartingRef.current = true;
    setQuickStartStarting(true);
    try {
      const playerTees = await resolveQuickStartTees(course, selectedPlayers);
      const created = buildQuickStartTournamentDraft({
        course,
        players: selectedPlayers,
        playerTees,
        settings: GAME_DEFAULT_SETTINGS,
        userId: currentUserId,
      });
      await mutate(created, { type: 'tournament.create', tournament: created });
      onCreated(created);

      if (shouldOfferPostCreateEditorInvite('game', selectedPlayers, currentUserId)) {
        setPostCreateInvite({
          visible: true,
          loading: true,
          link: '',
          error: '',
          tournament: created,
        });
        try {
          const { editorCode } = await generateInviteCode(created.id);
          setPostCreateInvite({
            visible: true,
            loading: false,
            link: buildJoinLink(currentOrigin(), editorCode),
            error: '',
            tournament: created,
          });
        } catch (inviteErr) {
          setPostCreateInvite({
            visible: true,
            loading: false,
            link: '',
            error: inviteErr?.message ?? tx('home.error.createInviteLink'),
            tournament: created,
          });
        }
        return;
      }

      navigateToCreatedGame();
    } catch (err) {
      showError(err?.message ?? tx('home.error.createGame'));
    } finally {
      quickStartStartingRef.current = false;
      setQuickStartStarting(false);
    }
  }

  async function handleQuickStartEditDetails({ course, players }) {
    if (!course) {
      showError(tx('home.error.chooseCourseEdit'));
      return;
    }
    try {
      const selectedPlayers = quickStartPlayersWithFallback(players);
      const playerTees = await resolveQuickStartTees(course, selectedPlayers);
      const round = buildQuickStartRound({ course, players: selectedPlayers, playerTees });
      navigation.navigate('Setup', {
        kind: 'game',
        initialStep: 'tees',
        prefill: {
          // Same name the Start button would give it — the wizard only
          // names a game after a course picked inside the wizard.
          name: buildQuickStartGameName(course?.name),
          players: selectedPlayers,
          rounds: [round],
          settings: GAME_DEFAULT_SETTINGS,
        },
      });
    } catch (err) {
      showError(err?.message ?? tx('home.error.prepareGame'));
    }
  }

  return {
    courses: quickStartCourses,
    coursesLoading: quickStartCoursesLoading,
    players: quickStartPlayers,
    playersLoading: quickStartPlayersLoading,
    playersError: quickStartPlayersError,
    starting: quickStartStarting,
    loadPlayers: loadQuickStartPlayers,
    start: handleQuickStartStart,
    editDetails: handleQuickStartEditDetails,
    postCreateInvite,
    requestClosePostCreateInvite,
    sharePostCreateInvite,
  };
}
