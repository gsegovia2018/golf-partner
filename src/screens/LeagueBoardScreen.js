import React, { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import PullToRefresh from '../components/PullToRefresh';
import LeaderboardCard from '../components/LeaderboardCard';
import DeadlineLine, { countdownText } from '../components/league/DeadlineLine';
import LeagueShareSheet from '../components/league/LeagueShareSheet';
import { useTheme } from '../theme/ThemeContext';
import { semantic } from '../theme/tokens';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../hooks/useLeague';
import { useMinuteClock } from '../hooks/useMinuteClock';
import { isMissed, needsApproval, deadlineInfo, isMonthClosed, monthClosesAt } from '../store/leagueRules';
import { seasonTable, monthResults } from '../store/leagueStandings';
import {
  formatEuros, potCents, lastScoredMonth, deltaLabel, monthBoard, rankNotes, placeLabel,
  leaguePointsText, monthStanding,
  daysLeftInMonth, collapseSeasonRows, currentMonthKey, yourCardState, myMonthCard, voidedNote, myRoundScored, viewableCards, monthRows,
} from '../store/leagueView';
import { memberName } from '../lib/leagueNames';
import { useT, tr, formatNumber, formatDate } from '../i18n';
import { dayLabel, timeLabel } from '../store/leagueOffApp';
import { splitVoidReason } from '../store/leagueTimeline';
import { getTournamentSnapshot } from '../store/tournamentStore';
import { leagueRoundIndex } from '../store/leagueGameCards';

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
  // The share sheet: null = closed; { mode: 'board' } follows the board's
  // chip; { mode: 'results', resultsMonth } is the month-end preset.
  const [share, setShare] = useState(null);
  const now = useMinuteClock();
  const t = useT();

  const view = useMemo(() => {
    if (!data) return null;
    const { league, members, cardsByMonth } = data;
    const active = members.filter((m) => !m.leftAt);
    const table = seasonTable(active, cardsByMonth, league.pointsTable, { participationPoints: league.participationPoints });
    const last = lastScoredMonth(cardsByMonth);
    const scoredMonths = Object.keys(cardsByMonth)
      .filter((m) => cardsByMonth[m].some((c) => c.status === 'confirmed' && !needsApproval(c)))
      .sort().reverse().slice(0, 6);
    return { league, members, active, cardsByMonth, table, last, scoredMonths };
  }, [data]);

  const title = view?.league.name ?? route?.params?.name ?? t('league.stats.leagueFallback');

  const header = (
    <View style={s.header}>
      <View style={s.headerLeft}>
        <IconButton icon="chevron-left" size={24} color={theme.accent.primary} onPress={() => navigation.goBack()} accessibilityLabel={t('common.back')} />
        <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
      </View>
      <View style={s.headerRight}>
        {!!view && (
          <IconButton
            icon="share-2"
            onPress={() => setShare({ mode: 'board' })}
            accessibilityLabel={t('league.share.boardButton')}
          />
        )}
        <IconButton
          icon="bar-chart-2"
          onPress={() => navigation.navigate('LeagueStats', { leagueId })}
          accessibilityLabel={t('league.home.statsA11y')}
        />
        <IconButton
          icon="settings"
          onPress={() => navigation.navigate('LeagueSettings', { leagueId })}
          accessibilityLabel={t('league.home.settingsA11y')}
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
              <Text style={s.emptyTitle}>{t('league.home.loadError')}</Text>
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

  const { league, members, active, cardsByMonth, table, last, scoredMonths } = view;
  const nameOf = (userId) => memberName(members, userId, meId);
  const openCard = (month, userId) => navigation.navigate('LeagueCard', { leagueId, month, userId });
  const viewable = (month) => new Set(viewableCards(members, cardsByMonth, month).map((c) => c.userId));
  const noCardsYet = !last;
  const curKey = currentMonthKey(now);
  const curMonth = monthLong(curKey);
  const archived = !!league.archivedAt;
  const activeScope = scope ?? (archived ? 'season' : curKey);
  const monthScope = activeScope === curKey && !archived;
  const pastScopes = scoredMonths.filter((m) => m !== curKey);

  // ---- Standings card ------------------------------------------------------

  let boardTitle;
  let boardSections;
  let boardFooter = null;
  let boardMore = null;
  // Confirmed cards on a tee with no slope/rating are listed, not ranked.
  const unratedNote = (userIds) => {
    if (userIds.length !== 1) return t('league.home.unratedMany', { count: userIds.length });
    return userIds[0] === meId ? t('league.home.unratedMine') : t('league.home.unratedOne', { name: nameOf(userIds[0]) });
  };
  if (monthScope) {
    const left = daysLeftInMonth(now);
    boardTitle = left === 0
      ? t('league.home.titleLastDay', { month: curMonth.toUpperCase() })
      : t('league.home.titleDaysLeft', { month: curMonth.toUpperCase(), count: left });
    const board = monthBoard(members, cardsByMonth, curKey, league.pointsTable, now, { participationPoints: league.participationPoints, voidCards: data?.cards });
    // Any card this month opens: live, missed and voided ones show their status.
    const canOpen = new Set([
      ...monthRows(members, cardsByMonth, curKey, now).filter((r) => r.card).map((r) => r.member.userId),
      ...board.voided.map((r) => r.member.userId),
    ]);
    const rowOf = (member) => ({
      key: member.userId,
      name: nameOf(member.userId),
      isMe: member.userId === meId,
      onPress: canOpen.has(member.userId) ? () => openCard(curKey, member.userId) : undefined,
    });
    const detailOf = (card, ...parts) => {
      const text = [...parts, card.notAnnounced ? t('league.home.notAnnounced') : null].filter(Boolean).join(' · ');
      return text.charAt(0).toUpperCase() + text.slice(1);
    };
    const noCard = [...board.noCard].sort((a, b) => (b.userId === meId) - (a.userId === meId));
    boardSections = [
      board.confirmed.length > 0 && {
        key: 'confirmed',
        label: t('league.home.secConfirmed', { count: board.confirmed.length }),
        icon: 'check',
        gold: true,
        cols: [t('league.board.colPts'), t('league.board.colLeague')],
        rows: board.confirmed.map((r) => ({
          ...rowOf(r.member),
          place: r.place,
          isTie: r.isTie,
          unranked: r.unrated,
          muted: r.unrated,
          white: !r.unrated,
          points: r.unrated ? t('league.home.unrated') : formatNumber(r.cardPoints),
          pointsLabel: r.unrated ? undefined : t('league.board.stablefordPoints', { count: r.cardPoints }),
          sub: r.unrated ? t('league.home.notRanked') : r.seasonPoints > 0 ? `+${leaguePointsText(r.seasonPoints)}` : null,
          subLabel: r.unrated || !(r.seasonPoints > 0) ? undefined : t('league.board.leaguePoints', { count: r.seasonPoints }),
          subGold: !r.unrated,
          // A tie says who it shares with instead of how it was confirmed.
          detail: detailOf(r.card, r.card.course?.name, r.isTie ? null : tr(r.howMsg), ...rankNotes(r).map(tr)),
        })),
      },
      board.waiting.length > 0 && {
        key: 'waiting',
        label: t('league.home.secWaiting', { count: board.waiting.length }),
        icon: 'clock',
        rows: board.waiting.map((r) => ({
          ...rowOf(r.member),
          place: null,
          unranked: true,
          muted: true,
          points: r.card.points != null ? String(r.card.points) : '—',
          sub: t('league.home.pending'),
          detail: detailOf(r.card, r.card.course?.name, tr(r.reasonMsg)),
        })),
      },
      board.onCourse.length > 0 && {
        key: 'oncourse',
        label: t('league.home.secOnCourse', { count: board.onCourse.length }),
        icon: 'flag',
        rows: board.onCourse.map((r) => {
          const dl = deadlineInfo(r.card, now);
          return {
          ...rowOf(r.member),
          place: null,
          unranked: true,
          muted: true,
          points: dl ? countdownText(dl.msLeft) : '—',
          sub: dl ? t(dl.urgent ? 'league.home.left' : 'league.home.toPost') : null,
          warn: !!dl?.urgent,
          detail: detailOf(
            r.card,
            ...(r.card.status === 'playing'
              ? [t('league.home.playingNow'), r.card.course?.name]
              : [t('league.home.announced'), [dayLabel(r.card.teeTime), timeLabel(r.card.teeTime)].filter(Boolean).join(' '), r.card.course?.name]),
          ),
          };
        }),
      },
      board.awaiting.length > 0 && {
        key: 'awaiting',
        label: t('league.home.secAwaiting', { count: board.awaiting.length }),
        icon: 'user-check',
        rows: board.awaiting.map((r) => ({
          ...rowOf(r.member),
          place: null,
          unranked: true,
          muted: true,
          points: r.card.points != null ? String(r.card.points) : '—',
          sub: t('league.home.notCounted'),
          detail: detailOf(r.card, r.card.course?.name, t('league.home.needsApproval')),
        })),
      },
      board.missed.length > 0 && {
        key: 'missed',
        label: t('league.home.secMissed', { count: board.missed.length }),
        icon: 'slash',
        rows: board.missed.map((r) => ({
          ...rowOf(r.member),
          place: null,
          unranked: true,
          muted: true,
          points: '—',
          detail: detailOf(r.card, t('league.home.notPostedInTime'), r.card.course?.name),
        })),
      },
      board.voided.length > 0 && {
        key: 'voided',
        label: t('league.home.secVoided', { count: board.voided.length }),
        icon: 'slash',
        rows: board.voided.map((r) => {
          const { reason } = splitVoidReason(r.card.voidedReason);
          const why = reason ?? (r.card.voidKind === 'withdrawn_after_play' ? t('league.home.playedAfterWithdrawing') : null);
          return {
            ...rowOf(r.member),
            place: null,
            unranked: true,
            muted: true,
            points: '—',
            detail: why ? t('league.home.voidedWhy', { why }) : t('league.home.voided'),
          };
        }),
      },
      noCard.length > 0 && {
        key: 'nocard',
        label: t('league.home.secNoCard', { count: noCard.length }),
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
    boardFooter = tr({ key: 'league.board.footMonth', params: { monthKey: curKey } })
      + (unratedNow.length > 0 ? ` ${unratedNote(unratedNow)}` : '');
  } else if (activeScope === 'season' || !pastScopes.includes(activeScope)) {
    boardTitle = last ? t('league.home.titleSeasonAfter', { month: monthLong(last).toUpperCase() }) : t('league.home.titleSeason');
    const seasonRows = table.map((r) => ({
      key: r.userId,
      place: noCardsYet ? null : r.place,
      isTie: r.isTie,
      name: nameOf(r.userId),
      points: noCardsYet ? '—' : leaguePointsText(r.total),
      sub: noCardsYet ? null : deltaLabel(r.lastMonthDelta, last),
      isMe: r.userId === meId,
    }));
    const collapsed = collapseSeasonRows(seasonRows, { expanded: showAllSeason });
    boardSections = [{
      key: 'season',
      label: t('league.board.seasonSection'),
      icon: 'award',
      gold: true,
      cols: [t('league.board.colTotal'), t('league.board.colLast')],
      rows: collapsed.rows,
    }];
    if (collapsed.hidden > 0) boardMore = { label: t('league.home.showAll', { count: seasonRows.length }), onPress: () => setShowAllSeason(true) };
    else if (collapseSeasonRows(seasonRows).hidden > 0) boardMore = { label: t('league.home.showTop'), onPress: () => setShowAllSeason(false) };
    const pot = potCents(members, league.entryFeeCents);
    boardFooter = t('league.home.footSeason', { month: monthWord(league.seasonEnd) })
      + (pot > 0 ? ` ${t('league.home.footPot', { pot: formatEuros(pot) })}` : '');
  } else {
    boardTitle = t('league.home.titleResults', { month: monthLong(activeScope).toUpperCase() });
    const canOpen = viewable(activeScope);
    const results = monthResults(cardsByMonth[activeScope], active, league.pointsTable, { participationPoints: league.participationPoints });
    const ranked = results.filter((r) => r.place != null || r.unrated);
    const absent = results.filter((r) => r.place == null && !r.unrated);
    boardSections = [
      ranked.length > 0 && {
        key: 'results',
        label: t('league.board.cards', { count: ranked.length }),
        icon: 'check',
        gold: true,
        cols: [t('league.board.colPts'), t('league.board.colLeague')],
        rows: ranked.map((r) => ({
          key: r.userId,
          place: r.place,
          isTie: r.isTie,
          name: nameOf(r.userId),
          points: r.unrated ? t('league.home.unrated') : formatNumber(r.cardPoints),
          pointsLabel: r.unrated ? undefined : t('league.board.stablefordPoints', { count: r.cardPoints }),
          white: !r.unrated,
          sub: r.unrated ? t('league.home.notRanked') : `+${leaguePointsText(r.seasonPoints)}`,
          subLabel: r.unrated ? undefined : t('league.board.leaguePoints', { count: r.seasonPoints }),
          subGold: !r.unrated,
          detail: rankNotes(r).map(tr).join(' · '),
          muted: !!r.unrated,
          isMe: r.userId === meId,
          onPress: canOpen.has(r.userId) ? () => openCard(activeScope, r.userId) : undefined,
        })),
      },
      absent.length > 0 && {
        key: 'noplay',
        label: t('league.board.noPlay', { count: absent.length }),
        icon: 'user-x',
        body: <Text style={s.noCardText}>{t('league.board.noPlayNames', { names: absent.map((r) => nameOf(r.userId)).join(', ') })}</Text>,
      },
    ].filter(Boolean);
    const unrated = results.filter((r) => r.unrated).map((r) => r.userId);
    if (unrated.length > 0) boardFooter = unratedNote(unrated);
    else if (ranked.some((r) => r.floored)) boardFooter = t('league.board.footPast', { points: formatNumber(league.participationPoints) });
    else boardFooter = t('league.board.footPastTies');
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
            <Text style={[s.chipText, on && s.chipTextOn]}>{key === 'season' ? t('league.public.season') : monthShort(key)}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  ) : null;

  // ---- Sharing -------------------------------------------------------------

  // Month end: the previous month is final (closed on day 4) for two weeks, or
  // the "Ranking updated" push says which month. Only when it ranked someone.
  const [cy, cm] = curKey.split('-').map(Number);
  const prevKey = `${cm === 1 ? cy - 1 : cy}-${String(cm === 1 ? 12 : cm - 1).padStart(2, '0')}`;
  const finalKey = route?.params?.finalMonth ?? (
    isMonthClosed(prevKey, now) && now.getTime() - monthClosesAt(prevKey).getTime() < 14 * 86400000 ? prevKey : null);
  const finalMonth = !archived && finalKey && monthResults(cardsByMonth[finalKey] ?? [], active, league.pointsTable,
    { participationPoints: league.participationPoints }).some((r) => r.place != null) ? finalKey : null;
  // The header's share icon follows the board: the month so far, the season,
  // or a past month's results.
  const sheetMode = share?.mode === 'board'
    ? (monthScope ? { mode: 'month' } : pastScopes.includes(activeScope)
      ? { mode: 'results', resultsMonth: activeScope } : { mode: 'season' })
    : share;

  // ---- My card -------------------------------------------------------------

  // A card an admin voided (or one played after a withdrawal) still takes the
  // month: it shows here instead of the announce buttons.
  const myCard = myMonthCard(cardsByMonth, data?.cards, curKey, meId);
  const mine = yourCardState(myCard);
  // Where my counting card stands in the open month (confirmed, counted).
  const standing = mine.kind === 'confirmed' && !needsApproval(mine.card)
    ? monthStanding({ league, members, cardsByMonth }, curKey, meId, now) : null;

  // My app card stuck before confirmation (left Validate, or no partner yet):
  // reopen Validate on its round. A submitted card goes straight to the check.
  // While holes are still unscored the card is simply being played: the
  // "Playing with the app" link to the scorecard is the way back, not Validate.
  const stillPlaying = !mine.offApp && mine.kind === 'playing'
    && myRoundScored(getTournamentSnapshot(mine.card.tournamentId), mine.card.roundId, meId, mine.card.playerId) === false;
  const finishValidating = !mine.offApp && !stillPlaying && (mine.kind === 'playing' || mine.kind === 'submitted') ? (
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
      <Text style={s.primaryText}>{t('league.home.finishValidating')}</Text>
    </TouchableOpacity>
  ) : null;

  const renderYourCard = () => {
    let body;
    let badge = null;
    if (mine.kind === 'none') {
      body = (
        <>
          <Text style={s.cardText}>
            {t('league.home.announceFirst', { month: monthWord(curKey) })}
          </Text>
          <TouchableOpacity
            style={s.primaryBtn}
            // Setup preselects this league's "Counts for" switch, on.
            onPress={() => navigation.navigate('Setup', { kind: 'game', leagueId })}
            activeOpacity={0.8}
          >
            <Feather name="play" size={16} color={theme.text.inverse} style={{ marginRight: 8 }} />
            <Text style={s.primaryText}>{t('league.home.playWithApp')}</Text>
          </TouchableOpacity>
          <View style={s.btnRow}>
            <TouchableOpacity
              style={s.splitBtn}
              onPress={() => navigation.navigate('LeagueAnnounce', { leagueId })}
              activeOpacity={0.7}
            >
              <Text style={s.secondaryText}>{t('league.home.playWithoutApp')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.splitBtn}
              onPress={() => navigation.navigate('LeagueAddScore', { leagueId })}
              activeOpacity={0.7}
            >
              <Text style={s.secondaryText}>{t('league.home.addPlayed')}</Text>
            </TouchableOpacity>
          </View>
        </>
      );
    } else if (mine.kind === 'voided') {
      badge = t('league.void.badge');
      body = (
        <>
          <Text style={s.cardText}>{tr(voidedNote(mine.card, { isOwner: true, who: '' }))}</Text>
          <TouchableOpacity
            style={s.secondaryBtn}
            onPress={() => navigation.navigate('LeagueCard', { leagueId, month: curKey, userId: meId })}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Text style={s.secondaryText}>{t('league.void.openCard')}</Text>
          </TouchableOpacity>
        </>
      );
    } else if (isMissed(mine.card, now)) {
      badge = t('league.home.badgeNotPosted');
      body = (
        <Text style={s.cardText}>
          {t(mine.course ? 'league.home.missedCourse' : 'league.home.missed', { course: mine.course })}
        </Text>
      );
    } else if (mine.kind === 'announced' || mine.kind === 'playing') {
      badge = t(mine.kind === 'playing' ? 'league.home.badgePlaying' : 'league.home.badgeAnnounced');
      body = (
        <>
          {/* An app card: the line opens the game's scorecard on the
              card's own round (any round of a tournament, R17). */}
          <Text
            style={s.cardText}
            {...(!mine.offApp && mine.card.tournamentId ? {
              onPress: () => navigation.navigate('Scorecard', {
                tournamentId: mine.card.tournamentId,
                roundIndex: leagueRoundIndex(getTournamentSnapshot(mine.card.tournamentId), mine.card.roundId),
              }),
              accessibilityRole: 'link',
            } : {})}
          >
            {mine.offApp && mine.kind === 'announced'
              ? t('league.home.announcedOffLine', {
                parts: [t('league.home.announcedAt', { time: timeLabel(mine.card.announcedAt) }), mine.course,
                  [dayLabel(mine.card.teeTime), timeLabel(mine.card.teeTime)].filter(Boolean).join(' ')]
                  .filter(Boolean).join(' · '),
              })
              : [t(mine.offApp ? 'league.home.playWithoutApp' : 'league.home.playingWithApp'), mine.course,
                !mine.offApp && mine.card.tournamentId ? t('league.home.openScorecard') : null].filter(Boolean).join(' · ')}
          </Text>
          {mine.kind === 'announced' && mine.offApp && (
            <TouchableOpacity
              style={s.primaryBtn}
              onPress={() => navigation.navigate('LeagueAddScore', { leagueId, cardId: mine.card.id })}
              activeOpacity={0.8}
            >
              <Text style={s.primaryText}>{t('league.home.addScore')}</Text>
            </TouchableOpacity>
          )}
          <DeadlineLine card={mine.card} now={now} style={s.deadline} />
          {finishValidating}
        </>
      );
    } else {
      badge = needsApproval(mine.card) ? t('league.home.badgeAwaiting') : mine.kind === 'confirmed' ? t('league.home.badgeConfirmed')
        : mine.waitingFor ? t('league.home.badgeWaitingFor', { name: mine.waitingFor }) : t('league.home.badgeSubmitted');
      const proofText = mine.card.proofPath
        ? t(mine.card.confirmation === 'official' ? 'league.home.officialAttached' : 'league.home.photoAttached')
        : null;
      body = (
        <>
          <Text style={s.cardText}>
            {!!mine.pts && <Text style={s.netLead}>{tr(mine.pts)}</Text>}
            {!!mine.pts && ' · '}
            {mine.unrated && `${t('league.home.unratedTee')} · `}
            {[
              standing ? t('league.board.placeSoFar', { place: placeLabel(standing.place, standing.isTie) }) : null,
              standing ? t('league.board.leaguePts', { points: leaguePointsText(standing.seasonPoints) }) : null,
              mine.course, mine.offApp ? t('league.home.addedAfter') : null, proofText,
              mine.card.confirmedByName ? t('league.home.confirmedBy', { name: mine.card.confirmedByName }) : null,
            ].filter(Boolean).join(' · ')}
          </Text>
          {mine.kind === 'submitted' && !!mine.card.markerNote && (
            <Text style={s.cardText}>{t('league.home.markerSentBack', { note: mine.card.markerNote })}</Text>
          )}
          {mine.kind === 'submitted' && mine.offApp && (
            <TouchableOpacity
              style={s.primaryBtn}
              onPress={() => navigation.navigate('LeagueAddProof', { leagueId, cardId: mine.card.id, resume: true })}
              activeOpacity={0.8}
            >
              <Text style={s.primaryText}>{t('league.home.addProof')}</Text>
            </TouchableOpacity>
          )}
          {finishValidating}
        </>
      );
    }
    return (
      <View style={s.card}>
        <View style={s.cardHeadRow}>
          <Text style={s.cardTitle}>{t('league.home.yourCard', { month: monthWord(curKey) })}</Text>
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
            <Text style={s.staleText}>{t('league.home.offline')}</Text>
          </View>
        )}
        {archived && (
          <View style={s.staleBanner}>
            <Feather name="archive" size={14} color={theme.text.secondary} />
            <Text style={s.staleText}>{t('league.home.archived')}</Text>
          </View>
        )}

        {!!finalMonth && (
          <View style={s.finalBanner}>
            <View style={s.finalHead}>
              <Feather name="award" size={18} color={theme.accent.primary} />
              <View style={{ flex: 1 }}>
                <Text style={s.finalTitle}>
                  {t('league.share.finalBanner', { month: cap(formatDate(`${finalMonth}-01`, 'monthName')) })}
                </Text>
                <Text style={s.finalSub}>{t('league.share.finalSub')}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={s.secondaryBtn}
              onPress={() => setShare({ mode: 'results', resultsMonth: finalMonth })}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <Text style={s.secondaryText}>{t('league.share.shareResults')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {!archived && renderYourCard()}

        <LeaderboardCard
          title={boardTitle}
          subheader={chips}
          sections={boardSections}
          footer={boardFooter}
          more={boardMore}
        />

        {noCardsYet && !monthScope && (
          <Text style={s.emptyNote}>
            {t('league.home.noCardsYet', { month: curMonth })}
          </Text>
        )}
      </PullToRefresh>
      <LeagueShareSheet
        visible={!!share}
        onClose={() => setShare(null)}
        leagueId={leagueId}
        snapshot={data}
        meId={meId}
        mode={sheetMode?.mode ?? 'month'}
        resultsMonth={sheetMode?.resultsMonth ?? null}
        now={now}
      />
    </ScreenContainer>
  );
}

const cap = (x) => (x ? x.charAt(0).toUpperCase() + x.slice(1) : x);
// Mid-sentence the month stays as the language writes it ("octubre").
const monthWord = (key) => formatDate(`${String(key).slice(0, 7)}-01`, 'monthName');
const monthLong = (key) => cap(monthWord(key));
const monthShort = (key) => cap(formatDate(`${key}-01`, 'day').split(' ')[1] ?? '');

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
    netLead: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary },
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
    deadline: { marginBottom: 12 },
    btnRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
    splitBtn: {
      flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1,
      borderColor: theme.border.default, paddingVertical: 10, paddingHorizontal: 8,
    },

    finalBanner: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: theme.accent.primary,
      padding: 14, marginBottom: 14, gap: 12,
    },
    finalHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    finalTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 15 },
    finalSub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, marginTop: 2 },

    noCardText: { fontFamily: 'PlusJakartaSans-Medium', color: 'rgba(255,255,255,0.7)', fontSize: 13, lineHeight: 20, paddingVertical: 6 },
    noCardMe: { fontFamily: 'PlusJakartaSans-Bold', color: '#ffffff' },
  });
}
