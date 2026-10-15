import React, { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import { buttonStyles } from '../components/ui/Buttons';
import ScreenHeader from '../components/ui/ScreenHeader';
import PullToRefresh from '../components/PullToRefresh';
import { useT, formatDate } from '../i18n';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../hooks/useLeague';
import { seasonTable, isMedalFormat, compareScores } from '../store/leagueStandings';
import { needsApproval } from '../store/leagueRules';
import { currentMonthKey, formatScore, formatToPar } from '../store/leagueView';
import { memberName } from '../lib/leagueNames';
import {
  MIN_HONOUR_CARDS, MIN_STAT_CARDS, monthHonours, monthSummary, statLeaders, seasonGrid, pointsBand, rivals, rivalMonths,
} from '../store/leagueStats';

const TABS = ['honours', 'leaders', 'grid', 'rivals'];
const MEDAL_TABS = ['grid', 'rivals'];
const STAT_CHIPS = ['avg', 'birdies', 'blobs', 'par3', 'backNine'];
const HONOUR_ICON = {
  card: 'award', hole: 'target', streak: 'trending-up', closer: 'flag',
  birdies: 'feather', snowman: 'cloud-snow', early: 'sunrise', last: 'moon',
};

// Renders a message descriptor whose params may be descriptors themselves.
const renderMsg = (t, msg) => {
  if (msg == null || typeof msg !== 'object') return msg ?? '';
  const params = {};
  Object.entries(msg.params ?? {}).forEach(([k, v]) => { params[k] = renderMsg(t, v); });
  return t(msg.key, params);
};
// "october" -> "October"; "oct" stays short for chips.
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const monthLong = (key) => cap(formatDate(`${key}-01`, 'monthName'));
const monthShort = (key) => cap(formatDate(`${key}-01`, 'day').split(' ')[1] ?? '');

// Honours, leaders, the season grid and my rivalries, all derived from the
// confirmed cards the league snapshot already carries. Cache first, then live.
export default function LeagueStatsScreen({ navigation, route }) {
  const { theme } = useTheme();
  const t = useT();
  const { user } = useAuth();
  const s = makeStyles(theme);
  const meId = user?.id ?? null;
  const leagueId = route?.params?.leagueId;
  const { data, stale, loading, refreshing, error, reload, refresh } = useLeague(navigation, leagueId);
  const [tabState, setTab] = useState('honours');
  // A medal league has no honours or leaders (they are per-hole Stableford):
  // the season grid and the rivals, with strokes to par.
  const format = data?.league?.format ?? 'stableford';
  const medal = isMedalFormat(format);
  const tabs = medal ? MEDAL_TABS : TABS;
  const tab = tabs.includes(tabState) ? tabState : tabs[0];
  const [month, setMonth] = useState(null);
  const [statKey, setStatKey] = useState('avg');
  const [openRival, setOpenRival] = useState(null);

  const view = useMemo(() => {
    if (!data) return null;
    const { league, members, cardsByMonth } = data;
    const active = members.filter((m) => !m.leftAt);
    const table = seasonTable(active, cardsByMonth, league.pointsTable, { participationPoints: league.participationPoints, format: league.format });
    const scored = Object.keys(cardsByMonth)
      .filter((m) => cardsByMonth[m].some((c) => c.status === 'confirmed' && !needsApproval(c))).sort();
    return { league, members, active, cardsByMonth, table, scored };
  }, [data]);

  const title = t('league.stats.title', { name: view?.league.name ?? route?.params?.name ?? t('league.stats.leagueFallback') });

  const header = (
    <ScreenHeader onBack={() => navigation.goBack()} title={title} numberOfLines={1} />
  );

  if (!view) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {header}
        <View style={s.center}>
          {loading ? <ActivityIndicator color={theme.accent.primary} /> : (
            <>
              <Feather name="cloud-off" size={40} color={theme.text.muted} />
              <Text style={s.emptyTitle}>{t('league.stats.loadError')}</Text>
              <Text style={s.emptyText}>{error}</Text>
              <TouchableOpacity style={s.secondaryBtn} onPress={reload} activeOpacity={0.8}>
                <Text style={s.secondaryText}>{t('common.retry')}</Text>
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
    if (scored.length === 0) return <Text style={s.emptyNote}>{t('league.stats.honoursEmpty')}</Text>;
    // The month in progress first, then settled months newest first.
    const months = [...scored].reverse();
    const picked = months.includes(month) ? month : months[0];
    const live = picked === curKey;
    const cards = cardsByMonth[picked] ?? [];
    const sum = monthSummary(cards);
    const honours = monthHonours(cards, members, meId);
    const lastDay = new Date(Number(picked.slice(0, 4)), Number(picked.slice(5, 7)), 0).getDate();
    const meta = live
      ? t('league.stats.metaLive', { cards: sum.cards, total: active.length, day: formatDate(`${picked}-${String(lastDay).padStart(2, '0')}`, 'day') })
      : renderMsg(t, sum.msg);
    return (
      <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow} contentContainerStyle={{ gap: 6 }}>
          {months.map((m) => chip(m, m === curKey ? t('league.stats.monthSoFarChip', { month: monthShort(m) }) : monthShort(m), m === picked, () => setMonth(m)))}
        </ScrollView>
        <View style={s.card}>
          <View style={s.cardHeadRow}>
            <Text style={s.cardTitle}>{t(live ? 'league.stats.monthSoFar' : 'league.stats.monthHonours', { month: monthLong(picked) })}</Text>
            <Text style={s.cardMeta}>{meta}</Text>
          </View>
          {honours.length === 0 ? (
            <Text style={s.cardText}>
              {t('league.stats.honoursFew', { count: MIN_HONOUR_CARDS })}
            </Text>
          ) : honours.map((h, i) => (
            <View key={h.key} style={[s.honourRow, i < honours.length - 1 && s.rowDivider]}>
              <View style={s.honourIcon}>
                <Feather name={HONOUR_ICON[h.key]} size={16} color={theme.accent.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.honourLabel}>{renderMsg(t, h.title).toUpperCase()}</Text>
                <Text style={s.honourText}>{renderMsg(t, h.text)}</Text>
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
          {STAT_CHIPS.map((k) => chip(k, t(`league.stats.stat.${k}`), k === statKey, () => setStatKey(k)))}
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
                <Text style={[s.leaderValue, !ranked && s.muted]} numberOfLines={1}>{typeof r.display === 'string' ? r.display : renderMsg(t, r.display)}</Text>
              </View>
            );
          })}
        </View>
        {needsCards && <Text style={s.footnote}>{t('league.stats.leadersFootnote', { count: MIN_STAT_CARDS })}</Text>}
      </>
    );
  };

  // ---- Season grid ---------------------------------------------------------

  const renderGrid = () => {
    if (scored.length === 0) return <Text style={s.emptyNote}>{t('league.stats.gridEmpty')}</Text>;
    const grid = seasonGrid(cardsByMonth, table, scored, format);
    // Stableford point bands (the month ranks by points); a medal grid has none.
    const high = (c) => !medal && pointsBand(c.points) === 'high';
    const BAND_STYLE = { high: s.cellHigh, mid: s.cellMid, low: s.cellLow };
    const cellStyle = (c) => {
      if (c.cardId == null) return [s.cell, s.cellNone];
      if (c.unrated) return [s.cell, s.cellLow];
      return [s.cell, !medal && BAND_STYLE[pointsBand(c.points)], c.best && { borderWidth: 2, borderColor: gold }];
    };
    const cellLabel = (c, row) => (c.unrated
      ? t('league.stats.cellUnrated', { name: nameOf(row.userId), month: monthLong(c.month) })
      : medal
        ? t('league.stats.cellScore', { name: nameOf(row.userId), month: monthLong(c.month), score: formatScore(c.score, format, t) })
        : t('league.stats.cell', { name: nameOf(row.userId), month: monthLong(c.month), points: c.points }));
    return (
      <>
        <View style={s.card}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={s.gridRow}>
                <View style={s.gridName} />
                {scored.map((m) => (
                  <Text key={m} style={s.gridHead} accessibilityLabel={monthLong(m)}>{monthShort(m).slice(0, 1)}</Text>
                ))}
              </View>
              {grid.map((row) => (
                <View key={row.userId} style={s.gridRow}>
                  <Text style={[s.leaderName, s.gridName, row.userId === meId && s.bold]} numberOfLines={1}>{nameOf(row.userId)}</Text>
                  {row.cells.map((c) => (
                    <TouchableOpacity
                      key={c.month}
                      style={cellStyle(c)}
                      disabled={c.cardId == null}
                      onPress={() => navigation.navigate('LeagueCard', { leagueId, month: c.month, userId: row.userId })}
                      activeOpacity={0.7}
                      accessibilityLabel={c.cardId == null ? undefined : cellLabel(c, row)}
                    >
                      <Text style={[s.cellText, high(c) && s.cellTextHigh, (c.cardId == null || c.unrated) && s.muted]}>
                        {c.cardId == null ? '–' : c.unrated ? t('league.stats.nr') : medal ? formatToPar(c.score) : String(c.points)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
        <View style={s.legend}>
          {!medal && <View style={s.legendItem}><View style={[s.swatch, s.cellHigh]} /><Text style={s.legendText}>{t('league.stats.band.high')}</Text></View>}
          {!medal && <View style={s.legendItem}><View style={[s.swatch, s.cellMid]} /><Text style={s.legendText}>{t('league.stats.band.mid')}</Text></View>}
          {!medal && <View style={s.legendItem}><View style={[s.swatch, s.cellLow]} /><Text style={s.legendText}>{t('league.stats.band.low')}</Text></View>}
          <View style={s.legendItem}><Text style={[s.legendText, s.muted]}>{t('league.stats.nr')}</Text><Text style={s.legendText}>{t('league.stats.nrLegend')}</Text></View>
          <View style={s.legendItem}><View style={[s.swatch, { borderWidth: 2, borderColor: gold }]} /><Text style={s.legendText}>{t('league.stats.monthWinner')}</Text></View>
        </View>
      </>
    );
  };

  // ---- Rivals --------------------------------------------------------------

  const renderRivals = () => {
    const rows = rivals(cardsByMonth, active, meId, format);
    if (rows.length === 0) return <Text style={s.emptyNote}>{t('league.stats.rivalsEmpty')}</Text>;
    return (
      <View style={s.card}>
        <Text style={s.cardTitle}>{t('league.stats.youVsLeague')}</Text>
        {rows.map((r, i) => {
          const open = openRival === r.userId;
          const sub = r.months === 0
            ? t('league.stats.noSharedMonths')
            : [r.level > 0 ? t('league.stats.levelCount', { count: r.level }) : null, t('league.stats.monthsCount', { count: r.months })]
              .filter(Boolean).join(' · ');
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
              {open && rivalMonths(cardsByMonth, meId, r.userId, format).map((m) => (
                <View key={m.month} style={s.monthRow}>
                  <Text style={s.monthRowMonth}>{monthShort(m.month)}</Text>
                  <Text style={[s.monthRowText, compareScores(m.a, m.b, format) < 0 && s.winner]}>
                    {medal ? t('league.stats.youScore', { score: formatScore(m.a, format, t) }) : t('league.stats.youPts', { points: m.a })}
                  </Text>
                  <Text style={[s.monthRowText, compareScores(m.b, m.a, format) < 0 && s.winner]}>
                    {medal
                      ? t('league.stats.nameScore', { name: nameOf(r.userId), score: formatScore(m.b, format, t) })
                      : t('league.stats.namePts', { name: nameOf(r.userId), points: m.b })}
                  </Text>
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
        {tabs.map((tb) => (
          <TouchableOpacity
            key={tb}
            style={[s.tab, tab === tb && s.tabOn]}
            onPress={() => setTab(tb)}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === tb }}
          >
            <Text style={[s.tabText, tab === tb && s.tabTextOn]}>{t(`league.stats.tab.${tb}`)}</Text>
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
            <Text style={s.staleText}>{t('league.stats.offline')}</Text>
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
  const btn = buttonStyles(theme);
  return StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    content: { padding: 16, paddingBottom: 40 },
    muted: { color: theme.text.secondary },
    bold: { fontFamily: 'PlusJakartaSans-ExtraBold' },

    emptyTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 18, lineHeight: 24, marginTop: 14, textAlign: 'center' },
    emptyText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, marginTop: 6, marginBottom: 18, textAlign: 'center' },
    emptyNote: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, lineHeight: 19,
      textAlign: 'center', marginTop: 12,
    },
    secondaryBtn: { ...btn.secondaryBtn, paddingHorizontal: 28 },
    secondaryText: btn.secondaryText,

    tabs: {
      flexDirection: 'row', marginHorizontal: 16, marginTop: 4, padding: 3, borderRadius: 14,
      backgroundColor: theme.bg.secondary,
    },
    tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
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
    cardMeta: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, flexShrink: 1, textAlign: 'right' },
    cardText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, lineHeight: 19 },
    rowDivider: { borderBottomWidth: 1, borderBottomColor: theme.border.subtle },
    footnote: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, lineHeight: 17 },

    honourRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    honourIcon: {
      width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.accent.light,
    },
    honourLabel: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 10, letterSpacing: 1 },
    honourText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.primary, fontSize: 13, lineHeight: 18, marginTop: 1 },

    leaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 4 },
    meRow: { backgroundColor: theme.accent.light, borderRadius: 10 },
    place: { width: 20, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 12, textAlign: 'center' },
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
      color: theme.text.secondary, fontSize: 12,
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
    rivalSub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, marginTop: 1 },
    record: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.primary, fontSize: 16, marginLeft: 8 },
    monthRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, paddingLeft: 8 },
    monthRowMonth: { width: 32, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 12 },
    monthRowText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13 },
    winner: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.accent.primary },
  });
}
