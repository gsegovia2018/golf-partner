// All-holes GRID view for the unified scorecard. Every game mode renders the
// same front-nine / back-nine block layout (ScorecardTable). Best Ball adds a
// LiveMatchStrip below the table; there is no longer a separate "classic"
// horizontally-scrolling grid for 4-player Best Ball.
import React, { useMemo, useRef } from 'react';
import { View, Text, TextInput, useWindowDimensions } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { playersMeFirst } from '../../lib/playerOrder';
import { calcExtraShots, scrambleUnits } from '../../store/tournamentStore';
import PullToRefresh from '../PullToRefresh';
import { makeScorecardStyles } from './styles';
import { holePoints, roundTotals } from './scoreModel';
import { isScrambleMode } from '../scoringModes';

// Join a pair's member first names with ' & '.
function pairLabel(pair) {
  return pair.map((p) => p.name.split(' ')[0]).join(' & ');
}

// A team's total best/worst-ball points for the round.
function roundTeamPts(bbResult, team, bbVal, wbVal) {
  const { bestBall, worstBall } = bbResult;
  return (team === 1 ? bestBall.pair1 : bestBall.pair2) * bbVal
       + (team === 1 ? worstBall.pair1 : worstBall.pair2) * wbVal;
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
  holes, label, aggLabel, players, scores, onSetScore, editable,
  playerHandicaps, mode, round, theme, s, columns, meId,
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

  // Per-hole per-player points, computed once per block via scoreModel. The
  // displayed numbers are identical to the previous inline branching — the
  // scoreModel wraps the exact same scoring engines.
  const holePtsByHole = {};
  for (const h of holes) {
    holePtsByHole[h.number] = holePoints({
      mode, hole: h, players, scores, handicaps: playerHandicaps, round,
    });
  }
  const ptsFor = (hole, player) => holePtsByHole[hole.number]?.[player.id] ?? null;

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
    const sumPts = holes.reduce((acc, h) => acc + (ptsFor(h, player) ?? 0), 0);
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
            const cellEditable = editable ? editable(player.id) !== false : true;
            const cellValue = scores[player.id]?.[h.number] != null
              ? String(scores[player.id][h.number])
              : '';
            return (
              <View key={h.number} style={[s.soloNineCell, holeCell, s.soloNineYouCell]}>
                {cellEditable ? (
                  <TextInput
                    ref={(el) => { cellRefs.current[cellKey(player.id, h.number)] = el; }}
                    style={s.soloNineStrokeInput}
                    keyboardType="numeric"
                    keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                    selectionColor={theme.accent.primary}
                    maxLength={2}
                    value={cellValue}
                    onChangeText={(v) => onSetScore(player.id, h.number, v)}
                    placeholder="·"
                    placeholderTextColor={theme.text.muted}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => focusNext(player.id, h.number)}
                  />
                ) : (
                  // Plain Text keeps centering reliable in view-only mode —
                  // a readonly TextInput can pick up browser user-agent
                  // styles that override textAlign on web. The parent cell
                  // already centers via flex, so the Text only needs the
                  // typographic styles.
                  <Text style={s.soloNineStrokeText} numberOfLines={1}>
                    {cellValue || '·'}
                  </Text>
                )}
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
            const pts = ptsFor(h, player);
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

function ScorecardTable({ round, players, scores, onSetScore, editable, mode, meId, handicapsOverride }) {
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
  // Scramble rows pass a team-handicap override (unitId -> team handicap) —
  // otherwise fall back to the round's individual player handicaps.
  const playerHandicaps = handicapsOverride ?? (round.playerHandicaps ?? {});
  const displayPlayers = playersMeFirst(players, meId);

  // Block inner width: viewport minus content padding (14*2) minus card
  // border (2) minus card padding (2*2). In side-by-side mode, each card
  // gets half the space minus the gap between them (16).
  const innerWidth = (() => {
    const available = width - 14 * 2 - 2 - 2 * 2 - 4 * 2;
    return sideBySide ? (available - 16) / 2 : available;
  })();
  const columns = getSoloColumns(innerWidth);

  const coursePar = holes.reduce((acc, h) => acc + h.par, 0);
  const isSolo = players.length === 1;

  // Per-player round totals via scoreModel — same numbers as the previous
  // inline branching. roundTotals returns Map<playerId, {pts,str,parPlayed}>.
  const totalsMap = roundTotals({
    mode, round, players, scores, handicaps: playerHandicaps,
  });
  const playerTotals = displayPlayers.map((p) => {
    const { str = 0, pts = 0, parPlayed = 0 } = totalsMap.get(p.id) ?? {};
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
            editable={editable}
            playerHandicaps={playerHandicaps}
            mode={mode}
            round={round}
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
              editable={editable}
              playerHandicaps={playerHandicaps}
              mode={mode}
              round={round}
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
                : mode === 'pairsmatchplay' ? 'PAIRS MATCH PLAY'
                : isScrambleMode(mode) ? 'SCRAMBLE'
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

export function GridView({ round, roundIndex, players, scores, isBestBall, bbResult, settings, onSetScore, editable, refreshing, onRefresh, meId }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);
  const rawMode = settings?.scoringMode;
  const mode = rawMode === 'matchplay' ? 'matchplay'
    : rawMode === 'sindicato' ? 'sindicato'
    : rawMode === 'pairsmatchplay' ? 'pairsmatchplay'
    : isScrambleMode(rawMode) ? rawMode
    : isBestBall ? 'bestball'
    : 'stableford';

  // Scramble modes score one ball per team under the captain — swap the row
  // source for synthetic team "players" (scrambleUnits) so score entry,
  // points, and handicaps all key off the captain's id, and "me first"
  // resolves to the containing team's row.
  const isScramble = isScrambleMode(mode);
  const rowPlayers = isScramble ? scrambleUnits(round, players) : players;
  const rowHandicaps = isScramble
    ? Object.fromEntries(rowPlayers.map((u) => [u.id, u.handicap]))
    : null;
  const effectiveMeId = isScramble
    ? (rowPlayers.find((u) => u.members?.some((m) => m.id === meId))?.id ?? meId)
    : meId;

  // Every game mode renders the same front-nine / back-nine card layout
  // (ScorecardTable). Best Ball adds a LiveMatchStrip below the table.
  return (
    <PullToRefresh
      style={s.flex}
      contentContainerStyle={s.soloGridContent}
      automaticallyAdjustKeyboardInsets
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <View style={s.soloGridHeaderBar}>
        <View style={{ flex: 1 }}>
          <Text style={s.soloGridHeaderTitle} numberOfLines={1}>
            {round.courseName} · Round {roundIndex + 1}
          </Text>
        </View>
      </View>

      <ScorecardTable
        round={round}
        players={rowPlayers}
        scores={scores}
        onSetScore={onSetScore}
        editable={editable}
        mode={mode}
        meId={effectiveMeId}
        handicapsOverride={rowHandicaps}
      />

      {isBestBall && bbResult && <LiveMatchStrip bbResult={bbResult} settings={settings} />}
    </PullToRefresh>
  );
}

function LiveMatchStrip({ bbResult, settings }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);

  if (!bbResult) return null;
  const { pair1, pair2 } = bbResult;
  const { bestBallValue: bbVal = 1, worstBallValue: wbVal = 1 } = settings ?? {};
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
