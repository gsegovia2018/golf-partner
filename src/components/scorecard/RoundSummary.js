// Unified bottom-summary panel for the scorecard. Renders the round result
// for every game mode from a single view-model — it branches only on
// `state.variant` (never on game mode) so the scorecard structure stays
// identical across modes. All scoring math lives in summaryState().
import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { makeScorecardStyles } from './styles';
import { teamColor } from './teamModel';
import { summaryState } from './scoreModel';

const GOLD = '#e8c45f';

export const RoundSummary = React.memo(function RoundSummary({
  mode,
  round,
  players,
  scores,
  settings,
  currentHole,
  meId,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);
  const state = useMemo(
    () => summaryState({ mode, round, players, scores, settings, currentHole, meId }),
    [mode, round, players, scores, settings, currentHole, meId],
  );

  return (
    <View style={s.summaryCard}>
      <Text style={s.summaryEyebrow}>{state.eyebrow}</Text>

      {state.variant === 'pairs' && (
        <View>
          <View style={s.summaryColHeader}>
            <View style={s.summaryName} />
            <Text style={s.summaryColLabel}>{`HOLE ${currentHole}`}</Text>
            <Text style={s.summaryColLabel}>ROUND</Text>
          </View>
          {(state.pairs ?? []).map((pair) => (
            <View
              key={pair.index}
              style={[s.summaryRow, pair.isWinner && s.summaryRowWinner]}
            >
              <View style={s.summaryNameWrap}>
                <Text
                  style={[s.summaryName, { color: teamColor(theme, pair.index) }]}
                  numberOfLines={1}
                >
                  {pair.name}
                </Text>
                {pair.isWinner && (
                  <Feather name="award" size={14} color={GOLD} />
                )}
              </View>
              <Text style={s.summaryCol}>{pair.holePts ?? '-'}</Text>
              <Text style={s.summaryCol}>{pair.roundPts}</Text>
            </View>
          ))}
        </View>
      )}

      {state.variant === 'players' && (
        <View style={s.summaryChipRow}>
          {(state.chips ?? []).map((chip) => (
            <View
              key={chip.id}
              // summaryRowWinner is intentionally last so the gold winner tint overrides the leader accent on a decided winner.
            style={[
                s.summaryChip,
                chip.isLeader && s.summaryChipLeader,
                chip.isWinner && s.summaryRowWinner,
              ]}
            >
              <View style={s.summaryChipNameRow}>
                <Text style={s.summaryChipName} numberOfLines={1}>
                  {chip.name.split(' ')[0]}
                </Text>
                {chip.isWinner && (
                  <Feather name="award" size={12} color={GOLD} />
                )}
              </View>
              <Text style={s.summaryChipValue}>{chip.points}</Text>
            </View>
          ))}
        </View>
      )}

      {state.variant === 'solo' && (
        <View style={s.summarySolo}>
          <View style={s.summarySoloItem}>
            <Text style={s.summarySoloLabel}>STROKES</Text>
            <Text style={s.summarySoloValue}>{state.solo.str}</Text>
          </View>
          <View style={s.summarySoloDivider} />
          <View style={s.summarySoloItem}>
            <Text style={s.summarySoloLabel}>POINTS</Text>
            <Text style={s.summarySoloValue}>{state.solo.pts}</Text>
          </View>
          <View style={s.summarySoloDivider} />
          <View style={s.summarySoloItem}>
            <Text style={s.summarySoloLabel}>vs PAR</Text>
            <Text style={s.summarySoloValue}>{state.solo.vsParLabel}</Text>
          </View>
        </View>
      )}

      {state.status != null && (
        <Text style={[s.summaryStatus, state.decided && s.summaryStatusWinner]}>
          {state.status}
        </Text>
      )}
    </View>
  );
});
