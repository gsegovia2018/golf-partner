import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Image, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import { makeOffAppStyles } from '../components/league/offAppStyles';
import CardHoleGrid from '../components/league/CardHoleGrid';
import DeadlineLine from '../components/league/DeadlineLine';
import LeagueCardActions from '../components/league/LeagueCardActions';
import CardTimeline from '../components/league/CardTimeline';
import { stamp } from '../components/league/stamp';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../hooks/useLeague';
import { useMinuteClock } from '../hooks/useMinuteClock';
import { useCardEvents } from '../hooks/useCardEvents';
import { useT, tr, formatNumber } from '../i18n';
import { semantic } from '../theme/tokens';
import { getLeagueProofUrl } from '../store/leagueStore';
import { dayLabel, timeLabel } from '../store/leagueOffApp';
import { isMissed, needsApproval, isMonthClosed } from '../store/leagueRules';
import {
  monthName, netDiffTone, memberName, cardBreakdown, monthStanding, standingCells, currentMonthKey,
  monthCardsView, cardActions, voidedNote,
} from '../store/leagueView';

// A member's card, read-only, with ‹ › to flick through that month's cards
// (same order as the board). Params: { leagueId, month ('YYYY-MM'), userId }.
export default function LeagueCardScreen({ navigation, route }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = makeOffAppStyles(theme);
  const l = useMemo(() => makeStyles(theme), [theme]);
  const meId = user?.id ?? null;
  const t = useT();
  const now = useMinuteClock();
  const { leagueId, month, userId } = route?.params ?? {};
  const { data, loading, error, reload } = useLeague(navigation, leagueId);
  const [shownUser, setShownUser] = useState(userId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState(null);

  const cards = useMemo(
    () => (data ? monthCardsView(data, month, meId, now) : []),
    [data, month, meId, now],
  );
  const idx = cards.findIndex((c) => c.userId === shownUser);
  const card = idx >= 0 ? cards[idx] : null;
  const monthLabel = monthName(month);
  const who = memberName(data?.members, shownUser, meId);
  const timeline = useCardEvents(card?.id, version);

  const isOwner = !!card && card.userId === meId;
  const isAdmin = !!data?.members.find((m) => m.userId === meId && !m.leftAt && m.role === 'admin');
  const otherAdmin = !!data?.members.some((m) => m.userId !== meId && !m.leftAt && m.role === 'admin');
  const items = useMemo(
    () => cardActions(card, { isOwner, isAdmin, otherAdmin }, data?.league, now, { when: stamp, clock: timeLabel }),
    [card, isOwner, isAdmin, otherAdmin, data?.league, now],
  );

  const header = (
    <View style={s.header}>
      <IconButton icon="chevron-left" size={24} color={theme.accent.primary} onPress={() => navigation.goBack()} accessibilityLabel="Back" />
      <Text style={[s.headerTitle, { flex: 1 }]} numberOfLines={1}>{data ? `${who} · ${monthLabel} card` : `${monthLabel} card`}</Text>
      {items.length > 0 && (
        <IconButton
          icon="more-vertical"
          size={22}
          color={theme.text.primary}
          onPress={() => setMenuOpen(true)}
          accessibilityLabel={t('league.actions.menu')}
        />
      )}
    </View>
  );

  // A flick to another card closes anything open for this one.
  const flickTo = (step) => { setMenuOpen(false); setNotice(null); setShownUser(cards[idx + step].userId); };
  const afterAction = async (kind) => {
    setNotice(kind === 'withdraw' || kind === 'void' ? `league.actions.${kind}.done` : null);
    setVersion((v) => v + 1);
    await reload();
  };

  if (!card) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {header}
        <View style={s.center}>
          {loading && !data ? <ActivityIndicator color={theme.accent.primary} /> : (
            <>
              <Feather name="clipboard" size={40} color={theme.text.muted} />
              <Text style={[s.cardTitle, { marginTop: 12 }]}>No card to show</Text>
              <Text style={s.text}>{(!data && error) || 'This card is not available yet.'}</Text>
            </>
          )}
        </View>
      </ScreenContainer>
    );
  }

  const offApp = card.source === 'offapp';
  const scored = !!card.holes && (card.status === 'confirmed' || card.status === 'submitted');
  const missed = isMissed(card);
  const awaiting = needsApproval(card);
  const voided = card.status === 'void';
  const withdrawn = voided && (card.voidKind === 'withdrawn' || card.voidKind === 'auto_withdrawn');
  const badge = voided ? (withdrawn ? t('league.void.badgeWithdrawn') : t('league.void.badge')) : missed ? 'Not posted' : awaiting ? 'Awaiting approval' : card.status === 'playing' ? 'Playing' : card.status === 'announced' ? 'Announced' : card.status === 'confirmed' ? 'Confirmed' : offApp ? 'Added after the round' : 'Submitted';
  const course = card.course;
  const played = card.playedOn ? dayLabel(card.playedOn) : null;
  const breakdown = cardBreakdown(card);
  const teeText = course?.tee
    ? (breakdown.rated ? `${course.tee} tees, slope ${breakdown.slope} · CR ${breakdown.rating}` : course.tee)
    : null;
  const subline = [course?.name, teeText, played].filter(Boolean).join(' · ');
  // Stableford points are the headline (the league ranks by them).
  const valueText = card.points != null ? formatNumber(card.points) : 'Unrated';
  const valueKey = card.points != null ? t('league.card.stableford') : 'not ranked';
  const handTee = card.teeVerified === false;
  const standing = scored && !awaiting && !missed
    ? monthStanding(data, month, card.userId, now) : null;
  const cells = standing ? standingCells(standing, { month, current: month === currentMonthKey(now) }) : null;
  const diffTone = netDiffTone(card.netDifferential);
  const diffValue = card.netDifferential == null ? null : formatNumber(Math.abs(Math.round(card.netDifferential * 10) / 10), { decimals: 1 });
  const diffText = diffValue == null ? t('league.card.diffNone')
    : t(diffTone === 'better' ? 'league.card.diffBetter' : diffTone === 'worse' ? 'league.card.diffWorse' : 'league.card.diffLevel',
      { value: diffValue, handicap: formatNumber(card.leagueHandicap, { decimals: 1 }) || '—' });
  const atStart = idx === 0;
  const atEnd = idx === cards.length - 1;
  const go = flickTo;

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {header}
      <View style={l.flick}>
        <IconButton
          icon="chevron-left"
          onPress={() => go(-1)}
          disabled={atStart}
          style={[l.arrow, atStart && l.arrowOff]}
          accessibilityLabel="Previous card"
          accessibilityState={{ disabled: atStart }}
        />
        <Text style={l.flickText}>{`${idx + 1} of ${cards.length} ${monthLabel} cards`}</Text>
        <IconButton
          icon="chevron-right"
          onPress={() => go(1)}
          disabled={atEnd}
          style={[l.arrow, atEnd && l.arrowOff]}
          accessibilityLabel="Next card"
          accessibilityState={{ disabled: atEnd }}
        />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        {!!notice && (
          <View style={s.note} accessibilityRole="alert">
            <Feather name="check-circle" size={14} color={theme.accent.primary} />
            <Text style={s.noteText}>{t(notice)}</Text>
          </View>
        )}
        {voided ? (
          <View style={s.card}>
            <View style={l.headRow}>
              <View style={l.valueRow}>
                {card.points != null ? (
                  <>
                    <Text style={[l.value, { color: theme.text.muted }]}>{formatNumber(card.points)}</Text>
                    <Text style={l.valueKey}>{t('league.void.notCounted')}</Text>
                  </>
                ) : <Text style={s.cardTitle}>{badge}</Text>}
              </View>
              <View style={l.badgeBad}><Text style={l.badgeBadText}>{badge}</Text></View>
            </View>
            {!!subline && <Text style={s.text}>{subline}</Text>}
            <Text style={s.text}>{tr(voidedNote(card, { isOwner, who }))}</Text>
            {isOwner && withdrawn && month === currentMonthKey(now) && !isMonthClosed(month, now) && (
              <TouchableOpacity
                style={s.primaryBtn}
                onPress={() => navigation.navigate('LeagueBoard', { leagueId })}
                activeOpacity={0.8}
                accessibilityRole="button"
              >
                <Text style={s.primaryText}>{t('league.void.announceAnother')}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : scored ? (
          <View style={s.card}>
            <View style={l.headRow}>
              <View style={l.valueRow}>
                <Text style={[l.value, { color: theme.text.primary }]}>{valueText}</Text>
                <Text style={l.valueKey}>{valueKey}</Text>
              </View>
              {handTee
                ? <View style={l.badgeWarn}><Text style={l.badgeWarnText}>{t('league.card.teeByHand')}</Text></View>
                : <View style={l.badge}><Text style={l.badgeText}>{badge}</Text></View>}
            </View>
            {!!subline && <Text style={s.text}>{subline}</Text>}
            <Text style={s.text}>
              {[card.playingHandicap != null ? t('league.card.handicaps', { playing: card.playingHandicap }) : null,
                card.gross != null ? t('league.card.gross', { gross: card.gross }) : null].filter(Boolean).join(' · ')}
            </Text>
            {!!card.confirmedByName && <Text style={s.text}>{`Confirmed by ${card.confirmedByName}`}</Text>}
            {handTee && <Text style={s.text}>{t('league.card.teeByHandNote')}</Text>}
            {card.notAnnounced && <Text style={s.text}>Not announced in the app</Text>}
            {awaiting && <Text style={s.text}>Awaiting an admin's approval · not counted yet</Text>}
            {!!cells && (
              <View style={l.strip}>
                <View style={l.cell}>
                  <Text style={l.cellValue}>{cells.place}</Text>
                  <Text style={l.cellNote}>{tr(cells.placeNote)}</Text>
                </View>
                <View style={l.cell}>
                  <Text style={[l.cellValue, { color: theme.scoreColor('excellent') }]}>{cells.lp}</Text>
                  <Text style={l.cellNote}>{tr(cells.lpNote)}</Text>
                </View>
              </View>
            )}
          </View>
        ) : (
          <View style={s.card}>
            <View style={l.headRow}>
              <Text style={s.cardTitle}>{missed ? 'Not posted' : card.status === 'playing' ? 'Playing now' : 'Announced'}</Text>
              <View style={l.badge}><Text style={l.badgeText}>{badge}</Text></View>
            </View>
            {!!subline && <Text style={s.text}>{subline}</Text>}
            {!!card.teeTime && (
              <Text style={s.text}>{`Tee time ${[dayLabel(card.teeTime), timeLabel(card.teeTime)].filter(Boolean).join(' ')}`}</Text>
            )}
            {!!card.announcedAt && <Text style={s.text}>{`Announced ${timeLabel(card.announcedAt)}`}</Text>}
            {missed
              ? <Text style={s.text}>{`Not posted — this month's card is used.`}</Text>
              : <DeadlineLine card={card} />}
          </View>
        )}

        <LeagueCardActions
          card={card}
          who={who}
          monthLabel={monthLabel}
          isOwner={isOwner}
          items={items}
          menuOpen={menuOpen}
          onMenuClose={() => setMenuOpen(false)}
          onDone={afterAction}
        />

        <CardTimeline
          events={timeline.events}
          loading={timeline.loading}
          error={timeline.error}
          onRetry={timeline.reload}
          meId={meId}
          monthKey={card.monthKey}
        />

        {scored && !!course?.holes && (
          <>
            <CardHoleGrid perHole={breakdown.perHole} />
          </>
        )}

        {scored && (
          <View style={[s.card, { marginTop: 14 }]}>
            <Text style={s.cardTitle}>{t('league.card.diffTitle')}</Text>
            <Text style={s.text}>{diffText}</Text>
          </View>
        )}

        {!!card.proofPath && (
          <ProofPhoto key={card.proofPath} path={card.proofPath} official={card.confirmation === 'official'} theme={theme} />
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

// The signed card photo / official result. The URL is signed on demand.
function ProofPhoto({ path, official, theme }) {
  const s = makeOffAppStyles(theme);
  const l = useMemo(() => makeStyles(theme), [theme]);
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    setUrl(null);
    try {
      setUrl(await getLeagueProofUrl(path));
    } catch {
      setFailed(true);
    }
  }, [path]);
  useEffect(() => { load(); }, [load]);

  const label = official ? 'Official result' : 'Signed card photo';
  return (
    <View style={[s.card, { marginTop: 14 }]}>
      <Text style={s.cardTitle}>{label}</Text>
      {failed ? (
        <View style={l.photoFail}>
          <Text style={s.text}>Couldn't load the photo</Text>
          <TouchableOpacity onPress={load} activeOpacity={0.7} accessibilityRole="button">
            <Text style={l.retry}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : url ? (
        <Image
          source={{ uri: url }}
          style={l.photo}
          resizeMode="contain"
          onError={() => setFailed(true)}
          accessibilityLabel={label}
        />
      ) : (
        <ActivityIndicator color={theme.accent.primary} style={{ marginVertical: 24 }} />
      )}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    flick: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
    arrow: { width: 44, height: 44 },
    arrowOff: { opacity: 0.3 },
    flickText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 12 },
    headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
    valueRow: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8 },
    value: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 28 },
    valueKey: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 13 },
    badge: { backgroundColor: theme.bg.secondary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    badgeText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 11 },
    badgeBad: { backgroundColor: theme.bg.secondary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    badgeBadText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.destructive, fontSize: 11 },
    badgeWarn: { backgroundColor: theme.isDark ? 'rgba(224,178,77,0.18)' : 'rgba(184,121,26,0.14)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    badgeWarnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.isDark ? semantic.warning.dark : semantic.warning.light, fontSize: 11 },
    strip: { flexDirection: 'row', gap: 8, marginTop: 10 },
    cell: { flex: 1, backgroundColor: theme.bg.secondary, borderRadius: 12, padding: 12 },
    cellValue: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.primary, fontSize: 18 },
    cellNote: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
    photo: { width: '100%', height: 360, borderRadius: 10 },
    photoFail: { alignItems: 'center', paddingVertical: 20, gap: 8 },
    retry: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
  });
}
