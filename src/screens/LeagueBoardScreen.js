import React, { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import { useTabBarScroll, useTabBarClearance } from '../navigation/tabBarChrome';
import { buttonStyles } from '../components/ui/Buttons';
import IconButton from '../components/ui/IconButton';
import ScreenHeader from '../components/ui/ScreenHeader';
import PullToRefresh from '../components/PullToRefresh';
import LeaderboardCard from '../components/LeaderboardCard';
import DeadlineLine, { countdownText, clockWithDay } from '../components/league/DeadlineLine';
import LeagueShareSheet from '../components/league/LeagueShareSheet';
import MonthClosingBanner from '../components/league/MonthClosingBanner';
import CardSteps from '../components/league/CardSteps';
import InitialsAvatar from '../components/league/InitialsAvatar';
import { ghostSection, closeInfo } from '../components/league/graceText';
import { useTheme } from '../theme/ThemeContext';
import { semantic, onDeep } from '../theme/tokens';
import { withAlpha } from '../theme/alpha';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../hooks/useLeague';
import { useMinuteClock } from '../hooks/useMinuteClock';
import { isMissed, needsApproval, deadlineInfo, isMonthClosed, monthClosesAt, postOpensLater } from '../store/leagueRules';
import { LEAGUE_FINAL_ENABLED } from '../store/leagueFinal';
import { seasonPhase } from '../store/leagueSetup';
import { seasonTable, monthResults, isMedalFormat } from '../store/leagueStandings';
import { graceMonth } from '../store/leagueGrace';
import {
  formatEuros, potCents, lastScoredMonth, monthBoard, rankNotes, placeLabel,
  leaguePointsText, monthStanding, formatScore, formatToPar, formatKey,
  daysLeftInMonth, collapseSeasonRows, currentMonthKey, yourCardState, myMonthCard, voidedNote, myRoundScored, viewableCards, monthRows,
  cardValueText, seasonMoves, yourCardStep,
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
  const tabBarScroll = useTabBarScroll();
  const tabBarClearance = useTabBarClearance();
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
    const table = seasonTable(active, cardsByMonth, league.pointsTable, { participationPoints: league.participationPoints, format: league.format });
    const last = lastScoredMonth(cardsByMonth);
    const scoredMonths = Object.keys(cardsByMonth)
      .filter((m) => cardsByMonth[m].some((c) => c.status === 'confirmed' && !needsApproval(c)))
      .sort().reverse().slice(0, 6);
    return { league, members, active, cardsByMonth, table, last, scoredMonths };
  }, [data]);

  const title = view?.league.name ?? route?.params?.name ?? t('league.stats.leagueFallback');

  const header = (
    <ScreenHeader
      onBack={() => navigation.goBack()}
      title={title}
      numberOfLines={1}
      right={(
        <>
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
        </>
      )}
    />
  );

  if (!view) {
    return (
      <ScreenContainer style={s.container} edges={['top']}>
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
  const viewable = (month) => new Set(viewableCards(members, cardsByMonth, month, league.format).map((c) => c.userId));
  const noCardsYet = !last;
  const { format } = league;
  const medal = isMedalFormat(format);
  // A card's ranking value in a board cell: Stableford points as the number, medal to par bare ('−2', 'E').
  const cellValue = (card) => {
    if (medal) return formatToPar(card.toPar);
    return card.points != null ? String(card.points) : '—';
  };
  const valueText = (card) => cardValueText(card, format, t);
  // A face for a row: the member's photo, else their initials.
  const avatarOf = (member) => ({ name: member?.displayName ?? member?.username ?? '', url: member?.avatarUrl ?? null });
  const curKey = currentMonthKey(now);
  const curMonth = monthLong(curKey);
  const archived = !!league.archivedAt;
  const activeScope = scope ?? (archived ? 'season' : curKey);
  const monthScope = activeScope === curKey && !archived;
  // R12: the previous month stays open for 3 days; its chip stays while cards wait.
  const grace = archived ? null : graceMonth(data, now, meId);
  const graceKey = grace?.monthKey ?? null;
  const pastScopes = [...(graceKey ? [graceKey] : []), ...scoredMonths.filter((m) => m !== curKey && m !== graceKey)];

  // ---- Standings card ------------------------------------------------------

  let boardTitle;
  let boardMeta = null;
  let boardProgress = null;
  let boardEmpty = null;
  let boardSections;
  let boardFooter = null;
  let boardMore = null;
  // The month's cards that don't count (yet), and who has none: under the board.
  let pendingRows = [];
  let noCardMembers = [];
  // Confirmed cards on a tee with no slope/rating are listed, not ranked.
  const unratedNote = (userIds) => {
    if (userIds.length !== 1) return t('league.home.unratedMany', { count: userIds.length });
    return userIds[0] === meId ? t('league.home.unratedMine') : t('league.home.unratedOne', { name: nameOf(userIds[0]) });
  };
  if (monthScope) {
    const left = daysLeftInMonth(now);
    const board = monthBoard(members, cardsByMonth, curKey, league.pointsTable, now, { participationPoints: league.participationPoints, voidCards: data?.cards, format: league.format });
    boardTitle = curMonth.toUpperCase();
    boardMeta = t(left === 0 ? 'league.home.metaLastDay' : 'league.home.metaDaysLeft', {
      count: left, cards: board.confirmed.length, total: active.length,
    });
    boardProgress = active.length > 0 ? board.confirmed.length / active.length : 0;
    // Any card this month opens: live, missed and voided ones show their status.
    const canOpen = new Set([
      ...monthRows(members, cardsByMonth, curKey, now, league.format).filter((r) => r.card).map((r) => r.member.userId),
      ...board.voided.map((r) => r.member.userId),
    ]);
    const open = (member) => (canOpen.has(member.userId) ? () => openCard(curKey, member.userId) : undefined);
    const detailOf = (card, ...parts) => {
      const text = [...parts, card.notAnnounced ? t('league.home.notAnnounced') : null].filter(Boolean).join(' · ');
      return text.charAt(0).toUpperCase() + text.slice(1);
    };
    boardSections = board.confirmed.length > 0 ? [{
      key: 'confirmed',
      rows: board.confirmed.map((r) => ({
        key: r.member.userId,
        name: nameOf(r.member.userId),
        avatar: avatarOf(r.member),
        isMe: r.member.userId === meId,
        onPress: open(r.member),
        place: r.place,
        isTie: r.isTie,
        unranked: r.unrated,
        muted: r.unrated,
        white: !r.unrated,
        points: r.unrated ? t('league.home.unrated') : medal ? formatToPar(r.cardScore) : formatNumber(r.cardPoints),
        pointsLabel: r.unrated ? undefined : medal ? formatScore(r.cardScore, format, t) : t('league.board.stablefordPoints', { count: r.cardPoints }),
        sub: r.unrated ? t('league.home.notRanked') : r.seasonPoints > 0 ? `+${leaguePointsText(r.seasonPoints)}` : null,
        subLabel: r.unrated || !(r.seasonPoints > 0) ? undefined : t('league.board.leaguePoints', { count: r.seasonPoints }),
        subGold: !r.unrated,
        subPill: !r.unrated,
        // A tie says who it shares with.
        detail: detailOf(r.card, r.card.course?.name, ...rankNotes(r).map(tr)),
      })),
    }] : [];
    if (board.confirmed.length === 0) boardEmpty = t('league.home.emptyMonth', { month: curMonth });
    // Everyone with a card that doesn't count (yet): one list, a status each.
    const pending = (r, chip, tone, ...parts) => ({
      key: r.member.userId, member: r.member, chip, tone, onPress: open(r.member), detail: detailOf(r.card, ...parts),
    });
    pendingRows = [
      ...board.waiting.map((r) => pending(r, t('league.home.chipWaiting'), 'warn',
        r.card.course?.name, cellValue(r.card) !== '—' ? valueText(r.card) : null, tr(r.reasonMsg))),
      ...board.onCourse.map((r) => {
        const dl = deadlineInfo(r.card, now);
        const playing = r.card.status === 'playing';
        // A member playing with the app: the row follows their round live.
        const follow = playing && r.card.tournamentId && r.card.roundId && r.member.userId !== meId
          ? () => navigation.navigate('RoundSummary', { tournamentId: r.card.tournamentId, roundId: r.card.roundId })
          : null;
        const row = pending(r,
          dl ? t('league.home.chipToPost', { time: countdownText(dl.msLeft) }) : t(playing ? 'league.home.playingNow' : 'league.home.announced'),
          dl?.urgent ? 'warn' : playing ? 'accent' : 'grey',
          playing ? t('league.home.playingNow') : [t('league.home.announced'), dayLabel(r.card.teeTime), timeLabel(r.card.teeTime)].filter(Boolean).join(' '),
          r.card.course?.name);
        return follow ? { ...row, onPress: follow } : row;
      }),
      ...board.awaiting.map((r) => pending(r, t('league.home.chipApproval'), 'warn',
        r.card.course?.name, valueText(r.card), t('league.home.needsApproval'))),
      ...board.missed.map((r) => pending(r, t('league.home.badgeNotPosted'), 'grey', r.card.course?.name)),
      ...board.voided.map((r) => {
        const { reason } = splitVoidReason(r.card.voidedReason);
        const why = reason ?? (r.card.voidKind === 'withdrawn_after_play' ? t('league.home.playedAfterWithdrawing') : null);
        return pending(r, t('league.home.voided'), 'bad', why);
      }),
    ];
    noCardMembers = [...board.noCard].sort((a, b) => (b.userId === meId) - (a.userId === meId));
    const unratedNow = board.confirmed.filter((r) => r.unrated).map((r) => r.member.userId);
    boardFooter = board.confirmed.length === 0 ? null
      : tr({ key: formatKey('league.board.footMonth', format), params: { monthKey: curKey } })
        + (unratedNow.length > 0 ? ` ${unratedNote(unratedNow)}` : '');
  } else if (activeScope === 'season' || !pastScopes.includes(activeScope)) {
    boardTitle = last ? t('league.home.titleSeasonAfter', { month: monthLong(last).toUpperCase() }) : t('league.home.titleSeason');
    const moves = seasonMoves(active, cardsByMonth, league.pointsTable, { participationPoints: league.participationPoints, format: league.format });
    const seasonRows = table.map((r) => {
      const member = members.find((m) => m.userId === r.userId);
      return {
        key: r.userId,
        place: noCardsYet ? null : r.place,
        isTie: r.isTie,
        name: nameOf(r.userId),
        avatar: avatarOf(member),
        move: noCardsYet ? null : moves.get(r.userId) ?? null,
        white: true,
        points: noCardsYet ? '—' : leaguePointsText(r.total),
        sub: null,
        detail: member?.spot ? t('league.membersMisc.notJoined')
          : !noCardsYet && r.lastMonthDelta > 0 ? t('league.home.seasonDelta', { points: leaguePointsText(r.lastMonthDelta), month: monthWord(last) })
            : undefined,
        isMe: r.userId === meId,
      };
    });
    const collapsed = collapseSeasonRows(seasonRows, { expanded: showAllSeason });
    boardSections = [{ key: 'season', rows: collapsed.rows }];
    if (collapsed.hidden > 0) boardMore = { label: t('league.home.showAll', { count: seasonRows.length }), onPress: () => setShowAllSeason(true) };
    else if (collapseSeasonRows(seasonRows).hidden > 0) boardMore = { label: t('league.home.showTop'), onPress: () => setShowAllSeason(false) };
    const pot = potCents(members, league.entryFeeCents);
    // The December Final is hidden for now (LEAGUE_FINAL_ENABLED): no promise of it.
    boardFooter = [
      LEAGUE_FINAL_ENABLED ? t('league.home.footSeason', { month: monthWord(league.seasonEnd) }) : null,
      pot > 0 ? t('league.home.footPot', { pot: formatEuros(pot) }) : null,
    ].filter(Boolean).join(' ') || null;
  } else {
    boardTitle = t('league.home.titleResults', { month: monthLong(activeScope).toUpperCase() });
    boardMeta = t('league.home.metaResults', { cards: monthResults(cardsByMonth[activeScope], active, league.pointsTable, { participationPoints: league.participationPoints, format: league.format }).filter((r) => r.place != null).length, total: active.length });
    const canOpen = viewable(activeScope);
    const results = monthResults(cardsByMonth[activeScope], active, league.pointsTable, { participationPoints: league.participationPoints, format: league.format });
    const ranked = results.filter((r) => r.place != null || r.unrated);
    const inGrace = !!grace && activeScope === graceKey;
    const waitingIds = new Set(inGrace ? grace.pending.map((p) => p.userId) : []);
    const absent = results.filter((r) => r.place == null && !r.unrated && !waitingIds.has(r.userId));
    boardSections = [
      ranked.length > 0 && {
        key: 'results',
        rows: ranked.map((r) => ({
          key: r.userId,
          place: r.place,
          isTie: r.isTie,
          name: nameOf(r.userId),
          avatar: avatarOf(members.find((m) => m.userId === r.userId)),
          subPill: !r.unrated,
          points: r.unrated ? t('league.home.unrated') : medal ? formatToPar(r.cardScore) : formatNumber(r.cardPoints),
          pointsLabel: r.unrated ? undefined : medal ? formatScore(r.cardScore, format, t) : t('league.board.stablefordPoints', { count: r.cardPoints }),
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
        body: <Text style={s.noPlayText}>{t('league.board.noPlayNames', { names: absent.map((r) => nameOf(r.userId)).join(', ') })}</Text>,
      },
    ].filter(Boolean);
    const unrated = results.filter((r) => r.unrated).map((r) => r.userId);
    if (unrated.length > 0) boardFooter = unratedNote(unrated);
    else if (ranked.some((r) => r.floored)) boardFooter = t('league.board.footPast', { points: formatNumber(league.participationPoints) });
    else boardFooter = t(formatKey('league.board.footPastTies', format));
    if (inGrace) {
      const close = closeInfo(grace.closesAt, now);
      boardTitle = t('league.grace.boardTitle', { month: monthLong(graceKey), when: `${close.weekdayShort} ${close.clock}` });
      boardSections.push(ghostSection(grace, t, { nameOf, now, format, onOpen: (userId) => openCard(graceKey, userId) }));
      boardFooter = t('league.grace.footer', { weekday: close.weekday });
    }
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
            <Text style={[s.chipText, key === graceKey && !on && s.chipTextGrace, on && s.chipTextOn]}>
              {key === 'season' ? t('league.public.season')
                : key === graceKey ? t('league.grace.chip', { month: monthShort(key) }) : monthShort(key)}
            </Text>
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
    { participationPoints: league.participationPoints, format: league.format }).some((r) => r.place != null) ? finalKey : null;
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
  const mine = yourCardState(myCard, format);
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

  const postOpens = postOpensLater(mine.card, now);

  // The card's path through the month (Anunciar · Jugar · Enviar · Confirmar);
  // null once it left it (missed, voided) or outside the season.
  const step = seasonPhase(league, now) && mine.kind === 'none' ? null : yourCardStep(mine, { stillPlaying });

  const renderYourCard = () => {
    let headline = null;
    let body;
    let badge = null;
    // Outside the season there is nothing to play for yet (or any more).
    const phase = mine.kind === 'none' ? seasonPhase(league, now) : null;
    if (phase) {
      body = (
        <Text style={s.cardText}>
          {phase === 'before'
            ? t('league.home.seasonStarts', { date: formatDate(String(league.seasonStart).slice(0, 10), 'day') })
            : t('league.home.seasonOver')}
        </Text>
      );
    } else if (mine.kind === 'none') {
      headline = t('league.home.announceTitle', { month: monthWord(curKey) });
      body = (
        <>
          <Text style={s.cardText}>{t('league.home.announceRule')}</Text>
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
              <Text style={s.secondaryText}>{t('league.home.playWithoutAppCta')}</Text>
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
          {t(mine.course ? 'league.home.missedCourse' : 'league.home.missed', { course: mine.course, month: monthWord(curKey) })}
        </Text>
      );
    } else if (mine.kind === 'announced' || mine.kind === 'playing') {
      const when = [dayLabel(mine.card.teeTime), timeLabel(mine.card.teeTime)].filter(Boolean).join(' ');
      headline = mine.offApp
        ? [mine.course, when].filter(Boolean).join(' · ')
        : t('league.home.playingAt', { course: mine.course ?? '' });
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
            {mine.offApp
              ? [mine.card.announcedAt ? t('league.home.announcedAt', { time: timeLabel(mine.card.announcedAt) }) : null,
                t('league.home.playWithoutApp')].filter(Boolean).join(' · ')
              : [t('league.home.playingWithApp'), mine.card.tournamentId ? t('league.home.openScorecard') : null].filter(Boolean).join(' · ')}
          </Text>
          {mine.kind === 'announced' && mine.offApp && (
            // R8: an off-app card can be posted from tee time + 3 h.
            <TouchableOpacity
              style={[s.primaryBtn, !!postOpens && { opacity: 0.5 }]}
              onPress={() => navigation.navigate('LeagueAddScore', { leagueId, cardId: mine.card.id })}
              disabled={!!postOpens}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ disabled: !!postOpens }}
            >
              <Text style={s.primaryText}>
                {postOpens ? t('league.home.postFrom', { time: clockWithDay(postOpens, now) }) : t('league.home.addScore')}
              </Text>
            </TouchableOpacity>
          )}
          <DeadlineLine card={mine.card} now={now} style={s.deadline} />
          {finishValidating}
        </>
      );
    } else {
      const awaiting = needsApproval(mine.card);
      headline = mine.pts ? tr(mine.pts) : null;
      const proofText = mine.card.proofPath
        ? t(mine.card.confirmation === 'official' ? 'league.home.officialAttached' : 'league.home.photoAttached')
        : null;
      // What the card is waiting for, said once (the track shows where).
      const waitLine = awaiting ? t('league.home.waitApproval')
        : mine.kind !== 'submitted' ? null
          : mine.offApp && !mine.card.proofPath ? t('league.home.waitProof')
            : mine.waitingFor ? t('league.home.waitMarker', { name: mine.waitingFor }) : t('league.home.waitAnyMarker');
      body = (
        <>
          {!!waitLine && <Text style={s.waitText}>{waitLine}</Text>}
          <Text style={s.cardText}>
            {mine.unrated && `${t('league.home.unratedTee')} · `}
            {standing && (
              <>
                <Text style={s.netLead}>{t('league.board.placeSoFar', { place: placeLabel(standing.place, standing.isTie) })}</Text>
                {' · '}
                <Text style={s.goldLead}>{t('league.board.leaguePts', { points: leaguePointsText(standing.seasonPoints) })}</Text>
                {' · '}
              </>
            )}
            {[
              mine.course, mine.offApp ? t('league.home.addedAfter') : null, proofText,
              mine.card.confirmedByName ? t('league.home.confirmedBy', { name: mine.card.confirmedByName }) : null,
            ].filter(Boolean).join(' · ')}
          </Text>
          {mine.kind === 'submitted' && !!mine.card.markerNote && (
            <Text style={s.cardText}>{t('league.home.markerSentBack', { note: mine.card.markerNote })}</Text>
          )}
          {mine.kind === 'submitted' && mine.offApp && !mine.card.proofPath && (
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
        {!!step && <CardSteps step={step.step} wait={step.wait} />}
        {!!headline && <Text style={s.headline}>{headline}</Text>}
        {body}
      </View>
    );
  };

  // The month's cards that don't count yet, one status chip each.
  const chipTone = {
    warn: [s.chipWarn, s.chipWarnText], accent: [s.chipAccent, s.chipAccentText],
    bad: [s.chipGrey, s.chipBadText], grey: [s.chipGrey, s.chipGreyText],
  };
  const renderPending = () => (
    <View style={s.card}>
      <Text style={s.secTitle}>{t('league.home.secNotCounting', { count: pendingRows.length })}</Text>
      {pendingRows.map((r, i) => {
        const Row = r.onPress ? TouchableOpacity : View;
        const [chipBox, chipText] = chipTone[r.tone] ?? chipTone.grey;
        return (
          <Row
            key={r.key}
            style={[s.listRow, i > 0 && s.listDivider]}
            {...(r.onPress ? {
              onPress: r.onPress,
              activeOpacity: 0.7,
              accessibilityRole: 'button',
              accessibilityLabel: r.member.userId === meId ? t('shared.leaderboard.yourCard') : t('shared.leaderboard.cardOf', { name: nameOf(r.member.userId) }),
              accessibilityHint: [r.chip, r.detail].filter(Boolean).join('. '),
            } : {})}
          >
            <InitialsAvatar {...avatarOf(r.member)} size={32} style={s.listAvatar} />
            <View style={s.listName}>
              <Text style={[s.listTitle, r.member.userId === meId && s.bold]} numberOfLines={1}>{nameOf(r.member.userId)}</Text>
              {!!r.detail && <Text style={s.listSub} numberOfLines={2}>{r.detail}</Text>}
            </View>
            <View style={[s.statusChip, chipBox]}><Text style={[s.statusChipText, chipText]} numberOfLines={1}>{r.chip}</Text></View>
          </Row>
        );
      })}
    </View>
  );
  const renderNoCard = () => (
    <View style={s.card}>
      <Text style={s.secTitle}>{t('league.home.secNoCard', { count: noCardMembers.length })}</Text>
      <View style={s.noCardRow}>
        <View style={s.stack}>
          {noCardMembers.slice(0, 5).map((m, i) => (
            <InitialsAvatar key={m.userId} {...avatarOf(m)} size={28} style={[s.stackItem, i === 0 && { marginLeft: 0 }]} />
          ))}
        </View>
        <Text style={s.noCardText}>
          {noCardMembers.map((m, i) => (
            <Text key={m.userId} style={m.userId === meId ? s.bold : null}>
              {`${i > 0 ? ', ' : ''}${nameOf(m.userId)}`}
            </Text>
          ))}
        </Text>
      </View>
    </View>
  );

  return (
    <ScreenContainer style={s.container} edges={['top']}>
      {header}
      <PullToRefresh
        style={{ flex: 1 }}
        contentContainerStyle={[s.content, { paddingBottom: tabBarClearance }]}
        refreshing={refreshing}
        onRefresh={refresh}
        {...tabBarScroll}
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

        {!!grace && (
          <MonthClosingBanner
            grace={grace}
            navigation={navigation}
            leagueId={leagueId}
            format={format}
            nameOf={nameOf}
            now={now}
            onSeeMonth={() => setScope(graceKey)}
          />
        )}

        {!!finalMonth && !grace && (
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
          scope={boardTitle}
          headerRight={boardMeta ? <Text style={s.boardMeta} numberOfLines={1}>{boardMeta}</Text> : null}
          subheader={(
            <>
              {boardProgress != null && (
                <View style={s.progress} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <View style={[s.progressFill, { width: `${Math.round(boardProgress * 100)}%` }]} />
                </View>
              )}
              {chips}
              {!!boardEmpty && <Text style={s.boardEmpty}>{boardEmpty}</Text>}
            </>
          )}
          sections={boardSections}
          footer={boardFooter}
          more={boardMore}
        />

        {pendingRows.length > 0 && renderPending()}
        {noCardMembers.length > 0 && renderNoCard()}

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
  const btn = buttonStyles(theme);
  const warn = theme.isDark ? semantic.warning.dark : semantic.warning.light;
  const gold = semantic.winner[theme.isDark ? 'soft' : 'light'];
  return StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    content: { padding: 16, paddingBottom: 40 },

    emptyTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 18, lineHeight: 24, marginTop: 14, textAlign: 'center' },
    emptyText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, marginTop: 6, marginBottom: 18, textAlign: 'center' },
    emptyNote: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, lineHeight: 19,
      textAlign: 'center', marginTop: -4, marginBottom: 16,
    },

    chipRow: { flexGrow: 0, marginBottom: 12 },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6,
      borderRadius: 999, backgroundColor: onDeep.fill,
    },
    chipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: semantic.winner.dark },
    chipDotOn: { backgroundColor: theme.bg.deep },
    chipOn: { backgroundColor: onDeep.strong },
    chipText: { fontFamily: 'PlusJakartaSans-SemiBold', color: onDeep.soft, fontSize: 12 },
    chipTextOn: { color: theme.bg.deep },
    chipTextGrace: { color: semantic.winner.dark },

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
    goldLead: { fontFamily: 'PlusJakartaSans-Bold', color: gold },
    headline: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.primary, fontSize: 17, lineHeight: 22, marginBottom: 4 },
    waitText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 13, lineHeight: 19, marginBottom: 6 },
    badgeText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 11 },

    primaryBtn: btn.primaryBtn,
    primaryText: btn.primaryText,
    secondaryBtn: { ...btn.secondaryBtn, paddingHorizontal: 28 },
    secondaryText: btn.secondaryText,
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

    // The board's header line, cards-in bar and empty month (on bg.deep).
    boardMeta: { fontFamily: 'PlusJakartaSans-SemiBold', color: onDeep.soft, fontSize: 12, flexShrink: 1 },
    progress: { height: 4, borderRadius: 2, backgroundColor: onDeep.fill, overflow: 'hidden', marginBottom: 12 },
    progressFill: { height: 4, borderRadius: 2, backgroundColor: onDeep.strong },
    boardEmpty: { fontFamily: 'PlusJakartaSans-Medium', color: onDeep.soft, fontSize: 13, lineHeight: 19, textAlign: 'center', paddingVertical: 12 },

    // Cards that don't count yet, and who has none.
    secTitle: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase',
      color: theme.text.secondary, marginBottom: 4,
    },
    listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingVertical: 8 },
    listDivider: { borderTopWidth: 1, borderTopColor: theme.border.subtle },
    listAvatar: { marginRight: 0 },
    listName: { flex: 1, minWidth: 0 },
    listTitle: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 14 },
    listSub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, lineHeight: 16, marginTop: 1 },
    bold: { fontFamily: 'PlusJakartaSans-Bold' },
    statusChip: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, maxWidth: 140 },
    statusChipText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 11 },
    chipWarn: { backgroundColor: withAlpha(warn, theme.isDark ? 0.18 : 0.14) },
    chipWarnText: { color: warn },
    chipAccent: { backgroundColor: theme.accent.light },
    chipAccentText: { color: theme.accent.primary },
    chipGrey: { backgroundColor: theme.bg.secondary },
    chipGreyText: { color: theme.text.secondary },
    chipBadText: { color: theme.destructive },
    noCardRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
    stack: { flexDirection: 'row' },
    stackItem: { marginRight: 0, marginLeft: -8, borderWidth: 2, borderColor: theme.isDark ? theme.bg.primary : theme.bg.card },
    noCardText: { flex: 1, minWidth: 0, fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, lineHeight: 19 },
    noPlayText: { fontFamily: 'PlusJakartaSans-Medium', color: onDeep.soft, fontSize: 13, lineHeight: 20, paddingVertical: 6 },
  });
}
