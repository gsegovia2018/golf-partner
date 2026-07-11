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
//   showShotDetail — whether the shot-detail section may render at all. In
//     scramble rounds `player.id` is the team unit (captain) id, not the
//     signed-in member's personal id — the write path has no honest place
//     to store shot detail, so the caller passes false there even when
//     `isMe` is true.
//   officialState, canResolveHere, onOpenDiscrepancy — official mode
//   conflict, onOpenConflict — casual-mode score conflict (amber flag + resolve sheet)
export const PlayerCard = React.memo(function PlayerCard({
  player, hole, strokes, points,
  handicap, extraShots, pickup, isPickup, teeLabel,
  team,
  isMe, canEdit, showRunning, totals,
  getScoreAnim,
  onStep, onSetScore,
  shotDetail, onSetShot, shotCollapsed, onToggleShotDetail, showShotDetail,
  officialState, canResolveHere, onOpenDiscrepancy,
  conflict, onOpenConflict,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);

  const ptsColor = points == null ? theme.text.muted
    : points >= 3 ? theme.scoreColor('excellent')
    : points >= 2 ? theme.scoreColor('good')
    : points === 1 ? theme.scoreColor('neutral')
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

  // A conflicted card, or an official discrepancy card the viewer can act on,
  // opens its resolve sheet on tap. Conflict takes priority over official
  // state (the two never co-occur — official rounds have no casual conflicts).
  // Defaults to `isMe` when the caller doesn't pass it explicitly, so
  // existing callers keep the old behavior — only HolePage's scramble path
  // passes `showShotDetail={false}` while `isMe` is still true.
  const shouldShowShotDetail = showShotDetail ?? isMe;
  const conflicted = !!conflict;
  const officialTappable = officialState === 'discrepancy' && canResolveHere;
  const heroTappable = conflicted || officialTappable;
  const showScoreControls = canEdit && !conflicted;
  const HeroCard = heroTappable ? Pressable : View;
  const heroCardProps = conflicted
    ? {
      onPress: () => onOpenConflict?.(player.id, hole.number),
      accessibilityLabel: `Resolve ${player.name}'s conflicting score on hole ${hole.number}`,
    }
    : officialTappable
      ? {
        onPress: () => onOpenDiscrepancy?.(player.id, hole.number),
        accessibilityLabel: `Resolve ${player.name}'s score on hole ${hole.number}`,
      }
      : {};

  return (
    <HeroCard style={[s.soloHeroCard, haloStyle, conflicted && s.soloHeroCardConflict]} {...heroCardProps}>
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
            {conflicted && (
              <Feather name="alert-circle" size={14} color="#c77a0a" />
            )}
          </View>
          <Text style={s.soloHeroHcp}>
            HCP {handicap}{extraShots > 0 ? `  ·  +${extraShots} on this hole` : ''}
          </Text>
        </View>
        {/* Pickup toggle is a write action — hide on read-only cards. */}
        {showScoreControls && (
          <TouchableOpacity
            style={[s.pickupBtn, isPickup && s.pickupBtnActive]}
            onPress={() => onSetScore(player.id, hole.number, isPickup ? null : pickup)}
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

      <View style={[s.soloScoreRow, !showScoreControls && s.soloScoreRowReadOnly]}>
        {/* Steppers only on cards this device may write. A read-only card
            (official mode: not self / not markee) shows the score with no
            +/- and no long-press-to-clear. */}
        {showScoreControls && (
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
            if (canEdit && !conflicted && strokes != null) {
              haptic('medium');
              onSetScore(player.id, hole.number, '');
            }
          }}
          delayLongPress={350}
          accessibilityLabel={`Strokes on hole ${hole.number}${canEdit && !conflicted && strokes != null ? ' — long-press to clear' : ''}`}
        >
          <Animated.View style={[s.soloScoreDisplay, { transform: [{ scale: getScoreAnim(player.id) }] }]}>
            <Text style={[
              s.soloScoreNum,
              strokes == null && s.scoreDisplayNumEmpty,
              conflicted && { color: '#c77a0a' },
            ]}>
              {strokes ?? '—'}
            </Text>
            <Text style={[s.soloScoreLabel, conflicted && { color: '#c77a0a' }]}>
              {conflicted
                ? 'TAP TO RESOLVE'
                : strokes == null ? 'STROKES' : canEdit ? 'HOLD TO CLEAR' : 'STROKES'}
            </Text>
          </Animated.View>
        </Pressable>
        {showScoreControls && (
          <TouchableOpacity
            style={s.soloStepBtn}
            onPress={() => onStep(player.id, hole.number, 1)}
            accessibilityLabel={`Increase strokes on hole ${hole.number}`}
          >
            <Feather name="plus" size={24} color={theme.text.primary} />
          </TouchableOpacity>
        )}
      </View>

      {points != null && !conflicted && (
        <View style={[s.soloPtsBadge, { borderColor: ptsColor }]}>
          <Text style={[s.soloPtsText, { color: ptsColor }]}>
            {points} {points === 1 ? 'point' : 'points'}
          </Text>
        </View>
      )}

      {conflicted && (
        <View style={s.soloConflictHint}>
          <Feather name="alert-circle" size={14} color="#ffffff" />
          <Text style={s.soloConflictHintText}>Tap to resolve</Text>
        </View>
      )}

      {showRunning && !conflicted && (
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

      {shouldShowShotDetail && !conflicted && (
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
