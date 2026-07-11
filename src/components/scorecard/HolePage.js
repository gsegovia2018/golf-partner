import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { playersMeFirst } from '../../lib/playerOrder';
import {
  pickupStrokes, isPickupScore, scrambleUnits, matchPlayEffectiveHandicaps, calcExtraShots,
} from '../../store/tournamentStore';
import { scoreCellState } from '../../store/officialScoring';
import { isScrambleMode } from '../scoringModes';
import { PlayerCard } from './PlayerCard';
import { holePoints } from './scoreModel';
import { teamsByPlayer } from './teamModel';

// Web-only CSS scroll-snap for each pager page (the page-level snap rules).
// The pager container's scroll-snap-type is set inline in HoleView.
const PAGER_PAGE_SNAP_STYLE = Platform.OS === 'web'
  ? { scrollSnapAlign: 'start', scrollSnapStop: 'always' }
  : null;

// True when two `{ [playerId]: { [hole]: value } }` maps hold identical
// values for `holeNumber` across every player present in either map.
function samePerHoleSlice(prevMap, nextMap, holeNumber) {
  if (prevMap === nextMap) return true;
  const a = prevMap ?? {};
  const b = nextMap ?? {};
  const pids = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const pid of pids) {
    if (a[pid]?.[holeNumber] !== b[pid]?.[holeNumber]) return false;
  }
  return true;
}

// Custom `React.memo` comparison. The pager mounts all 18 HolePage instances
// at once, but a single score edit hands every one of them a fresh
// `scores`/`totalsMap` reference — defeating the default shallow compare and
// re-rendering all 18 pages (and every PlayerCard) for one tap. A page only
// depends on its own hole's score + shot-detail slice and its structural
// props. Round totals are whole-round and change on every edit, but an
// off-screen page need not reflect them until it is visible — `isActive`
// flipping forces that re-render on swipe, so `totalsMap` is not compared.
// Returns true to SKIP the re-render.
export function holePagePropsEqual(prev, next) {
  if (
    prev.isActive !== next.isActive
    || prev.pageHole !== next.pageHole
    || prev.width !== next.width
    || prev.height !== next.height
    || prev.courseName !== next.courseName
    || prev.roundIndex !== next.roundIndex
    || prev.round !== next.round
    || prev.players !== next.players
    || prev.meId !== next.meId
    || prev.onSetShot !== next.onSetShot
    || prev.theme !== next.theme
    || prev.s !== next.s
    || prev.onStep !== next.onStep
    || prev.onSetScore !== next.onSetScore
    || prev.editable !== next.editable
    || prev.getScoreAnim !== next.getScoreAnim
    || prev.showRunning !== next.showRunning
    || prev.mode !== next.mode
    || prev.official !== next.official
    || prev.officialDiscrepancy !== next.officialDiscrepancy
    || prev.onOpenDiscrepancy !== next.onOpenDiscrepancy
    || prev.onOpenConflict !== next.onOpenConflict
    || prev.shotCollapsed !== next.shotCollapsed
    || prev.onToggleShotDetail !== next.onToggleShotDetail
  ) {
    return false;
  }
  const hole = next.pageHole.number;
  return samePerHoleSlice(prev.scores, next.scores, hole)
    && samePerHoleSlice(prev.shotDetails, next.shotDetails, hole);
}

// Memoized per-hole page. Extracted so a swipe that only changes the
// outside `currentHole` indicator does NOT re-render the other 17 pages
// in the pager — that's the main source of swipe lag. The custom
// `holePagePropsEqual` comparator extends this to score/shot edits: a tap
// on the active hole no longer re-renders the other 17 pages.
export const HolePage = React.memo(function HolePage({
  pageHole, width, height, courseName, roundIndex,
  round, players, scores,
  shotDetails, meId, onSetShot,
  theme, s,
  onStep, onSetScore, editable, getScoreAnim,
  showRunning,
  mode,
  official, officialDiscrepancy, onOpenDiscrepancy,
  onOpenConflict,
  shotCollapsed, onToggleShotDetail,
  totalsMap,
}) {
  // Every game mode now renders the unified PlayerCard. Scramble modes score
  // one ball per team under the captain — swap the roster for synthetic team
  // "players" so score entry, points, and handicaps all key off the captain's
  // id. Players are then ordered "me first" so the signed-in player's card
  // (or their team's card, for scramble) is on top.
  const isScramble = isScrambleMode(mode);
  const scoringPlayers = isScramble ? scrambleUnits(round, players) : players;
  const effectiveMeId = isScramble
    ? (scoringPlayers.find((u) => u.members?.some((m) => m.id === meId))?.id ?? meId)
    : meId;
  const orderedPlayers = playersMeFirst(scoringPlayers, effectiveMeId);

  // Per-hole points are computed once per render and then looked up per player.
  // roundTotals is computed once in HoleView and passed down via totalsMap.
  // Scramble rows use the team handicap, not the captain's individual one.
  //
  // Two maps are kept: `handicaps` (effective/relative in match play modes)
  // drives the extra-shot dots and net-vs-par scoring, since that's how the
  // duel is actually scored. `fullHandicaps` is always the FULL handicap
  // (team handicap for scramble) — it drives the pickup value/threshold and
  // the "HCP n" label, both of which must reflect the player's real handicap
  // regardless of who they happen to be matched against this round.
  const fullHandicaps = isScramble
    ? Object.fromEntries(scoringPlayers.map((u) => [u.id, u.handicap]))
    : (round.playerHandicaps ?? {});
  const handicaps = isScramble
    ? fullHandicaps
    // Match play modes: per-duel relative map so the extra-shot markers and
    // pickup hint match how the duel is actually scored (identity elsewhere).
    : matchPlayEffectiveHandicaps(mode, round, players);
  const holePts = holePoints({ mode, hole: pageHole, players: scoringPlayers, scores, handicaps, round });
  const teams = useMemo(() => teamsByPlayer(round), [round]);

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
        <View style={[s.holeHeaderRight, s.holeHeaderRightWrap]}>
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
        {orderedPlayers.map((player) => {
          // Relative (or team, for scramble) handicap — drives the
          // extra-shot dots only; that's the handicap the duel actually
          // plays off.
          const handicap = handicaps[player.id] ?? player.handicap;
          // Full (or team, for scramble) handicap — drives the pickup value
          // and the "HCP n" label. Pickup stats and the mixed-mode
          // Stableford leaderboard both key off the full handicap, so the
          // recorded pickup and the button's threshold text must match it,
          // not the relative value used for the match play dots.
          const fullHandicap = fullHandicaps[player.id] ?? player.handicap;
          const strokes = scores[player.id]?.[pageHole.number];
          const points = holePts[player.id] ?? null;

          const extraShots = calcExtraShots(handicap, pageHole.strokeIndex);

          const pickup = pickupStrokes(pageHole.par, fullHandicap, pageHole.strokeIndex);
          const isPickup = isPickupScore(strokes, pageHole.par, fullHandicap, pageHole.strokeIndex);
          // Per-card write permission. Casual mode passes no `editable` prop
          // (or one that returns true). In official mode a read-only card
          // renders the score without +/- steppers or the pickup toggle.
          const canEdit = editable ? editable(player.id) : true;
          const isMe = player.id === effectiveMeId;

          // Official mode: classify this player's hole from the raw two-row
          // score data so the card can show an agreed / waiting / discrepancy
          // badge. Casual mode leaves officialState null.
          let officialState = null;     // 'empty' | 'waiting' | 'agreed' | 'discrepancy'
          let canResolveHere = false;   // viewer owns an entry → can open sheet
          if (official && officialDiscrepancy) {
            const { self, marker } = officialDiscrepancy.cellEntries(player.id, pageHole.number);
            officialState = scoreCellState(self, marker);
            // The viewer can act on a card they own an entry for (self or
            // marker). canEdit already encodes editableSource !== null.
            canResolveHere = canEdit;
          }

          const conflict = round.scoreConflicts?.[player.id]?.[pageHole.number] ?? null;

          return (
            <PlayerCard
              key={player.id}
              player={player}
              hole={pageHole}
              strokes={strokes}
              points={points}
              handicap={fullHandicap}
              extraShots={extraShots}
              pickup={pickup}
              isPickup={isPickup}
              teeLabel={round.playerTees?.[player.id]?.label ?? null}
              team={teams[player.id] ?? null}
              isMe={isMe}
              canEdit={canEdit}
              showRunning={showRunning}
              totals={totalsMap.get(player.id)}
              getScoreAnim={getScoreAnim}
              onStep={onStep}
              onSetScore={onSetScore}
              shotDetail={isMe ? shotDetails[meId]?.[pageHole.number] : undefined}
              onSetShot={onSetShot}
              shotCollapsed={shotCollapsed}
              onToggleShotDetail={onToggleShotDetail}
              officialState={officialState}
              canResolveHere={canResolveHere}
              onOpenDiscrepancy={onOpenDiscrepancy}
              conflict={conflict}
              onOpenConflict={onOpenConflict}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}, holePagePropsEqual);

// Prompt shown on the scorecard when shot-detail tracking can't tell which
// player is "me" (a game you joined — the app can't infer your roster slot).
// A centered modal: picking yourself matters enough to ask up front, but
// `onSkip` lets you keep scoring without shot tracking.
export function MePicker({ players, onPickMe, onSkip, theme, s }) {
  return (
    <Modal statusBarTranslucent hardwareAccelerated visible transparent animationType="fade" onRequestClose={onSkip}>
      <View style={s.mePickerBackdrop}>
        <View style={s.mePickerCard}>
          <View style={s.mePickerIcon}>
            <Feather name="target" size={26} color={theme.accent.primary} />
          </View>
          <Text style={s.mePickerTitle}>Which player are you?</Text>
          <Text style={s.mePickerSubtitle}>
            Pick yourself so the app can track your shots this round.
          </Text>
          <View style={s.mePickerChips}>
            {players.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={s.mePickerChip}
                onPress={() => onPickMe(p.id)}
                activeOpacity={0.8}
              >
                <Text style={s.mePickerChipText} numberOfLines={1}>{p.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={s.mePickerSkip}
            onPress={onSkip}
            activeOpacity={0.7}
          >
            <Text style={s.mePickerSkipText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
