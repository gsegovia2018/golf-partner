import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Switch, TextInput, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import PressableScale from '../components/ui/PressableScale';
import Reveal from '../components/ui/Reveal';
import GappingChart, { GappingLegend } from '../components/bag/GappingChart';
import ClubDistanceSheet from '../components/bag/ClubDistanceSheet';
import { useTheme } from '../theme/ThemeContext';
import { useT } from '../i18n';
import { useAppSettings } from '../hooks/useAppSettings';
import { updateAppSettings } from '../store/settingsStore';
import {
  subscribeShots, getShotsVersion, getShots, clearAllShots,
} from '../store/shotStore';
import {
  subscribeCourseGeometry, getCourseGeometryVersion, getCourseGeometry, hasCourseDetails,
} from '../lib/geo';
import { describeConditions } from '../lib/playConditions';
import {
  CLUB_CATALOG, DEFAULT_BAG, isClubKey, clubOrder,
} from '../lib/clubs';
import { bagLadder, ladderMax } from '../lib/bagLadder';
import { haptic } from '../lib/haptics';

const REVEAL_STEP = 40;

// Catalog grouped the way a bag is packed, for the club picker.
const GROUPS = [
  ['woods', (k) => k === 'driver' || /^\dw$/.test(k)],
  ['hybrids', (k) => /^\dh$/.test(k)],
  ['irons', (k) => /^\di$/.test(k)],
  ['wedges', (k) => ['pw', 'gw', 'sw', 'lw'].includes(k)],
  ['putter', (k) => k === 'putter'],
].map(([key, test]) => ({ key, clubs: CLUB_CATALOG.filter((c) => test(c.key)) }));

// De-dupe geometry courses by display name, sorted A→Z.
function dedupeCoursesByName(list) {
  const seen = new Set();
  return list
    .filter((c) => c?.name && !seen.has(c.name) && seen.add(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Course elevation field. Keeps its own draft and saves on blur, on the done
// key and when the screen unmounts — onEndEditing alone never fires on web
// and is skipped on Android when the keyboard is closed with back.
function AltitudeInput({
  name, value, onSave, style, placeholderTextColor, accessibilityLabel,
}) {
  const [draft, setDraft] = useState(value ? String(value) : '');
  const latest = useRef({ draft, value, onSave });
  latest.current = { draft, value, onSave };
  const commit = () => {
    const { draft: d, value: v, onSave: save } = latest.current;
    const n = parseInt(d, 10);
    const next = Number.isFinite(n) ? Math.max(0, n) : 0;
    if (next !== (v || 0)) save(name, next);
  };
  useEffect(() => () => commit(), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <TextInput
      style={style}
      keyboardType="number-pad"
      value={draft}
      onChangeText={setDraft}
      onBlur={commit}
      onSubmitEditing={commit}
      placeholder="0"
      placeholderTextColor={placeholderTextColor}
      returnKeyType="done"
      accessibilityLabel={accessibilityLabel}
    />
  );
}

export default function BagScreen({ navigation }) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  const appSettings = useAppSettings();
  const {
    units, conditionsEnabled, courseAltitudes, clubDistances,
  } = appSettings;
  const [editingClubs, setEditingClubs] = useState(false);
  const [openRow, setOpenRow] = useState(null);

  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);

  const geomVersion = useSyncExternalStore(subscribeCourseGeometry, getCourseGeometryVersion);
  // Courses to offer an elevation input for, de-duped by name: only those
  // with details loaded (bundled, or opened this session) or an altitude set —
  // not the whole course index.
  const courses = useMemo(() => dedupeCoursesByName(getCourseGeometry()
    .filter((c) => hasCourseDetails(c) || courseAltitudes?.[c.name] != null)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [geomVersion, courseAltitudes]);
  const month = new Date().getMonth();

  const setAltitude = (name, meters) => {
    updateAppSettings({ courseAltitudes: { [name]: meters } }).catch(() => {});
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

  // An explicitly empty bag stays empty here (bagLadder would fall back to
  // the default set).
  const rows = useMemo(
    () => (bag.length ? bagLadder({ bag, shots: getShots(), overrides: clubDistances }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bag.join(','), clubDistances, shotsVersion],
  );
  const max = useMemo(() => ladderMax(rows), [rows]);
  // Keep the open sheet's row in step with saves.
  const sheetRow = openRow ? rows.find((r) => r.club === openRow) ?? null : null;

  const saveClubDistance = (club, meters) => {
    haptic('selection');
    updateAppSettings({ clubDistances: { [club]: meters } }).catch(() => {});
  };

  // Reset is offered whenever there is anything to clear — a manual override
  // on any club (bagged or not) or a single marked shot.
  const canReset = Object.values(clubDistances || {}).some((v) => v > 0) || getShots().length > 0;

  // Full reset: drop every manual override AND wipe the marked-shot log the
  // measured averages are derived from, so each club really does go back to
  // its catalog estimate rather than snapping to the average it already had.
  //
  // Settings merge object keys, so clearing overrides means writing 0 for each
  // set club rather than an empty map. Deleting the shots is irreversible and
  // reaches further than this screen — the shot-detail stats, the per-hole
  // longest-drive maps and every club recommendation read the same rows — so
  // the confirmation spells out what goes.
  const resetDistances = () => {
    const overrides = Object.keys(clubDistances || {});
    const shotCount = getShots().length;
    if (!overrides.length && !shotCount) return;
    const body = shotCount
      ? t('courses.bag.resetBodyShots', { count: shotCount })
      : t('courses.bag.resetBodyNone');
    Alert.alert(
      t('courses.bag.resetTitle'),
      body,
      [
        { text: t('courses.cancel'), style: 'cancel' },
        {
          text: shotCount ? t('courses.bag.resetConfirm') : t('courses.bag.reset'),
          style: 'destructive',
          onPress: () => {
            haptic('selection');
            if (overrides.length) {
              updateAppSettings({
                clubDistances: Object.fromEntries(overrides.map((k) => [k, 0])),
              }).catch(() => {});
            }
            clearAllShots().catch(() => {});
          },
        },
      ],
    );
  };

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton icon="chevron-left" accessibilityLabel={t('courses.back')} onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>{editingClubs ? t('courses.bag.editClubs') : t('courses.bag.title')}</Text>
        <PressableScale
          onPress={() => { haptic('selection'); setEditingClubs((v) => !v); }}
          style={[s.headerBtn, editingClubs && s.headerBtnOn]}
          accessibilityRole="button"
          testID="bag-edit-clubs"
        >
          <Text style={[s.headerBtnText, editingClubs && s.headerBtnTextOn]}>
            {editingClubs ? t('courses.bag.done') : t('courses.bag.editClubs')}
          </Text>
        </PressableScale>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {editingClubs ? (
          <Reveal delay={0}>
            <Text style={s.sectionHint}>{t('courses.bag.clubsHint')}</Text>
            <View style={s.groups}>
              {GROUPS.map((g) => (
                <View key={g.key} style={s.group}>
                  <Text style={s.groupLabel}>{t(`courses.bag.group.${g.key}`)}</Text>
                  <View style={s.chipWrap}>
                    {g.clubs.map((c) => {
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
                          {on && <Feather name="check" size={13} color={theme.text.inverse} style={{ marginRight: 4 }} />}
                          <Text style={[s.chipText, on && s.chipTextOn]}>{c.label}</Text>
                        </PressableScale>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          </Reveal>
        ) : (
          <>
            <Reveal delay={0}>
              {rows.length === 0 ? (
                <View style={s.empty}>
                  <Text style={s.emptyTitle}>{t('courses.bag.emptyTitle')}</Text>
                  <Text style={s.emptyText}>{t('courses.bag.emptyBody')}</Text>
                  <PressableScale onPress={() => setEditingClubs(true)} style={s.addBtn} accessibilityRole="button">
                    <Text style={s.addBtnText}>{t('courses.bag.addClubs')}</Text>
                  </PressableScale>
                </View>
              ) : (
                <>
                  <Text style={s.sectionHint}>{t('courses.bag.chartHint')}</Text>
                  <GappingLegend />
                  <View style={s.chartCard}>
                    <GappingChart rows={rows} max={max} units={units} onPressRow={(r) => setOpenRow(r.club)} />
                  </View>
                </>
              )}
            </Reveal>

            <Reveal delay={REVEAL_STEP}>
              <View style={s.condHead}>
                <View style={s.condHeadText}>
                  <Text style={s.sectionLabel}>{t('courses.bag.conditionsLabel')}</Text>
                  <Text style={s.sectionHint}>
                    {t('courses.bag.conditionsHint')}
                  </Text>
                </View>
                <Switch
                  style={s.condSwitch}
                  value={!!conditionsEnabled}
                  onValueChange={(v) => { haptic('selection'); updateAppSettings({ conditionsEnabled: v }).catch(() => {}); }}
                  trackColor={{ true: theme.accent.primary }}
                />
              </View>

              {conditionsEnabled && (
                <View style={s.groupCard}>
                  {courses.length === 0 ? (
                    <Text style={s.emptyText}>{t('courses.bag.noCourses')}</Text>
                  ) : courses.map((c, i) => {
                    const alt = (courseAltitudes && courseAltitudes[c.name]) || 0;
                    const d = describeConditions({ month, altitudeM: alt });
                    return (
                      <View key={c.name} style={[s.condRow, i > 0 && s.rowDivider]}>
                        <View style={s.condLeft}>
                          <Text style={s.condName} numberOfLines={1}>{c.name}</Text>
                          <Text style={s.condMeta}>{`≈ ${d.tempC}°C · ${d.text}`}</Text>
                        </View>
                        <View style={s.condRight}>
                          <AltitudeInput
                            name={c.name}
                            value={alt}
                            onSave={setAltitude}
                            style={s.altInput}
                            placeholderTextColor={theme.text.muted}
                            accessibilityLabel={t('courses.bag.elevationA11y', { course: c.name })}
                          />
                          <Text style={s.altUnit}>m</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </Reveal>

            {canReset && (
              <PressableScale
                onPress={resetDistances}
                style={s.resetBtn}
                accessibilityRole="button"
                accessibilityLabel={t('courses.bag.resetA11y')}
                testID="bag-reset-distances"
              >
                <Feather name="rotate-ccw" size={13} color={theme.destructive} />
                <Text style={s.resetBtnText}>{t('courses.bag.resetAll')}</Text>
              </PressableScale>
            )}
          </>
        )}
      </ScrollView>

      <ClubDistanceSheet
        row={sheetRow}
        units={units}
        onSave={saveClubDistance}
        onClose={() => setOpenRow(null)}
        onOpenStats={(club) => navigation.navigate('ClubStat', { club })}
      />
    </ScreenContainer>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  headerBtn: {
    minHeight: 36, paddingHorizontal: 12, borderRadius: 999, justifyContent: 'center',
    backgroundColor: theme.accent.light,
  },
  headerBtnOn: { backgroundColor: theme.accent.primary },
  headerBtnText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.accent.primary },
  headerBtnTextOn: { color: theme.text.inverse },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 4 },

  sectionLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted, fontSize: 10,
    letterSpacing: 1.4, textTransform: 'uppercase', marginTop: 24, marginBottom: 6,
  },
  sectionHint: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary,
    fontSize: 12, lineHeight: 17, marginBottom: 10,
  },

  chartCard: {
    backgroundColor: theme.bg.card, borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 10,
  },

  groups: { gap: 16 },
  group: { gap: 8 },
  groupLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted, fontSize: 10,
    letterSpacing: 1.4, textTransform: 'uppercase',
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', minHeight: 36,
    borderRadius: 999, backgroundColor: theme.bg.secondary,
    paddingHorizontal: 13, paddingVertical: 8,
  },
  chipOn: { backgroundColor: theme.accent.primary },
  chipText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 13 },
  chipTextOn: { color: theme.text.inverse, fontFamily: 'PlusJakartaSans-Bold' },

  empty: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: theme.text.primary },
  emptyText: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary, fontSize: 13,
    textAlign: 'center', maxWidth: 260, paddingVertical: 4,
  },
  addBtn: {
    backgroundColor: theme.accent.primary, borderRadius: 14, paddingHorizontal: 20, minHeight: 44,
    justifyContent: 'center', marginTop: 6,
  },
  addBtnText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 14 },

  groupCard: {
    backgroundColor: theme.bg.card, borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
    paddingHorizontal: 14,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border.subtle },
  condHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  condHeadText: { flex: 1 },
  condSwitch: { marginTop: 18 },
  condRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 11, gap: 12,
  },
  condLeft: { flex: 1 },
  condName: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 14 },
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

  resetBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    alignSelf: 'center', minHeight: 44, paddingHorizontal: 12, marginTop: 28,
  },
  resetBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.destructive, fontSize: 13 },
});
