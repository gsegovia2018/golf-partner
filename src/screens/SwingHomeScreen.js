import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Alert, Image, Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import PressableScale from '../components/ui/PressableScale';
import SwipeToDelete from '../components/ui/SwipeToDelete';
import BottomSheet from '../components/BottomSheet';
import { useTheme } from '../theme/ThemeContext';
import { semantic } from '../theme/tokens';
import { haptic } from '../lib/haptics';
import {
  subscribeSwings, getSwingsVersion, getSwings, getSwingProfile, hydrateSwings,
  createSwing, deleteSwing, storageBytes, defaultSwingName, setSwingProfile,
} from '../store/swingStore';
import { getSwingAvailability } from '../swing/availability';
import { pickSwingVideo } from '../swing/importVideo';
import { defaultHeightCm } from '../swing/scale';
import { normClub } from '../swing/checks';
import { passDone, MARK_TOTAL } from '../swing/markPass';
import { SWING_STRINGS } from '../swing/strings';
import { useT } from '../i18n';
import { formatDate, formatNumber } from '../i18n/format';

const T = SWING_STRINGS.home;
const P = SWING_STRINGS.profileSheet;

/** Swings (already newest first) grouped by month: [{ key, label, swings }]. */
export function groupByMonth(swings) {
  const groups = [];
  swings.forEach((sw) => {
    const d = new Date(sw.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      const label = formatDate(d, d.getFullYear() === new Date().getFullYear() ? 'monthName' : 'month');
      g = { key, label: label.charAt(0).toUpperCase() + label.slice(1), swings: [] };
      groups.push(g);
    }
    g.swings.push(sw);
  });
  return groups;
}

export function formatBytes(n) {
  if (n >= 1024 * 1024 * 1024) return `${formatNumber(n / 1024 / 1024 / 1024, { decimals: 1 })} GB`;
  return `${Math.max(1, Math.round(n / 1024 / 1024))} MB`;
}

// fps tag state: 240+ good, 120+ watch, below that approximate (design B).
const fpsState = (fps) => (fps.approximate || fps.effective < 120 ? 'red' : fps.effective >= 240 ? 'green' : 'yellow');

export default function SwingHomeScreen({ navigation }) {
  useT(); // the swing copy reads the language as it renders: re-render when it changes
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const tone = useMemo(() => ({
    green: theme.accent.primary,
    yellow: theme.isDark ? semantic.warning.dark : semantic.warning.light,
    red: theme.isDark ? semantic.destructive.dark : semantic.destructive.light,
    none: theme.text.muted,
  }), [theme]);

  useSyncExternalStore(subscribeSwings, getSwingsVersion);
  const swings = getSwings();
  const profile = getSwingProfile();
  const availability = useMemo(() => getSwingAvailability(), []);
  const canAnalyse = availability.supported;

  useEffect(() => { hydrateSwings(); }, []);

  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState([]);
  const [sheet, setSheet] = useState(false);
  const [actionRow, setActionRow] = useState(null);
  const [heightText, setHeightText] = useState('');
  const [handed, setHanded] = useState('right');
  const [busy, setBusy] = useState(false);
  const afterSheet = useRef(null);

  const groups = useMemo(() => groupByMonth(swings), [swings]);

  const doImport = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const clip = await pickSwingVideo();
      if (!clip) return;
      // D27: the club is asked per video on the club sheet after the analysis
      const row = await createSwing({ videoUri: clip.uri, source: 'import', createdAt: new Date() });
      navigation.navigate('SwingResults', { swingId: row.id });
    } catch {
      Alert.alert(T.importFailed);
    } finally {
      setBusy(false);
    }
  }, [busy, navigation]);

  const doRecord = useCallback(() => navigation.navigate('SwingCapture'), [navigation]);

  // First analysis asks height + handedness once (D5, D6), then carries on.
  const gate = useCallback((action) => {
    if (!canAnalyse) return;
    if (profile.asked) { action(); return; }
    afterSheet.current = action;
    setHeightText(profile.heightCm ? String(profile.heightCm) : '');
    setHanded(profile.handedness);
    setSheet(true);
  }, [canAnalyse, profile]);

  const heightNum = Number(heightText.replace(',', '.'));
  const heightValid = Number.isFinite(heightNum) && heightNum >= 120 && heightNum <= 230;

  const closeSheet = async (save) => {
    await setSwingProfile({ heightCm: save ? Math.round(heightNum) : null, handedness: handed });
    setSheet(false);
    const next = afterSheet.current;
    afterSheet.current = null;
    next?.();
  };

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 2 ? p : [...p, id]));
  const endSelect = () => { setSelecting(false); setPicked([]); };

  // D26: a swing whose marking pass is unfinished resumes it; Results come after.
  const unmarked = (sw) => sw.status === 'ready' && !!sw.marked && !passDone(sw.marked);
  const onRowPress = (sw) => {
    if (selecting) { toggle(sw.id); return; }
    if (unmarked(sw)) navigation.navigate('SwingEditMarks', { swingId: sw.id, mode: 'pass' });
    else navigation.navigate('SwingResults', { swingId: sw.id });
  };
  // Long-press opens the row's actions (Delete, and Compare when there is another swing to pair).
  const onRowLongPress = (sw) => {
    if (selecting) return;
    haptic('medium');
    setActionRow(sw);
  };
  const startCompare = (sw) => {
    setActionRow(null);
    setSelecting(true);
    setPicked([sw.id]);
  };

  const confirmDelete = (sw) => {
    Alert.alert(T.deleteTitle, T.deleteBody, [
      { text: T.cancel, style: 'cancel' },
      { text: T.delete, style: 'destructive', onPress: () => { deleteSwing(sw.id); } },
    ]);
  };

  const pickedRows = picked.map((id) => swings.find((x) => x.id === id)).filter(Boolean);
  const shortName = (sw) => sw.name.split(' · ')[0];

  const renderRow = (sw) => {
    const sel = selecting ? picked.includes(sw.id) : null;
    const marking = unmarked(sw);
    const worst = sw.counts && !marking ? (sw.counts.red ? 'red' : sw.counts.yellow ? 'yellow' : 'green') : 'none';
    const headline = sw.status === 'pending' ? T.analysing
      : sw.status === 'error' ? T.failed
        : marking ? T.continueMarking(sw.marked.count, MARK_TOTAL)
          : sw.mainFault ? SWING_STRINGS.fault[sw.mainFault] ?? sw.mainFault : T.noFault;
    const customName = sw.name !== defaultSwingName(sw.createdAt, 'en') && sw.name !== defaultSwingName(sw.createdAt, 'es');
    const c = marking ? null : sw.counts;
    const clubName = SWING_STRINGS.club[normClub(sw.club)];
    return (
      <SwipeToDelete key={sw.id} enabled={!selecting} onDelete={() => confirmDelete(sw)} borderRadius={0} accessibilityLabel={T.deleteA11y(sw.name)}>
        <PressableScale
          style={s.row}
          onPress={() => onRowPress(sw)}
          onLongPress={() => onRowLongPress(sw)}
          accessibilityRole="button"
          accessibilityLabel={`${headline}, ${sw.name}, ${clubName}${c ? `, ${T.countLabel(c.green, c.yellow, c.red)}` : ''}`}
          accessibilityState={sel == null ? undefined : { selected: sel }}
        >
          {sel != null ? (
            <View style={[s.selCircle, sel && s.selCircleOn]}>
              {sel ? <Feather name="check" size={14} color={theme.text.inverse} /> : null}
            </View>
          ) : null}
          <View style={s.thumb}>
            {sw.thumb ? <Image source={{ uri: sw.thumb }} style={s.thumbImg} resizeMode="cover" /> : <Feather name="activity" size={22} color={theme.text.muted} />}
          </View>
          <View style={s.rowText}>
            <View style={s.faultLine}>
              <View style={[s.dot, { backgroundColor: tone[worst] }]} />
              <Text style={s.fault} numberOfLines={1}>{headline}</Text>
            </View>
            <Text style={s.rowName} numberOfLines={1}>{customName ? sw.name : defaultSwingName(sw.createdAt)}</Text>
            {customName ? <Text style={s.rowSub}>{defaultSwingName(sw.createdAt)}</Text> : null}
            <View style={s.metaLine}>
              <Text style={s.clubChip} testID={`club-chip-${sw.id}`}>{clubName}</Text>
              {c ? (
                <View style={s.counts}>
                  {['green', 'yellow', 'red'].map((k) => (
                    <View key={k} style={s.count}>
                      <View style={[s.dotSm, { backgroundColor: tone[k] }]} />
                      <Text style={s.countNum}>{c[k]}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {sw.fps ? (
                <Text style={[s.fpsTag, { color: tone[fpsState(sw.fps)] }]}>
                  {T.fpsTag(Math.round(sw.fps.effective), sw.fps.approximate)}
                </Text>
              ) : null}
            </View>
          </View>
          {!selecting ? <Feather name="chevron-right" size={18} color={theme.text.muted} /> : null}
        </PressableScale>
      </SwipeToDelete>
    );
  };

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton icon="chevron-left" accessibilityLabel={T.back} onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>{T.title}</Text>
        <View style={s.headerSpacer} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        {!canAnalyse && availability.reason === 'update' ? (
          <View style={s.banner} accessibilityRole="alert">
            <Feather name="alert-triangle" size={18} color={tone.yellow} />
            <View style={s.bannerText}>
              <Text style={s.bannerTitle}>{T.updateTitle}</Text>
              <Text style={s.bannerBody}>{T.updateBody}</Text>
            </View>
          </View>
        ) : null}

        {selecting ? (
          <View style={s.banner}>
            <Feather name="columns" size={18} color={theme.accent.primary} />
            <View style={s.bannerText}>
              <Text style={s.bannerTitle}>{T.pickTwo}</Text>
              <Text style={s.bannerBody}>{T.picked(picked.length)}</Text>
            </View>
          </View>
        ) : null}

        {swings.length === 0 ? (
          <View style={s.emptyCard}>
            <View style={s.guide}>
              <View style={s.guideBox} />
              <Feather name="user" size={56} color={theme.text.muted} />
            </View>
            <Text style={s.emptyTitle}>{T.emptyTitle}</Text>
            <Text style={s.emptyBody}>{T.emptyBody}</Text>
            <Text style={s.emptyHint}>{T.emptyHint}</Text>
          </View>
        ) : (
          <>
            {groups.map((g) => (
              <View key={g.key}>
                <Text style={s.sectionLabel}>{g.label}</Text>
                <View style={s.group}>
                  {g.swings.map((sw, i) => (
                    <View key={sw.id} style={i > 0 ? s.divider : null}>{renderRow(sw)}</View>
                  ))}
                </View>
              </View>
            ))}
            {!selecting ? (
              <>
                <Text style={s.footer}>{T.footer(swings.length, formatBytes(storageBytes()))}</Text>
                <Text style={s.footerSub}>{T.attribution}</Text>
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      <View style={s.bottomBar}>
        <View style={s.privacy}>
          <Feather name="shield" size={14} color={theme.accent.primary} style={s.privacyIcon} />
          <Text style={s.privacyText}>{SWING_STRINGS.privacy}</Text>
        </View>
        {selecting ? (
          <View style={s.btnRow}>
            <PressableScale
              style={[s.btn, s.btnPrimary, s.btnFlex, pickedRows.length < 2 && s.btnDisabled]}
              disabled={pickedRows.length < 2}
              onPress={() => { navigation.navigate('SwingCompare', { ids: picked }); endSelect(); }}
              accessibilityRole="button"
              accessibilityLabel={pickedRows.length === 2 ? T.compare(shortName(pickedRows[0]), shortName(pickedRows[1])) : T.comparePick}
            >
              <Feather name="columns" size={18} color={theme.text.inverse} />
              <Text style={s.btnPrimaryText} numberOfLines={1}>
                {pickedRows.length === 2 ? T.compareShort : T.comparePick}
              </Text>
            </PressableScale>
            <PressableScale style={[s.btn, s.btnSecondary]} onPress={endSelect} accessibilityRole="button" accessibilityLabel={T.cancel}>
              <Text style={s.btnSecondaryText}>{T.cancel}</Text>
            </PressableScale>
          </View>
        ) : (
          <>
            <View style={s.btnRow}>
              <PressableScale
                style={[s.btn, s.btnPrimary, s.btnRecord, !canAnalyse && s.btnDisabled]}
                disabled={!canAnalyse}
                onPress={() => gate(doRecord)}
                accessibilityRole="button"
                accessibilityLabel={T.record}
                accessibilityState={{ disabled: !canAnalyse }}
              >
                <Feather name="camera" size={18} color={theme.text.inverse} />
                <Text style={s.btnPrimaryText}>{T.record}</Text>
              </PressableScale>
              <PressableScale
                style={[s.btn, s.btnSecondary, s.btnFlex, (!canAnalyse || busy) && s.btnDisabled]}
                disabled={!canAnalyse || busy}
                onPress={() => gate(doImport)}
                accessibilityRole="button"
                accessibilityLabel={T.import}
                accessibilityState={{ disabled: !canAnalyse || busy }}
              >
                <Feather name="download" size={18} color={theme.text.primary} />
                <Text style={s.btnSecondaryText}>{T.import}</Text>
              </PressableScale>
            </View>
          </>
        )}
      </View>

      <BottomSheet visible={actionRow !== null} onClose={() => setActionRow(null)} sheetStyle={s.sheet}>
        <Text style={s.sheetTitle} numberOfLines={1}>{actionRow?.name ?? T.rowActions}</Text>
        {swings.length > 1 ? (
          <PressableScale style={s.menuRow} onPress={() => startCompare(actionRow)} accessibilityRole="button" accessibilityLabel={T.compareWith} testID="row-action-compare">
            <Feather name="columns" size={18} color={theme.text.primary} />
            <Text style={s.menuText}>{T.compareWith}</Text>
          </PressableScale>
        ) : null}
        <PressableScale
          style={s.menuRow}
          onPress={() => { const sw = actionRow; setActionRow(null); confirmDelete(sw); }}
          accessibilityRole="button"
          accessibilityLabel={T.deleteSwing}
          testID="row-action-delete"
        >
          <Feather name="trash-2" size={18} color={tone.red} />
          <Text style={[s.menuText, { color: tone.red }]}>{T.deleteSwing}</Text>
        </PressableScale>
      </BottomSheet>

      <BottomSheet visible={sheet} onClose={() => setSheet(false)} sheetStyle={s.sheet}>
        <Text style={s.sheetTitle}>{P.title}</Text>
        <Text style={s.sheetBody}>{P.body}</Text>
        <Text style={s.fieldLabel}>{P.height}</Text>
        <View style={s.inputWrap}>
          <TextInput
            style={s.input}
            value={heightText}
            onChangeText={setHeightText}
            keyboardType="numeric"
            placeholder="176"
            placeholderTextColor={theme.text.muted}
            accessibilityLabel={P.height}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            maxLength={5}
          />
          <Text style={s.unit}>{P.cm}</Text>
        </View>
        {heightText && !heightValid ? <Text style={s.error}>{P.invalid}</Text> : null}
        <Text style={s.fieldLabel}>{P.handedness}</Text>
        <View style={s.pills}>
          {[['right', P.right], ['left', P.left]].map(([k, label]) => (
            <Pressable
              key={k}
              style={[s.pill, handed === k && s.pillOn]}
              onPress={() => setHanded(k)}
              accessibilityRole="radio"
              accessibilityState={{ selected: handed === k }}
              accessibilityLabel={label}
            >
              <Text style={[s.pillText, handed === k && s.pillTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <PressableScale
          style={[s.btn, s.btnPrimary, !heightValid && s.btnDisabled]}
          disabled={!heightValid}
          onPress={() => closeSheet(true)}
          accessibilityRole="button"
          accessibilityLabel={P.save}
        >
          <Text style={s.btnPrimaryText}>{P.save}</Text>
        </PressableScale>
        <PressableScale style={[s.btn, s.btnSecondary, s.sheetSkip]} onPress={() => closeSheet(false)} accessibilityRole="button" accessibilityLabel={P.skip(defaultHeightCm())}>
          <Text style={s.btnSecondaryText}>{P.skip(defaultHeightCm())}</Text>
        </PressableScale>
      </BottomSheet>
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
  headerSpacer: { width: 40, height: 40 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 24, flexGrow: 1 },

  banner: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 12,
    backgroundColor: theme.bg.card, borderRadius: theme.radius.lg, padding: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
  },
  bannerText: { flex: 1 },
  bannerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.text.primary },
  bannerBody: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12.5, color: theme.text.secondary, marginTop: 2, lineHeight: 18 },

  sectionLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted, fontSize: 10,
    letterSpacing: 1.4, textTransform: 'uppercase', marginTop: 16, marginBottom: 6,
  },
  group: {
    backgroundColor: theme.bg.card, borderRadius: theme.radius.lg, overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border.subtle },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12,
    backgroundColor: theme.bg.card,
  },
  thumb: {
    width: 64, height: 86, borderRadius: 10, overflow: 'hidden',
    backgroundColor: theme.bg.secondary, alignItems: 'center', justifyContent: 'center',
  },
  thumbImg: { width: '100%', height: '100%' },
  rowText: { flex: 1, gap: 2 },
  faultLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fault: { flex: 1, fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15, color: theme.text.primary },
  rowName: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: theme.text.secondary },
  rowSub: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11.5, color: theme.text.muted },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  counts: { flexDirection: 'row', gap: 8 },
  count: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  countNum: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, color: theme.text.primary, fontVariant: ['tabular-nums'] },
  dot: { width: 9, height: 9, borderRadius: 5 },
  dotSm: { width: 7, height: 7, borderRadius: 4 },
  fpsTag: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 0.6 },
  clubChip: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 10.5, color: theme.text.secondary, backgroundColor: theme.bg.secondary,
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden',
  },
  selCircle: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: theme.border.default,
    alignItems: 'center', justifyContent: 'center',
  },
  selCircleOn: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },

  footer: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11, color: theme.text.muted, marginTop: 14, lineHeight: 16 },
  footerSub: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11, color: theme.text.muted, marginTop: 2 },

  emptyCard: {
    backgroundColor: theme.bg.card, borderRadius: theme.radius.lg, padding: 16, gap: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
  },
  guide: {
    aspectRatio: 1.5, borderRadius: 12, backgroundColor: theme.bg.secondary,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  guideBox: {
    ...StyleSheet.absoluteFillObject, margin: 14, borderRadius: 10,
    borderWidth: 2, borderStyle: 'dashed', borderColor: theme.text.muted,
  },
  emptyTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary },
  emptyBody: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, color: theme.text.secondary, lineHeight: 19 },
  emptyHint: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11.5, color: theme.text.muted },

  bottomBar: {
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12,
    backgroundColor: theme.bg.primary,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border.default,
  },
  privacy: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 10 },
  privacyIcon: { marginTop: 1 },
  privacyText: { flex: 1, fontFamily: 'PlusJakartaSans-Medium', fontSize: 11.5, color: theme.text.secondary, lineHeight: 16 },
  btnRow: { flexDirection: 'row', gap: 10 },
  btn: {
    minHeight: 48, borderRadius: 14, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  btnFlex: { flex: 1 },
  btnRecord: { flex: 1.4 },
  btnPrimary: { backgroundColor: theme.accent.primary },
  btnPrimaryText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, color: theme.text.inverse },
  btnSecondary: { backgroundColor: theme.bg.secondary, borderWidth: 1, borderColor: theme.border.default },
  btnSecondaryText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, color: theme.text.primary },
  btnDisabled: { opacity: 0.5 },

  sheet: {
    backgroundColor: theme.bg.primary, padding: 20, paddingBottom: 32,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
  },
  sheetTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary },
  sheetBody: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: theme.text.secondary, marginTop: 6, lineHeight: 19 },
  fieldLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted, fontSize: 10,
    letterSpacing: 1.4, textTransform: 'uppercase', marginTop: 16, marginBottom: 6,
  },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: theme.bg.card,
    borderRadius: 12, borderWidth: 1.5, borderColor: theme.border.default, paddingHorizontal: 14,
  },
  input: { flex: 1, minHeight: 48, fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  unit: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: theme.text.muted },
  error: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: theme.isDark ? semantic.destructive.dark : semantic.destructive.light, marginTop: 6 },
  pills: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  pill: {
    flex: 1, minHeight: 44, borderRadius: 999, borderWidth: 1.5, borderColor: theme.border.default,
    backgroundColor: theme.bg.card, alignItems: 'center', justifyContent: 'center',
  },
  pillOn: { borderColor: theme.accent.primary, backgroundColor: theme.accent.light },
  pillText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: theme.text.secondary },
  pillTextOn: { color: theme.accent.primary, fontFamily: 'PlusJakartaSans-Bold' },
  sheetSkip: { marginTop: 10 },
  menuRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 4 },
  menuText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 15, color: theme.text.primary },
});
