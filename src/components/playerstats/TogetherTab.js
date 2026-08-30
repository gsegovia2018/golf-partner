import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import PressableScale from '../ui/PressableScale';
import StatTile from '../mystats/StatTile';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

const fmtSigned1 = (v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1));

// Rounds you and this friend have both played, most recent first, with a
// head-to-head summary up top. All numbers come from `shared`/`h2h` — no
// domain maths lives here.
export default function TogetherTab({ shared = [], h2h, name, navigation }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const ptsEdge = h2h && h2h.n > 0 ? h2h.avgMe - h2h.avgThem : null;
  const rows = useMemo(() => [...shared].reverse(), [shared]); // most recent first

  if (!shared || shared.length === 0) {
    return (
      <View style={s.empty}>
        <Text style={s.emptyTitle}>No shared rounds yet</Text>
        <Text style={s.emptyText}>
          {`Play a tournament together and it'll show up here.`}
        </Text>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <View style={s.tiles}>
        <StatTile value={h2h?.n ?? shared.length} caption="Rounds together" />
        <StatTile
          value={ptsEdge == null ? '—' : fmtSigned1(ptsEdge)}
          caption="Points edge / rnd"
          tone={ptsEdge > 0 ? 'up' : ptsEdge < 0 ? 'down' : 'default'}
        />
      </View>

      {rows.map((round) => {
        const winner = round.mePoints > round.themPoints ? 'me'
          : round.themPoints > round.mePoints ? 'them' : null;
        return (
          <PressableScale
            key={round.key}
            style={[s.row, winner === 'me' && s.rowWinTint]}
            onPress={() => navigation.navigate('Scorecard', {
              tournamentId: round.tournamentId,
              roundIndex: round.roundIndex,
            })}
            accessibilityRole="button"
          >
            <View style={s.rowHead}>
              <Text style={s.rowTitle} numberOfLines={1}>
                {round.courseName || `Round ${round.roundIndex + 1}`}
              </Text>
              {round.partners ? (
                <View style={s.partnersTag}>
                  <Text style={s.partnersTagText}>Partners</Text>
                </View>
              ) : null}
            </View>
            <Text style={s.rowSub} numberOfLines={1}>
              {[round.tournamentName, fmtDate(round.date)].filter(Boolean).join(' · ')}
            </Text>
            <View style={s.scoreRow}>
              <View style={s.scoreCol}>
                <Text style={[s.scoreValue, winner === 'me' && s.scoreValueWin]}>{round.mePoints}</Text>
                <Text style={s.scoreLabel}>You</Text>
              </View>
              <Text style={s.scoreDivider}>{'–'}</Text>
              <View style={s.scoreCol}>
                <Text style={[s.scoreValue, winner === 'them' && s.scoreValueWin]}>{round.themPoints}</Text>
                <Text style={s.scoreLabel} numberOfLines={1}>{name}</Text>
              </View>
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.md },
    tiles: { flexDirection: 'row', gap: theme.spacing.sm },
    empty: { alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.xxxl },
    emptyTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 16, color: theme.text.primary },
    emptyText: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, color: theme.text.muted, textAlign: 'center' },

    row: {
      backgroundColor: theme.bg.card, borderRadius: theme.radius.lg, padding: theme.spacing.md,
      borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default, gap: 4,
    },
    rowWinTint: { backgroundColor: theme.accent.light, borderColor: theme.accent.primary },
    rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rowTitle: { flex: 1, fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.primary },
    partnersTag: {
      paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.pill, backgroundColor: theme.bg.secondary,
    },
    partnersTagText: {
      fontSize: 9, fontFamily: 'PlusJakartaSans-Bold', letterSpacing: 0.6, textTransform: 'uppercase', color: theme.text.muted,
    },
    rowSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11.5, color: theme.text.muted },
    scoreRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, marginTop: 4 },
    scoreCol: { alignItems: 'center', minWidth: 44 },
    scoreValue: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.secondary },
    scoreValueWin: { color: theme.accent.primary },
    scoreLabel: {
      fontSize: 9, fontFamily: 'PlusJakartaSans-Bold', letterSpacing: 1, textTransform: 'uppercase', color: theme.text.muted, marginTop: 2,
    },
    scoreDivider: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.muted },
  });
}
