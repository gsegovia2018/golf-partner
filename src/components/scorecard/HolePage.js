import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { playersMeFirst } from '../../lib/playerOrder';
import { pickupStrokes } from '../../store/tournamentStore';
import { scoreCellState } from '../../store/officialScoring';
import { PlayerCard } from './PlayerCard';
import { holePoints } from './scoreModel';
import { teamsByPlayer } from './teamModel';

// Web-only CSS scroll-snap for each pager page (the page-level snap rules).
// The pager container's scroll-snap-type is set inline in HoleView.
const PAGER_PAGE_SNAP_STYLE = Platform.OS === 'web'
  ? { scrollSnapAlign: 'start', scrollSnapStop: 'always' }
  : null;

// Memoized per-hole page. Extracted so a swipe that only changes the
// outside `currentHole` indicator does NOT re-render the other 17 pages
// in the pager — that's the main source of swipe lag.
export const HolePage = React.memo(function HolePage({
  pageHole, width, height, courseName, roundIndex,
  round, players, scores,
  shotDetails, meId, onSetShot,
  theme, s,
  onStep, onSetScore, editable, getScoreAnim,
  showRunning,
  mode,
  official, officialDiscrepancy, onOpenDiscrepancy,
  shotCollapsed, onToggleShotDetail,
  totalsMap,
}) {
  // Every game mode now renders the unified PlayerCard. Players are ordered
  // "me first" so the signed-in player's card (with shot detail) is on top.
  const orderedPlayers = playersMeFirst(players, meId);

  // Per-hole points are computed once per render and then looked up per player.
  // roundTotals is computed once in HoleView and passed down via totalsMap.
  const handicaps = round.playerHandicaps ?? {};
  const holePts = holePoints({ mode, hole: pageHole, players, scores, handicaps });
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
        {orderedPlayers.map((player) => {
          const handicap = round.playerHandicaps?.[player.id] ?? player.handicap;
          const strokes = scores[player.id]?.[pageHole.number];
          const points = holePts[player.id] ?? null;

          const extraShots = handicap >= pageHole.strokeIndex ? (Math.floor(handicap / 18) + (handicap % 18 >= pageHole.strokeIndex ? 1 : 0)) : 0;

          const pickup = pickupStrokes(pageHole.par, handicap, pageHole.strokeIndex);
          const isPickup = strokes != null && strokes >= pickup;
          // Per-card write permission. Casual mode passes no `editable` prop
          // (or one that returns true). In official mode a read-only card
          // renders the score without +/- steppers or the pickup toggle.
          const canEdit = editable ? editable(player.id) : true;
          const isMe = player.id === meId;

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

          return (
            <PlayerCard
              key={player.id}
              player={player}
              hole={pageHole}
              strokes={strokes}
              points={points}
              handicap={handicap}
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
            />
          );
        })}
      </ScrollView>
    </View>
  );
});

// Prompt shown on the scorecard when shot-detail tracking can't tell which
// player is "me" (a game you joined — the app can't infer your roster slot).
// A centered modal: picking yourself matters enough to ask up front, but
// `onSkip` lets you keep scoring without shot tracking.
export function MePicker({ players, onPickMe, onSkip, theme, s }) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onSkip}>
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
