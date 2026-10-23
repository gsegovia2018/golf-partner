import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Alert, Image, Pressable, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import PressableScale from '../components/ui/PressableScale';
import SwipeToDelete from '../components/ui/SwipeToDelete';
import BottomSheet from '../components/BottomSheet';
import { PrimaryButton, SecondaryButton } from '../components/ui/Buttons';
import { Overline, swingType } from '../components/swing/swingStyles';
import { useTheme } from '../theme/ThemeContext';
import { semantic } from '../theme/tokens';
import { useSwingTone } from '../components/swing/swingTone';
import { haptic } from '../lib/haptics';
import {
  subscribeSwings, getSwingsVersion, getSwings, getSwingProfile, hydrateSwings,
  createSwing, deleteSwing, storageBytes, defaultSwingName, hasCustomName, setSwingProfile,
} from '../store/swingStore';
import { getSwingAvailability } from '../swing/availability';
import { pickSwingVideo } from '../swing/importVideo';
import { displayUri } from '../swing/fs';
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

// The frame rate is only worth a word when it is a problem: approximate, or under 240 fps.
// 240 fps clips measure 239.x: anything from 200 up is a full slow-motion clip.
const fpsLow = (fps) => fps.approximate || fps.effective < 200;

export default function SwingHomeScreen({ navigation }) {
  useT(); // the swing copy reads the language as it renders: re-render when it changes
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const tone = useSwingTone();

  useSyncExternalStore(subscribeSwings, getSwingsVersion);
  const swings = getSwings();
  const profile = getSwingProfile();
  const availability = useMemo(() => getSwingAvailability(), []);
  const canAnalyse = availability.supported;
  // The web build analyses imported clips only: no browser records high-speed video.
  const isWeb = Platform.OS === 'web';

  useEffect(() => { hydrateSwings(); }, []);

  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState([]);
  const [sheet, setSheet] = useState(false);
  const [actionRow, setActionRow] = useState(null);
  const [about, setAbout] = useState(false);
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
    const headline = sw.status === 'pending' ? T.analysing
      : sw.status === 'error' ? T.failed
        : marking ? T.finishMarking
          : sw.mainFault ? SWING_STRINGS.fault[sw.mainFault] ?? sw.mainFault : T.noFault;
    const lead = hasCustomName(sw) ? sw.name : defaultSwingName(sw.createdAt); // date and time: several swings a day are common
    const c = marking ? null : sw.counts;
    const clubName = SWING_STRINGS.club[normClub(sw.club)];
    const fps = sw.fps && fpsLow(sw.fps) ? Math.round(sw.fps.effective) : null;
    const a11y = [
      headline,
      marking ? T.markProgress(sw.marked.count, MARK_TOTAL) : null,
      `${lead} · ${clubName}`,
      c ? T.countLabel(c.green, c.yellow, c.red) : null,
      fps != null ? T.fpsWarnA11y(fps) : null,
    ].filter(Boolean).join(', ');
    return (
      <SwipeToDelete key={sw.id} enabled={!selecting} onDelete={() => confirmDelete(sw)} borderRadius={0} accessibilityLabel={T.deleteA11y(sw.name)}>
        <PressableScale
          style={s.row}
          onPress={() => onRowPress(sw)}
          onLongPress={() => onRowLongPress(sw)}
          accessibilityRole="button"
          accessibilityLabel={a11y}
          accessibilityState={sel == null ? undefined : { selected: sel }}
        >
          {sel != null ? (
            <View style={[s.selCircle, sel && s.selCircleOn]}>
              {sel ? <Feather name="check" size={14} color={theme.text.inverse} /> : null}
            </View>
          ) : null}
          <View style={s.thumb}>
            {displayUri(sw.thumb) ? <Image source={{ uri: displayUri(sw.thumb) }} style={s.thumbImg} resizeMode="cover" /> : <Feather name="activity" size={22} color={theme.text.muted} />}
          </View>
          <View style={s.rowText}>
            <Text style={s.fault} numberOfLines={1}>{headline}</Text>
            {/* the club keeps its own Text (and testID) inside the line: "<date or name> · <club>" */}
            <Text style={s.rowSub} numberOfLines={1}>
              {`${lead} · `}
              <Text testID={`club-chip-${sw.id}`}>{clubName}</Text>
            </Text>
            {marking ? (
              <View style={s.prog} testID={`mark-progress-${sw.id}`}>
                <View style={[s.progFill, { width: `${Math.min(100, (sw.marked.count / MARK_TOTAL) * 100)}%` }]} />
              </View>
            ) : null}
            {c || fps != null ? (
              <View style={s.metaLine}>
                {c ? ['green', 'yellow', 'red'].map((k) => (
                  <View key={k} style={s.count}>
                    <View style={[s.dotSm, { backgroundColor: tone[k] }]} />
                    <Text style={s.countNum}>{c[k]}</Text>
                  </View>
                )) : null}
                {fps != null ? (
                  <View style={s.fpsWarn} testID={`fps-warn-${sw.id}`}>
                    <Feather name="alert-triangle" size={12} color={tone.warning} />
                    <Text style={[s.fpsWarnText, { color: tone.warning }]}>{T.fpsWarn(fps)}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
          {selecting ? null : marking ? (
            <View style={s.contPill}><Text style={s.contText}>{T.continue}</Text></View>
          ) : <Feather name="chevron-right" size={18} color={theme.text.muted} />}
        </PressableScale>
      </SwipeToDelete>
    );
  };

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton icon="chevron-left" accessibilityLabel={T.back} onPress={() => navigation.goBack()} />
        <View style={s.headerMid}>
          <Text style={s.headerTitle}>{T.title}</Text>
          <View style={s.headerSub}>
            <Feather name="lock" size={11} color={theme.text.secondary} />
            <Text style={s.headerSubText}>{T.storedHere}</Text>
          </View>
        </View>
        <IconButton icon="more-horizontal" accessibilityLabel={T.more} onPress={() => setAbout(true)} testID="home-more" />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        {!canAnalyse && (availability.reason === 'update' || isWeb) ? (
          <View style={s.banner} accessibilityRole="alert">
            <Feather name="alert-triangle" size={18} color={tone.warning} />
            <View style={s.bannerText}>
              <Text style={s.bannerTitle}>{isWeb ? T.webUnsupportedTitle() : T.updateTitle}</Text>
              <Text style={s.bannerBody}>{isWeb ? T.webUnsupportedBody() : T.updateBody}</Text>
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
                <Overline style={s.sectionLabel}>{g.label}</Overline>
                <View style={s.group}>
                  {g.swings.map((sw, i) => (
                    <View key={sw.id} style={i > 0 ? s.divider : null}>{renderRow(sw)}</View>
                  ))}
                </View>
              </View>
            ))}
            {!selecting ? (
              <Text style={s.footer}>{T.footer(swings.length, formatBytes(storageBytes()))}</Text>
            ) : null}
          </>
        )}
      </ScrollView>

      <View style={s.bottomBar}>
        {selecting ? (
          <View style={s.btnRow}>
            <PrimaryButton
              style={[s.btn, s.btnFlex]}
              icon="columns"
              label={pickedRows.length === 2 ? T.compareShort : T.comparePick}
              numberOfLines={1}
              disabled={pickedRows.length < 2}
              onPress={() => { navigation.navigate('SwingCompare', { ids: picked }); endSelect(); }}
              accessibilityLabel={pickedRows.length === 2 ? T.compare(shortName(pickedRows[0]), shortName(pickedRows[1])) : T.comparePick}
            />
            <SecondaryButton style={s.btn} label={T.cancel} onPress={endSelect} accessibilityLabel={T.cancel} />
          </View>
        ) : isWeb ? (
          <View style={s.btnRow}>
            <PrimaryButton
              style={[s.btn, s.btnFlex]}
              icon="download"
              label={T.import}
              disabled={!canAnalyse || busy}
              onPress={() => gate(doImport)}
              accessibilityLabel={T.import}
            />
          </View>
        ) : (
          <View style={s.btnRow}>
            <PrimaryButton
              style={[s.btn, s.btnRecord]}
              icon="camera"
              label={T.record}
              disabled={!canAnalyse}
              onPress={() => gate(doRecord)}
              accessibilityLabel={T.record}
            />
            <SecondaryButton
              style={[s.btn, s.btnFlex]}
              icon="download"
              label={T.import}
              textStyle={{ color: theme.text.primary }}
              disabled={!canAnalyse || busy}
              onPress={() => gate(doImport)}
              accessibilityLabel={T.import}
            />
          </View>
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

      <BottomSheet visible={about} onClose={() => setAbout(false)} sheetStyle={s.sheet}>
        <Text style={s.sheetTitle}>{T.about}</Text>
        <View style={s.aboutLine}>
          <Feather name="shield" size={16} color={theme.accent.primary} style={s.aboutIcon} />
          <Text style={s.aboutText}>{SWING_STRINGS.privacy}</Text>
        </View>
        <View style={s.aboutLine}>
          <Feather name="hard-drive" size={16} color={theme.text.secondary} style={s.aboutIcon} />
          <Text style={s.aboutText}>{isWeb ? T.footer(swings.length, formatBytes(storageBytes())) : T.storage(swings.length, formatBytes(storageBytes()))}</Text>
        </View>
        <View style={s.aboutLine}>
          <Feather name="move" size={16} color={theme.text.secondary} style={s.aboutIcon} />
          <Text style={s.aboutText}>{T.gestureHint}</Text>
        </View>
        <Text style={[s.footer, s.aboutCredits]}>{T.attribution}</Text>
        <Text style={s.footer}>{T.attributionClub}</Text>
      </BottomSheet>

      <BottomSheet visible={sheet} onClose={() => setSheet(false)} sheetStyle={s.sheet}>
        <Text style={s.sheetTitle}>{P.title}</Text>
        <Text style={s.sheetBody}>{P.body}</Text>
        <Overline style={s.fieldLabel}>{P.height}</Overline>
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
        <Overline style={s.fieldLabel}>{P.handedness}</Overline>
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
        <PrimaryButton style={s.btn} label={P.save} disabled={!heightValid} onPress={() => closeSheet(true)} accessibilityLabel={P.save} />
        <SecondaryButton
          style={[s.btn, s.sheetSkip]}
          label={P.skip(defaultHeightCm())}
          onPress={() => closeSheet(false)}
          accessibilityLabel={P.skip(defaultHeightCm())}
        />
      </BottomSheet>
    </ScreenContainer>
  );
}

const makeStyles = (theme) => {
  const ty = swingType(theme);
  return StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
  headerMid: { flex: 1, alignItems: 'center' },
  headerTitle: { ...ty.heading },
  headerSub: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  headerSubText: { ...ty.label, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 24, flexGrow: 1 },

  banner: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 12,
    backgroundColor: theme.bg.card, borderRadius: theme.radius.lg, padding: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
  },
  bannerText: { flex: 1 },
  bannerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.text.primary },
  bannerBody: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: theme.text.secondary, marginTop: 2, lineHeight: 18 },

  sectionLabel: { marginTop: 16, marginBottom: 6 },
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
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  fault: { ...ty.heading, fontFamily: 'PlusJakartaSans-ExtraBold' },
  rowSub: { ...ty.body, fontFamily: 'PlusJakartaSans-Medium' },
  prog: {
    width: 120, maxWidth: '100%', height: 4, borderRadius: 2, marginTop: 6, overflow: 'hidden',
    backgroundColor: theme.bg.secondary,
  },
  progFill: { height: '100%', backgroundColor: theme.accent.primary },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  count: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  countNum: { ...ty.label, fontVariant: ['tabular-nums'] },
  dotSm: { width: 7, height: 7, borderRadius: 4 },
  fpsWarn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fpsWarnText: { ...ty.label },
  contPill: { backgroundColor: theme.accent.primary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  contText: { ...ty.label, color: theme.text.inverse },
  selCircle: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: theme.border.default,
    alignItems: 'center', justifyContent: 'center',
  },
  selCircleOn: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },

  footer: { ...ty.label, fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, marginTop: 14 },

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
  emptyHint: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11, color: theme.text.muted },

  bottomBar: {
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12,
    backgroundColor: theme.bg.primary,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border.default,
  },
  btnRow: { flexDirection: 'row', gap: 10 },
  btn: { paddingHorizontal: 16 },
  btnFlex: { flex: 1 },
  btnRecord: { flex: 1.4 },

  sheet: {
    backgroundColor: theme.bg.primary, padding: 20, paddingBottom: 32,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
  },
  sheetTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary },
  sheetBody: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: theme.text.secondary, marginTop: 6, lineHeight: 19 },
  fieldLabel: { marginTop: 16, marginBottom: 6 },
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
  aboutLine: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: 14 },
  aboutIcon: { marginTop: 2 },
  aboutText: { ...ty.bodyInk, flex: 1 },
  aboutCredits: { marginTop: 20 },
  });
};
