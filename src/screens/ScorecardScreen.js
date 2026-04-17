import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView,
} from 'react-native';

import { Feather } from '@expo/vector-icons';
import {
  loadTournament, saveTournament,
  calcStablefordPoints, calcBestWorstBall, DEFAULT_SETTINGS,
} from '../store/tournamentStore';
import { useTheme } from '../theme/ThemeContext';

export default function ScorecardScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const { roundIndex } = route.params;
  const [tournament, setTournament] = useState(null);
  const [scores, setScores] = useState({});
  const [notes, setNotes] = useState('');
  const [view, setView] = useState('hole'); // 'grid' | 'hole'
  const [currentHole, setCurrentHole] = useState(1);
  const tournamentRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const notesSaveTimeoutRef = useRef(null);

  useEffect(() => { tournamentRef.current = tournament; }, [tournament]);

  useEffect(() => {
    (async () => {
      const t = await loadTournament();
      setTournament(t);
      setScores(t.rounds[roundIndex].scores ?? {});
      setNotes(t.rounds[roundIndex].notes ?? '');
    })();
  }, [roundIndex]);

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

  function setScore(playerId, holeNumber, value) {
    const parsed = value === '' ? undefined : parseInt(value, 10) || undefined;
    setScores((prev) => {
      const next = { ...prev, [playerId]: { ...prev[playerId], [holeNumber]: parsed } };
      autoSave(next);
      return next;
    });
  }

  function stepScore(playerId, holeNumber, delta) {
    const holePar = round.holes.find((h) => h.number === holeNumber)?.par ?? 4;
    setScores((prev) => {
      const current = prev[playerId]?.[holeNumber] ?? holePar;
      const next = { ...prev, [playerId]: { ...prev[playerId], [holeNumber]: Math.max(1, current + delta) } };
      autoSave(next);
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
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Scorecard</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* View toggle */}
      <View style={s.toggleBar}>
        <View style={s.togglePill}>
          <TouchableOpacity
            style={[s.toggleBtn, view === 'hole' && s.toggleBtnActive]}
            onPress={() => setView('hole')}
          >
            <Text style={[s.toggleText, view === 'hole' && s.toggleTextActive]}>Hole by Hole</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.toggleBtn, view === 'grid' && s.toggleBtnActive]}
            onPress={() => setView('grid')}
          >
            <Text style={[s.toggleText, view === 'grid' && s.toggleTextActive]}>All Holes</Text>
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
          onPrev={() => setCurrentHole((h) => Math.max(1, h - 1))}
          onNext={() => setCurrentHole((h) => Math.min(18, h + 1))}
          onGoToHole={setCurrentHole}
          onGoBack={() => navigation.goBack()}
          playerTotals={playerTotals}
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
        />
      )}
    </View>
  );
}

function HoleView({ round, roundIndex, players, scores, notes, currentHole, hole, isBestBall, bbResult, settings, onStep, onSetScore, onNotesChange, onPrev, onNext, onGoToHole, onGoBack, playerTotals }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  if (!hole) return null;

  return (
    <View style={s.flex}>
      {/* Hole header */}
      <View style={s.holeHeaderCard}>
        <View style={s.holeHeaderLeft}>
          <Text style={s.holeHeaderRound}>{round.courseName} -- Round {roundIndex + 1}</Text>
          <View style={s.holeNumberRow}>
            <Text style={s.holeNumberLabel}>HOLE</Text>
            <Text style={s.holeNumber}>{currentHole}</Text>
          </View>
        </View>
        <View style={s.holeHeaderRight}>
          <View style={s.holeMetaItem}>
            <Text style={s.holeMetaLabel}>PAR</Text>
            <Text style={s.holeMetaValue}>{hole.par}</Text>
          </View>
          <View style={s.holeMetaItem}>
            <Text style={s.holeMetaLabel}>SI</Text>
            <Text style={s.holeMetaValue}>{hole.strokeIndex}</Text>
          </View>
        </View>
      </View>

      {/* Hole navigation */}
      <View style={s.holeNav}>
        <TouchableOpacity
          style={[s.holeNavBtn, currentHole === 1 && s.holeNavBtnDisabled]}
          onPress={onPrev}
          disabled={currentHole === 1}
        >
          <Feather name="chevron-left" size={16} color={currentHole === 1 ? theme.text.muted : theme.accent.primary} />
          <Text style={[s.holeNavBtnText, currentHole === 1 && s.holeNavBtnTextDisabled]}>Prev</Text>
        </TouchableOpacity>
        <View style={s.holePips}>
          {Array.from({ length: 18 }, (_, i) => {
            const n = i + 1;
            const hasAnyScore = players.some((p) => scores[p.id]?.[n] != null);
            return (
              <TouchableOpacity key={n} onPress={() => onGoToHole(n)}>
                <View style={[s.pip, n === currentHole && s.pipActive, hasAnyScore && n !== currentHole && s.pipDone]} />
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity
          style={[s.holeNavBtn, currentHole === 18 && s.holeNavBtnDisabled]}
          onPress={onNext}
          disabled={currentHole === 18}
        >
          <Text style={[s.holeNavBtnText, currentHole === 18 && s.holeNavBtnTextDisabled]}>Next</Text>
          <Feather name="chevron-right" size={16} color={currentHole === 18 ? theme.text.muted : theme.accent.primary} />
        </TouchableOpacity>
      </View>

      {/* Player score cards */}
      <ScrollView style={s.flex} contentContainerStyle={s.playerCardsContent}>
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
            const strokes = scores[player.id]?.[currentHole];
            const pts = strokes != null
              ? calcStablefordPoints(hole.par, strokes, handicap, hole.strokeIndex)
              : null;

            const ptsColor = pts == null ? theme.text.muted
              : pts >= 3 ? theme.scoreColor('excellent')
              : pts >= 2 ? theme.scoreColor('good')
              : pts === 1 ? theme.scoreColor('neutral')
              : theme.scoreColor('poor');

            const extraShots = handicap >= hole.strokeIndex ? (Math.floor(handicap / 18) + (handicap % 18 >= hole.strokeIndex ? 1 : 0)) : 0;

            return (
              <React.Fragment key={player.id}>
                {isFirstOfPair && (
                  <Text style={[s.pairLabel, { color: pairColor, marginTop: idx === 0 ? 0 : 16 }]}>{pairLabelText}</Text>
                )}
                <View style={[s.playerCard, { borderLeftColor: pairColor, borderLeftWidth: 3 }]}>
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
                    <TouchableOpacity style={s.stepBtn} onPress={() => onStep(player.id, currentHole, -1)}>
                      <Feather name="minus" size={18} color={theme.text.primary} />
                    </TouchableOpacity>
                    <View style={s.scoreDisplay}>
                      <Text style={s.scoreDisplayNum}>
                        {strokes ?? hole.par}
                      </Text>
                      {pts !== null && (
                        <Text style={[s.scoreDisplayPts, { color: ptsColor }]}>
                          {pts} {pts === 1 ? 'pt' : 'pts'}
                        </Text>
                      )}
                    </View>
                    <TouchableOpacity style={s.stepBtn} onPress={() => onStep(player.id, currentHole, 1)}>
                      <Feather name="plus" size={18} color={theme.text.primary} />
                    </TouchableOpacity>
                  </View>
                </View>
              </React.Fragment>
            );
          });
        })()}
      </ScrollView>

      <TextInput
        style={s.notesInput}
        placeholder="Round notes..."
        placeholderTextColor={theme.text.muted}
        keyboardAppearance={theme.isDark ? 'dark' : 'light'}
        selectionColor={theme.accent.primary}
        multiline
        value={notes}
        onChangeText={onNotesChange}
      />

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

      <TouchableOpacity
        style={s.saveBtn}
        onPress={currentHole < 18 ? onNext : onGoBack}
        activeOpacity={0.8}
      >
        <Text style={s.saveBtnText}>
          {currentHole < 18 ? `Hole ${currentHole + 1}` : 'Finish Round'}
        </Text>
        {currentHole < 18 && (
          <Feather name="chevron-right" size={18} color={theme.text.inverse} />
        )}
      </TouchableOpacity>
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

function GridView({ round, roundIndex, players, scores, isBestBall, bbResult, settings, onSetScore }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  return (
    <ScrollView style={s.flex} contentContainerStyle={s.gridContent} automaticallyAdjustKeyboardInsets>
      <View>
        <Text style={s.title}>{round.courseName}</Text>
        <Text style={s.subtitle}>Round {roundIndex + 1}</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={s.headerRow}>
            <Text style={[s.cell, s.holeCell, s.headerText]}>Hole</Text>
            <Text style={[s.cell, s.parCell, s.headerText]}>Par</Text>
            <Text style={[s.cell, s.siCell, s.headerText]}>SI</Text>
            {(() => {
              const pairs = round.pairs ?? [];
              const orderedPlayers = pairs.length === 2
                ? [...pairs[0], ...pairs[1]].map((pp) => players.find((p) => p.id === pp.id)).filter(Boolean)
                : players;
              return orderedPlayers.map((p) => {
                const pairIndex = pairs.findIndex((pair) => pair.some((pp) => pp.id === p.id));
                const color = pairIndex === 0 ? theme.pairA : pairIndex === 1 ? theme.pairB : theme.accent.primary;
                return (
                  <Text key={p.id} style={[s.cell, s.playerCell, s.headerText, { color }]}>
                    {p.name.split(' ')[0]}
                  </Text>
                );
              });
            })()}
          </View>

          {round.holes.map((hole, holeIdx) => {
            const pairs = round.pairs ?? [];
            const orderedPlayers = pairs.length === 2
              ? [...pairs[0], ...pairs[1]].map((pp) => players.find((p) => p.id === pp.id)).filter(Boolean)
              : players;
            return (
              <View key={hole.number} style={[s.holeRow, hole.number % 2 === 0 && s.altRow]}>
                <Text style={[s.cell, s.holeCell]}>{hole.number}</Text>
                <Text style={[s.cell, s.parCell]}>{hole.par}</Text>
                <Text style={[s.cell, s.siCell]}>{hole.strokeIndex}</Text>
                {orderedPlayers.map((p) => {
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
              const orderedPlayers = pairs.length === 2
                ? [...pairs[0], ...pairs[1]].map((pp) => players.find((p) => p.id === pp.id)).filter(Boolean)
                : players;
              return orderedPlayers.map((p) => {
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
                const pairIndex = pairs.findIndex((pair) => pair.some((pp) => pp.id === p.id));
                const ptsColor = pairIndex === 0 ? theme.pairA : pairIndex === 1 ? theme.pairB : theme.accent.primary;
                return (
                  <View key={p.id} style={[s.cell, s.playerCell]}>
                    <Text style={[s.totalPts, { color: ptsColor }]}>{totalPts} pts</Text>
                    <Text style={s.totalStr}>{totalStr || '-'}</Text>
                  </View>
                );
              });
            })()}
          </View>
        </View>
      </ScrollView>

      {isBestBall && bbResult && <LiveMatchStrip bbResult={bbResult} settings={settings} />}
    </ScrollView>
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
    container: { flex: 1, backgroundColor: theme.bg.primary },
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
    headerTitle: {
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 17,
      color: theme.text.primary,
      letterSpacing: -0.3,
    },

    // Toggle
    toggleBar: {
      backgroundColor: theme.bg.primary,
      paddingTop: 10,
      paddingHorizontal: 16,
      paddingBottom: 10,
    },
    togglePill: {
      flexDirection: 'row',
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      padding: 3,
    },
    toggleBtn: {
      flex: 1,
      paddingVertical: 9,
      alignItems: 'center',
      borderRadius: 11,
    },
    toggleBtnActive: {
      backgroundColor: theme.accent.primary,
    },
    toggleText: {
      color: theme.text.muted,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 14,
    },
    toggleTextActive: {
      color: theme.text.inverse,
      fontFamily: 'PlusJakartaSans-Bold',
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
      fontFamily: 'PlusJakartaSans-ExtraBold',
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
    holePips: {
      flex: 1,
      flexDirection: 'row',
      flexWrap: 'nowrap',
      justifyContent: 'center',
      gap: 4,
    },
    pip: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.border.default,
    },
    pipActive: {
      backgroundColor: theme.accent.primary,
      width: 9,
      height: 9,
      borderRadius: 5,
    },
    pipDone: { backgroundColor: theme.accent.primary },

    // Player cards
    playerCardsContent: { padding: 14, paddingTop: 10, gap: 8 },
    pairLabel: {
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.5,
      marginBottom: 4,
      marginLeft: 2,
      textTransform: 'uppercase',
    },
    playerCard: {
      backgroundColor: theme.bg.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingVertical: 14,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      overflow: 'hidden',
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    playerCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    playerAvatar: {
      width: 38,
      height: 38,
      borderRadius: 19,
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
    playerCardRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    stepBtn: {
      width: 38,
      height: 38,
      borderRadius: 10,
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
    },
    scoreDisplayPts: {
      fontSize: 11,
      fontFamily: 'PlusJakartaSans-Bold',
      marginTop: -1,
    },

    // Notes input
    notesInput: {
      backgroundColor: theme.bg.card,
      color: theme.text.primary,
      borderTopWidth: 1,
      borderTopColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingHorizontal: 18,
      paddingVertical: 12,
      fontSize: 14,
      fontFamily: 'PlusJakartaSans-Regular',
      minHeight: 44,
      textAlignVertical: 'top',
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

    // Save / next button
    saveBtn: {
      backgroundColor: theme.accent.primary,
      marginHorizontal: 14,
      marginVertical: 12,
      borderRadius: 16,
      padding: 17,
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
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.accent.primary,
      letterSpacing: -0.5,
    },
    subtitle: {
      color: theme.text.secondary,
      marginBottom: 16,
      fontFamily: 'PlusJakartaSans-Medium',
    },
    headerRow: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingBottom: 8,
      marginBottom: 2,
    },
    holeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
    altRow: { backgroundColor: theme.bg.card },
    totalsRow: {
      borderTopWidth: 1,
      borderTopColor: theme.isDark ? theme.glass?.border : theme.border.default,
      marginTop: 4,
      paddingTop: 8,
    },
    headerText: {
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 12,
    },
    cell: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 2 },
    holeCell: { width: 36, color: theme.text.secondary, fontSize: 13, fontFamily: 'PlusJakartaSans-Medium' },
    parCell: { width: 32, color: theme.text.primary, textAlign: 'center', fontSize: 13, fontFamily: 'PlusJakartaSans-Medium' },
    siCell: { width: 32, color: theme.text.muted, fontSize: 11, textAlign: 'center', fontFamily: 'PlusJakartaSans-Regular' },
    playerCell: { width: 60 },
    inputCell: { alignItems: 'center' },
    scoreInput: {
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
      color: theme.text.primary,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      width: 48,
      height: 48,
      textAlign: 'center',
      fontSize: 16,
      fontFamily: 'PlusJakartaSans-Bold',
      padding: 5,
    },
    pts: {
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-SemiBold',
      marginTop: 2,
    },
    totalText: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 13,
      textAlign: 'center',
    },
    totalPts: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 13,
      textAlign: 'center',
    },
    totalStr: {
      color: theme.text.muted,
      fontSize: 11,
      textAlign: 'center',
      fontFamily: 'PlusJakartaSans-Regular',
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
