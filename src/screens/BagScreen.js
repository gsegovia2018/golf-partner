import React, { useMemo, useSyncExternalStore } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Switch, TextInput,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import PressableScale from '../components/ui/PressableScale';
import Reveal from '../components/ui/Reveal';
import { useTheme } from '../theme/ThemeContext';
import { useAppSettings } from '../hooks/useAppSettings';
import { updateAppSettings } from '../store/settingsStore';
import { subscribeShots, getShotsVersion, getShots } from '../store/shotStore';
import {
  subscribeCourseGeometry, getCourseGeometryVersion, getCourseGeometry,
} from '../lib/geo';
import { clubAverages } from '../lib/shotStats';
import { describeConditions } from '../lib/playConditions';
import {
  CLUB_CATALOG, DEFAULT_BAG, isClubKey, clubNominal, clubOrder,
} from '../lib/clubs';
import { formatDistance, unitSuffix } from '../lib/units';
import { haptic } from '../lib/haptics';

const REVEAL_STEP = 40;

// De-dupe geometry courses by display name, sorted A→Z.
function dedupeCoursesByName(list) {
  const seen = new Set();
  return list
    .filter((c) => c?.name && !seen.has(c.name) && seen.add(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export default function BagScreen({ navigation }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const appSettings = useAppSettings();
  const { units, conditionsEnabled, courseAltitudes } = appSettings;

  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const averages = useMemo(() => clubAverages(getShots()), [shotsVersion]);

  const geomVersion = useSyncExternalStore(subscribeCourseGeometry, getCourseGeometryVersion);
  // Courses to offer an elevation input for, de-duped by name.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const courses = useMemo(() => dedupeCoursesByName(getCourseGeometry()), [geomVersion]);
  const month = new Date().getMonth();

  const setAltitude = (name, text) => {
    const n = parseInt(text, 10);
    updateAppSettings({ courseAltitudes: { [name]: Number.isFinite(n) ? Math.max(0, n) : 0 } }).catch(() => {});
  };

  // Editor selection respects an explicit (even empty) stored list; only a
  // never-set bag falls back to the default 14.
  const bag = Array.isArray(appSettings.bag)
    ? appSettings.bag.filter(isClubKey)
    : DEFAULT_BAG;
  const bagSet = useMemo(() => new Set(bag), [bag]);

  const toggle = (key) => {
    haptic('selection');
    const next = new Set(bagSet);
    if (next.has(key)) next.delete(key); else next.add(key);
    updateAppSettings({ bag: [...next].sort((a, b) => clubOrder(a) - clubOrder(b)) }).catch(() => {});
  };

  // Distance rows for the swing clubs currently in the bag.
  const rows = useMemo(() => (
    [...bagSet]
      .filter((k) => k !== 'putter')
      .sort((a, b) => clubOrder(a) - clubOrder(b))
      .map((club) => {
        const measured = averages.get(club);
        const cat = CLUB_CATALOG.find((c) => c.key === club);
        return {
          club,
          label: cat?.label ?? club,
          distance: measured ?? clubNominal(club),
          measured: measured != null,
        };
      })
  ), [bagSet, averages]);

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton icon="chevron-left" accessibilityLabel="Back" onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>Your Bag</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        <Reveal delay={0}>
          <Text style={s.sectionLabel}>CLUBS YOU CARRY</Text>
          <Text style={s.sectionHint}>Tap to add or remove. Only these appear when you log a shot.</Text>
          <View style={s.chipWrap}>
            {CLUB_CATALOG.map((c) => {
              const on = bagSet.has(c.key);
              return (
                <PressableScale
                  key={c.key}
                  onPress={() => toggle(c.key)}
                  style={[s.chip, on && s.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={c.label}
                >
                  {on && <Feather name="check" size={13} color={theme.accent.primary} style={{ marginRight: 5 }} />}
                  <Text style={[s.chipText, on && s.chipTextOn]}>{c.label}</Text>
                </PressableScale>
              );
            })}
          </View>
        </Reveal>

        <Reveal delay={REVEAL_STEP}>
          <Text style={s.sectionLabel}>CLUB DISTANCES</Text>
          <Text style={s.sectionHint}>
            Average carry from your logged shots. Tap a club for its full breakdown.
          </Text>
          <View style={s.groupCard}>
            {rows.length === 0 ? (
              <Text style={s.empty}>No swing clubs in your bag yet.</Text>
            ) : rows.map((r, i) => (
              <PressableScale
                key={r.club}
                onPress={() => navigation.navigate('ClubStat', { club: r.club })}
                style={[s.distRow, i > 0 && s.distRowDivider]}
                accessibilityLabel={`${r.label} stats`}
              >
                <Text style={s.distClub}>{r.label}</Text>
                <View style={s.distRight}>
                  <Text style={s.distValue}>
                    {r.distance ? `${formatDistance(r.distance, units)} ${unitSuffix(units)}` : '—'}
                  </Text>
                  <Text style={[s.distTag, r.measured ? s.distTagReal : s.distTagEst]}>
                    {r.measured ? 'MEASURED' : 'EST'}
                  </Text>
                  <Feather name="chevron-right" size={16} color={theme.text.muted} />
                </View>
              </PressableScale>
            ))}
          </View>
        </Reveal>

        <Reveal delay={REVEAL_STEP * 2}>
          <View style={s.condHead}>
            <View style={s.condHeadText}>
              <Text style={s.sectionLabel}>PLAYING CONDITIONS</Text>
              <Text style={s.sectionHint}>
                Adjust target distances for temperature (from the month) and course
                elevation. Warm, high air flies farther — the hole plays shorter.
              </Text>
            </View>
            <Switch
              value={!!conditionsEnabled}
              onValueChange={(v) => { haptic('selection'); updateAppSettings({ conditionsEnabled: v }).catch(() => {}); }}
              trackColor={{ true: theme.accent.primary }}
            />
          </View>

          {conditionsEnabled && (
            <View style={s.groupCard}>
              {courses.length === 0 ? (
                <Text style={s.empty}>No courses with map data yet.</Text>
              ) : courses.map((c, i) => {
                const alt = (courseAltitudes && courseAltitudes[c.name]) || 0;
                const d = describeConditions({ month, altitudeM: alt });
                return (
                  <View key={c.name} style={[s.condRow, i > 0 && s.distRowDivider]}>
                    <View style={s.condLeft}>
                      <Text style={s.distClub} numberOfLines={1}>{c.name}</Text>
                      <Text style={s.condMeta}>{`≈ ${d.tempC}°C · ${d.text}`}</Text>
                    </View>
                    <View style={s.condRight}>
                      <TextInput
                        style={s.altInput}
                        keyboardType="number-pad"
                        defaultValue={alt ? String(alt) : ''}
                        placeholder="0"
                        placeholderTextColor={theme.text.muted}
                        onEndEditing={(e) => setAltitude(c.name, e.nativeEvent.text)}
                        returnKeyType="done"
                        accessibilityLabel={`${c.name} elevation in metres`}
                      />
                      <Text style={s.altUnit}>m</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </Reveal>
      </ScrollView>
    </ScreenContainer>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
  backBtn: { width: 40, height: 40 },
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },

  sectionLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted, fontSize: 10,
    letterSpacing: 1.4, textTransform: 'uppercase', marginTop: 20, marginBottom: 6,
  },
  sectionHint: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted,
    fontSize: 11, marginBottom: 12,
  },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 999, borderWidth: 1.5, borderColor: theme.border.default,
    backgroundColor: theme.bg.card, paddingHorizontal: 14, paddingVertical: 9,
  },
  chipOn: { borderColor: theme.accent.primary, backgroundColor: theme.accent.light },
  chipText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 13 },
  chipTextOn: { color: theme.accent.primary, fontFamily: 'PlusJakartaSans-Bold' },

  groupCard: {
    backgroundColor: theme.bg.card, borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
    paddingHorizontal: 14,
  },
  empty: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 13,
    paddingVertical: 18, textAlign: 'center',
  },
  distRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 13,
  },
  distRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border.subtle },
  distClub: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 14 },
  distRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  distValue: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  distTag: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 8, letterSpacing: 1,
    paddingHorizontal: 6, paddingVertical: 3, borderRadius: 5, overflow: 'hidden',
  },
  distTagReal: { color: theme.accent.primary, backgroundColor: theme.accent.light },
  distTagEst: { color: theme.text.muted, backgroundColor: theme.border.subtle },

  condHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  condHeadText: { flex: 1 },
  condRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 11, gap: 12,
  },
  condLeft: { flex: 1 },
  condMeta: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 11,
    marginTop: 2,
  },
  condRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  altInput: {
    minWidth: 56, textAlign: 'right',
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 15,
    fontVariant: ['tabular-nums'],
    borderBottomWidth: 1.5, borderBottomColor: theme.border.default,
    paddingVertical: 2, paddingHorizontal: 2,
  },
  altUnit: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 13 },
});
