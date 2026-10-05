import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import PullToRefresh from '../components/PullToRefresh';
import LeaderboardCard from '../components/LeaderboardCard';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../hooks/useLeague';
import { seasonTable, monthResults } from '../store/leagueStandings';
import {
  monthName, formatPoints, formatEuros, potCents, lastScoredMonth, deltaLabel, monthRows,
  daysLeftInMonth, currentMonthKey, memberName, yourCardState,
} from '../store/leagueView';
import { dayLabel, timeLabel } from '../store/leagueOffApp';
import {
  getPendingLeagueFinals, subscribePendingLeagueFinals, flushPendingLeagueFinals,
} from '../lib/leagueFinalPending';

// The league's home: season standings, this month's cards and my own card.
// Cache first, then live; pull to refresh.
export default function LeagueBoardScreen({ navigation, route }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = makeStyles(theme);
  const meId = user?.id ?? null;
  const leagueId = route?.params?.leagueId;
  const { data, stale, loading, refreshing, error, reload, refresh } = useLeague(navigation, leagueId);
  const [scope, setScope] = useState('season');

  // A Final started on this device whose link to the league is still being
  // retried (see lib/leagueFinalPending). Flush on focus; reload once it lands.
  const [pendingFinal, setPendingFinal] = useState(null);
  useEffect(() => {
    let alive = true;
    let had = false;
    const apply = (list) => {
      if (!alive) return;
      const mine = list.find((x) => x.leagueId === leagueId) ?? null;
      setPendingFinal(mine);
      if (had && !mine) reload(); // the link landed: pick up the server's Final
      had = !!mine;
    };
    const unsub = subscribePendingLeagueFinals(apply);
    const onFocus = async () => {
      apply(await getPendingLeagueFinals());
      await flushPendingLeagueFinals();
    };
    onFocus();
    const off = navigation?.addListener?.('focus', onFocus);
    return () => { alive = false; unsub(); if (typeof off === 'function') off(); };
  }, [navigation, leagueId, reload]);

  const view = useMemo(() => {
    if (!data) return null;
    const { league, members, cardsByMonth } = data;
    const active = members.filter((m) => !m.leftAt);
    const table = seasonTable(active, cardsByMonth, league.pointsTable);
    const last = lastScoredMonth(cardsByMonth);
    const scoredMonths = Object.keys(cardsByMonth)
      .filter((m) => cardsByMonth[m].some((c) => c.status === 'confirmed'))
      .sort().reverse().slice(0, 6);
    return { league, members, active, cardsByMonth, table, last, scoredMonths };
  }, [data]);

  const title = view?.league.name ?? route?.params?.name ?? 'League';

  const header = (
    <View style={s.header}>
      <View style={s.headerLeft}>
        <IconButton icon="chevron-left" size={24} color={theme.accent.primary} onPress={() => navigation.goBack()} accessibilityLabel="Back" />
        <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
      </View>
      <View style={s.headerRight}>
        <IconButton
          icon="bar-chart-2"
          onPress={() => navigation.navigate('LeagueStats', { leagueId })}
          accessibilityLabel="Stats"
        />
        <IconButton
          icon="users"
          onPress={() => navigation.navigate('LeagueMembers', { leagueId })}
          accessibilityLabel="Members and handicaps"
        />
        <IconButton
          icon="settings"
          onPress={() => navigation.navigate('LeagueSettings', { leagueId })}
          accessibilityLabel="League settings"
        />
      </View>
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
              <Text style={s.emptyTitle}>Couldn't load the league</Text>
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

  const { league, members, active, cardsByMonth, table, last, scoredMonths } = view;
  const nameOf = (userId) => memberName(members, userId, meId);
  const noCardsYet = !last;
  const now = new Date();
  const curKey = currentMonthKey(now);
  const curMonth = monthName(curKey);
  const archived = !!league.archivedAt;

  // ---- Standings card ------------------------------------------------------

  let boardTitle;
  let boardRows;
  let boardFooter = null;
  if (scope === 'season' || !scoredMonths.includes(scope)) {
    boardTitle = last ? `SEASON · AFTER ${monthName(last).toUpperCase()}` : 'SEASON';
    boardRows = table.map((r) => ({
      key: r.userId,
      place: noCardsYet ? null : r.place,
      isTie: r.isTie,
      name: nameOf(r.userId),
      points: noCardsYet ? '—' : formatPoints(r.total),
      sub: noCardsYet ? null : deltaLabel(r.lastMonthDelta, last),
      isMe: r.userId === meId,
    }));
    const pot = potCents(members, league.entryFeeCents);
    boardFooter = `Final in ${monthName(league.seasonEnd)} — extra strokes from these standings, set on the day.${pot > 0 ? ` Pot ${formatEuros(pot)}` : ''}`;
  } else {
    boardTitle = `${monthName(scope).toUpperCase()} · RESULTS`;
    boardRows = monthResults(cardsByMonth[scope], active, league.pointsTable).map((r) => ({
      key: r.userId,
      place: r.place,
      isTie: r.isTie,
      name: nameOf(r.userId),
      points: r.place == null ? '—' : `${r.cardPoints} pts`,
      sub: r.place == null ? null : `+${formatPoints(r.seasonPoints)}`,
      isMe: r.userId === meId,
    }));
  }

  const chips = scoredMonths.length > 0 ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow} contentContainerStyle={{ gap: 6 }}>
      {['season', ...scoredMonths].map((key) => {
        const on = scope === key || (key === 'season' && !scoredMonths.includes(scope));
        return (
          <TouchableOpacity
            key={key}
            style={[s.chip, on && s.chipOn]}
            onPress={() => setScope(key)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[s.chipText, on && s.chipTextOn]}>{key === 'season' ? 'Season' : monthName(key, true)}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  ) : null;

  // ---- This month ----------------------------------------------------------

  const rows = monthRows(members, cardsByMonth, curKey, now);
  const myCard = (cardsByMonth[curKey] ?? []).find((c) => c.userId === meId) ?? null;
  const mine = yourCardState(myCard);
  const toneColor = { done: theme.accent.primary, live: theme.text.primary, muted: theme.text.muted };

  // My app card stuck before confirmation (left Validate, or no partner yet):
  // reopen Validate on its round. A submitted card goes straight to the check.
  const finishValidating = !mine.offApp && (mine.kind === 'playing' || mine.kind === 'submitted') ? (
    <TouchableOpacity
      style={s.primaryBtn}
      onPress={() => navigation.navigate('LeagueValidate', {
        leagueId,
        cardId: mine.card.id,
        tournamentId: mine.card.tournamentId,
        roundId: mine.card.roundId,
        submitted: mine.kind === 'submitted',
      })}
      activeOpacity={0.8}
    >
      <Text style={s.primaryText}>Finish validating your card</Text>
    </TouchableOpacity>
  ) : null;

  const renderYourCard = () => {
    let body;
    let badge = null;
    if (mine.kind === 'none') {
      body = (
        <>
          <Text style={s.cardText}>
            Announce it before your first shot. Whatever you score then is your {curMonth} card.
          </Text>
          <TouchableOpacity
            style={s.primaryBtn}
            // Setup preselects this league's "Counts for" switch, on.
            onPress={() => navigation.navigate('Setup', { kind: 'game', leagueId })}
            activeOpacity={0.8}
          >
            <Feather name="play" size={16} color={theme.text.inverse} style={{ marginRight: 8 }} />
            <Text style={s.primaryText}>Play with the app</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.linkBtn}
            onPress={() => navigation.navigate('LeagueAnnounce', { leagueId })}
            activeOpacity={0.7}
          >
            <Text style={s.linkText}>Playing without the app?</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.navigate('LeagueAddScore', { leagueId })}
            activeOpacity={0.7}
            accessibilityRole="link"
          >
            <Text style={[s.hint, s.hintLink]}>
              Already played and announced it somewhere else? Add the card. It shows as “Not announced in the app”.
            </Text>
          </TouchableOpacity>
        </>
      );
    } else if (mine.kind === 'announced' || mine.kind === 'playing') {
      badge = mine.kind === 'playing' ? 'Playing' : 'Announced';
      body = (
        <>
          <Text style={s.cardText}>
            {mine.offApp && mine.kind === 'announced'
              ? [`Announced ${timeLabel(mine.card.announcedAt)}`, mine.course,
                [dayLabel(mine.card.teeTime), timeLabel(mine.card.teeTime)].filter(Boolean).join(' ')]
                .filter(Boolean).join(' · ') + ' — playing without the app'
              : `${mine.offApp ? 'Playing without the app' : 'Playing with the app'}${mine.course ? ` · ${mine.course}` : ''}`}
          </Text>
          {mine.kind === 'announced' && mine.offApp && (
            <TouchableOpacity
              style={s.primaryBtn}
              onPress={() => navigation.navigate('LeagueAddScore', { leagueId, cardId: mine.card.id })}
              activeOpacity={0.8}
            >
              <Text style={s.primaryText}>Add your score</Text>
            </TouchableOpacity>
          )}
          {finishValidating}
        </>
      );
    } else {
      badge = mine.kind === 'confirmed' ? 'Confirmed' : 'Submitted';
      const proofText = mine.card.proofPath
        ? (mine.card.confirmation === 'official' ? 'official result attached' : 'photo attached')
        : null;
      body = (
        <>
          <Text style={s.cardText}>
            {[mine.pts, mine.course, mine.offApp ? 'added after the round' : null, proofText,
              mine.card.confirmedByName ? `confirmed by ${mine.card.confirmedByName}` : null]
              .filter(Boolean).join(' · ')}
          </Text>
          {mine.kind === 'submitted' && mine.offApp && (
            <TouchableOpacity
              style={s.primaryBtn}
              onPress={() => navigation.navigate('LeagueAddProof', { leagueId, cardId: mine.card.id, resume: true })}
              activeOpacity={0.8}
            >
              <Text style={s.primaryText}>Add proof</Text>
            </TouchableOpacity>
          )}
          {finishValidating}
        </>
      );
    }
    return (
      <View style={s.card}>
        <View style={s.cardHeadRow}>
          <Text style={s.cardTitle}>{`Your ${curMonth} card`}</Text>
          {badge && <View style={s.badge}><Text style={s.badgeText}>{badge}</Text></View>}
        </View>
        {body}
      </View>
    );
  };

  // The December Final: the admin sets it up once; afterwards it is a link to
  // the tournament for everyone.
  const iAmAdmin = members.some((m) => m.userId === meId && m.role === 'admin' && !m.leftAt);
  const finalDate = data.final?.createdAt
    ? new Date(data.final.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : null;
  let finalRow = null;
  const finalId = data.final?.tournamentId ?? pendingFinal?.tournamentId ?? null;
  if (finalId) {
    finalRow = (
      <TouchableOpacity
        style={s.linkRow}
        onPress={() => navigation.navigate('Tournament', { tournamentId: finalId, viewMode: 'tournament' })}
        activeOpacity={0.7}
      >
        <Feather name="flag" size={16} color={theme.text.primary} style={{ marginRight: 10 }} />
        <Text style={s.linkRowText}>{['Final', finalDate, 'open'].filter(Boolean).join(' · ')}</Text>
        {!data.final && <Text style={{ color: theme.text.muted, fontSize: 12, marginRight: 6 }}>Linking the Final to the league…</Text>}
        <Feather name="chevron-right" size={18} color={theme.text.muted} />
      </TouchableOpacity>
    );
  } else if (iAmAdmin && !archived) {
    finalRow = (
      <TouchableOpacity
        style={s.linkRow}
        onPress={() => navigation.navigate('LeagueFinal', { leagueId })}
        activeOpacity={0.7}
      >
        <Feather name="flag" size={16} color={theme.text.primary} style={{ marginRight: 10 }} />
        <Text style={s.linkRowText}>Set up the Final</Text>
        <Feather name="chevron-right" size={18} color={theme.text.muted} />
      </TouchableOpacity>
    );
  }

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {header}
      <PullToRefresh
        style={{ flex: 1 }}
        contentContainerStyle={s.content}
        refreshing={refreshing}
        onRefresh={refresh}
      >
        {stale && (
          <View style={s.staleBanner}>
            <Feather name="cloud-off" size={14} color={theme.text.secondary} />
            <Text style={s.staleText}>Offline · showing the last saved board</Text>
          </View>
        )}
        {archived && (
          <View style={s.staleBanner}>
            <Feather name="archive" size={14} color={theme.text.secondary} />
            <Text style={s.staleText}>This league is archived and read-only.</Text>
          </View>
        )}

        <LeaderboardCard title={boardTitle} subheader={chips} rows={boardRows} footer={boardFooter} />

        {noCardsYet && (
          <Text style={s.emptyNote}>
            {`No cards yet. ${curMonth} is open: the board fills in as each card is confirmed.`}
          </Text>
        )}

        {!archived && renderYourCard()}

        <View style={s.card}>
          <View style={s.cardHeadRow}>
            <Text style={s.cardTitle}>{curMonth}</Text>
            <Text style={s.cardMeta}>{`${daysLeftInMonth(now)} days left · 1 card each`}</Text>
          </View>
          {rows.map((r, i) => (
            <View key={r.member.userId} style={[s.memberRow, i < rows.length - 1 && s.rowDivider]}>
              <View style={{ flex: 1 }}>
                <Text style={s.memberName} numberOfLines={1}>{nameOf(r.member.userId)}</Text>
                {!!r.flag && <Text style={s.flag}>{r.flag}</Text>}
              </View>
              <Text style={[s.memberStatus, { color: toneColor[r.tone] }]}>{r.text}</Text>
            </View>
          ))}
        </View>

        {finalRow}

        <TouchableOpacity
          style={[s.linkRow, { marginTop: finalRow ? 14 : 0 }]}
          onPress={() => navigation.navigate('LeagueMembers', { leagueId })}
          activeOpacity={0.7}
        >
          <Feather name="users" size={16} color={theme.text.primary} style={{ marginRight: 10 }} />
          <Text style={s.linkRowText}>Members and handicaps</Text>
          <Feather name="chevron-right" size={18} color={theme.text.muted} />
        </TouchableOpacity>
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
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6,
    },
    headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, gap: 4 },
    headerRight: { flexDirection: 'row', gap: 4 },
    headerTitle: {
      fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 17, letterSpacing: -0.3, flexShrink: 1,
    },
    content: { padding: 16, paddingBottom: 40 },

    emptyTitle: { fontFamily: 'PlayfairDisplay-Bold', color: theme.text.primary, fontSize: 22, marginTop: 14, textAlign: 'center' },
    emptyText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, marginTop: 6, marginBottom: 18, textAlign: 'center' },
    emptyNote: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, lineHeight: 19,
      textAlign: 'center', marginTop: -4, marginBottom: 16,
    },

    chipRow: { flexGrow: 0, marginBottom: 12 },
    chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
    chipOn: { backgroundColor: 'rgba(255,255,255,0.9)' },
    chipText: { fontFamily: 'PlusJakartaSans-SemiBold', color: 'rgba(255,255,255,0.72)', fontSize: 12 },
    chipTextOn: { color: theme.bg.deep },

    staleBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.bg.secondary,
      borderRadius: 12, padding: 10, marginBottom: 12,
    },
    staleText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12 },

    card: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: cardBorder,
      padding: 16, marginBottom: 14, ...(theme.isDark ? {} : theme.shadow.card),
    },
    cardHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    cardTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 15 },
    cardMeta: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 12 },
    cardText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, lineHeight: 19, marginBottom: 12 },
    badge: { backgroundColor: theme.accent.light, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
    badgeText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 11 },
    hint: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 12, lineHeight: 17, textAlign: 'center' },
    hintLink: { color: theme.accent.primary },

    memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
    rowDivider: { borderBottomWidth: 1, borderBottomColor: theme.border.subtle },
    memberName: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 14 },
    flag: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 11, marginTop: 2 },
    memberStatus: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, marginLeft: 8, textAlign: 'right', flexShrink: 1 },

    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.accent.primary, borderRadius: 14, paddingVertical: 14,
    },
    primaryText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 14 },
    secondaryBtn: {
      alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1,
      borderColor: theme.border.default, paddingVertical: 12, paddingHorizontal: 28,
    },
    secondaryText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 14 },
    linkBtn: { alignItems: 'center', paddingVertical: 12 },
    linkText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },

    linkRow: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: theme.bg.card, borderRadius: 16,
      borderWidth: 1, borderColor: cardBorder, padding: 16,
    },
    linkRowText: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 14 },
  });
}
