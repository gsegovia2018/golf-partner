import React, { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import PullToRefresh from '../components/PullToRefresh';
import LeaderboardCard from '../components/LeaderboardCard';
import { useTheme } from '../theme/ThemeContext';
import { semantic } from '../theme/tokens';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../hooks/useLeague';
import { seasonTable, monthResults } from '../store/leagueStandings';
import {
  monthName, formatPoints, formatNetDiff, formatEuros, potCents, lastScoredMonth, deltaLabel, monthBoard,
  daysLeftInMonth, collapseSeasonRows, currentMonthKey, memberName, yourCardState, viewableCards,
} from '../store/leagueView';
import { dayLabel, timeLabel } from '../store/leagueOffApp';

// The league's home: my own card, then this month's board (or the season / a past month).
// Cache first, then live; pull to refresh.
export default function LeagueBoardScreen({ navigation, route }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = makeStyles(theme);
  const meId = user?.id ?? null;
  const leagueId = route?.params?.leagueId;
  const { data, stale, loading, refreshing, error, reload, refresh } = useLeague(navigation, leagueId);
  const [scope, setScope] = useState(null); // null = this month (the season when archived)
  const [showAllSeason, setShowAllSeason] = useState(false);

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
  const openCard = (month, userId) => navigation.navigate('LeagueCard', { leagueId, month, userId });
  const viewable = (month) => new Set(viewableCards(members, cardsByMonth, month).map((c) => c.userId));
  const noCardsYet = !last;
  const now = new Date();
  const curKey = currentMonthKey(now);
  const curMonth = monthName(curKey);
  const archived = !!league.archivedAt;
  const activeScope = scope ?? (archived ? 'season' : curKey);
  const monthScope = activeScope === curKey && !archived;
  const pastScopes = scoredMonths.filter((m) => m !== curKey);

  // ---- Standings card ------------------------------------------------------

  let boardTitle;
  let boardRows;
  let boardSections;
  let boardFooter = null;
  let boardMore = null;
  // Confirmed cards on a tee with no slope/rating are listed, not ranked.
  const unratedNote = (userIds) => `${userIds.length === 1 ? `${userIds[0] === meId ? 'Your' : `${nameOf(userIds[0])}'s`} card has` : `${userIds.length} cards have`} no slope or rating · shown, not ranked`;
  if (monthScope) {
    const left = daysLeftInMonth(now);
    boardTitle = `${curMonth.toUpperCase()} SO FAR · ${left === 0 ? 'LAST DAY' : `${left} ${left === 1 ? 'DAY' : 'DAYS'} LEFT`}`;
    const board = monthBoard(members, cardsByMonth, curKey, league.pointsTable);
    const canOpen = viewable(curKey);
    const rowOf = (member) => ({
      key: member.userId,
      name: nameOf(member.userId),
      isMe: member.userId === meId,
      onPress: canOpen.has(member.userId) ? () => openCard(curKey, member.userId) : undefined,
    });
    const detailOf = (card, ...parts) => {
      const text = [...parts, card.notAnnounced ? 'not announced in the app' : null].filter(Boolean).join(' · ');
      return text.charAt(0).toUpperCase() + text.slice(1);
    };
    const noCard = [...board.noCard].sort((a, b) => (b.userId === meId) - (a.userId === meId));
    boardSections = [
      board.confirmed.length > 0 && {
        key: 'confirmed',
        label: `Confirmed · ${board.confirmed.length}`,
        icon: 'check',
        gold: true,
        rows: board.confirmed.map((r) => ({
          ...rowOf(r.member),
          place: r.place,
          isTie: r.isTie,
          unranked: r.unrated,
          muted: r.unrated,
          points: r.unrated ? 'unrated' : formatNetDiff(r.netDifferential),
          sub: r.unrated ? 'not ranked' : r.seasonPoints > 0 ? `+${formatPoints(r.seasonPoints)}` : null,
          subGold: !r.unrated,
          detail: detailOf(r.card, r.card.course?.name, r.how),
        })),
      },
      board.waiting.length > 0 && {
        key: 'waiting',
        label: `Waiting for confirmation · ${board.waiting.length}`,
        icon: 'clock',
        rows: board.waiting.map((r) => ({
          ...rowOf(r.member),
          place: null,
          unranked: true,
          muted: true,
          points: r.card.netDifferential != null ? formatNetDiff(r.card.netDifferential)
            : r.card.points != null ? String(r.card.points) : '—',
          sub: 'pending',
          detail: detailOf(r.card, r.card.course?.name, r.reason),
        })),
      },
      board.onCourse.length > 0 && {
        key: 'oncourse',
        label: `Playing or announced · ${board.onCourse.length}`,
        icon: 'flag',
        rows: board.onCourse.map((r) => ({
          ...rowOf(r.member),
          place: null,
          unranked: true,
          muted: true,
          points: '—',
          detail: detailOf(
            r.card,
            ...(r.card.status === 'playing'
              ? ['Playing now', r.card.course?.name]
              : ['Announced', [dayLabel(r.card.teeTime), timeLabel(r.card.teeTime)].filter(Boolean).join(' '), r.card.course?.name]),
          ),
        })),
      },
      noCard.length > 0 && {
        key: 'nocard',
        label: `No card yet · ${noCard.length}`,
        icon: 'user-x',
        body: (
          <Text style={s.noCardText}>
            {noCard.map((m, i) => (
              <Text key={m.userId} style={m.userId === meId ? s.noCardMe : null}>
                {`${i > 0 ? ', ' : ''}${nameOf(m.userId)}`}
              </Text>
            ))}
          </Text>
        ),
      },
    ].filter(Boolean);
    const unratedNow = board.confirmed.filter((r) => r.unrated).map((r) => r.member.userId);
    boardFooter = 'Gold = table points if the month ended today. The season table is one tap away on Season.'
      + (unratedNow.length > 0 ? ` ${unratedNote(unratedNow)}` : '');
  } else if (activeScope === 'season' || !pastScopes.includes(activeScope)) {
    boardTitle = last ? `SEASON · AFTER ${monthName(last).toUpperCase()}` : 'SEASON';
    const seasonRows = table.map((r) => ({
      key: r.userId,
      place: noCardsYet ? null : r.place,
      isTie: r.isTie,
      name: nameOf(r.userId),
      points: noCardsYet ? '—' : formatPoints(r.total),
      sub: noCardsYet ? null : deltaLabel(r.lastMonthDelta, last),
      isMe: r.userId === meId,
    }));
    const collapsed = collapseSeasonRows(seasonRows, { expanded: showAllSeason });
    boardRows = collapsed.rows;
    if (collapsed.hidden > 0) boardMore = { label: `Show all ${seasonRows.length}`, onPress: () => setShowAllSeason(true) };
    else if (collapseSeasonRows(seasonRows).hidden > 0) boardMore = { label: 'Show top 8', onPress: () => setShowAllSeason(false) };
    const pot = potCents(members, league.entryFeeCents);
    boardFooter = `Final in ${monthName(league.seasonEnd)} — extra strokes from these standings, set on the day.${pot > 0 ? ` Pot ${formatEuros(pot)}` : ''}`;
  } else {
    boardTitle = `${monthName(activeScope).toUpperCase()} · RESULTS`;
    const canOpen = viewable(activeScope);
    const results = monthResults(cardsByMonth[activeScope], active, league.pointsTable);
    boardRows = results.map((r) => ({
      key: r.userId,
      place: r.place,
      isTie: r.isTie,
      name: nameOf(r.userId),
      points: r.unrated ? 'unrated' : r.place == null ? '—' : formatNetDiff(r.netDifferential),
      sub: r.unrated ? 'not ranked' : r.place == null ? null : `+${formatPoints(r.seasonPoints)}`,
      muted: !!r.unrated,
      isMe: r.userId === meId,
      onPress: canOpen.has(r.userId) ? () => openCard(activeScope, r.userId) : undefined,
    }));
    const unrated = results.filter((r) => r.unrated).map((r) => r.userId);
    boardFooter = unrated.length === 0
      ? "Better or worse than each member's league handicap · ties share points"
      : unratedNote(unrated);
  }

  const chipKeys = [...(archived ? [] : [curKey]), 'season', ...pastScopes];
  const chips = chipKeys.length > 1 ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow} contentContainerStyle={{ gap: 6 }}>
      {chipKeys.map((key) => {
        const on = key === 'season' ? !monthScope && !pastScopes.includes(activeScope) : activeScope === key;
        return (
          <TouchableOpacity
            key={key}
            style={[s.chip, on && s.chipOn]}
            onPress={() => setScope(key)}
            hitSlop={{ top: 8, bottom: 8 }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            {key === curKey && <View style={[s.chipDot, on && s.chipDotOn]} />}
            <Text style={[s.chipText, on && s.chipTextOn]}>{key === 'season' ? 'Season' : monthName(key, true)}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  ) : null;

  // ---- My card -------------------------------------------------------------

  const myCard = (cardsByMonth[curKey] ?? []).find((c) => c.userId === meId) ?? null;
  const mine = yourCardState(myCard);
  // Better = the success green, worse = the danger red, level = plain text.
  const netColor = (tone) => (tone === 'better' ? theme.scoreColor('excellent')
    : tone === 'worse' ? theme.destructive : theme.text.primary);

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
          <View style={s.btnRow}>
            <TouchableOpacity
              style={s.splitBtn}
              onPress={() => navigation.navigate('LeagueAnnounce', { leagueId })}
              activeOpacity={0.7}
            >
              <Text style={s.secondaryText}>Playing without the app</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.splitBtn}
              onPress={() => navigation.navigate('LeagueAddScore', { leagueId })}
              activeOpacity={0.7}
            >
              <Text style={s.secondaryText}>Add a card I played</Text>
            </TouchableOpacity>
          </View>
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
            {mine.net != null && (
              <Text style={[s.netLead, { color: netColor(mine.netTone) }]}>{mine.net}</Text>
            )}
            {mine.net != null && `${mine.net === 'level' ? ' with' : ' than'} your handicap · `}
            {mine.unrated && 'Unrated tee, not ranked · '}
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

        {!archived && renderYourCard()}

        <LeaderboardCard
          title={boardTitle}
          subheader={chips}
          rows={boardRows}
          sections={boardSections}
          footer={boardFooter}
          more={boardMore}
        />

        {noCardsYet && !monthScope && (
          <Text style={s.emptyNote}>
            {`No cards yet. ${curMonth} is open: the board fills in as each card is confirmed.`}
          </Text>
        )}
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
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6,
      borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)',
    },
    chipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: semantic.winner.dark },
    chipDotOn: { backgroundColor: theme.bg.deep },
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
    cardText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, lineHeight: 19, marginBottom: 12 },
    badge: { backgroundColor: theme.accent.light, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
    netLead: { fontFamily: 'PlusJakartaSans-Bold' },
    badgeText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 11 },

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
    btnRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
    splitBtn: {
      flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1,
      borderColor: theme.border.default, paddingVertical: 10, paddingHorizontal: 8,
    },

    noCardText: { fontFamily: 'PlusJakartaSans-Medium', color: 'rgba(255,255,255,0.7)', fontSize: 13, lineHeight: 20, paddingVertical: 6 },
    noCardMe: { fontFamily: 'PlusJakartaSans-Bold', color: '#ffffff' },
  });
}
