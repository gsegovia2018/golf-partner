import React, { useMemo } from 'react';
import {
  View, Text, TouchableOpacity, Pressable, Animated,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { semantic } from '../../theme/tokens';
import { makeScorecardStyles } from './styles';
import { teamColor } from './teamModel';
import { ShotDetailSection } from './ShotDetailSection';
import PressableScale from '../ui/PressableScale';
import { haptic } from '../../lib/haptics';
import { useT, formatNumber } from '../../i18n';
import { teeDisplayName } from '../../lib/teeName';

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
//   ghost — { value, authorName } | null. Casual, unverified holes only:
//     when this scorer hasn't marked a cell themselves but a peer's synced
//     entry exists, the caller passes the peer's value here (with `strokes`
//     left null) so the card shows it as a muted, read-only preview with
//     attribution instead of a blank dash. Display only — it never changes
//     `strokes`, so steppers / tap-to-set still start from the same empty
//     baseline as any other unmarked cell.
export const PlayerCard = React.memo(function PlayerCard({
  player, hole, strokes, points,
  handicap, extraShots, pickup, isPickup, teeLabel,
  team, league = false, medalLeague = false,
  isMe, canEdit, showRunning, totals,
  getScoreAnim,
  onStep, onSetScore,
  shotDetail, onSetShot, shotCollapsed, onToggleShotDetail, showShotDetail,
  officialState, canResolveHere, onOpenDiscrepancy,
  conflict, onOpenConflict,
  ghost,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);
  const tx = useT();

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
  // Conflict styling takes priority over the ghost preview (they're not
  // expected to co-occur in practice, but conflict already owns the hero
  // card's tap target and colour when it does). Guarded on `strokes == null`
  // defensively too — the ghost must never show alongside a real entry, even
  // if a caller ever passed both.
  const ghostVisible = !!ghost && strokes == null && !conflicted;
  // A ghosted cell is a peer's entry this scorer never marked. Tapping it
  // accepts that value as this scorer's OWN mark — exactly the write typing
  // the number in would make, so the two cards then record that they agree
  // and the cell stops reading as unverified.
  const ghostAcceptable = ghostVisible && canEdit;
  const officialTappable = officialState === 'discrepancy' && canResolveHere;
  const heroTappable = conflicted || officialTappable;
  const showScoreControls = canEdit && !conflicted;
  const HeroCard = heroTappable ? Pressable : View;
  const heroCardProps = conflicted
    ? {
      onPress: () => onOpenConflict?.(player.id, hole.number),
      accessibilityLabel: tx('scorecard.player.resolveConflict', { name: player.name, hole: formatNumber(hole.number) }),
    }
    : officialTappable
      ? {
        onPress: () => onOpenDiscrepancy?.(player.id, hole.number),
        accessibilityLabel: tx('scorecard.player.resolve', { name: player.name, hole: formatNumber(hole.number) }),
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
              <Text style={s.teeBadge}>{teeDisplayName(teeLabel)}</Text>
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
            {/* LEAGUE chip: this player's card counts for a league (D5). */}
            {league ? (
              <Text
                style={[s.leagueChip, { color: theme.isDark ? semantic.winner.dark : semantic.winner.light }]}
                accessibilityLabel={tx('league.strip.chipLabel')}
              >
                {tx('league.strip.chip')}
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
              <Feather name="alert-circle" size={14} color={semantic.conflict.base} />
            )}
          </View>
          <Text style={s.soloHeroHcp}>
            {extraShots > 0
              ? tx('scorecard.player.hcpExtra', { handicap, extra: formatNumber(extraShots) })
              : tx('scorecard.player.hcp', { handicap })}
          </Text>
        </View>
        {/* Pickup toggle is a write action — hide on read-only cards, and in
            a medal league (a hole not holed out can't count). */}
        {showScoreControls && !(league && medalLeague) && (
          <TouchableOpacity
            style={[s.pickupBtn, isPickup && s.pickupBtnActive]}
            onPress={() => onSetScore(player.id, hole.number, isPickup ? null : pickup)}
            activeOpacity={0.7}
            hitSlop={9}
            accessibilityRole="button"
            accessibilityState={{ selected: isPickup }}
            accessibilityLabel={isPickup
              ? tx('scorecard.player.pickedUpA11y', { count: formatNumber(pickup) })
              : tx('scorecard.player.pickupA11y', { count: formatNumber(pickup) })}
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
          <PressableScale
            style={s.soloStepBtn}
            onPress={() => onStep(player.id, hole.number, -1)}
            activeScale={0.97}
            accessibilityLabel={tx('scorecard.player.decreaseA11y', { hole: formatNumber(hole.number) })}
          >
            <Feather name="minus" size={24} color={theme.text.primary} />
          </PressableScale>
        )}
        <Pressable
          onPress={ghostAcceptable ? () => {
            haptic('light');
            onSetScore(player.id, hole.number, String(ghost.value));
          } : undefined}
          onLongPress={() => {
            if (canEdit && !conflicted && strokes != null) {
              haptic('medium');
              onSetScore(player.id, hole.number, '');
            }
          }}
          delayLongPress={350}
          accessibilityLabel={
            ghostVisible
              ? (ghostAcceptable
                ? tx('scorecard.player.ghostAcceptA11y', { hole: formatNumber(hole.number), name: player.name, value: formatNumber(ghost.value), author: ghost.authorName })
                : tx('scorecard.player.ghostA11y', { hole: formatNumber(hole.number), name: player.name, value: formatNumber(ghost.value), author: ghost.authorName }))
              : (canEdit && !conflicted && strokes != null
                ? tx('scorecard.player.strokesClearA11y', { hole: formatNumber(hole.number) })
                : tx('scorecard.player.strokesA11y', { hole: formatNumber(hole.number) }))
          }
        >
          <Animated.View style={[s.soloScoreDisplay, { transform: [{ scale: getScoreAnim(player.id) }] }]}>
            <Text style={[
              s.soloScoreNum,
              strokes == null && s.scoreDisplayNumEmpty,
              ghostVisible && s.ghostScoreNum,
              conflicted && { color: semantic.conflict.base },
            ]}>
              {strokes ?? (ghostVisible ? ghost.value : '—')}
            </Text>
            <Text style={[s.soloScoreLabel, conflicted && { color: semantic.conflict.base }]}>
              {conflicted
                ? tx('scorecard.player.tapResolve')
                : strokes == null
                  ? (ghostAcceptable ? tx('scorecard.player.tapAccept') : ghostVisible ? tx('scorecard.player.notVerified') : tx('scorecard.player.strokes'))
                  : canEdit ? tx('scorecard.player.holdClear') : tx('scorecard.player.strokes')}
            </Text>
            {/* Attribution for the ghost preview — who entered this value,
                so it reads as theirs, not the viewer's own verified entry. */}
            {ghostVisible && (
              <Text style={s.ghostAttribution} numberOfLines={1}>{tx('scorecard.player.byAuthor', { name: ghost.authorName })}</Text>
            )}
          </Animated.View>
        </Pressable>
        {showScoreControls && (
          <PressableScale
            style={s.soloStepBtn}
            onPress={() => onStep(player.id, hole.number, 1)}
            activeScale={0.97}
            accessibilityLabel={tx('scorecard.player.increaseA11y', { hole: formatNumber(hole.number) })}
          >
            <Feather name="plus" size={24} color={theme.text.primary} />
          </PressableScale>
        )}
      </View>

      {showScoreControls && league && medalLeague && (
        <Text style={s.soloMedalNote}>{tx('scorecard.player.medalNote')}</Text>
      )}

      {points != null && !conflicted && (
        <View style={[s.soloPtsBadge, { borderColor: ptsColor }]}>
          <Text style={[s.soloPtsText, { color: ptsColor }]}>
            {tx('scorecard.player.points', { count: points })}
          </Text>
        </View>
      )}

      {conflicted && (
        <View style={s.soloConflictHint}>
          <Feather name="alert-circle" size={14} color={semantic.conflict.ink} />
          <Text style={s.soloConflictHintText}>{tx('scorecard.player.tapToResolve')}</Text>
        </View>
      )}

      {showRunning && !conflicted && (
        <View style={s.soloStatsRow}>
          <View style={s.soloStatItem}>
            <Text style={s.soloStatLabel}>{tx('scorecard.player.statStrokes')}</Text>
            <Text style={s.soloStatValue}>{t.str || '—'}</Text>
          </View>
          <View style={s.soloStatDivider} />
          <View style={s.soloStatItem}>
            <Text style={s.soloStatLabel}>{tx('scorecard.player.statPoints')}</Text>
            <Text style={[s.soloStatValue, { color: theme.accent.primary }]}>{t.pts}</Text>
          </View>
          <View style={s.soloStatDivider} />
          <View style={s.soloStatItem}>
            <Text style={s.soloStatLabel}>{tx('scorecard.player.statVsPar')}</Text>
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
