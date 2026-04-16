import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView,
} from 'react-native';
import {
  loadTournament, saveTournament,
  calcStablefordPoints, calcBestWorstBall, DEFAULT_SETTINGS,
} from '../store/tournamentStore';

export default function ScorecardScreen({ navigation, route }) {
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
      const s = scores[player.id]?.[hole.number];
      if (s) {
        str += s;
        pts += calcStablefordPoints(hole.par, s, handicap, hole.strokeIndex);
      }
    });
    return { pts, str };
  }

  const hole = round.holes.find((h) => h.number === currentHole);
  const liveRound = { ...round, scores };
  const bbResult = isBestBall ? calcBestWorstBall(liveRound, players) : null;

  return (
    <View style={styles.container}>
      {/* View toggle */}
      <View style={styles.toggleBar}>
        <View style={styles.togglePill}>
          <TouchableOpacity
            style={[styles.toggleBtn, view === 'hole' && styles.toggleBtnActive]}
            onPress={() => setView('hole')}
          >
            <Text style={[styles.toggleText, view === 'hole' && styles.toggleTextActive]}>Hole by Hole</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, view === 'grid' && styles.toggleBtnActive]}
            onPress={() => setView('grid')}
          >
            <Text style={[styles.toggleText, view === 'grid' && styles.toggleTextActive]}>All Holes</Text>
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
  if (!hole) return null;

  return (
    <View style={styles.flex}>
      {/* Hole header */}
      <View style={styles.holeHeader}>
        <View style={styles.holeHeaderLeft}>
          <Text style={styles.holeHeaderRound}>{round.courseName} · Round {roundIndex + 1}</Text>
          <View style={styles.holeNumberRow}>
            <Text style={styles.holeNumberLabel}>HOLE</Text>
            <Text style={styles.holeNumber}>{currentHole}</Text>
          </View>
        </View>
        <View style={styles.holeHeaderRight}>
          <View style={styles.holeMetaItem}>
            <Text style={styles.holeMetaLabel}>PAR</Text>
            <Text style={styles.holeMetaValue}>{hole.par}</Text>
          </View>
          <View style={styles.holeMetaItem}>
            <Text style={styles.holeMetaLabel}>SI</Text>
            <Text style={styles.holeMetaValue}>{hole.strokeIndex}</Text>
          </View>
        </View>
      </View>

      {/* Hole navigation */}
      <View style={styles.holeNav}>
        <TouchableOpacity
          style={[styles.holeNavBtn, currentHole === 1 && styles.holeNavBtnDisabled]}
          onPress={onPrev}
          disabled={currentHole === 1}
        >
          <Text style={[styles.holeNavBtnText, currentHole === 1 && styles.holeNavBtnTextDisabled]}>← Prev</Text>
        </TouchableOpacity>
        <View style={styles.holePips}>
          {Array.from({ length: 18 }, (_, i) => {
            const n = i + 1;
            const hasAnyScore = players.some((p) => scores[p.id]?.[n] != null);
            return (
              <TouchableOpacity key={n} onPress={() => onGoToHole(n)}>
                <View style={[styles.pip, n === currentHole && styles.pipActive, hasAnyScore && n !== currentHole && styles.pipDone]} />
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity
          style={[styles.holeNavBtn, currentHole === 18 && styles.holeNavBtnDisabled]}
          onPress={onNext}
          disabled={currentHole === 18}
        >
          <Text style={[styles.holeNavBtnText, currentHole === 18 && styles.holeNavBtnTextDisabled]}>Next →</Text>
        </TouchableOpacity>
      </View>

      {/* Player score cards */}
      <ScrollView style={styles.flex} contentContainerStyle={styles.playerCardsContent}>
        {(() => {
          const PAIR_COLORS = ['#4caf50', '#f9a825'];
          const pairs = round.pairs ?? [];
          const orderedPlayers = pairs.length === 2
            ? [...pairs[0], ...pairs[1]].map((pp) => players.find((p) => p.id === pp.id)).filter(Boolean)
            : players;

          return orderedPlayers.map((player, idx) => {
            const pairIndex = pairs.findIndex((pair) => pair.some((pp) => pp.id === player.id));
            const pairColor = pairIndex >= 0 ? PAIR_COLORS[pairIndex] : '#30363d';
            const isFirstOfPair = pairs.length === 2 && (idx === 0 || idx === 2);
            const pairLabel = pairIndex === 0 ? 'Pair A' : 'Pair B';

            const handicap = round.playerHandicaps?.[player.id] ?? player.handicap;
            const strokes = scores[player.id]?.[currentHole];
            const pts = strokes != null
              ? calcStablefordPoints(hole.par, strokes, handicap, hole.strokeIndex)
              : null;

            const ptsColor = pts == null ? '#8b949e'
              : pts >= 3 ? '#1565c0'
              : pts >= 2 ? '#4caf50'
              : pts === 1 ? '#8b949e'
              : '#da3633';

            const extraShots = handicap >= hole.strokeIndex ? (Math.floor(handicap / 18) + (handicap % 18 >= hole.strokeIndex ? 1 : 0)) : 0;

            return (
              <React.Fragment key={player.id}>
                {isFirstOfPair && (
                  <Text style={[styles.pairLabel, { color: pairColor, marginTop: idx === 0 ? 0 : 16 }]}>{pairLabel}</Text>
                )}
                <View style={[styles.playerCard, { borderLeftColor: pairColor, borderLeftWidth: 3 }]}>
                  <View style={styles.playerCardLeft}>
                    <View style={[styles.playerAvatar, { backgroundColor: pairColor }]}>
                      <Text style={styles.playerAvatarText}>{player.name[0].toUpperCase()}</Text>
                    </View>
                    <View>
                      <Text style={styles.playerCardName}>{player.name}</Text>
                      <Text style={styles.playerCardHcp}>HCP {handicap}{extraShots > 0 ? ` · +${extraShots}` : ''}</Text>
                    </View>
                  </View>
                  <View style={styles.playerCardRight}>
                    <TouchableOpacity style={styles.stepBtn} onPress={() => onStep(player.id, currentHole, -1)}>
                      <Text style={styles.stepBtnText}>−</Text>
                    </TouchableOpacity>
                    <View style={styles.scoreDisplay}>
                      <Text style={styles.scoreDisplayNum}>
                        {strokes ?? hole.par}
                      </Text>
                      {pts !== null && (
                        <Text style={[styles.scoreDisplayPts, { color: ptsColor }]}>
                          {pts} {pts === 1 ? 'pt' : 'pts'}
                        </Text>
                      )}
                    </View>
                    <TouchableOpacity style={styles.stepBtn} onPress={() => onStep(player.id, currentHole, 1)}>
                      <Text style={styles.stepBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </React.Fragment>
            );
          });
        })()}
      </ScrollView>

      <TextInput
        style={styles.notesInput}
        placeholder="Round notes…"
        placeholderTextColor="#484f58"
        keyboardAppearance="dark"
        selectionColor="#4caf50"
        multiline
        value={notes}
        onChangeText={onNotesChange}
      />

      {isBestBall && bbResult
        ? <MatchPanel bbResult={bbResult} currentHole={currentHole} settings={settings} />
        : (
          <View style={styles.totalsStrip}>
            <Text style={styles.totalStripLabel}>ROUND TOTALS</Text>
            <View style={styles.totalStripRow}>
              {players.map((player) => {
                const { pts, str } = playerTotals(player);
                return (
                  <View key={player.id} style={styles.totalStripPlayer}>
                    <Text style={styles.totalStripName}>{player.name.split(' ')[0]}</Text>
                    <Text style={styles.totalStripPts}>{pts}</Text>
                    <Text style={styles.totalStripStr}>{str || '-'}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )
      }

      <TouchableOpacity
        style={styles.saveBtn}
        onPress={currentHole < 18 ? onNext : onGoBack}
      >
        <Text style={styles.saveBtnText}>
          {currentHole < 18 ? `Hole ${currentHole + 1} →` : 'Finish Round'}
        </Text>
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
    <View style={styles.matchPanel}>
      {/* Column headers */}
      <View style={styles.matchPanelHeaderRow}>
        <View style={styles.matchPanelNameCol} />
        <Text style={styles.matchPanelColLabel}>HOLE {currentHole}</Text>
        <Text style={styles.matchPanelColLabel}>ROUND</Text>
      </View>

      {/* Pair 1 row */}
      <View style={styles.matchPanelDataRow}>
        <Text style={[styles.matchPanelName, roundWinner === 1 && styles.matchPanelWinner]} numberOfLines={1}>
          {p1Name}
        </Text>
        <Text style={[styles.matchPanelStat, holeWinner === 1 && styles.matchPanelWinner, holeWinner === 2 && styles.matchPanelLoser]}>
          {p1Hole ?? '–'}
        </Text>
        <Text style={[styles.matchPanelStat, styles.matchPanelStatRound, roundWinner === 1 && styles.matchPanelWinner]}>
          {p1Round}
        </Text>
      </View>

      {/* Pair 2 row */}
      <View style={styles.matchPanelDataRow}>
        <Text style={[styles.matchPanelName, roundWinner === 2 && styles.matchPanelWinner]} numberOfLines={1}>
          {p2Name}
        </Text>
        <Text style={[styles.matchPanelStat, holeWinner === 2 && styles.matchPanelWinner, holeWinner === 1 && styles.matchPanelLoser]}>
          {p2Hole ?? '–'}
        </Text>
        <Text style={[styles.matchPanelStat, styles.matchPanelStatRound, roundWinner === 2 && styles.matchPanelWinner]}>
          {p2Round}
        </Text>
      </View>
    </View>
  );
}

function GridView({ round, roundIndex, players, scores, isBestBall, bbResult, settings, onSetScore }) {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.gridContent} automaticallyAdjustKeyboardInsets>
      <Text style={styles.title}>{round.courseName}</Text>
      <Text style={styles.subtitle}>Round {roundIndex + 1}</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={styles.headerRow}>
            <Text style={[styles.cell, styles.holeCell, styles.headerText]}>Hole</Text>
            <Text style={[styles.cell, styles.parCell, styles.headerText]}>Par</Text>
            <Text style={[styles.cell, styles.siCell, styles.headerText]}>SI</Text>
            {(() => {
              const PAIR_COLORS = ['#4caf50', '#f9a825'];
              const pairs = round.pairs ?? [];
              const orderedPlayers = pairs.length === 2
                ? [...pairs[0], ...pairs[1]].map((pp) => players.find((p) => p.id === pp.id)).filter(Boolean)
                : players;
              return orderedPlayers.map((p) => {
                const pairIndex = pairs.findIndex((pair) => pair.some((pp) => pp.id === p.id));
                const color = pairIndex >= 0 ? PAIR_COLORS[pairIndex] : '#4caf50';
                return (
                  <Text key={p.id} style={[styles.cell, styles.playerCell, styles.headerText, { color }]}>
                    {p.name.split(' ')[0]}
                  </Text>
                );
              });
            })()}
          </View>

          {round.holes.map((hole) => {
            const PAIR_COLORS = ['#4caf50', '#f9a825'];
            const pairs = round.pairs ?? [];
            const orderedPlayers = pairs.length === 2
              ? [...pairs[0], ...pairs[1]].map((pp) => players.find((p) => p.id === pp.id)).filter(Boolean)
              : players;
            return (
              <View key={hole.number} style={[styles.holeRow, hole.number % 2 === 0 && styles.altRow]}>
                <Text style={[styles.cell, styles.holeCell]}>{hole.number}</Text>
                <Text style={[styles.cell, styles.parCell]}>{hole.par}</Text>
                <Text style={[styles.cell, styles.siCell]}>{hole.strokeIndex}</Text>
                {orderedPlayers.map((p) => {
                  const strokes = scores[p.id]?.[hole.number];
                  const handicap = round.playerHandicaps?.[p.id] ?? p.handicap;
                  const pts = strokes != null
                    ? calcStablefordPoints(hole.par, strokes, handicap, hole.strokeIndex)
                    : null;
                  const pairIndex = pairs.findIndex((pair) => pair.some((pp) => pp.id === p.id));
                  const ptsGoodColor = pairIndex >= 0 ? PAIR_COLORS[pairIndex] : '#4caf50';
                  return (
                    <View key={p.id} style={[styles.cell, styles.playerCell, styles.inputCell]}>
                      <TextInput
                        style={styles.scoreInput}
                        keyboardType="numeric"
                        keyboardAppearance="dark"
                        selectionColor="#4caf50"
                        maxLength={2}
                        value={strokes != null ? String(strokes) : ''}
                        onChangeText={(v) => onSetScore(p.id, hole.number, v)}
                        placeholder="-"
                        placeholderTextColor="#484f58"
                      />
                      {pts !== null && (
                        <Text style={[styles.pts, pts >= 2 && { color: ptsGoodColor }, pts === 0 && styles.zeroPts]}>
                          {pts}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
            );
          })}

          <View style={[styles.holeRow, styles.totalsRow]}>
            <Text style={[styles.cell, styles.holeCell, styles.totalText]}>Total</Text>
            <Text style={[styles.cell, styles.parCell, styles.totalText]}>
              {round.holes.reduce((s, h) => s + h.par, 0)}
            </Text>
            <Text style={[styles.cell, styles.siCell]} />
            {(() => {
              const PAIR_COLORS = ['#4caf50', '#f9a825'];
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
                const ptsColor = pairIndex >= 0 ? PAIR_COLORS[pairIndex] : '#4caf50';
                return (
                  <View key={p.id} style={[styles.cell, styles.playerCell]}>
                    <Text style={[styles.totalPts, { color: ptsColor }]}>{totalPts} pts</Text>
                    <Text style={styles.totalStr}>{totalStr || '-'}</Text>
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
  if (!bbResult) return null;
  const { pair1, pair2 } = bbResult;
  const { bestBallValue: bbVal, worstBallValue: wbVal } = settings;
  const p1Name = pairLabel(pair1);
  const p2Name = pairLabel(pair2);
  const p1Round = roundTeamPts(bbResult, 1, bbVal, wbVal);
  const p2Round = roundTeamPts(bbResult, 2, bbVal, wbVal);
  const roundWinner = p1Round > p2Round ? 1 : p2Round > p1Round ? 2 : 0;
  return (
    <View style={styles.liveMatch}>
      <Text style={styles.liveMatchTitle}>Match Score</Text>
      <View style={styles.liveRow}>
        <Text style={[styles.liveName, roundWinner === 1 && styles.liveWin]}>{p1Name}</Text>
        <Text style={[styles.liveScore, roundWinner === 1 && styles.liveWin]}>{p1Round}</Text>
        <Text style={styles.liveDash}>–</Text>
        <Text style={[styles.liveScore, roundWinner === 2 && styles.liveWin]}>{p2Round}</Text>
        <Text style={[styles.liveName, styles.liveNameRight, roundWinner === 2 && styles.liveWin]}>{p2Name}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070d15' },
  flex: { flex: 1 },

  // Toggle
  toggleBar: {
    backgroundColor: '#070d15', borderBottomWidth: 1,
    borderBottomColor: '#1c3250', paddingTop: 10, paddingHorizontal: 16, paddingBottom: 10,
  },
  togglePill: {
    flexDirection: 'row', backgroundColor: '#0c1a28', borderRadius: 12,
    borderWidth: 1, borderColor: '#1c3250', padding: 3,
  },
  toggleBtn: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 10 },
  toggleBtnActive: { backgroundColor: '#22c55e' },
  toggleText: { color: '#364f68', fontWeight: '600', fontSize: 14 },
  toggleTextActive: { color: '#fff', fontWeight: '700' },

  // Hole view
  holeHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#0c1a28', borderBottomWidth: 1, borderBottomColor: '#1c3250',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  holeHeaderLeft: { gap: 2 },
  holeHeaderRound: { color: '#364f68', fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  holeNumberRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  holeNumberLabel: { color: '#364f68', fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  holeNumber: { color: '#f1f5f9', fontSize: 44, fontWeight: '900', lineHeight: 48, letterSpacing: -1 },
  holeHeaderRight: { flexDirection: 'row', gap: 20 },
  holeMetaItem: { alignItems: 'center', gap: 4 },
  holeMetaLabel: { color: '#364f68', fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  holeMetaValue: { color: '#f1f5f9', fontSize: 22, fontWeight: '800' },

  holeNav: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14,
    paddingVertical: 10, backgroundColor: '#070d15', gap: 8,
  },
  holeNavBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: '#0c1a28', borderWidth: 1, borderColor: '#1c3250' },
  holeNavBtnDisabled: { opacity: 0.25 },
  holeNavBtnText: { color: '#4ade80', fontWeight: '700', fontSize: 13 },
  holeNavBtnTextDisabled: { color: '#364f68' },
  holePips: { flex: 1, flexDirection: 'row', flexWrap: 'nowrap', justifyContent: 'center', gap: 4 },
  pip: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#1c3250' },
  pipActive: { backgroundColor: '#4ade80', width: 9, height: 9, borderRadius: 5 },
  pipDone: { backgroundColor: '#22c55e' },

  playerCardsContent: { padding: 14, paddingTop: 10, gap: 8 },
  pairLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 4, marginLeft: 2, textTransform: 'uppercase' },
  playerCard: {
    backgroundColor: '#0c1a28', borderRadius: 14, borderWidth: 1, borderColor: '#1c3250',
    paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  playerCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  playerAvatar: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  playerAvatarText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  playerCardName: { color: '#f1f5f9', fontWeight: '700', fontSize: 15 },
  playerCardHcp: { color: '#7a8fa8', fontSize: 12, marginTop: 2, fontWeight: '500' },
  playerCardRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: '#112038', borderWidth: 1, borderColor: '#1c3250',
    alignItems: 'center', justifyContent: 'center',
  },
  stepBtnText: { color: '#f1f5f9', fontSize: 20, fontWeight: '700', lineHeight: 22 },
  scoreDisplay: { width: 52, alignItems: 'center' },
  scoreDisplayNum: { color: '#f1f5f9', fontSize: 26, fontWeight: '900' },
  scoreDisplayDefault: { color: '#364f68' },
  scoreDisplayPts: { fontSize: 11, fontWeight: '700', marginTop: -1 },

  notesInput: {
    backgroundColor: '#0c1a28', color: '#f1f5f9', borderTopWidth: 1, borderTopColor: '#1c3250',
    paddingHorizontal: 18, paddingVertical: 12, fontSize: 14, minHeight: 44,
    textAlignVertical: 'top',
  },
  // Round totals strip
  totalsStrip: {
    backgroundColor: '#0c1a28', borderTopWidth: 1, borderTopColor: '#1c3250',
    paddingHorizontal: 18, paddingVertical: 12,
  },
  totalStripLabel: { color: '#364f68', fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 8, textTransform: 'uppercase' },
  totalStripRow: { flexDirection: 'row', justifyContent: 'space-around' },
  totalStripPlayer: { alignItems: 'center', gap: 2 },
  totalStripName: { color: '#7a8fa8', fontSize: 11, fontWeight: '600' },
  totalStripPts: { color: '#4ade80', fontSize: 18, fontWeight: '900' },
  totalStripStr: { color: '#364f68', fontSize: 11 },

  // Match panel (hole-by-hole best ball)
  matchPanel: {
    backgroundColor: '#0c1a28', borderTopWidth: 1, borderTopColor: '#1c3250',
    paddingHorizontal: 18, paddingVertical: 12,
  },
  matchPanelHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  matchPanelNameCol: { flex: 1 },
  matchPanelColLabel: { width: 56, textAlign: 'center', color: '#364f68', fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
  matchPanelDataRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  matchPanelName: { flex: 1, color: '#7a8fa8', fontSize: 13, fontWeight: '600' },
  matchPanelStat: { width: 56, textAlign: 'center', color: '#7a8fa8', fontSize: 20, fontWeight: '800' },
  matchPanelStatRound: { color: '#c8d6e5' },
  matchPanelWinner: { color: '#4ade80' },
  matchPanelLoser: { color: '#f87171' },

  saveBtn: { backgroundColor: '#22c55e', marginHorizontal: 14, marginVertical: 12, borderRadius: 14, padding: 17, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },

  // Grid view
  gridContent: { padding: 16, paddingTop: 12, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '900', color: '#4ade80', letterSpacing: -0.5 },
  subtitle: { color: '#7a8fa8', marginBottom: 16, fontWeight: '500' },
  headerRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1c3250', paddingBottom: 8, marginBottom: 2 },
  holeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  altRow: { backgroundColor: '#0c1a28' },
  totalsRow: { borderTopWidth: 1, borderTopColor: '#1c3250', marginTop: 4, paddingTop: 8 },
  headerText: { fontWeight: '700', fontSize: 12 },
  cell: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 2 },
  holeCell: { width: 36, color: '#7a8fa8', fontSize: 13 },
  parCell: { width: 32, color: '#c8d6e5', textAlign: 'center', fontSize: 13 },
  siCell: { width: 32, color: '#364f68', fontSize: 11, textAlign: 'center' },
  playerCell: { width: 60 },
  inputCell: { alignItems: 'center' },
  scoreInput: {
    backgroundColor: '#112038', color: '#f1f5f9', borderRadius: 8, borderWidth: 1, borderColor: '#1c3250',
    width: 42, textAlign: 'center', fontSize: 16, fontWeight: '600', padding: 5,
  },
  pts: { fontSize: 10, color: '#364f68', marginTop: 2, fontWeight: '600' },
  goodPts: { color: '#4ade80' },
  zeroPts: { color: '#f87171' },
  totalText: { color: '#f1f5f9', fontWeight: '700', fontSize: 13, textAlign: 'center' },
  totalPts: { fontWeight: '800', fontSize: 13, textAlign: 'center' },
  totalStr: { color: '#364f68', fontSize: 11, textAlign: 'center' },

  // Live match
  liveMatch: { backgroundColor: '#031a0a', borderRadius: 14, borderWidth: 1, borderColor: '#1a4a2e', padding: 16, margin: 16, gap: 10 },
  liveMatchTitle: { color: '#4ade80', fontWeight: '700', fontSize: 12, marginBottom: 2, letterSpacing: 1, textTransform: 'uppercase' },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveName: { flex: 1, color: '#7a8fa8', fontSize: 12 },
  liveNameRight: { textAlign: 'right' },
  liveWin: { color: '#4ade80', fontWeight: '700' },
  liveLabel: { color: '#364f68', fontSize: 11, width: 68, textAlign: 'center' },
  liveScore: { color: '#f1f5f9', fontWeight: '900', fontSize: 22, width: 32, textAlign: 'center' },
  liveDash: { color: '#364f68', fontSize: 18 },
});
