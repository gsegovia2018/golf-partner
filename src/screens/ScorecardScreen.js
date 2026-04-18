import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Modal, Pressable, KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import * as Haptics from 'expo-haptics';

import { Feather } from '@expo/vector-icons';
import {
  loadTournament, saveTournament,
  calcStablefordPoints, calcBestWorstBall, pickupStrokes, DEFAULT_SETTINGS,
} from '../store/tournamentStore';
import { useTheme } from '../theme/ThemeContext';
import PullToRefresh from '../components/PullToRefresh';

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
  const s = makeStyles(theme);
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
  const scoreAnims = useRef({});
  const [celebration, setCelebration] = useState({ playerId: null, holeNumber: null, label: null });
  const celebrationAnim = useRef(new Animated.Value(0)).current;
  const roundIndex = paramRoundIndex ?? tournament?.currentRound ?? 0;

  useEffect(() => { tournamentRef.current = tournament; }, [tournament]);

  const reload = useCallback(async () => {
    const t = await loadTournament();
    if (!t) return;
    const idx = paramRoundIndex ?? t.currentRound;
    setTournament(t);
    setScores(t.rounds[idx]?.scores ?? {});
    setNotes(t.rounds[idx]?.notes ?? '');
  }, [paramRoundIndex]);

  useEffect(() => { reload(); }, [reload]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await reload(); } finally { setRefreshing(false); }
  }, [reload]);

  // Auto-initialize current hole scores to par so "leaving it" records par
  useEffect(() => {
    if (!tournament) return;
    const r = tournament.rounds[roundIndex];
    const h = r.holes.find((x) => x.number === currentHole);
    if (!h) return;
    setScores((prev) => {
      let changed = false;
      const next = { ...prev };
      tournament.players.forEach((p) => {
        if (next[p.id]?.[currentHole] == null) {
          next[p.id] = { ...(next[p.id] ?? {}), [currentHole]: h.par };
          changed = true;
        }
      });
      if (!changed) return prev;
      autoSave(next);
      return next;
    });
  }, [currentHole, tournament]);

  function autoSave(newScores) {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      if (!tournamentRef.current) return;
      const updated = { ...tournamentRef.current };
      updated.rounds = [...updated.rounds];
      updated.rounds[roundIndex] = { ...updated.rounds[roundIndex], scores: newScores };
      await saveTournament(updated);
    }, 300);
  }

  function saveNotes(value) {
    setNotes(value);
    if (notesSaveTimeoutRef.current) clearTimeout(notesSaveTimeoutRef.current);
    notesSaveTimeoutRef.current = setTimeout(async () => {
      if (!tournamentRef.current) return;
      const updated = { ...tournamentRef.current };
      updated.rounds = [...updated.rounds];
      updated.rounds[roundIndex] = { ...updated.rounds[roundIndex], notes: value };
      await saveTournament(updated);
    }, 400);
  }

  if (!tournament) return null;

  const round = tournament.rounds[roundIndex];
  const { players } = tournament;
  const settings = { ...DEFAULT_SETTINGS, ...tournament.settings };
  const isBestBall = settings.scoringMode === 'bestball';

  function triggerCelebration(playerId, holeNumber, label) {
    const holdMs = label === 'BIRDIE' ? 550 : label === 'EAGLE' ? 750 : 1000;
    haptic('success');
    celebrationAnim.stopAnimation();
    celebrationAnim.setValue(0);
    setCelebration({ playerId, holeNumber, label });
    Animated.sequence([
      Animated.timing(celebrationAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.delay(holdMs),
      Animated.timing(celebrationAnim, { toValue: 0, duration: 380, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) setCelebration({ playerId: null, holeNumber: null, label: null });
    });
  }

  function setScore(playerId, holeNumber, value) {
    const parsed = value === '' ? undefined : parseInt(value, 10) || undefined;
    const holePar = round.holes.find((h) => h.number === holeNumber)?.par ?? 4;
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
  }

  function getScoreAnim(playerId) {
    if (!scoreAnims.current[playerId]) scoreAnims.current[playerId] = new Animated.Value(1);
    return scoreAnims.current[playerId];
  }

  function stepScore(playerId, holeNumber, delta) {
    haptic('light');
    const anim = getScoreAnim(playerId);
    anim.setValue(1.18);
    Animated.spring(anim, { toValue: 1, friction: 5, useNativeDriver: true }).start();

    const holePar = round.holes.find((h) => h.number === holeNumber)?.par ?? 4;
    setScores((prev) => {
      const current = prev[playerId]?.[holeNumber] ?? holePar;
      const newStrokes = Math.max(1, current + delta);
      const next = { ...prev, [playerId]: { ...prev[playerId], [holeNumber]: newStrokes } };
      autoSave(next);
      if (newStrokes !== current) {
        const label = celebrationFor(holePar, newStrokes);
        if (label) triggerCelebration(playerId, holeNumber, label);
      }
      return next;
    });
  }

  function playerTotals(player) {
    let pts = 0;
    let str = 0;
    const handicap = round.playerHandicaps?.[player.id] ?? player.handicap;
    round.holes.forEach((hole) => {
      const sc = scores[player.id]?.[hole.number];
      if (sc) {
        str += sc;
        pts += calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
      }
    });
    return { pts, str };
  }

  const hole = round.holes.find((h) => h.number === currentHole);
  const liveRound = { ...round, scores };
  const bbResult = isBestBall ? calcBestWorstBall(liveRound, players) : null;

  return (
    <View style={s.container}>
      {/* Header with inline view toggle (small, doesn't take a full row) */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Scorecard</Text>
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
          onPrev={() => { haptic('medium'); setCurrentHole((h) => Math.max(1, h - 1)); }}
          onNext={() => { haptic('medium'); setCurrentHole((h) => Math.min(18, h + 1)); }}
          onGoToHole={(h) => { haptic('light'); setCurrentHole(h); }}
          onGoBack={() => navigation.goBack()}
          playerTotals={playerTotals}
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
    </View>
  );
}

function HoleView({ round, roundIndex, players, scores, notes, currentHole, hole, isBestBall, bbResult, settings, onStep, onSetScore, onNotesChange, onPrev, onNext, onGoToHole, onGoBack, playerTotals, getScoreAnim, celebration, celebrationAnim, refreshing, onRefresh }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [notesOpen, setNotesOpen] = useState(false);
  const [holePickerOpen, setHolePickerOpen] = useState(false);
  const [pagerWidth, setPagerWidth] = useState(0);
  const pagerRef = useRef(null);
  const holeScrollOffset = useRef(0);

  useEffect(() => {
    if (!pagerRef.current || pagerWidth <= 0) return;
    const target = (currentHole - 1) * pagerWidth;
    if (Math.abs(holeScrollOffset.current - target) < 1) return;
    pagerRef.current.scrollTo({ x: target, animated: false });
    holeScrollOffset.current = target;
  }, [currentHole, pagerWidth]);

  if (!hole) return null;

  return (
    <View style={s.flex}>
      <PullToRefresh
        style={s.flex}
        contentContainerStyle={s.holeScrollContent}
        refreshing={refreshing}
        onRefresh={onRefresh}
      >
      {/* Horizontal pager: one page per hole (swipe to change hole) */}
      <View style={s.pagerWrap} onLayout={(e) => setPagerWidth(e.nativeEvent.layout.width)}>
        {pagerWidth > 0 && (
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(e) => {
              const x = e.nativeEvent.contentOffset.x;
              holeScrollOffset.current = x;
              const idx = Math.round(x / pagerWidth);
              const newHole = idx + 1;
              if (newHole !== currentHole) onGoToHole(newHole);
            }}
            contentOffset={{ x: (currentHole - 1) * pagerWidth, y: 0 }}
          >
            {round.holes.map((pageHole) => (
              <View key={pageHole.number} style={{ width: pagerWidth }}>
                {/* Hole header */}
                <View style={s.holeHeaderCard}>
                  <View style={s.holeHeaderLeft}>
                    <Text style={s.holeHeaderRound}>{round.courseName} -- Round {roundIndex + 1}</Text>
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
                  {(() => {
                    const pairs = round.pairs ?? [];
                    const orderedPlayers = pairs.length === 2
                      ? [...pairs[0], ...pairs[1]].map((pp) => players.find((p) => p.id === pp.id)).filter(Boolean)
                      : players;

                    return orderedPlayers.map((player, idx) => {
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
                            {celebration?.playerId === player.id
                              && celebration?.holeNumber === pageHole.number
                              && celebration?.label && (
                              <Animated.View
                                pointerEvents="none"
                                style={[
                                  s.celebrationBanner,
                                  {
                                    opacity: celebrationAnim,
                                    transform: [
                                      { scale: celebrationAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
                                    ],
                                  },
                                ]}
                              >
                                <Text style={s.celebrationLabel}>{celebration.label}</Text>
                              </Animated.View>
                            )}
                            <View style={s.playerCardRow}>
                              <View style={s.playerCardLeft}>
                                <View style={[s.playerAvatar, { backgroundColor: pairColor }]}>
                                  <Text style={s.playerAvatarText}>{player.name[0].toUpperCase()}</Text>
                                </View>
                                <View>
                                  <Text style={s.playerCardName}>{player.name}</Text>
                                  <Text style={s.playerCardHcp}>HCP {handicap}{extraShots > 0 ? ` +${extraShots}` : ''}</Text>
                                </View>
                              </View>
                              <View style={s.playerCardRight}>
                                <TouchableOpacity style={s.stepBtn} onPress={() => onStep(player.id, pageHole.number, -1)}>
                                  <Feather name="minus" size={18} color={theme.text.primary} />
                                </TouchableOpacity>
                                <Animated.View style={[s.scoreDisplay, { transform: [{ scale: getScoreAnim(player.id) }] }]}>
                                  <Text style={s.scoreDisplayNum}>
                                    {strokes ?? pageHole.par}
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
                    });
                  })()}
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Round totals / live match — pinned above the bottom controls */}
      {isBestBall && bbResult
        ? <MatchPanel bbResult={bbResult} currentHole={currentHole} settings={settings} />
        : (
          <View style={s.totalsStrip}>
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
      </PullToRefresh>

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

function MatchPanel({ bbResult, currentHole, settings }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
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

  return (
    <View style={s.matchPanel}>
      {/* Column headers */}
      <View style={s.matchPanelHeaderRow}>
        <View style={s.matchPanelNameCol} />
        <Text style={s.matchPanelColLabel}>HOLE {currentHole}</Text>
        <Text style={s.matchPanelColLabel}>ROUND</Text>
      </View>

      {/* Pair 1 row */}
      <View style={s.matchPanelDataRow}>
        <Text style={[s.matchPanelName, roundWinner === 1 && { color: theme.accent.primary }]} numberOfLines={1}>
          {p1Name}
        </Text>
        <Text style={[s.matchPanelStat, holeWinner === 1 && { color: theme.accent.primary }, holeWinner === 2 && { color: theme.destructive }]}>
          {p1Hole ?? '-'}
        </Text>
        <Text style={[s.matchPanelStat, s.matchPanelStatRound, roundWinner === 1 && { color: theme.accent.primary }]}>
          {p1Round}
        </Text>
      </View>

      {/* Pair 2 row */}
      <View style={s.matchPanelDataRow}>
        <Text style={[s.matchPanelName, roundWinner === 2 && { color: theme.accent.primary }]} numberOfLines={1}>
          {p2Name}
        </Text>
        <Text style={[s.matchPanelStat, holeWinner === 2 && { color: theme.accent.primary }, holeWinner === 1 && { color: theme.destructive }]}>
          {p2Hole ?? '-'}
        </Text>
        <Text style={[s.matchPanelStat, s.matchPanelStatRound, roundWinner === 2 && { color: theme.accent.primary }]}>
          {p2Round}
        </Text>
      </View>
    </View>
  );
}

function GridView({ round, roundIndex, players, scores, notes, onNotesChange, isBestBall, bbResult, settings, onSetScore, refreshing, onRefresh }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
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
          <View style={s.headerRow}>
            <Text style={[s.cell, s.holeCell, s.headerText]}>Hole</Text>
            <Text style={[s.cell, s.parCell, s.headerText]}>Par</Text>
            <Text style={[s.cell, s.siCell, s.headerText]}>SI</Text>
            {(() => {
              const pairs = round.pairs ?? [];
              if (pairs.length !== 2) {
                return players.map((p) => (
                  <Text key={p.id} style={[s.cell, s.playerCell, s.headerText]}>
                    {p.name.split(' ')[0]}
                  </Text>
                ));
              }
              return pairs.flatMap((pair, pi) => {
                const members = pair.map((pp) => players.find((p) => p.id === pp.id)).filter(Boolean);
                return [
                  ...members.map((p) => (
                    <Text key={p.id} style={[s.cell, s.playerCell, s.headerText]}>
                      {p.name.split(' ')[0]}
                    </Text>
                  )),
                  <Text key={`pair-h-${pi}`} style={[s.cell, s.pairCell, s.headerText]}>
                    {pi === 0 ? 'Pair A' : 'Pair B'}
                  </Text>,
                ];
              });
            })()}
          </View>

          {round.holes.map((hole, holeIdx) => {
            const pairs = round.pairs ?? [];
            const renderPlayerCell = (p) => {
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
                    <Text style={[s.pts, { color: ptsColor }]}>
                      {pts}
                    </Text>
                  )}
                </View>
              );
            };

            return (
              <View key={hole.number} style={[s.holeRow, hole.number % 2 === 0 && s.altRow]}>
                <Text style={[s.cell, s.holeCell]}>{hole.number}</Text>
                <Text style={[s.cell, s.parCell]}>{hole.par}</Text>
                <Text style={[s.cell, s.siCell]}>{hole.strokeIndex}</Text>
                {pairs.length !== 2
                  ? players.map(renderPlayerCell)
                  : pairs.flatMap((pair, pi) => {
                      const members = pair.map((pp) => players.find((p) => p.id === pp.id)).filter(Boolean);
                      let pairPts = 0;
                      let hasAny = false;
                      if (isBestBall && bbResult) {
                        const hd = bbResult.holes.find((h) => h.number === hole.number);
                        if (hd && hd.bestWinner !== null) {
                          hasAny = true;
                          pairPts = holeTeamPts(hd, pi + 1, settings.bestBallValue, settings.worstBallValue) ?? 0;
                        }
                      } else {
                        members.forEach((m) => {
                          const str = scores[m.id]?.[hole.number];
                          if (str != null) {
                            hasAny = true;
                            const hcp = round.playerHandicaps?.[m.id] ?? m.handicap;
                            pairPts += calcStablefordPoints(hole.par, str, hcp, hole.strokeIndex);
                          }
                        });
                      }
                      const pairColor = pi === 0 ? theme.pairA : theme.pairB;
                      return [
                        ...members.map(renderPlayerCell),
                        <View key={`pair-c-${pi}`} style={[s.cell, s.pairCell]}>
                          <Text style={[s.pairHolePts, { color: hasAny ? pairColor : theme.text.muted }]}>
                            {hasAny ? pairPts : '-'}
                          </Text>
                        </View>,
                      ];
                    })}
              </View>
            );
          })}

          <View style={[s.holeRow, s.totalsRow]}>
            <Text style={[s.cell, s.holeCell, s.totalText]}>Total</Text>
            <Text style={[s.cell, s.parCell, s.totalText]}>
              {round.holes.reduce((sum, h) => sum + h.par, 0)}
            </Text>
            <Text style={[s.cell, s.siCell]} />
            {(() => {
              const pairs = round.pairs ?? [];
              const playerTotalCell = (p, pi) => {
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
                const ptsColor = pi === 0 ? theme.pairA : pi === 1 ? theme.pairB : theme.accent.primary;
                return (
                  <View key={p.id} style={[s.cell, s.playerCell]}>
                    <Text style={[s.totalPts, { color: ptsColor }]}>{totalPts} pts</Text>
                    <Text style={s.totalStr}>{totalStr || '-'}</Text>
                  </View>
                );
              };

              if (pairs.length !== 2) {
                return players.map((p) => playerTotalCell(p, -1));
              }
              return pairs.flatMap((pair, pi) => {
                const members = pair.map((pp) => players.find((p) => p.id === pp.id)).filter(Boolean);
                let pairTotal = 0;
                if (isBestBall && bbResult) {
                  pairTotal = roundTeamPts(bbResult, pi + 1, settings.bestBallValue, settings.worstBallValue);
                } else {
                  members.forEach((m) => {
                    const hcp = round.playerHandicaps?.[m.id] ?? m.handicap;
                    round.holes.forEach((hole) => {
                      const str = scores[m.id]?.[hole.number];
                      if (str) pairTotal += calcStablefordPoints(hole.par, str, hcp, hole.strokeIndex);
                    });
                  });
                }
                const pairColor = pi === 0 ? theme.pairA : theme.pairB;
                return [
                  ...members.map((p) => playerTotalCell(p, pi)),
                  <View key={`pair-t-${pi}`} style={[s.cell, s.pairCell]}>
                    <Text style={[s.totalPts, { color: pairColor }]}>{pairTotal} pts</Text>
                  </View>,
                ];
              });
            })()}
          </View>
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
  const s = makeStyles(theme);

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

    // PullToRefresh content container for HoleView — fills the viewport so
    // bottomBar stays at the bottom even when there's nothing to scroll.
    holeScrollContent: { flexGrow: 1 },

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

    // Player cards (compact — must fit 4 + 2 pair labels with no inner scroll)
    playerCardsContent: { flex: 1, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4, gap: 6 },
    pairLabel: {
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.5,
      marginBottom: 2,
      marginLeft: 2,
      textTransform: 'uppercase',
    },
    playerCard: {
      backgroundColor: theme.bg.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingVertical: 8,
      paddingHorizontal: 12,
      overflow: 'hidden',
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    celebrationBanner: {
      position: 'absolute',
      top: 4,
      right: 8,
      paddingHorizontal: 8,
      paddingVertical: 3,
      backgroundColor: '#006747',
      borderRadius: 999,
      borderWidth: 1,
      borderColor: '#ffd700',
      zIndex: 10,
    },
    celebrationLabel: {
      color: '#ffd700',
      fontSize: 9,
      fontFamily: 'PlayfairDisplay-Black',
      letterSpacing: 1.5,
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
    playerCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
    playerAvatar: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
    },
    playerAvatarText: {
      color: '#fff',
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 13,
    },
    playerCardName: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 14,
    },
    playerCardHcp: {
      color: theme.text.secondary,
      fontSize: 11,
      marginTop: 1,
      fontFamily: 'PlusJakartaSans-Medium',
    },
    playerCardRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    stepBtn: {
      width: 32,
      height: 32,
      borderRadius: 10,
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scoreDisplay: { width: 46, alignItems: 'center' },
    scoreDisplayNum: {
      color: theme.text.primary,
      fontSize: 22,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      lineHeight: 24,
    },
    scoreDisplayPts: {
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      marginTop: 0,
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

    // Horizontal pager — each hole is a full-width page
    pagerWrap: {},

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
    playerCell: { width: 62 },
    pairCell: {
      width: 58,
      borderLeftWidth: 1,
      borderLeftColor: theme.isDark ? theme.glass?.border : theme.border.default,
    },
    pairHolePts: {
      fontSize: 14,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      textAlign: 'center',
    },
    inputCell: { alignItems: 'center' },
    scoreInput: {
      backgroundColor: theme.isDark ? theme.bg.elevated : '#ffffff',
      color: theme.text.primary,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.subtle,
      width: 46,
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
