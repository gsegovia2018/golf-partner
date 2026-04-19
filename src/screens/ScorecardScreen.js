import React, { useEffect, useRef, useState, useCallback, useMemo, startTransition } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Modal, Pressable, KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Feather } from '@expo/vector-icons';

const RUNNING_SCORE_KEY = '@scorecard_show_running_score';
import {
  loadTournament, saveTournament, subscribeTournamentChanges,
  calcStablefordPoints, calcBestWorstBall, pickupStrokes, DEFAULT_SETTINGS,
  roundPairLeaderboard, roundPairClinched,
} from '../store/tournamentStore';
import { useTheme } from '../theme/ThemeContext';
import PullToRefresh from '../components/PullToRefresh';
import MediaLightbox from '../components/MediaLightbox';
import AttachMediaSheet from '../components/AttachMediaSheet';
import CaptureMenuSheet from '../components/CaptureMenuSheet';
import { pickMedia, attachMedia } from '../lib/mediaCapture';
import { useRoundMedia } from '../hooks/useRoundMedia';
import { Alert } from 'react-native';

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

function celebrationFor(par, strokes) {
  if (!par || !strokes) return null;
  if (strokes === 1 && par > 1) return 'HOLE IN ONE';
  const diff = par - strokes;
  if (diff >= 3) return 'ALBATROSS';
  if (diff === 2) return 'EAGLE';
  if (diff === 1) return 'BIRDIE';
  return null;
}

export default function ScorecardScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const paramRoundIndex = route.params?.roundIndex;
  const [tournament, setTournament] = useState(null);
  const [scores, setScores] = useState({});
  const [notes, setNotes] = useState('');
  const [view, setView] = useState('hole'); // 'grid' | 'hole'
  const [currentHole, setCurrentHole] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const tournamentRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const notesSaveTimeoutRef = useRef(null);
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
  const { items: roundMediaItems } = useRoundMedia(tournament?.rounds?.[paramRoundIndex ?? tournament?.currentRound ?? 0]?.id);
  const roundMediaCount = roundMediaItems.length;
  const roundIndex = paramRoundIndex ?? tournament?.currentRound ?? 0;

  useEffect(() => { tournamentRef.current = tournament; }, [tournament]);

  const reload = useCallback(async ({ preserveLocalEdits = false } = {}) => {
    const t = await loadTournament();
    if (!t) return;
    const idx = paramRoundIndex ?? t.currentRound;
    const round = t.rounds[idx];
    const roundScores = round?.scores ?? {};
    setTournament(t);
    if (!preserveLocalEdits) {
      setScores(roundScores);
      setNotes(round?.notes ?? '');

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
  }, [paramRoundIndex]);

  useEffect(() => {
    reload();
    const unsub = subscribeTournamentChanges(() => {
      reload({ preserveLocalEdits: pendingSaveRef.current });
    });
    return unsub;
  }, [reload]);

  // Re-run the auto-jump to the first unplayed hole whenever the round
  // being displayed changes. Without this, switching from round 1 to
  // round 2 would leave the pager stuck on whatever hole was active
  // in round 1.
  useEffect(() => {
    hasAutoJumpedRef.current = false;
  }, [paramRoundIndex]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await reload(); } finally { setRefreshing(false); }
  }, [reload]);

  const autoSave = useCallback((newScores) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    pendingSaveRef.current = true;
    saveTimeoutRef.current = setTimeout(async () => {
      saveTimeoutRef.current = null;
      if (!tournamentRef.current) {
        if (!notesSaveTimeoutRef.current) pendingSaveRef.current = false;
        return;
      }
      const updated = { ...tournamentRef.current };
      updated.rounds = [...updated.rounds];
      updated.rounds[roundIndex] = { ...updated.rounds[roundIndex], scores: newScores };
      try {
        await saveTournament(updated);
      } finally {
        if (!saveTimeoutRef.current && !notesSaveTimeoutRef.current) {
          pendingSaveRef.current = false;
        }
      }
    }, 300);
  }, [roundIndex]);

  const saveNotes = useCallback((value) => {
    setNotes(value);
    if (notesSaveTimeoutRef.current) clearTimeout(notesSaveTimeoutRef.current);
    pendingSaveRef.current = true;
    notesSaveTimeoutRef.current = setTimeout(async () => {
      notesSaveTimeoutRef.current = null;
      if (!tournamentRef.current) {
        if (!saveTimeoutRef.current) pendingSaveRef.current = false;
        return;
      }
      const updated = { ...tournamentRef.current };
      updated.rounds = [...updated.rounds];
      updated.rounds[roundIndex] = { ...updated.rounds[roundIndex], notes: value };
      try {
        await saveTournament(updated);
      } finally {
        if (!saveTimeoutRef.current && !notesSaveTimeoutRef.current) {
          pendingSaveRef.current = false;
        }
      }
    }, 400);
  }, [roundIndex]);

  // Hoist memoised derivations above the early return so the hook order
  // stays stable while the tournament loads.
  const round = tournament?.rounds?.[roundIndex] ?? null;
  const players = tournament?.players ?? [];
  const settings = useMemo(
    () => ({ ...DEFAULT_SETTINGS, ...(tournament?.settings ?? {}) }),
    [tournament?.settings],
  );
  const isBestBall = settings.scoringMode === 'bestball';
  const liveRound = useMemo(
    () => (round ? { ...round, scores } : null),
    [round, scores],
  );
  const bbResult = useMemo(
    () => (isBestBall && liveRound ? calcBestWorstBall(liveRound, players) : null),
    [isBestBall, liveRound, players],
  );

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

  const setScore = useCallback((playerId, holeNumber, value) => {
    const parsed = value === '' ? undefined : parseInt(value, 10) || undefined;
    const holePar = round?.holes?.find((h) => h.number === holeNumber)?.par ?? 4;
    setScores((prev) => {
      const current = prev[playerId]?.[holeNumber];
      const next = { ...prev, [playerId]: { ...prev[playerId], [holeNumber]: parsed } };
      autoSave(next);
      if (parsed != null && parsed !== current) {
        const label = celebrationFor(holePar, parsed);
        if (label) triggerCelebration(playerId, holeNumber, label);
      }
      return next;
    });
  }, [round, autoSave, triggerCelebration]);

  const stepScore = useCallback((playerId, holeNumber, delta) => {
    haptic('light');
    const anim = getScoreAnim(playerId);
    anim.setValue(1.18);
    Animated.spring(anim, { toValue: 1, friction: 5, useNativeDriver: true }).start();

    const holePar = round?.holes?.find((h) => h.number === holeNumber)?.par ?? 4;
    setScores((prev) => {
      const current = prev[playerId]?.[holeNumber];
      // First interaction on an un-scored hole: + lands on par, - lands on birdie.
      // After that, +/- step by one as usual. Minimum is 1 stroke.
      let newStrokes;
      if (current == null) {
        newStrokes = delta > 0 ? holePar : Math.max(1, holePar - 1);
      } else {
        newStrokes = Math.max(1, current + delta);
      }
      const next = { ...prev, [playerId]: { ...prev[playerId], [holeNumber]: newStrokes } };
      autoSave(next);
      if (newStrokes !== current) {
        const label = celebrationFor(holePar, newStrokes);
        if (label) triggerCelebration(playerId, holeNumber, label);
      }
      return next;
    });
  }, [round, autoSave, triggerCelebration, getScoreAnim]);

  // Totals computed once per (round, players, scores) change. The per-hole
  // pager pages do NOT read this — it only feeds the outside totals strip.
  const playerTotalsMap = useMemo(() => {
    const map = new Map();
    if (!round) return map;
    players.forEach((player) => {
      const handicap = round.playerHandicaps?.[player.id] ?? player.handicap;
      let pts = 0;
      let str = 0;
      round.holes.forEach((hole) => {
        const sc = scores[player.id]?.[hole.number];
        if (sc) {
          str += sc;
          pts += calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
        }
      });
      map.set(player.id, { pts, str });
    });
    return map;
  }, [round, players, scores]);

  const playerTotals = useCallback(
    (player) => playerTotalsMap.get(player.id) ?? { pts: 0, str: 0 },
    [playerTotalsMap],
  );

  const goToPrevHole = useCallback(() => {
    haptic('medium');
    setCurrentHole((h) => Math.max(1, h - 1));
  }, []);

  const [showRunning, setShowRunning] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(RUNNING_SCORE_KEY).then((v) => {
      if (v === '1') setShowRunning(true);
    }).catch(() => {});
  }, []);
  const toggleRunning = useCallback(() => {
    setShowRunning((v) => {
      const next = !v;
      AsyncStorage.setItem(RUNNING_SCORE_KEY, next ? '1' : '0').catch(() => {});
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
    setCurrentHole((h) => Math.min(18, h + 1));
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

  const goBack = useCallback(() => navigation.goBack(), [navigation]);

  const openCapturePicker = useCallback(() => {
    setCaptureMenuVisible(true);
  }, []);

  const handleCaptureMenuSelect = useCallback(async ({ source, mediaTypes }) => {
    setCaptureMenuVisible(false);
    try {
      const asset = await pickMedia({ source, mediaTypes });
      if (asset) setPickerAsset(asset);
    } catch (e) {
      Alert.alert('No se pudo capturar', String(e?.message ?? e));
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
      });
    } catch (e) {
      Alert.alert('No se pudo adjuntar', String(e?.message ?? e));
    }
  }, [pickerAsset, tournament, round]);

  if (!tournament || !round) return null;

  const hole = round.holes.find((h) => h.number === currentHole);

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      {/* Header with inline view toggle (small, doesn't take a full row) */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Scorecard</Text>
        <View style={s.headerRight}>
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
          <TouchableOpacity
            onPress={openCapturePicker}
            style={s.cameraBtn}
            accessibilityLabel="Adjuntar recuerdo"
          >
            <Feather name="camera" size={20} color={theme.accent.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {view === 'hole' ? (
        <HoleView
          round={round}
          roundIndex={roundIndex}
          players={players}
          scores={scores}
          notes={notes}
          currentHole={currentHole}
          hole={hole}
          isBestBall={isBestBall}
          bbResult={bbResult}
          settings={settings}
          onStep={stepScore}
          onSetScore={setScore}
          onNotesChange={saveNotes}
          onPrev={goToPrevHole}
          onNext={goToNextHole}
          onGoToHole={goToHole}
          onGoBack={goBack}
          playerTotals={playerTotals}
          showRunning={showRunning}
          getScoreAnim={getScoreAnim}
          celebration={celebration}
          celebrationAnim={celebrationAnim}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      ) : (
        <GridView
          round={round}
          roundIndex={roundIndex}
          players={players}
          scores={scores}
          notes={notes}
          onNotesChange={saveNotes}
          isBestBall={isBestBall}
          bbResult={bbResult}
          settings={settings}
          onSetScore={setScore}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      )}

      <CaptureMenuSheet
        visible={captureMenuVisible}
        onSelect={handleCaptureMenuSelect}
        onClose={() => setCaptureMenuVisible(false)}
        extraActions={roundMediaCount > 0 ? [{
          key: 'view',
          icon: 'image',
          label: `Ver recuerdos de esta ronda (${roundMediaCount})`,
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
    </SafeAreaView>
  );
}

// Memoized per-hole page. Extracted so a swipe that only changes the
// outside `currentHole` indicator does NOT re-render the other 17 pages
// in the pager — that's the main source of swipe lag.
const HolePage = React.memo(function HolePage({
  pageHole, width, height, courseName, roundIndex,
  round, players, scores,
  theme, s,
  onStep, onSetScore, getScoreAnim,
  showRunning, playerTotals,
}) {
  const pairs = round.pairs ?? [];
  const orderedPlayers = pairs.length === 2
    ? [...pairs[0], ...pairs[1]].map((pp) => players.find((p) => p.id === pp.id)).filter(Boolean)
    : players;

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

      {/* Player score cards */}
      <View style={s.playerCardsContent}>
        {orderedPlayers.map((player, idx) => {
          const pairIndex = pairs.findIndex((pair) => pair.some((pp) => pp.id === player.id));
          const pairColor = pairIndex === 0 ? theme.pairA : pairIndex === 1 ? theme.pairB : theme.text.muted;
          const isFirstOfPair = pairs.length === 2 && (idx === 0 || idx === 2);
          const pairLabelText = pairIndex === 0 ? 'Pair A' : 'Pair B';

          const handicap = round.playerHandicaps?.[player.id] ?? player.handicap;
          const strokes = scores[player.id]?.[pageHole.number];
          const pts = strokes != null
            ? calcStablefordPoints(pageHole.par, strokes, handicap, pageHole.strokeIndex)
            : null;

          const ptsColor = pts == null ? theme.text.muted
            : pts >= 3 ? theme.scoreColor('excellent')
            : pts >= 2 ? theme.scoreColor('good')
            : pts === 1 ? theme.scoreColor('neutral')
            : theme.scoreColor('poor');

          const extraShots = handicap >= pageHole.strokeIndex ? (Math.floor(handicap / 18) + (handicap % 18 >= pageHole.strokeIndex ? 1 : 0)) : 0;

          const pickup = pickupStrokes(pageHole.par, handicap, pageHole.strokeIndex);
          const isPickup = strokes != null && strokes >= pickup;

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
                      <Text style={s.playerCardName}>{player.name}</Text>
                      <Text style={s.playerCardHcp}>HCP {handicap}{extraShots > 0 ? ` +${extraShots}` : ''}</Text>
                      {showRunning && (
                        <Text style={s.playerCardRunning}>
                          {playerTotals(player).pts} pts
                        </Text>
                      )}
                    </View>
                  </View>
                  <View style={s.playerCardRight}>
                    <TouchableOpacity style={s.stepBtn} onPress={() => onStep(player.id, pageHole.number, -1)}>
                      <Feather name="minus" size={18} color={theme.text.primary} />
                    </TouchableOpacity>
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
                    <TouchableOpacity style={s.stepBtn} onPress={() => onStep(player.id, pageHole.number, 1)}>
                      <Feather name="plus" size={18} color={theme.text.primary} />
                    </TouchableOpacity>
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
                  </View>
                </View>
              </View>
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
});

function HoleView({ round, roundIndex, players, scores, notes, currentHole, hole, isBestBall, bbResult, settings, onStep, onSetScore, onNotesChange, onPrev, onNext, onGoToHole, onGoBack, playerTotals, showRunning, getScoreAnim, celebration, celebrationAnim, refreshing, onRefresh }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [holePickerOpen, setHolePickerOpen] = useState(false);
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
                theme={theme}
                s={s}
                onStep={onStep}
                onSetScore={onSetScore}
                getScoreAnim={getScoreAnim}
                showRunning={showRunning}
                playerTotals={playerTotals}
              />
            ))}
          </ScrollView>
        )}
      </View>

      {/* Round totals / live match — pinned above the bottom controls */}
      {isBestBall && bbResult
        ? <MatchPanel bbResult={bbResult} currentHole={currentHole} settings={settings} />
        : (
          <View style={s.totalsStrip}>
            <StablefordWinnerBanner round={round} scores={scores} players={players} />
            <Text style={s.totalStripLabel}>ROUND TOTALS</Text>
            <View style={s.totalStripRow}>
              {players.map((player) => {
                const { pts, str } = playerTotals(player);
                return (
                  <View key={player.id} style={s.totalStripPlayer}>
                    <Text style={s.totalStripName}>{player.name.split(' ')[0]}</Text>
                    <Text style={s.totalStripPts}>{pts}</Text>
                    <Text style={s.totalStripStr}>{str || '-'}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )
      }

      {/* Bottom controls: actions (notes / go-to-hole / next) */}
      <View style={s.bottomBar}>
        <View style={s.bottomActionsRow}>
          <TouchableOpacity
            style={s.notesPillBtn}
            onPress={() => setNotesOpen(true)}
            activeOpacity={0.7}
          >
            <Feather
              name={notes?.trim() ? 'edit-3' : 'edit-2'}
              size={14}
              color={notes?.trim() ? theme.accent.primary : theme.text.muted}
            />
            <Text style={[s.notesPillBtnText, notes?.trim() && s.notesPillBtnTextActive]}>
              {notes?.trim() ? 'Notes' : 'Notes'}
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
          <TouchableOpacity
            style={s.saveBtn}
            onPress={currentHole < 18 ? onNext : onGoBack}
            activeOpacity={0.8}
          >
            <Text style={s.saveBtnText}>
              {currentHole < 18 ? `Hole ${currentHole + 1}` : 'Finish'}
            </Text>
            {currentHole < 18 && (
              <Feather name="chevron-right" size={18} color={theme.text.inverse} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Notes modal — only shown on demand */}
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
                <Text style={s.notesTitle}>Round Notes</Text>
                <TouchableOpacity onPress={() => setNotesOpen(false)} style={s.notesCloseBtn}>
                  <Feather name="x" size={18} color={theme.text.secondary} />
                </TouchableOpacity>
              </View>
              <TextInput
                style={s.notesModalInput}
                placeholder="What happened this round?"
                placeholderTextColor={theme.text.muted}
                keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                selectionColor={theme.accent.primary}
                multiline
                value={notes}
                onChangeText={onNotesChange}
                autoFocus
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
              {Array.from({ length: 18 }, (_, i) => {
                const n = i + 1;
                const hasAnyScore = players.some((p) => scores[p.id]?.[n] != null);
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
                  </TouchableOpacity>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

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
  const s = useMemo(() => makeStyles(theme), [theme]);
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
  const s = useMemo(() => makeStyles(theme), [theme]);
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
// (either mathematically clinched or all 18 holes fully scored).
function StablefordWinnerBanner({ round, scores, players }) {
  const pairs = round?.pairs ?? [];
  if (pairs.length !== 2) return null;

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

const CELEBRATION_TIERS = {
  BIRDIE: {
    eyebrow: 'A BIRDIE',
    accent: '#f0c419', // soft gold
    glow: 'rgba(240,196,25,0.35)',
    icon: 'star',
  },
  EAGLE: {
    eyebrow: 'AN EAGLE',
    accent: '#ffd700', // Augusta gold
    glow: 'rgba(255,215,0,0.45)',
    icon: 'award',
  },
  ALBATROSS: {
    eyebrow: 'AN ALBATROSS',
    accent: '#ffffff',
    glow: 'rgba(255,255,255,0.55)',
    icon: 'star',
  },
  'HOLE IN ONE': {
    eyebrow: 'A HOLE IN ONE',
    accent: '#ffd700',
    glow: 'rgba(255,215,0,0.65)',
    icon: 'target',
  },
};

function CelebrationOverlay({ celebration, celebrationAnim, players }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

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

function GridView({ round, roundIndex, players, scores, notes, onNotesChange, isBestBall, bbResult, settings, onSetScore, refreshing, onRefresh }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [notesOpen, setNotesOpen] = useState(false);

  return (
    <PullToRefresh
      style={s.flex}
      contentContainerStyle={s.gridContent}
      automaticallyAdjustKeyboardInsets
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <View style={s.gridHeaderRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{round.courseName}</Text>
          <Text style={s.subtitle}>Round {roundIndex + 1}</Text>
        </View>
        <TouchableOpacity
          style={s.notesPillBtn}
          onPress={() => setNotesOpen(true)}
          activeOpacity={0.7}
        >
          <Feather
            name={notes?.trim() ? 'edit-3' : 'edit-2'}
            size={14}
            color={notes?.trim() ? theme.accent.primary : theme.text.muted}
          />
          <Text style={[s.notesPillBtnText, notes?.trim() && s.notesPillBtnTextActive]}>
            {notes?.trim() ? 'Notes' : 'Notes'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {(() => {
            const pairs = round.pairs ?? [];
            const hasPairs = pairs.length === 2;
            const orderedPlayers = hasPairs
              ? [...pairs[0], ...pairs[1]].map((pp) => players.find((p) => p.id === pp.id)).filter(Boolean)
              : players;

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
                    style={s.scoreInput}
                    keyboardType="numeric"
                    keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                    selectionColor={theme.accent.primary}
                    maxLength={2}
                    value={strokes != null ? String(strokes) : ''}
                    onChangeText={(v) => onSetScore(p.id, hole.number, v)}
                    placeholder="-"
                    placeholderTextColor={theme.text.muted}
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

      {isBestBall && bbResult && <LiveMatchStrip bbResult={bbResult} settings={settings} />}

      {/* Notes modal — same as HoleView */}
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
                <Text style={s.notesTitle}>Round Notes</Text>
                <TouchableOpacity onPress={() => setNotesOpen(false)} style={s.notesCloseBtn}>
                  <Feather name="x" size={18} color={theme.text.secondary} />
                </TouchableOpacity>
              </View>
              <TextInput
                style={s.notesModalInput}
                placeholder="What happened this round?"
                placeholderTextColor={theme.text.muted}
                keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                selectionColor={theme.accent.primary}
                multiline
                value={notes}
                onChangeText={onNotesChange}
                autoFocus
              />
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </PullToRefresh>
  );
}

function LiveMatchStrip({ bbResult, settings }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

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

function makeStyles(theme) {
  return StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
    flex: { flex: 1 },

    // Header
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 10,
      backgroundColor: theme.bg.primary,
      borderBottomWidth: 1,
      borderBottomColor: theme.isDark ? theme.glass?.border : theme.border.default,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    cameraBtn: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 17,
      color: theme.text.primary,
      letterSpacing: -0.3,
    },

    // Inline view toggle (small, lives in header)
    togglePill: {
      flexDirection: 'row',
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      padding: 2,
      gap: 2,
    },
    toggleBtn: {
      width: 32,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
    },
    toggleBtnActive: {
      backgroundColor: theme.accent.primary,
    },

    // Hole view header card
    holeHeaderCard: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: theme.bg.card,
      borderBottomWidth: 1,
      borderBottomColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingHorizontal: 20,
      paddingVertical: 14,
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    holeHeaderLeft: { gap: 2 },
    holeHeaderRound: {
      color: theme.text.muted,
      fontSize: 11,
      fontFamily: 'PlusJakartaSans-SemiBold',
      letterSpacing: 0.5,
    },
    holeNumberRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    holeNumberLabel: {
      color: theme.text.muted,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.5,
    },
    holeNumber: {
      color: theme.text.primary,
      fontSize: 44,
      fontFamily: 'PlayfairDisplay-Black',
      lineHeight: 48,
      letterSpacing: -1,
    },
    holeHeaderRight: { flexDirection: 'row', gap: 20 },
    holeMetaItem: { alignItems: 'center', gap: 4 },
    holeMetaLabel: {
      color: theme.text.muted,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.5,
    },
    holeMetaValue: {
      color: theme.text.primary,
      fontSize: 22,
      fontFamily: 'PlusJakartaSans-ExtraBold',
    },

    // Hole navigation
    holeNav: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: theme.bg.primary,
      gap: 8,
    },
    holeNavBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: theme.bg.card,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    },
    holeNavBtnDisabled: { opacity: 0.3 },
    holeNavBtnText: {
      color: theme.accent.primary,
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 13,
    },
    holeNavBtnTextDisabled: { color: theme.text.muted },

    // Player cards (must fit 4 + 2 pair labels with no inner scroll)
    playerCardsContent: { flex: 1, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6, gap: 8 },
    pairLabel: {
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.8,
      marginBottom: 4,
      marginLeft: 2,
      textTransform: 'uppercase',
    },
    playerCard: {
      backgroundColor: theme.bg.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingVertical: 12,
      paddingHorizontal: 14,
      overflow: 'hidden',
      ...(theme.isDark ? {} : theme.shadow.card),
    },

    // Full-scorecard celebration overlay
    celebrationRoot: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 50,
      elevation: 50,
    },
    celebrationScrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: '#000',
    },
    celebrationCard: {
      minWidth: 240,
      paddingVertical: 22,
      paddingHorizontal: 28,
      borderRadius: 22,
      borderWidth: 1.5,
      backgroundColor: '#003d27', // Augusta deep green
      alignItems: 'center',
      shadowOpacity: 0.55,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 8 },
      elevation: 18,
    },
    celebrationRing: {
      position: 'absolute',
      width: 260,
      height: 260,
      borderRadius: 130,
      borderWidth: 2,
      left: '50%',
      top: '50%',
      marginLeft: -130,
      marginTop: -130,
    },
    celebrationIconWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
      backgroundColor: 'rgba(255,255,255,0.05)',
    },
    celebrationEyebrow: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 10,
      letterSpacing: 3,
      textTransform: 'uppercase',
      marginBottom: 6,
    },
    celebrationLabelBig: {
      color: '#ffffff',
      fontSize: 34,
      fontFamily: 'PlayfairDisplay-Black',
      letterSpacing: 2,
      textAlign: 'center',
      marginBottom: 8,
    },
    celebrationSubtitle: {
      color: 'rgba(255,255,255,0.7)',
      fontSize: 12,
      fontFamily: 'PlusJakartaSans-Medium',
      letterSpacing: 0.6,
      textAlign: 'center',
    },

    // Pair winner badge (above totals strip / match panel)
    winnerBadgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: theme.isDark ? 'rgba(255,215,0,0.14)' : 'rgba(255,215,0,0.18)',
      borderWidth: 1,
      borderColor: 'rgba(255,215,0,0.45)',
      marginBottom: 8,
    },
    winnerBadgeText: {
      color: theme.isDark ? '#ffd700' : '#8a6d00',
      fontSize: 10,
      letterSpacing: 1.5,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      textTransform: 'uppercase',
    },
    matchPanelNameWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    playerCardRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    pickupBtn: {
      width: 30,
      height: 30,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pickupBtnActive: {
      borderColor: theme.accent.primary,
      backgroundColor: theme.accent.primary,
    },
    playerCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
    playerAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    playerAvatarText: {
      color: '#fff',
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 15,
    },
    playerCardName: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 15,
    },
    playerCardHcp: {
      color: theme.text.secondary,
      fontSize: 12,
      marginTop: 2,
      fontFamily: 'PlusJakartaSans-Medium',
    },
    playerCardRunning: {
      color: theme.accent.primary,
      fontSize: 11,
      marginTop: 2,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 0.5,
    },
    playerCardRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    stepBtn: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scoreDisplay: { width: 52, alignItems: 'center' },
    scoreDisplayNum: {
      color: theme.text.primary,
      fontSize: 26,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      lineHeight: 28,
    },
    scoreDisplayNumEmpty: {
      color: theme.text.muted,
      fontSize: 26,
      lineHeight: 28,
    },
    scoreDisplayPts: {
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      marginTop: 1,
    },

    // Bottom bar (hole nav + actions row)
    bottomBar: {
      backgroundColor: theme.bg.primary,
      borderTopWidth: 1,
      borderTopColor: theme.isDark ? theme.glass?.border : theme.border.default,
    },
    bottomActionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 12,
    },
    notesPillBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
    },
    notesPillBtnText: {
      color: theme.text.muted,
      fontSize: 12,
      fontFamily: 'PlusJakartaSans-SemiBold',
    },
    notesPillBtnTextActive: { color: theme.accent.primary, fontFamily: 'PlusJakartaSans-Bold' },

    // Notes modal (bottom sheet)
    notesModalKav: { flex: 1, justifyContent: 'flex-end' },
    notesBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    notesSheet: {
      backgroundColor: theme.bg.primary,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingTop: 10,
      paddingBottom: 24,
      paddingHorizontal: 16,
      borderTopWidth: 1,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderColor: theme.border.default,
    },
    notesHandle: {
      alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
      backgroundColor: theme.border.default, marginBottom: 12,
    },
    notesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    notesTitle: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.primary,
      fontSize: 16,
    },
    notesCloseBtn: {
      width: 32, height: 32, borderRadius: 16,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
    },
    notesModalInput: {
      minHeight: 160,
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.card,
      color: theme.text.primary,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border.default,
      padding: 14,
      fontSize: 14,
      fontFamily: 'PlusJakartaSans-Regular',
      textAlignVertical: 'top',
    },

    // Horizontal pager — flexes to fill between fixed top card and bottom bar
    pagerWrap: { flex: 1 },

    // Grid view header row (course title + Notes pill)
    gridHeaderRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 8,
    },

    // Go-to-hole picker (centered modal with 18-hole grid)
    holePickerSheet: {
      alignSelf: 'center',
      backgroundColor: theme.bg.primary,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.border.default,
      paddingVertical: 20,
      paddingHorizontal: 20,
      marginHorizontal: 24,
      marginVertical: 'auto',
      gap: 16,
    },
    holePickerGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      justifyContent: 'center',
    },
    holePickerBtn: {
      width: 48, height: 48, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
      borderWidth: 1, borderColor: theme.border.default,
    },
    holePickerBtnActive: {
      backgroundColor: theme.accent.primary,
      borderColor: theme.accent.primary,
    },
    holePickerBtnDone: {
      borderColor: theme.accent.primary,
    },
    holePickerBtnText: {
      color: theme.text.primary,
      fontSize: 16,
      fontFamily: 'PlusJakartaSans-Bold',
    },
    holePickerBtnTextActive: {
      color: theme.text.inverse,
    },

    // Round totals strip
    totalsStrip: {
      backgroundColor: theme.bg.card,
      borderTopWidth: 1,
      borderTopColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingHorizontal: 18,
      paddingVertical: 12,
    },
    totalStripLabel: {
      color: theme.text.muted,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.5,
      marginBottom: 8,
      textTransform: 'uppercase',
    },
    totalStripRow: { flexDirection: 'row', justifyContent: 'space-around' },
    totalStripPlayer: { alignItems: 'center', gap: 2 },
    totalStripName: {
      color: theme.text.secondary,
      fontSize: 11,
      fontFamily: 'PlusJakartaSans-SemiBold',
    },
    totalStripPts: {
      color: theme.accent.primary,
      fontSize: 18,
      fontFamily: 'PlusJakartaSans-ExtraBold',
    },
    totalStripStr: {
      color: theme.text.muted,
      fontSize: 11,
      fontFamily: 'PlusJakartaSans-Regular',
    },

    // Match panel (hole-by-hole best ball)
    matchPanel: {
      backgroundColor: theme.bg.card,
      borderTopWidth: 1,
      borderTopColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingHorizontal: 18,
      paddingVertical: 12,
    },
    matchPanelHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
    matchPanelNameCol: { flex: 1 },
    matchPanelColLabel: {
      width: 56,
      textAlign: 'center',
      color: theme.text.muted,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.5,
      textTransform: 'uppercase',
    },
    matchPanelDataRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
    matchPanelName: {
      flex: 1,
      color: theme.text.secondary,
      fontSize: 13,
      fontFamily: 'PlusJakartaSans-SemiBold',
    },
    matchPanelStat: {
      width: 56,
      textAlign: 'center',
      color: theme.text.secondary,
      fontSize: 20,
      fontFamily: 'PlusJakartaSans-ExtraBold',
    },
    matchPanelStatRound: { color: theme.text.primary },

    // Save / next button (now sits inside bottomActionsRow)
    saveBtn: {
      flex: 1,
      backgroundColor: theme.accent.primary,
      borderRadius: 14,
      paddingVertical: 14,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 6,
      ...(theme.isDark ? {} : theme.shadow.accent),
    },
    saveBtnText: {
      color: theme.text.inverse,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 16,
    },

    // Grid view
    gridContent: { padding: 16, paddingTop: 12, paddingBottom: 40 },
    title: {
      fontSize: 22,
      fontFamily: 'PlayfairDisplay-Bold',
      color: theme.accent.primary,
      letterSpacing: -0.3,
    },
    subtitle: {
      color: theme.text.muted,
      marginBottom: 16,
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 12,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    headerRow: {
      flexDirection: 'row',
      backgroundColor: '#006747',
      borderRadius: 8,
      paddingVertical: 8,
      marginBottom: 4,
    },
    holeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderRadius: 6 },
    altRow: {
      backgroundColor: theme.isDark ? 'rgba(79,174,138,0.04)' : 'rgba(0,103,71,0.03)',
    },
    totalsRow: {
      borderTopWidth: 2,
      borderTopColor: theme.accent.primary,
      marginTop: 6,
      paddingTop: 10,
    },
    headerText: {
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 11,
      color: 'rgba(255,255,255,0.85)',
      letterSpacing: 0.5,
    },
    cell: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 2 },
    holeCell: {
      width: 36, fontSize: 13,
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.secondary,
      textAlign: 'center',
    },
    parCell: {
      width: 32, fontSize: 12,
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.primary,
      textAlign: 'center',
    },
    siCell: {
      width: 32, fontSize: 10,
      fontFamily: 'PlusJakartaSans-Regular',
      color: theme.text.muted,
      textAlign: 'center',
    },
    playerCell: { width: 50 },
    pairCombinedCell: {
      width: 62,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      borderLeftWidth: 1,
      borderLeftColor: theme.isDark ? theme.glass?.border : theme.border.default,
    },
    pairInlinePts: {
      fontSize: 13,
      fontFamily: 'PlusJakartaSans-ExtraBold',
    },
    pairInlineTotal: {
      fontSize: 14,
      fontFamily: 'PlayfairDisplay-Bold',
    },
    pairInlineSep: {
      fontSize: 11,
      color: theme.text.muted,
      fontFamily: 'PlusJakartaSans-Regular',
    },
    inputCell: { alignItems: 'center' },
    scoreInput: {
      backgroundColor: theme.isDark ? theme.bg.elevated : '#ffffff',
      color: theme.text.primary,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.subtle,
      width: 40,
      height: 38,
      textAlign: 'center',
      fontSize: 15,
      fontFamily: 'PlusJakartaSans-Bold',
      padding: 2,
    },
    pts: {
      fontSize: 9,
      fontFamily: 'PlusJakartaSans-Bold',
      marginTop: 1,
      letterSpacing: 0.2,
    },
    totalText: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 13,
      textAlign: 'center',
    },
    totalPts: {
      fontFamily: 'PlayfairDisplay-Bold',
      fontSize: 15,
      textAlign: 'center',
    },
    totalStr: {
      color: theme.text.muted,
      fontSize: 10,
      textAlign: 'center',
      fontFamily: 'PlusJakartaSans-Medium',
    },

    // Live match
    liveMatch: {
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.accent.light,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      padding: 16,
      margin: 16,
      gap: 10,
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    liveMatchTitle: {
      color: theme.accent.primary,
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 12,
      marginBottom: 2,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    liveName: {
      flex: 1,
      color: theme.text.secondary,
      fontSize: 12,
      fontFamily: 'PlusJakartaSans-Medium',
    },
    liveNameRight: { textAlign: 'right' },
    liveWin: {
      color: theme.accent.primary,
      fontFamily: 'PlusJakartaSans-Bold',
    },
    liveScore: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 22,
      width: 32,
      textAlign: 'center',
    },
    liveDash: {
      color: theme.text.muted,
      fontSize: 18,
      fontFamily: 'PlusJakartaSans-Regular',
    },
  });
}
