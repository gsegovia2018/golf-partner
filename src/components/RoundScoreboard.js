import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { semantic } from '../theme/tokens';
import { roundTotals } from '../store/tournamentStore';
import { isScrambleMode, scrambleRoundTally } from '../store/scoring';
import { playersMeFirst } from '../lib/playerOrder';

// Universal round scoreboard — the same player stat cards in every scoring
// mode. Home shows it unranked (me first, no standings); the round summary
// shows it ranked (sorted by Stableford points with rank badges and a
// leader tint). Holes-played progress bar on top; glowing HOLE badge while
// a player is mid-round. Hole badges can be suppressed for finished rounds via
// showHoleBadges.
export default function RoundScoreboard({
  round, players, meId, showRunning = true, ranked = false, teeLabels = null, showHoleBadges = true,
  scoringMode = null,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const holes = round?.holes ?? [];
  const totalHoles = holes.length || 18;

  const totals = roundTotals(round, players);
  const totalsById = Object.fromEntries(totals.map((t) => [t.player.id, t]));

  // Scramble rounds play one team ball, stored under the captain (pair[0]).
  // Both teammates share that ball's result, so map every player to their
  // captain's scores and credit the team's Stableford points to each — otherwise
  // non-captains would show blank ("—") in the round-scores card.
  const mode = scoringMode ?? round?.scoringMode ?? null;
  const scramble = isScrambleMode(mode);
  const captainOf = {};
  const teamPointsByCaptain = {};
  if (scramble) {
    for (const pair of (round?.pairs ?? [])) {
      if (!Array.isArray(pair) || pair.length === 0) continue;
      const capId = pair[0]?.id;
      if (!capId) continue;
      for (const m of pair) if (m?.id) captainOf[m.id] = capId;
    }
    const tally = scrambleRoundTally(round, players);
    for (const r of (tally?.totals ?? [])) teamPointsByCaptain[r.unit.id] = r.points;
  }

  let rows = playersMeFirst(players, meId).map((player) => {
    const sourceId = scramble ? (captainOf[player.id] ?? player.id) : player.id;
    const ps = round?.scores?.[sourceId] ?? {};
    let strokes = 0;
    let parThrough = 0;
    let played = 0;
    for (const hole of holes) {
      const sc = ps[hole.number];
      if (sc) { strokes += sc; parThrough += hole.par ?? 0; played++; }
    }
    const points = scramble
      ? (teamPointsByCaptain[captainOf[player.id]] ?? 0)
      : (totalsById[player.id]?.totalPoints ?? 0);
    return {
      player,
      handicap: totalsById[player.id]?.handicap,
      points,
      strokes,
      played,
      vsPar: strokes - parThrough,
    };
  });
  if (ranked) rows = [...rows].sort((a, b) => b.points - a.points);

  const holesPlayed = rows.length ? Math.max(...rows.map((r) => r.played)) : 0;
  const progressPct = totalHoles > 0 ? Math.min(100, Math.round((holesPlayed / totalHoles) * 100)) : 0;

  const vsParText = (r) => {
    if (r.played === 0) return '—';
    if (r.vsPar === 0) return 'E';
    return r.vsPar > 0 ? `+${r.vsPar}` : `${r.vsPar}`;
  };
  const vsParColor = (r) => {
    if (r.played === 0) return theme.text.muted;
    if (r.vsPar < 0) return theme.scoreColor('excellent');
    if (r.vsPar === 0) return theme.scoreColor('good');
    return theme.scoreColor('poor');
  };

  return (
    <>
      <View style={s.roundProgressRow}>
        <View style={s.roundProgressTrack}>
          <View style={[s.roundProgressFill, { width: `${progressPct}%` }]} />
        </View>
        <Text style={s.roundProgressText}>{holesPlayed} / {totalHoles}</Text>
      </View>
      <View style={{ gap: 10 }}>
        {rows.map((r, i) => {
          const onHole = showRunning && showHoleBadges && r.played > 0 && r.played < totalHoles
            ? r.played + 1
            : null;
          const isLeader = ranked && i === 0 && r.points > 0;
          const tee = teeLabels?.[r.player.id]?.label;
          return (
            <View key={r.player.id} style={[s.gamePlayerCard, isLeader && s.gamePlayerCardLeader]}>
              <View style={s.gamePlayerHeader}>
                <View
                  style={s.gamePlayerNameWrap}
                  accessibilityLabel={ranked ? `Rank ${i + 1}: ${r.player.name}` : undefined}
                >
                  {ranked && (
                    <View style={s.rankBadge}>
                      <Text style={s.rankBadgeText}>{i + 1}</Text>
                    </View>
                  )}
                  <Text style={s.gamePlayerName} numberOfLines={1}>{r.player.name}</Text>
                  {tee ? <Text style={s.teeBadge}>{tee}</Text> : null}
                </View>
                <View style={s.gamePlayerHeaderRight}>
                  {onHole != null && (
                    <View style={s.holeBadge} accessibilityLabel={`On hole ${onHole}`}>
                      <Text style={s.holeBadgeText}>HOLE {onHole}</Text>
                    </View>
                  )}
                  <Text style={s.gamePlayerHcp}>
                    HCP {Number.isFinite(r.handicap) ? r.handicap : '—'}
                  </Text>
                </View>
              </View>
              <View style={s.gameStatsRow}>
                <View style={s.gameStatCell}>
                  <Text style={s.gameStatValue}>{showRunning ? r.points : '—'}</Text>
                  <Text style={s.gameStatLabel}>Points</Text>
                </View>
                <View style={s.gameStatDivider} />
                <View style={s.gameStatCell}>
                  <Text style={s.gameStatValue}>
                    {showRunning && r.played > 0 ? r.strokes : '—'}
                  </Text>
                  <Text style={s.gameStatLabel}>Strokes</Text>
                </View>
                <View style={s.gameStatDivider} />
                <View style={s.gameStatCell}>
                  <Text style={[s.gameStatValue, showRunning && { color: vsParColor(r) }]}>
                    {showRunning ? vsParText(r) : '—'}
                  </Text>
                  <Text style={s.gameStatLabel}>vs Par</Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </>
  );
}

const makeStyles = (t) => StyleSheet.create({
  roundProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  roundProgressTrack: {
    flex: 1, height: 6, borderRadius: 3,
    backgroundColor: t.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  roundProgressFill: { height: 6, borderRadius: 3, backgroundColor: t.accent.primary },
  roundProgressText: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.muted, fontSize: 11 },

  gamePlayerCard: {
    borderRadius: 14,
    backgroundColor: t.isDark ? t.bg.secondary : t.bg.secondary,
    borderWidth: 1,
    borderColor: t.border.default,
    padding: 14,
  },
  gamePlayerCardLeader: {
    backgroundColor: t.isDark ? 'rgba(255,215,0,0.06)' : '#fffaeb',
    borderColor: semantic.winner.dark + '66',
  },
  gamePlayerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 12,
  },
  gamePlayerName: {
    fontFamily: 'PlusJakartaSans-Bold',
    color: t.text.primary,
    fontSize: 15,
    flexShrink: 1,
  },
  gamePlayerHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gamePlayerHcp: {
    fontFamily: 'PlusJakartaSans-Medium',
    color: t.text.muted,
    fontSize: 11,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  // Glowing "on hole N" badge — same halo recipe (tinted border + shadow) as
  // the team-color halo on the live scorecard's PlayerCard.
  holeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: t.accent.light,
    borderWidth: 1.5,
    borderColor: t.accent.primary,
    shadowColor: t.accent.primary,
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  holeBadgeText: {
    fontFamily: 'PlusJakartaSans-Bold',
    color: t.accent.primary,
    fontSize: 10,
    letterSpacing: 0.4,
  },
  gameStatsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: t.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
    borderRadius: 10,
    paddingVertical: 8,
  },
  gameStatCell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  gameStatDivider: {
    width: 1,
    backgroundColor: t.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    marginVertical: 4,
  },
  gameStatValue: {
    fontFamily: 'PlusJakartaSans-Bold',
    color: t.text.primary,
    fontSize: 15,
  },
  gameStatLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: t.text.muted,
    fontSize: 9,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 3,
  },

  gamePlayerNameWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    flex: 1, minWidth: 0,
  },
  rankBadge: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
  },
  rankBadgeText: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.secondary, fontSize: 11 },
  teeBadge: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11,
    color: t.accent.primary, backgroundColor: t.accent.light,
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
});
