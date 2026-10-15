import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { semantic } from '../../theme/tokens';
import { useT, formatDate } from '../../i18n';
import { firstName, cardValueText } from '../../store/leagueView';
import { approvalReason } from '../../store/leagueGrace';
import { getTournamentSnapshot } from '../../store/tournamentStore';
import { leagueRoundIndex } from '../../store/leagueGameCards';
import { closeInfo, deadlineLabel, madridDateStr } from './graceText';

// R12 grace window: the previous month stays open until the end of day 3, so
// a card still waiting for a marker, a photo or an admin gets one banner above
// the board instead of vanishing on the 1st. `grace` is graceMonth()'s result.
// Sits in the slot of the "<month> is final" banner (they never show together).
export default function MonthClosingBanner({
  grace, navigation, leagueId, nameOf, now = new Date(), onSeeMonth, format = 'stableford',
}) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  const { monthKey, closesAt, mine, toApprove, pendingOthersCount } = grace;
  const month = formatDate(`${monthKey}-01`, 'monthName');
  const close = closeInfo(closesAt, now);
  const warn = semantic.warning[theme.isDark ? 'dark' : 'light'];

  const openCard = (userId) => navigation.navigate('LeagueCard', { leagueId, month: monthKey, userId });
  const scorecard = (card) => navigation.navigate('Scorecard', {
    tournamentId: card.tournamentId,
    roundIndex: leagueRoundIndex(getTournamentSnapshot(card.tournamentId), card.roundId),
  });

  // My card: one line, one action (none when it is the admins' or the check's turn).
  let mineBlock = null;
  // An admin's own card that needs approval is already in their list below.
  if (mine && !toApprove.includes(mine)) {
    const { card, state } = mine;
    const offApp = card.source === 'offapp';
    const resubmitOpen = !!mine.resubmitBy && mine.resubmitBy.getTime() > new Date(now).getTime();
    const by = mine.resubmitBy ? deadlineLabel(mine.resubmitBy, closesAt) : null;
    let line;
    let action = null;
    switch (state) {
      case 'marker': {
        const name = firstName(card.markerName);
        const since = card.markerRequestedAt ? madridDateStr(new Date(card.markerRequestedAt)) : null;
        line = since
          ? t('league.grace.mine.markerSince', { name: card.markerName, since: formatDate(since, 'short'), first: name })
          : t('league.grace.mine.marker', { name: card.markerName, first: name });
        action = {
          label: t('league.grace.showQr', { name }),
          onPress: () => navigation.navigate('LeagueMarkerQR', { leagueId, cardId: card.id }),
        };
        break;
      }
      case 'returned':
        line = !resubmitOpen ? t('league.grace.mine.returnedLate')
          : card.markerNote ? t('league.grace.mine.returnedNote', { note: card.markerNote, by })
            : t('league.grace.mine.returned', { by });
        if (resubmitOpen) {
          action = offApp
            ? { label: t('league.home.addScore'), onPress: () => navigation.navigate('LeagueAddScore', { leagueId, cardId: card.id }) }
            : { label: t('league.grace.editScorecard'), onPress: () => scorecard(card) };
        }
        break;
      case 'noProof':
        line = t('league.grace.mine.noProof');
        action = { label: t('league.home.addProof'), onPress: () => navigation.navigate('LeagueAddProof', { leagueId, cardId: card.id, resume: true }) };
        break;
      case 'noScan':
        line = t('league.grace.mine.noScan');
        action = {
          label: t('league.home.finishValidating'),
          onPress: () => navigation.navigate('LeagueValidate', {
            leagueId, cardId: card.id, tournamentId: card.tournamentId, roundId: card.roundId, submitted: true,
          }),
        };
        break;
      case 'check': line = t('league.grace.mine.check'); break;
      case 'approval': line = t('league.grace.mine.approval'); break;
      default:
        line = t('league.grace.mine.notPosted');
        if (offApp && state === 'announced') {
          action = { label: t('league.home.addScore'), onPress: () => navigation.navigate('LeagueAddScore', { leagueId, cardId: card.id }) };
        } else if (!offApp && card.tournamentId) {
          action = { label: t('league.grace.openScorecard'), onPress: () => scorecard(card) };
        }
    }
    const lead = [cardValueText(card, format, t), card.course?.name]
      .filter(Boolean).join(' · ');
    mineBlock = (
      <View style={s.block}>
        <Text style={s.overline}>{t('league.grace.yourCard')}</Text>
        {!!lead && <Text style={s.lead}>{lead}</Text>}
        <Text style={[s.status, { color: warn }]}>{line}</Text>
        {!!action && (
          <TouchableOpacity style={s.primaryBtn} onPress={action.onPress} activeOpacity={0.8} accessibilityRole="button">
            <Text style={s.primaryText}>{action.label}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const approveBlock = toApprove.length > 0 ? (
    <View style={s.block}>
      <Text style={s.overline}>{t('league.grace.toApprove', { count: toApprove.length })}</Text>
      {toApprove.map((e) => (
        <View key={e.userId} style={s.row}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.rowName} numberOfLines={1}>{nameOf(e.userId)}</Text>
            <Text style={s.rowSub} numberOfLines={2}>
              {[cardValueText(e.card, format, t),
                t(approvalReason(e.card) === 'handTee' ? 'league.grace.handTee' : 'league.grace.notAnnounced')]
                .filter(Boolean).join(' · ')}
            </Text>
          </View>
          <TouchableOpacity
            style={s.reviewBtn}
            onPress={() => openCard(e.userId)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('league.grace.reviewA11y', { name: nameOf(e.userId) })}
          >
            <Text style={s.reviewText}>{t('league.grace.review')}</Text>
          </TouchableOpacity>
        </View>
      ))}
      <Text style={s.hint}>{t('league.grace.reviewHint')}</Text>
    </View>
  ) : null;

  return (
    <View style={s.banner}>
      <View style={s.head}>
        <Feather name="clock" size={18} color={theme.accent.primary} style={{ marginTop: 2 }} />
        <View style={{ flex: 1 }}>
          <Text style={s.title}>
            {close.tonight
              ? t('league.grace.titleTonight', { month })
              : t('league.grace.title', { month, weekday: close.weekday })}
          </Text>
          <Text style={s.sub}>{t('league.grace.sub', { when: `${close.short}, ${close.clock}` })}</Text>
        </View>
      </View>
      {mineBlock}
      {approveBlock}
      {pendingOthersCount > 0 && (
        <Text style={s.more}>
          {t('league.grace.more', { count: pendingOthersCount, month })}
          {' · '}
          <Text style={s.moreLink} onPress={onSeeMonth} accessibilityRole="link">{t('league.grace.see', { month })}</Text>
        </Text>
      )}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    banner: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1.5, borderColor: theme.accent.primary,
      padding: 14, marginBottom: 14, gap: 10,
    },
    head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    title: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 16 },
    sub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, lineHeight: 19, marginTop: 2 },
    block: { gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.border.default },
    overline: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 10,
      letterSpacing: 1.5, textTransform: 'uppercase',
    },
    lead: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 14 },
    status: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, lineHeight: 19 },
    primaryBtn: {
      minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent.primary,
      borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, marginTop: 4,
    },
    primaryText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.inverse, fontSize: 14 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    rowName: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 14 },
    rowSub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, marginTop: 1 },
    reviewBtn: {
      minHeight: 44, minWidth: 76, alignItems: 'center', justifyContent: 'center', borderRadius: 12,
      borderWidth: 1, borderColor: theme.border.default, paddingHorizontal: 14,
    },
    reviewText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13 },
    hint: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, lineHeight: 18 },
    more: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, lineHeight: 19,
      paddingTop: 2,
    },
    moreLink: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary },
  });
}
