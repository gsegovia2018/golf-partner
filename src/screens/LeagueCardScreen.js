import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Image, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import { makeOffAppStyles } from '../components/league/offAppStyles';
import { ScorecardTable } from '../components/scorecard/GridView';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../hooks/useLeague';
import { getLeagueProofUrl } from '../store/leagueStore';
import { dayLabel } from '../store/leagueOffApp';
import { monthName, formatPoints, memberName, viewableCards } from '../store/leagueView';

// A member's card, read-only, with ‹ › to flick through that month's cards
// (same order as the board). Params: { leagueId, month ('YYYY-MM'), userId }.
export default function LeagueCardScreen({ navigation, route }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = makeOffAppStyles(theme);
  const l = useMemo(() => makeStyles(theme), [theme]);
  const meId = user?.id ?? null;
  const { leagueId, month, userId } = route?.params ?? {};
  const { data, loading, error } = useLeague(navigation, leagueId);
  const [shownUser, setShownUser] = useState(userId);

  const cards = useMemo(
    () => (data ? viewableCards(data.members, data.cardsByMonth, month) : []),
    [data, month],
  );
  const idx = cards.findIndex((c) => c.userId === shownUser);
  const card = idx >= 0 ? cards[idx] : null;
  const monthLabel = monthName(month);
  const who = memberName(data?.members, shownUser, meId);

  const header = (
    <View style={s.header}>
      <IconButton icon="chevron-left" size={24} color={theme.accent.primary} onPress={() => navigation.goBack()} accessibilityLabel="Back" />
      <Text style={s.headerTitle} numberOfLines={1}>{data ? `${who} · ${monthLabel} card` : `${monthLabel} card`}</Text>
    </View>
  );

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
  const badge = card.status === 'confirmed' ? 'Confirmed' : offApp ? 'Added after the round' : 'Submitted';
  const course = card.course;
  const played = card.playedOn ? dayLabel(card.playedOn) : null;
  const subline = [course?.name, course?.tee, played].filter(Boolean).join(' · ');
  const atStart = idx === 0;
  const atEnd = idx === cards.length - 1;
  const go = (step) => setShownUser(cards[idx + step].userId);

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
        <View style={s.card}>
          <View style={l.headRow}>
            <View>
              <Text style={l.points}>{card.points != null ? formatPoints(card.points) : '—'}</Text>
              <Text style={l.pointsLabel}>points</Text>
            </View>
            <View style={l.badge}><Text style={l.badgeText}>{badge}</Text></View>
          </View>
          {!!subline && <Text style={s.text}>{subline}</Text>}
          <Text style={s.text}>
            {[card.playingHandicap != null ? `Playing handicap ${card.playingHandicap}` : null,
              card.gross != null ? `Gross ${card.gross}` : null].filter(Boolean).join(' · ')}
          </Text>
          {!!card.confirmedByName && <Text style={s.text}>{`Confirmed by ${card.confirmedByName}`}</Text>}
          {card.notAnnounced && <Text style={s.text}>Not announced in the app</Text>}
        </View>

        {!!course?.holes && (
          <ScorecardTable
            round={{
              holes: course.holes,
              courseName: course.name,
              scoringMode: 'stableford',
              playerHandicaps: { [card.userId]: card.playingHandicap },
            }}
            players={[{ id: card.userId, name: who, handicap: card.playingHandicap }]}
            scores={{ [card.userId]: card.holes }}
            editable={() => false}
            mode="stableford"
            meId={card.userId}
          />
        )}

        {offApp && !!card.proofPath && (
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
    points: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.primary, fontSize: 34, letterSpacing: -1 },
    pointsLabel: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 12 },
    badge: { backgroundColor: theme.bg.secondary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    badgeText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 11 },
    photo: { width: '100%', height: 360, borderRadius: 10 },
    photoFail: { alignItems: 'center', paddingVertical: 20, gap: 8 },
    retry: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
  });
}
