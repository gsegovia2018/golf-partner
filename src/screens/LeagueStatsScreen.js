import React, { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import PullToRefresh from '../components/PullToRefresh';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../hooks/useLeague';
import { seasonTable } from '../store/leagueStandings';
import { monthName, memberName, currentMonthKey } from '../store/leagueView';
import {
  MIN_HONOUR_CARDS, monthHonours, monthSummary, statLeaders, seasonGrid, rivals, rivalMonths,
} from '../store/leagueStats';

const TABS = [
  { key: 'honours', label: 'Honours' },
  { key: 'leaders', label: 'Leaders' },
  { key: 'grid', label: 'Grid' },
  { key: 'rivals', label: 'Rivals' },
];
const STAT_CHIPS = [
  { key: 'avg', label: 'Avg card' },
  { key: 'birdies', label: 'Birdies' },
  { key: 'blobs', label: 'Blobs' },
  { key: 'par3', label: 'Par 3s' },
  { key: 'backNine', label: 'Back nine' },
];
const HONOUR_ICON = {
  card: 'award', hole: 'target', streak: 'trending-up', closer: 'flag',
  birdies: 'feather', snowman: 'cloud-snow', early: 'sunrise', last: 'moon',
};

// Honours, leaders, the season grid and my rivalries, all derived from the
// confirmed cards the league snapshot already carries. Cache first, then live.
export default function LeagueStatsScreen({ navigation, route }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = makeStyles(theme);
  const meId = user?.id ?? null;
  const leagueId = route?.params?.leagueId;
  const { data, stale, loading, refreshing, error, reload, refresh } = useLeague(navigation, leagueId);
  const [tab, setTab] = useState('honours');
  const [month, setMonth] = useState(null);
  const [statKey, setStatKey] = useState('avg');
  const [openRival, setOpenRival] = useState(null);

  const view = useMemo(() => {
    if (!data) return null;
    const { league, members, cardsByMonth } = data;
    const active = members.filter((m) => !m.leftAt);
    const table = seasonTable(active, cardsByMonth, league.pointsTable);
    const scored = Object.keys(cardsByMonth)
      .filter((m) => cardsByMonth[m].some((c) => c.status === 'confirmed')).sort();
    return { league, members, active, cardsByMonth, table, scored };
  }, [data]);

  const title = `${view?.league.name ?? route?.params?.name ?? 'League'} · Stats`;

  const header = (
    <View style={s.header}>
      <IconButton icon="chevron-left" size={24} color={theme.accent.primary} onPress={() => navigation.goBack()} accessibilityLabel="Back" />
      <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
    </View>
  );

  if (!view) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {header}
        <View style={s.center}>
          {loading ? <ActivityIndicator color={theme.accent.primary} /> : (
            <>
              <Feather name="cloud-off" size={40} color={theme.text.muted} />
              <Text style={s.emptyTitle}>Couldn't load the stats</Text>
              <Text style={s.emptyText}>{error}</Text>
              <TouchableOpacity style={s.secondaryBtn} onPress={reload} activeOpacity={0.8}>
                <Text style={s.secondaryText}>Try again</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScreenContainer>
    );
  }

  const { members, active, cardsByMonth, table, scored } = view;
  const nameOf = (userId) => memberName(members, userId, meId);
  const gold = theme.semantic.winner[theme.isDark ? 'dark' : 'light'];
  const curKey = currentMonthKey();

  const chip = (key, label, on, onPress) => (
    <TouchableOpacity
      key={key}
      style={[s.chip, on && s.chipOn]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );

  // ---- Honours -------------------------------------------------------------

  const renderHonours = () => {
    if (scored.length === 0) return <Text style={s.emptyNote}>No confirmed cards yet. Honours appear once cards are confirmed.</Text>;
    // The month in progress first, then settled months newest first.
    const months = [...scored].reverse();
    const picked = months.includes(month) ? month : months[0];
    const live = picked === curKey;
    const cards = cardsByMonth[picked] ?? [];
    const sum = monthSummary(cards);
    const honours = monthHonours(cards, members);
    const lastDay = new Date(Number(picked.slice(0, 4)), Number(picked.slice(5, 7)), 0).getDate();
    const meta = live
      ? `${sum.cards} of ${active.length} cards · settles ${lastDay} ${monthName(picked, true)}`
      : sum.text;
    return (
      <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow} contentContainerStyle={{ gap: 6 }}>
          {months.map((m) => chip(m, m === curKey ? `${monthName(m, true)} · so far` : monthName(m, true), m === picked, () => setMonth(m)))}
        </ScrollView>
        <View style={s.card}>
          <View style={s.cardHeadRow}>
            <Text style={s.cardTitle}>{live ? `${monthName(picked)} so far` : `${monthName(picked)} honours`}</Text>
            <Text style={s.cardMeta}>{meta}</Text>
          </View>
          {honours.length === 0 ? (
            <Text style={s.cardText}>
              {`Not enough cards yet. Honours need ${MIN_HONOUR_CARDS} confirmed cards.`}
            </Text>
          ) : honours.map((h, i) => (
            <View key={h.key} style={[s.honourRow, i < honours.length - 1 && s.rowDivider]}>
              <View style={s.honourIcon}>
                <Feather name={HONOUR_ICON[h.key]} size={16} color={theme.accent.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.honourLabel}>{h.title.toUpperCase()}</Text>
                <Text style={s.honourText}>{h.text}</Text>
              </View>
            </View>
          ))}
        </View>
      </>
    );
  };

  // ---- Leaders -------------------------------------------------------------

  const renderLeaders = () => {
    const rows = statLeaders(cardsByMonth, active, statKey);
    const max = Math.max(0, ...rows.map((r) => r.value ?? 0));
    const needsCards = rows.some((r) => r.value == null && r.cards > 0);
    let place = 0;
    return (
      <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow} contentContainerStyle={{ gap: 6 }}>
          {STAT_CHIPS.map((c) => chip(c.key, c.label, c.key === statKey, () => setStatKey(c.key)))}
        </ScrollView>
        <View style={s.card}>
          {rows.map((r, i) => {
            const ranked = r.value != null;
            if (ranked) place += 1;
            const isMe = r.userId === meId;
            return (
              <View key={r.userId} style={[s.leaderRow, isMe && s.meRow, i < rows.length - 1 && s.rowDivider]}>
                <Text style={s.place}>{ranked ? place : '–'}</Text>
                <Text style={[s.leaderName, isMe && s.bold]} numberOfLines={1}>{nameOf(r.userId)}</Text>
                <View style={s.barTrack}>
                  {ranked && max > 0 && (
                    <View style={[s.barFill, { width: `${Math.max(4, Math.round((Math.max(0, r.value) / max) * 100))}%` }]} />
                  )}
                </View>
                <Text style={[s.leaderValue, !ranked && s.muted]} numberOfLines={1}>{r.display}</Text>
              </View>
            );
          })}
        </View>
        {needsCards && <Text style={s.footnote}>Averages need 3 cards. Players short of that are listed last.</Text>}
      </>
    );
  };

  // ---- Season grid ---------------------------------------------------------

  const renderGrid = () => {
    if (scored.length === 0) return <Text style={s.emptyNote}>No confirmed cards yet.</Text>;
    const grid = seasonGrid(cardsByMonth, table, scored);
    const cellStyle = (c) => {
      if (c.points == null) return [s.cell, s.cellNone];
      const base = c.points >= 36 ? s.cellHigh : (c.points >= 33 ? s.cellMid : s.cellLow);
      return [s.cell, base, c.best && { borderWidth: 2, borderColor: gold }];
    };
    return (
      <>
        <View style={s.card}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={s.gridRow}>
                <View style={s.gridName} />
                {scored.map((m) => (
                  <Text key={m} style={s.gridHead} accessibilityLabel={monthName(m)}>{monthName(m, true).slice(0, 1)}</Text>
                ))}
              </View>
              {grid.map((row) => (
                <View key={row.userId} style={s.gridRow}>
                  <Text style={[s.leaderName, s.gridName, row.userId === meId && s.bold]} numberOfLines={1}>{nameOf(row.userId)}</Text>
                  {row.cells.map((c) => (
                    <View key={c.month} style={cellStyle(c)}>
                      <Text style={[s.cellText, c.points != null && c.points >= 36 && s.cellTextHigh, c.points == null && s.muted]}>
                        {c.points ?? '–'}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
        <View style={s.legend}>
          <View style={s.legendItem}><View style={[s.swatch, s.cellHigh]} /><Text style={s.legendText}>36+</Text></View>
          <View style={s.legendItem}><View style={[s.swatch, s.cellMid]} /><Text style={s.legendText}>33-35</Text></View>
          <View style={s.legendItem}><View style={[s.swatch, s.cellLow]} /><Text style={s.legendText}>32 or less</Text></View>
          <View style={s.legendItem}><View style={[s.swatch, { borderWidth: 2, borderColor: gold }]} /><Text style={s.legendText}>Month winner</Text></View>
        </View>
      </>
    );
  };

  // ---- Rivals --------------------------------------------------------------

  const renderRivals = () => {
    const rows = rivals(cardsByMonth, active, meId);
    if (rows.length === 0) return <Text style={s.emptyNote}>Rivalries appear once you are in the league with others.</Text>;
    return (
      <View style={s.card}>
        <Text style={s.cardTitle}>You vs the league</Text>
        {rows.map((r, i) => {
          const open = openRival === r.userId;
          const sub = r.months === 0
            ? 'no shared months'
            : [r.level > 0 ? `${r.level} level` : null, `${r.months} ${r.months === 1 ? 'month' : 'months'}`].filter(Boolean).join(' · ');
          return (
            <View key={r.userId} style={i < rows.length - 1 && s.rowDivider}>
              <TouchableOpacity
                style={s.rivalRow}
                onPress={() => setOpenRival(open ? null : r.userId)}
                activeOpacity={0.7}
                disabled={r.months === 0}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.leaderName} numberOfLines={1}>{nameOf(r.userId)}</Text>
                  <Text style={s.rivalSub}>{sub}</Text>
                </View>
                <Text style={[s.record, r.won > r.lost && { color: theme.accent.primary }, r.months === 0 && s.muted]}>
                  {r.months === 0 ? '–' : `${r.won}–${r.lost}`}
                </Text>
              </TouchableOpacity>
              {open && rivalMonths(cardsByMonth, meId, r.userId).map((m) => (
                <View key={m.month} style={s.monthRow}>
                  <Text style={s.monthRowMonth}>{monthName(m.month, true)}</Text>
                  <Text style={[s.monthRowText, m.a > m.b && s.winner]}>{`You ${m.a}`}</Text>
                  <Text style={[s.monthRowText, m.b > m.a && s.winner]}>{`${nameOf(r.userId)} ${m.b}`}</Text>
                </View>
              ))}
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {header}
      <View style={s.tabs}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[s.tab, tab === t.key && s.tabOn]}
            onPress={() => setTab(t.key)}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.key }}
          >
            <Text style={[s.tabText, tab === t.key && s.tabTextOn]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <PullToRefresh
        style={{ flex: 1 }}
        contentContainerStyle={s.content}
        refreshing={refreshing}
        onRefresh={refresh}
      >
        {stale && (
          <View style={s.staleBanner}>
            <Feather name="cloud-off" size={14} color={theme.text.secondary} />
            <Text style={s.staleText}>Offline · showing the last saved stats</Text>
          </View>
        )}
        {tab === 'honours' && renderHonours()}
        {tab === 'leaders' && renderLeaders()}
        {tab === 'grid' && renderGrid()}
        {tab === 'rivals' && renderRivals()}
      </PullToRefresh>
    </ScreenContainer>
  );
}

function makeStyles(theme) {
  const cardBorder = theme.isDark ? theme.glass?.border : theme.border.default;
  return StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6,
    },
    headerTitle: {
      fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 17, letterSpacing: -0.3, flexShrink: 1,
    },
    content: { padding: 16, paddingBottom: 40 },
    muted: { color: theme.text.muted },
    bold: { fontFamily: 'PlusJakartaSans-ExtraBold' },

    emptyTitle: { fontFamily: 'PlayfairDisplay-Bold', color: theme.text.primary, fontSize: 22, marginTop: 14, textAlign: 'center' },
    emptyText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, marginTop: 6, marginBottom: 18, textAlign: 'center' },
    emptyNote: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, lineHeight: 19,
      textAlign: 'center', marginTop: 12,
    },
    secondaryBtn: {
      alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, minHeight: 44,
      borderColor: theme.border.default, paddingVertical: 12, paddingHorizontal: 28,
    },
    secondaryText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 14 },

    tabs: {
      flexDirection: 'row', marginHorizontal: 16, marginTop: 4, padding: 3, borderRadius: 14,
      backgroundColor: theme.bg.secondary,
    },
    tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
    tabOn: { backgroundColor: theme.accent.primary },
    tabText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 13 },
    tabTextOn: { color: theme.text.inverse },

    chipRow: { flexGrow: 0, marginBottom: 12 },
    chip: {
      minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 999,
      backgroundColor: theme.bg.secondary,
    },
    chipOn: { backgroundColor: theme.accent.primary },
    chipText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 12 },
    chipTextOn: { color: theme.text.inverse },

    staleBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.bg.secondary,
      borderRadius: 12, padding: 10, marginBottom: 12,
    },
    staleText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12 },

    card: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: cardBorder,
      padding: 16, marginBottom: 14, ...(theme.isDark ? {} : theme.shadow.card),
    },
    cardHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 },
    cardTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 15 },
    cardMeta: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 12, flexShrink: 1, textAlign: 'right' },
    cardText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, lineHeight: 19 },
    rowDivider: { borderBottomWidth: 1, borderBottomColor: theme.border.subtle },
    footnote: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 12, lineHeight: 17 },

    honourRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    honourIcon: {
      width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.accent.light,
    },
    honourLabel: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted, fontSize: 10, letterSpacing: 1 },
    honourText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.primary, fontSize: 13, lineHeight: 18, marginTop: 1 },

    leaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 4 },
    meRow: { backgroundColor: theme.accent.light, borderRadius: 10 },
    place: { width: 20, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted, fontSize: 12, textAlign: 'center' },
    leaderName: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 14, width: 96 },
    barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: theme.bg.secondary, overflow: 'hidden' },
    barFill: { height: 8, borderRadius: 4, backgroundColor: theme.accent.primary },
    leaderValue: {
      fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 13, minWidth: 48, textAlign: 'right',
    },

    gridRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
    gridName: { width: 92 },
    gridHead: {
      width: 36, textAlign: 'center', marginRight: 4, fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.muted, fontSize: 12,
    },
    cell: { width: 36, height: 44, marginRight: 4, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    cellHigh: { backgroundColor: theme.accent.primary },
    cellMid: { backgroundColor: theme.accent.light },
    cellLow: { backgroundColor: theme.bg.secondary },
    cellNone: { borderWidth: 1, borderStyle: 'dashed', borderColor: theme.border.default },
    cellText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 12 },
    cellTextHigh: { color: theme.text.inverse },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 14 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    swatch: { width: 14, height: 14, borderRadius: 4 },
    legendText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12 },

    rivalRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingVertical: 8 },
    rivalSub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 12, marginTop: 1 },
    record: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.primary, fontSize: 16, marginLeft: 8 },
    monthRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, paddingLeft: 8 },
    monthRowMonth: { width: 32, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 12 },
    monthRowText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13 },
    winner: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.accent.primary },
  });
}
