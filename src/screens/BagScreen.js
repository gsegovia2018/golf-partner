import React, { useMemo, useState, useSyncExternalStore } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Alert,
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
  CLUB_CATALOG, DEFAULT_BAG, isClubKey, clubOrder,
} from '../lib/clubs';
import { bagLadder, ladderMax } from '../lib/bagLadder';
import { haptic } from '../lib/haptics';

// Catalog grouped the way a bag is packed, for the club picker.
const GROUPS = [
  ['woods', (k) => k === 'driver' || /^\dw$/.test(k)],
  ['hybrids', (k) => /^\dh$/.test(k)],
  ['irons', (k) => /^\di$/.test(k)],
  ['wedges', (k) => ['pw', 'gw', 'sw', 'lw'].includes(k)],
  ['putter', (k) => k === 'putter'],
].map(([key, test]) => ({ key, clubs: CLUB_CATALOG.filter((c) => test(c.key)) }));

export default function BagScreen({ navigation }) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  const appSettings = useAppSettings();
  const {
    units, clubDistances,
  } = appSettings;
  const [editingClubs, setEditingClubs] = useState(false);
  const [openRow, setOpenRow] = useState(null);

  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);

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

  resetBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    alignSelf: 'center', minHeight: 44, paddingHorizontal: 12, marginTop: 28,
  },
  resetBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.destructive, fontSize: 13 },
});
