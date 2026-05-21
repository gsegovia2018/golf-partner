import React, { useMemo } from 'react';
import {
  View, Text, TouchableOpacity, Pressable, Animated, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../theme/ThemeContext';
import { makeScorecardStyles } from './styles';
import { teamColor } from './teamModel';
import { ShotDetailSection } from './ShotDetailSection';

// Long-press-to-clear haptic — mirrors the helper in ScorecardScreen.
function haptic(style = 'medium') {
  if (Platform.OS === 'web') return;
  if (style === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

// Unified per-player score card. Every game mode renders this exact card —
// solo, Stableford, Match Play, Sindicato and Best Ball. It is the former
// "hero card" plus a team glow halo, a team chip, and a collapsible shot
// detail section for the "me" card. Pure presentation: all scoring values
// (points / totals / pickup / handicap) are computed by the caller.
//
// Props:
//   player, hole, strokes, points        — this player's hole values
//   handicap, extraShots, pickup, isPickup
//   team        — { index, label } | null (from teamModel.teamsByPlayer)
//   isMe, canEdit, showRunning, totals    — totals = { pts, str, parPlayed }
//   getScoreAnim                          — (playerId) => Animated.Value
//   onStep(playerId, holeNumber, delta), onSetScore(playerId, holeNumber, value)
//   shotDetail, onSetShot, shotCollapsed, onToggleShotDetail   — me-only
//   official, officialState, canResolveHere, onOpenDiscrepancy — official mode
export const PlayerCard = React.memo(function PlayerCard({
  player, hole, strokes, points,
  handicap, extraShots, pickup, isPickup, teeLabel,
  team,
  isMe, canEdit, showRunning, totals,
  getScoreAnim,
  onStep, onSetScore,
  shotDetail, onSetShot, shotCollapsed, onToggleShotDetail,
  official, officialState, canResolveHere, onOpenDiscrepancy,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);

  const pts = points;
  const ptsColor = pts == null ? theme.text.muted
    : pts >= 3 ? theme.scoreColor('excellent')
    : pts >= 2 ? theme.scoreColor('good')
    : pts === 1 ? theme.scoreColor('neutral')
    : theme.scoreColor('poor');

  const t = totals ?? { pts: 0, str: 0, parPlayed: 0 };
  const vsPar = t.parPlayed > 0 ? t.str - t.parPlayed : 0;
  const vsParLabel = t.parPlayed === 0 ? '—'
    : vsPar === 0 ? 'E'
    : vsPar > 0 ? `+${vsPar}` : String(vsPar);
  const vsParColor = t.parPlayed === 0 ? theme.text.muted
    : vsPar <= -1 ? theme.scoreColor('excellent')
    : vsPar === 0 ? theme.scoreColor('good')
    : vsPar <= 2 ? theme.scoreColor('neutral')
    : theme.scoreColor('poor');

  // Team glow halo — only when this player is on a team (two-pair rounds).
  const haloColor = team ? teamColor(theme, team.index) : null;
  const haloStyle = haloColor ? {
    borderWidth: 1.5,
    borderColor: haloColor,
    shadowColor: haloColor,
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  } : null;

  // A discrepancy card the viewer can act on opens the resolve sheet on tap.
  // Other states (or read-only viewers) keep the card non-interactive — the
  // badge alone communicates state.
  const heroTappable = officialState === 'discrepancy' && canResolveHere;
  const HeroCard = heroTappable ? Pressable : View;
  const heroCardProps = heroTappable
    ? {
      onPress: () => onOpenDiscrepancy?.(player.id, hole.number),
      accessibilityLabel: `Resolve ${player.name}'s score on hole ${hole.number}`,
    }
    : {};

  return (
    <HeroCard style={[s.soloHeroCard, haloStyle]} {...heroCardProps}>
      <View style={s.soloHeroHeader}>
        <View style={s.soloHeroNameWrap}>
          <View style={s.soloHeroNameRow}>
            <Text style={s.soloHeroName}>{player.name}</Text>
            {/* Tee badge — from the round's per-player tee assignment. */}
            {teeLabel ? (
              <Text style={s.teeBadge}>{teeLabel}</Text>
            ) : null}
            {/* Team chip — only on two-pair rounds, in the team colour. */}
            {team ? (
              <Text
                style={[
                  s.playerTeamChip,
                  s.playerTeamChipText,
                  { color: haloColor, backgroundColor: haloColor + '22' },
                ]}
              >
                {(team.label ?? '').toUpperCase()}
              </Text>
            ) : null}
            {/* Official discrepancy badge: green check (agreed), grey clock
                (waiting), red dot (discrepancy). No badge for 'empty' or in
                casual mode. */}
            {officialState === 'agreed' && (
              <Feather name="check-circle" size={14} color={theme.scoreColor('good')} />
            )}
            {officialState === 'waiting' && (
              <Feather name="clock" size={14} color={theme.text.muted} />
            )}
            {officialState === 'discrepancy' && (
              <Feather name="alert-circle" size={14} color={theme.destructive} />
            )}
          </View>
          <Text style={s.soloHeroHcp}>
            HCP {handicap}{extraShots > 0 ? `  ·  +${extraShots} on this hole` : ''}
          </Text>
        </View>
        {/* Pickup toggle is a write action — hide on read-only cards. */}
        {canEdit && (
          <TouchableOpacity
            style={[s.pickupBtn, isPickup && s.pickupBtnActive]}
            onPress={() => onSetScore(player.id, hole.number, isPickup ? hole.par : pickup)}
            activeOpacity={0.7}
            accessibilityLabel={isPickup ? `Picked up at ${pickup} strokes — tap to clear` : `Pickup at ${pickup} strokes`}
          >
            <Feather
              name="arrow-up-circle"
              size={16}
              color={isPickup ? theme.text.inverse : theme.text.muted}
            />
          </TouchableOpacity>
        )}
      </View>

      <View style={s.soloScoreRow}>
        {/* Steppers only on cards this device may write. A read-only card
            (official mode: not self / not markee) shows the score with no
            +/- and no long-press-to-clear. */}
        {canEdit && (
          <TouchableOpacity
            style={s.soloStepBtn}
            onPress={() => onStep(player.id, hole.number, -1)}
            accessibilityLabel={`Decrease strokes on hole ${hole.number}`}
          >
            <Feather name="minus" size={24} color={theme.text.primary} />
          </TouchableOpacity>
        )}
        <Pressable
          onLongPress={() => {
            if (canEdit && strokes != null) {
              haptic('medium');
              onSetScore(player.id, hole.number, '');
            }
          }}
          delayLongPress={350}
          accessibilityLabel={`Strokes on hole ${hole.number}${canEdit && strokes != null ? ' — long-press to clear' : ''}`}
        >
          <Animated.View style={[s.soloScoreDisplay, { transform: [{ scale: getScoreAnim(player.id) }] }]}>
            <Text style={[s.soloScoreNum, strokes == null && s.scoreDisplayNumEmpty]}>
              {strokes ?? '—'}
            </Text>
            <Text style={s.soloScoreLabel}>
              {strokes == null ? 'STROKES' : canEdit ? 'HOLD TO CLEAR' : 'STROKES'}
            </Text>
          </Animated.View>
        </Pressable>
        {canEdit && (
          <TouchableOpacity
            style={s.soloStepBtn}
            onPress={() => onStep(player.id, hole.number, 1)}
            accessibilityLabel={`Increase strokes on hole ${hole.number}`}
          >
            <Feather name="plus" size={24} color={theme.text.primary} />
          </TouchableOpacity>
        )}
      </View>

      {pts != null && (
        <View style={[s.soloPtsBadge, { borderColor: ptsColor }]}>
          <Text style={[s.soloPtsText, { color: ptsColor }]}>
            {pts} {pts === 1 ? 'point' : 'points'}
          </Text>
        </View>
      )}

      {showRunning && (
        <View style={s.soloStatsRow}>
          <View style={s.soloStatItem}>
            <Text style={s.soloStatLabel}>STROKES</Text>
            <Text style={s.soloStatValue}>{t.str || '—'}</Text>
          </View>
          <View style={s.soloStatDivider} />
          <View style={s.soloStatItem}>
            <Text style={s.soloStatLabel}>POINTS</Text>
            <Text style={[s.soloStatValue, { color: theme.accent.primary }]}>{t.pts}</Text>
          </View>
          <View style={s.soloStatDivider} />
          <View style={s.soloStatItem}>
            <Text style={s.soloStatLabel}>vs PAR</Text>
            <Text style={[s.soloStatValue, { color: vsParColor }]}>{vsParLabel}</Text>
          </View>
        </View>
      )}

      {isMe && (
        <ShotDetailSection
          hole={hole}
          detail={shotDetail}
          onChange={(patch) => onSetShot(player.id, hole.number, patch)}
          strokes={strokes}
          collapsed={shotCollapsed}
          onToggle={onToggleShotDetail}
        />
      )}
    </HeroCard>
  );
});
