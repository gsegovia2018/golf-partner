import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { semantic } from '../theme/tokens';

// The deep-green leaderboard card: the tournament leaderboard on Play and the
// season standings on the league board.
//
// Props:
//   title        small uppercase heading
//   headerRight  optional node at the right of the title row (the tournament's
//                points/strokes switch)
//   subheader    optional node between the title row and the rows (the scope chips)
//   rows         [{ key?, place (null = unplaced, shown as a dash), isTie, name, points, sub?, isMe?, mark? }]
//                points and sub are display strings; sub null renders nothing;
//                mark shows the winner icon beside the name;
//                onPress (optional) makes the row tappable, with a chevron
//   footer       optional string under the rows
//   sections     optional, instead of rows: [{ key, label, icon, gold?, rows?, body? }], each a
//                small uppercase heading (icon + label; gold tints it) over its rows, or over
//                `body` (a node) when it has no rows. A row may also set
//                  detail    a second line under the name
//                  muted     dim points (the row does not count yet)
//                  subGold   gold sub (table points)
//                  unranked  dashed place badge
//                A row may set compact (shorter, no sub), or be { key, gap: true }: a "⋯" spacer
//                for rows left out.
//   more         optional { label, onPress }: a text button under the rows (Show all 18)
export default function LeaderboardCard({ title, headerRight, subheader, rows = [], sections, footer, more }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const rankColors = [semantic.winner.dark, '#c0c8d4', '#daa06d'];

  const renderRow = (row, i, list) => {
    if (row.gap) {
      return (
        <View key={row.key} style={s.mastersGap} accessibilityLabel="More players">
          <Feather name="more-horizontal" size={16} color="rgba(255,255,255,0.4)" />
        </View>
      );
    }
    const placeIdx = row.place - 1;
    const isFirstPlace = row.place === 1;
    const rankColor = rankColors[placeIdx] || 'rgba(255,255,255,0.4)';
    const rankBg = placeIdx === 0 ? 'rgba(255,215,0,0.2)' : placeIdx === 1 ? 'rgba(192,200,212,0.15)' : placeIdx === 2 ? 'rgba(218,160,109,0.15)' : 'rgba(255,255,255,0.08)';
    const rankLabel = row.place == null ? '–' : row.isTie ? `T${row.place}` : row.place;
    const Row = row.onPress ? TouchableOpacity : View;
    return (
      <Row
        key={row.key ?? `${row.place}-${row.name}-${i}`}
        {...(row.onPress ? { onPress: row.onPress, activeOpacity: 0.7, accessibilityRole: 'button', accessibilityLabel: row.isMe ? 'Your card' : `${row.name}'s card` } : {})}
        style={[s.mastersRow, row.compact && s.mastersRowCompact, isFirstPlace && s.mastersRowFirst, row.isMe && s.mastersRowMe, i === list.length - 1 && { borderBottomWidth: 0 }]}
      >
        <View style={[s.mastersRankBadge, { backgroundColor: rankBg }, row.unranked && s.mastersRankUnranked]}>
          <Text style={[s.mastersRankText, { color: rankColor }]}>{rankLabel}</Text>
        </View>
        <View style={s.mastersNameCol}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[s.mastersName, (isFirstPlace || row.isMe) && { fontFamily: 'PlusJakartaSans-Bold' }]} numberOfLines={1}>
              {row.name}
            </Text>
            {row.mark && <Feather name="award" size={14} color={semantic.winner.dark} />}
          </View>
          {!!row.detail && <Text style={s.mastersDetail} numberOfLines={2}>{row.detail}</Text>}
        </View>
        <Text style={[s.mastersPoints, isFirstPlace && { fontSize: 18 }, row.muted && s.mastersPointsMuted]}>{row.points}</Text>
        {row.sub != null && <Text style={[s.mastersSub, row.subGold && s.mastersSubGold]}>{row.compact ? '' : row.sub}</Text>}
        {!!row.onPress && <Feather name="chevron-right" size={16} color="rgba(255,255,255,0.45)" style={{ marginLeft: 4 }} />}
      </Row>
    );
  };

  return (
    <View style={s.mastersCard}>
      <View style={[s.cardTitleRow, { marginBottom: 8 }]}>
        <Text style={[s.mastersCardTitle, { flexShrink: 1 }]} numberOfLines={1}>{title}</Text>
        {headerRight}
      </View>
      {subheader}
      {sections ? sections.map((sec) => (
        <View key={sec.key} style={s.mastersSection}>
          <View style={s.mastersSectionHead}>
            <Feather name={sec.icon} size={12} color={sec.gold ? semantic.winner.dark : 'rgba(255,255,255,0.6)'} />
            <Text style={[s.mastersSectionLabel, sec.gold && { color: semantic.winner.dark }]}>{sec.label}</Text>
          </View>
          {sec.rows ? sec.rows.map(renderRow) : sec.body}
        </View>
      )) : rows.map(renderRow)}
      {!!more && (
        <TouchableOpacity style={s.mastersMore} onPress={more.onPress} activeOpacity={0.7} accessibilityRole="button">
          <Text style={s.mastersMoreText}>{more.label}</Text>
        </TouchableOpacity>
      )}
      {!!footer && <Text style={s.mastersMatchStatus}>{footer}</Text>}
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    // Same title-row layout HomeScreen's `cardTitleRow` has.
    cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8 },
    mastersCard: {
      backgroundColor: t.bg.deep,
      borderRadius: 20, padding: 16, marginBottom: 16,
      ...(t.isDark ? {} : { shadowColor: '#004030', shadowOpacity: 0.3, shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, elevation: 6 }),
    },
    mastersCardTitle: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 10, color: 'rgba(255,255,255,0.6)',
      letterSpacing: 2, textTransform: 'uppercase',
    },
    mastersRow: {
      flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
      borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.12)',
    },
    mastersRowCompact: { paddingVertical: 6 },
    mastersGap: { alignItems: 'center', paddingVertical: 2, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.12)' },
    mastersMore: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
    mastersMoreText: { fontFamily: 'PlusJakartaSans-Bold', color: '#ffffff', fontSize: 13 },
    mastersRowFirst: { borderLeftWidth: 3, borderLeftColor: semantic.winner.dark, paddingLeft: 8, marginLeft: -8 },
    // The signed-in member's own row (league board); the tournament view never sets it.
    mastersRowMe: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, paddingHorizontal: 8, marginHorizontal: -8 },
    mastersRankBadge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
    mastersRankText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12 },
    mastersRankUnranked: { borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.3)', backgroundColor: 'transparent' },
    mastersSection: { marginTop: 8 },
    mastersSectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
    mastersSectionLabel: {
      fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, color: 'rgba(255,255,255,0.6)',
      letterSpacing: 1.6, textTransform: 'uppercase',
    },
    mastersDetail: { fontFamily: 'PlusJakartaSans-Medium', color: 'rgba(255,255,255,0.55)', fontSize: 11, marginTop: 2 },
    mastersNameCol: { flex: 1, minWidth: 0, marginRight: 8 },
    mastersName: { fontFamily: 'PlusJakartaSans-Medium', color: '#ffffff', fontSize: 14 },
    mastersPoints: { fontFamily: 'PlusJakartaSans-ExtraBold', color: semantic.winner.dark, fontSize: 16, marginRight: 8 },
    mastersPointsMuted: { color: 'rgba(255,255,255,0.45)', fontSize: 14 },
    mastersSubGold: { color: semantic.winner.dark, fontFamily: 'PlusJakartaSans-Bold' },
    mastersSub: { fontFamily: 'PlusJakartaSans-Medium', color: 'rgba(255,255,255,0.45)', fontSize: 11, width: 60, textAlign: 'right' },
    mastersMatchStatus: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: 'rgba(255,255,255,0.85)',
      fontSize: 12, textAlign: 'center', marginTop: 10,
    },
  });
}
