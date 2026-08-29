import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import PressableScale from '../components/ui/PressableScale';
import Reveal from '../components/ui/Reveal';
import TrendLineChart from '../components/mystats/TrendLineChart';
import { ShotReplaySheet } from '../components/scorecard/ShotReplaySheet';
import { useTheme } from '../theme/ThemeContext';
import { useAppSettings } from '../hooks/useAppSettings';
import { subscribeShots, getShotsVersion, getShots } from '../store/shotStore';
import { loadShotRoundIndex, shotRoundContext } from '../store/shotRounds';
import { clubDetail } from '../lib/shotStats';
import { clubLabel } from '../lib/clubs';
import { formatDistance, unitSuffix, M_TO_YD } from '../lib/units';

// Full per-club breakdown: measured carry, consistency, range and a per-round
// trend. Reached from the Bag screen's club-distance list. Read-only — the
// data comes straight from the marked-shot log.
export default function ClubStatScreen({ route, navigation }) {
  const { club } = route.params || {};
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { units } = useAppSettings();

  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const detail = useMemo(() => clubDetail(getShots(), club), [club, shotsVersion]);

  const suffix = unitSuffix(units);

  // Where the longest carry was struck, so the LONGEST tile can open that
  // hole's map. Loads lazily — the rest of the screen never waits on it.
  const [roundIndexMap, setRoundIndexMap] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadShotRoundIndex()
      .then((m) => { if (!cancelled) setRoundIndexMap(m); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const longestAt = useMemo(
    () => shotRoundContext(roundIndexMap, detail?.longest),
    [roundIndexMap, detail],
  );
  const [replayOpen, setReplayOpen] = useState(false);

  const trend = useMemo(() => (detail?.byRound || []).map((r, i) => ({
    label: `R${i + 1}`,
    value: Math.round(units === 'yards' ? r.avg * M_TO_YD : r.avg),
  })), [detail, units]);

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton icon="chevron-left" accessibilityLabel="Back" onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>{clubLabel(club)}</Text>
        <View style={s.spacer} />
      </View>

      {!detail ? (
        <View style={s.emptyWrap}>
          <Text style={s.emptyTitle}>No shots yet</Text>
          <Text style={s.emptyText}>
            Mark where the ball lands on the hole map and tag this club. Once you
            log a shot, its carry, consistency and trend show up here.
          </Text>
        </View>
      ) : (
        <ScrollView style={s.scroll} contentContainerStyle={s.content}>
          <Reveal delay={0}>
            <View style={s.hero}>
              <Text style={s.heroValue}>
                {formatDistance(detail.avg, units)}
                <Text style={s.heroUnit}>{` ${suffix}`}</Text>
              </Text>
              <Text style={s.heroSub}>
                {`avg carry · ${detail.count} shot${detail.count === 1 ? '' : 's'}`}
                {detail.nominal ? ` · typical ${formatDistance(detail.nominal, units)}${suffix}` : ''}
              </Text>
            </View>
          </Reveal>

          <Reveal delay={40}>
            <View style={s.tiles}>
              <View style={s.tile}>
                <Text style={s.tileValue}>{`±${formatDistance(detail.std, units)}`}</Text>
                <Text style={s.tileLabel}>CONSISTENCY</Text>
              </View>
              <View style={s.tile}>
                <Text style={s.tileValue}>{`${formatDistance(detail.min, units)}–${formatDistance(detail.max, units)}`}</Text>
                <Text style={s.tileLabel}>RANGE ({suffix})</Text>
              </View>
              <PressableScale
                style={[s.tile, longestAt && s.tileTappable]}
                disabled={!longestAt}
                onPress={() => setReplayOpen(true)}
                accessibilityRole={longestAt ? 'button' : undefined}
                accessibilityLabel={longestAt
                  ? `Longest carry ${formatDistance(detail.max, units)} ${suffix}, hole ${longestAt.holeNumber} at ${longestAt.courseName}. Open the hole map.`
                  : undefined}
                testID="club-longest-tile"
              >
                <Text style={s.tileValue}>{`${formatDistance(detail.max, units)}`}</Text>
                <Text style={s.tileLabel}>LONGEST ({suffix})</Text>
                {longestAt ? (
                  <View style={s.tileLink}>
                    <Feather name="map-pin" size={9} color={theme.accent.primary} />
                    <Text style={s.tileLinkText} numberOfLines={1}>{`Hole ${longestAt.holeNumber}`}</Text>
                  </View>
                ) : null}
              </PressableScale>
            </View>
          </Reveal>

          {trend.length >= 2 && (
            <Reveal delay={80}>
              <Text style={s.sectionLabel}>CARRY BY ROUND</Text>
              <View style={s.card}>
                <TrendLineChart
                  series={trend}
                  caption="Average carry per round you used this club"
                  formatValue={(v) => `${v}`}
                  dropGaps
                />
              </View>
            </Reveal>
          )}

          {detail.recent.length > 0 && (
            <Reveal delay={120}>
              <Text style={s.sectionLabel}>RECENT CARRIES</Text>
              <View style={s.chipWrap}>
                {detail.recent.map((m, i) => (
                  <View key={i} style={s.chip}>
                    <Text style={s.chipText}>{`${formatDistance(m, units)}${suffix}`}</Text>
                  </View>
                ))}
              </View>
            </Reveal>
          )}
        </ScrollView>
      )}
      {longestAt ? (
        <ShotReplaySheet
          visible={replayOpen}
          onClose={() => setReplayOpen(false)}
          courseName={longestAt.courseName}
          holeNumber={longestAt.holeNumber}
          par={longestAt.par}
          strokeIndex={longestAt.strokeIndex}
          roundId={detail.longest.roundId}
          roundIndex={detail.longest.roundIndex}
          caption={`Longest ${clubLabel(club)} · ${formatDistance(detail.max, units)}${suffix} · ${longestAt.courseName}`}
        />
      ) : null}
    </ScreenContainer>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
  spacer: { width: 40, height: 40 },
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 8 },
  emptyTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 18, color: theme.text.primary },
  emptyText: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: theme.text.muted,
    textAlign: 'center', lineHeight: 19,
  },

  hero: { alignItems: 'center', paddingVertical: 18 },
  heroValue: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 52, color: theme.text.primary,
    fontVariant: ['tabular-nums'],
  },
  heroUnit: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 22, color: theme.text.muted },
  heroSub: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.muted, marginTop: 4 },

  tiles: { flexDirection: 'row', gap: 10 },
  tile: {
    flex: 1, backgroundColor: theme.bg.card, borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
    paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center', gap: 4,
  },
  tileValue: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: theme.text.primary,
    fontVariant: ['tabular-nums'],
  },
  tileLabel: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 8, letterSpacing: 1,
    color: theme.text.muted, textAlign: 'center',
  },
  tileTappable: { borderColor: theme.accent.primary },
  tileLink: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  tileLinkText: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 9, color: theme.accent.primary,
  },

  sectionLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted, fontSize: 10,
    letterSpacing: 1.4, textTransform: 'uppercase', marginTop: 22, marginBottom: 10,
  },
  card: {
    backgroundColor: theme.bg.card, borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
    padding: 8,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 999, backgroundColor: theme.bg.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  chipText: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
});
