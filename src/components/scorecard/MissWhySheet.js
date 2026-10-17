// The "Why?" sheet (miss reasons spec 2026-10-17 §4.2): a tracer with a start
// band, contact chips and situation chips. Every tap reports a one-key patch
// through onChange straight away, so closing early loses nothing.
import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, {
  Defs, LinearGradient, Stop, Rect, Path, Ellipse, Line, Circle,
} from 'react-native-svg';
import BottomSheet from '../BottomSheet';
import SheetHandle from '../ui/SheetHandle';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n';
import { unitWord } from '../../lib/units';
import { OPTIONS, flightOf, shotName, situations } from '../../store/missReasons';
import { APPROACH_LABELS, APPROACH_LABELS_YD } from './constants';

const KEYS = {
  drive: { start: 'driveStart', contact: 'driveContact', situation: 'driveSituation', finish: 'drive' },
  approach: { start: 'approachStart', contact: 'approachContact', situation: 'approachSituation', finish: 'approachMiss' },
  short: { result: 'shortResult', contact: 'shortContact', situation: 'shortSituation' },
};
const OPTION_KEYS = {
  drive: { contact: OPTIONS.driveContact, situation: OPTIONS.driveSituation },
  approach: { contact: OPTIONS.approachContact, situation: OPTIONS.approachSituation },
  short: { contact: OPTIONS.shortContact, situation: OPTIONS.shortSituation },
};

// Tracer palette per theme (the approved mock's TLIGHT / TDARK + band + pill).
const TRACER = {
  light: {
    sky1: '#cfe3d5', sky2: '#eef5f0', ground: '#2a7d56', target: '#4fae8a', line: 'rgba(26,26,26,0.28)',
    path: '#8a6d00', bandBg: 'rgba(255,255,255,0.88)', bandText: '#4b5563', pillBg: '#00553c', pillText: '#ffd700',
  },
  dark: {
    sky1: '#0f2a1f', sky2: '#183a2b', ground: '#1d5a3f', target: '#4fae8a', line: 'rgba(255,255,255,0.3)',
    path: '#ffd700', bandBg: 'rgba(0,0,0,0.38)', bandText: '#cfe3d5', pillBg: '#ffd700', pillText: null,
  },
};

const FIN_A = { left: [118, 126], right: [240, 126], long: [179, 112], short: [179, 144] };
const FIN_D = { left: [110, 128], right: [248, 128], short: [179, 150] };

function flightPath({ start, side, fin, fx, fy }) {
  if (!start) return `M179 172 Q179 30 ${fx} ${fy}`;
  const sx = start === 'left' ? -1 : start === 'right' ? 1 : 0;
  if (!side) return `M179 172 C ${179 + sx * 34} 100, ${fx + sx * 26} 46, ${fx} ${fy}`;
  if (start === 'center') return `M179 172 C 179 96, 181 44, ${fx} ${fy}`;
  if (start === fin) return `M179 172 C ${179 + sx * 22} 108, ${fx - sx * 4} 64, ${fx} ${fy}`;
  return `M179 172 C ${179 + sx * 46} 100, ${179 + sx * 44} 40, ${fx} ${fy}`;
}

function Chip({ label, selected, onPress, styles }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipOn]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export default function MissWhySheet({
  visible, mode, hole, detail, onChange, onClose, onMuteRound, units, handedness = 'right',
}) {
  const { theme } = useTheme();
  const t = useT();
  const { height } = useWindowDimensions();
  const palette = theme.isDark ? TRACER.dark : TRACER.light;
  const styles = useMemo(() => makeStyles(theme, palette), [theme, palette]);
  if (!mode || !KEYS[mode]) return null;

  const d = detail || {};
  const k = KEYS[mode];
  const isShortMode = mode === 'short';
  const isApproach = mode === 'approach';
  const bunker = isApproach && !!d.approachBunker;
  const fin = isShortMode ? null : (isApproach ? d.approachMiss : d.drive) ?? null;
  const side = fin === 'left' || fin === 'right' ? fin : null;
  const driveShort = mode === 'drive' && d.drive === 'short';
  const start = isShortMode ? null : d[k.start] ?? null;
  const showBand = !isShortMode && !driveShort;

  let title;
  if (isApproach) {
    if (bunker && side) title = t('shots.why.title.bunkerSide', { side: t(`shots.why.side.${side}`) });
    else if (bunker) title = t('shots.why.title.bunker');
    else if (side) title = t(`shots.why.title.${side}`);
    else title = t(`shots.why.title.${fin === 'long' ? 'long' : 'short'}`);
  } else if (mode === 'drive') {
    title = t(driveShort ? 'shots.why.title.driveShort' : `shots.why.title.drive${d.drive === 'right' ? 'Right' : 'Left'}`);
  } else {
    title = t('shots.why.title.shortGame');
  }
  const bucketLabels = units === 'yards' ? APPROACH_LABELS_YD : APPROACH_LABELS;
  const bucket = bucketLabels[d.approachBucket];
  let sub;
  if (isApproach && bucket) {
    sub = t('shots.why.sub.approach', { hole: hole?.number ?? '', bucket, unit: unitWord(units) });
  } else {
    sub = t(`shots.why.sub.${isApproach ? 'approachAny' : mode}`, { hole: hole?.number ?? '' });
  }

  const set = (key, value) => onChange({ [key]: d[key] === value ? null : value });
  const toggle = (key, value, order) => {
    const cur = situations(d, key);
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    onChange({ [key]: order.filter((v) => next.includes(v)) });
  };

  // Tracer pill: the live text.
  const name = showBand ? shotName(flightOf({ start, finish: fin }), handedness) : null;
  const finWord = bunker && !side ? 'bunker' : fin;
  const sideText = finWord ? t(`shots.why.side.${finWord}`) : null;
  let pill; let pillAsk = false;
  if (driveShort) { pill = t('shots.why.noStartLine'); pillAsk = true; }
  else if (name) pill = t('shots.why.pill', { a: t(`shots.why.name.${name}`), b: sideText });
  else if (start) {
    pill = sideText ? t('shots.why.pill', { a: t(`shots.why.start.${start}`), b: sideText }) : t(`shots.why.start.${start}`);
  } else { pill = t('shots.why.bandHint'); pillAsk = true; }

  const [fx, fy] = (isApproach ? FIN_A[fin] ?? [234, 132] : FIN_D[fin] ?? [179, 150]);
  const target = isApproach
    ? 'M131 126 C131 118 227 118 227 126 C227 134 131 134 131 126 Z'
    : 'M150 176 L166 122 L192 122 L208 176 Z';
  const path = showBand || start ? flightPath({ start, side, fin, fx, fy }) : flightPath({ start: null, fx, fy });

  const opts = OPTION_KEYS[mode];
  const selectedContact = d[k.contact];
  const selectedSits = situations(d, k.situation);

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={styles.sheet}>
      <SheetHandle />
      <ScrollView style={{ maxHeight: height * 0.88 }} bounces={false} showsVerticalScrollIndicator={false}>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{sub}</Text>

        {!isShortMode ? (
          <View style={styles.tracer}>
            <Svg width="100%" height={176} viewBox="0 0 358 176" accessible={false} importantForAccessibility="no-hide-descendants">
              <Defs>
                <LinearGradient id="why-sky" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={palette.sky1} />
                  <Stop offset="1" stopColor={palette.sky2} />
                </LinearGradient>
              </Defs>
              <Rect x="-300" width="958" height="122" fill="url(#why-sky)" />
              <Rect x="-300" y="122" width="958" height="54" fill={palette.ground} />
              <Path d={target} fill={palette.target} />
              {bunker ? <Ellipse cx="236" cy="134" rx="16" ry="4.5" fill="#d9c58a" /> : null}
              <Line x1="179" y1="172" x2="179" y2="30" stroke={palette.line} strokeWidth="1.5" strokeDasharray="4 5" />
              {isApproach ? (
                <>
                  <Line x1="179" y1="126" x2="179" y2="112" stroke="#ffffff" strokeWidth="1.5" />
                  <Path d="M179 112 L188 115 L179 118 Z" fill="#c8102e" />
                </>
              ) : null}
              <Path
                d={path}
                fill="none"
                stroke={start ? palette.path : palette.line}
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray={start ? undefined : '5 6'}
              />
              <Circle cx="179" cy="172" r="4" fill="#ffffff" />
              <Circle cx={fx} cy={fy} r="6" fill={palette.path} stroke={palette.ground} strokeWidth="2" />
            </Svg>
            <View style={styles.pillRow} pointerEvents="none">
              <Text
                accessibilityLiveRegion="polite"
                style={pillAsk ? styles.pillAsk : styles.pill}
              >
                {pill}
              </Text>
            </View>
            {showBand ? (
              <View accessibilityRole="radiogroup" accessibilityLabel={t('shots.why.band')} style={styles.band}>
                {OPTIONS.start.map((v) => {
                  const on = start === v;
                  return (
                    <Pressable
                      key={v}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      onPress={() => set(k.start, v)}
                      style={[styles.bandBtn, on && styles.bandBtnOn]}
                    >
                      <Text style={[styles.bandText, on && styles.bandTextOn]}>{t(`shots.why.band.${v}`)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        ) : (
          <>
            <Text style={[styles.section, { marginTop: 4 }]}>{t('shots.why.section.result')}</Text>
            <View style={styles.chips}>
              {OPTIONS.shortResult.map((v) => (
                <Chip
                  key={v}
                  styles={styles}
                  label={t(`shots.why.shortResult.${v}`)}
                  selected={d[k.result] === v}
                  onPress={() => set(k.result, v)}
                />
              ))}
            </View>
          </>
        )}

        <Text style={styles.section}>{t('shots.why.section.feel')}</Text>
        <View style={styles.chips}>
          {opts.contact.map((v) => (
            <Chip
              key={v}
              styles={styles}
              label={t(`shots.why.contact.${v}`)}
              selected={selectedContact === v}
              onPress={() => set(k.contact, v)}
            />
          ))}
        </View>

        <Text style={styles.section}>{t('shots.why.section.unusual')}</Text>
        <View style={styles.chips}>
          {opts.situation.map((v) => (
            <Chip
              key={v}
              styles={styles}
              label={t(`shots.why.situation.${v}`)}
              selected={selectedSits.includes(v)}
              onPress={() => toggle(k.situation, v, opts.situation)}
            />
          ))}
        </View>

        <View style={styles.foot}>
          <Pressable
            accessibilityRole="button"
            onPress={() => { if (onMuteRound) onMuteRound(); onClose(); }}
            style={styles.link}
          >
            <Text style={styles.linkText}>{t('shots.why.notThisRound')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.done}>
            <Text style={styles.doneText}>{t('shots.why.done')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

function makeStyles(theme, p) {
  const accent = theme.accent.primary;
  return StyleSheet.create({
    sheet: { paddingTop: 8, paddingHorizontal: 16, paddingBottom: 18 },
    title: { fontSize: 18, fontWeight: '700', lineHeight: 24, color: theme.text.primary },
    sub: { fontSize: 13, color: theme.text.secondary, marginTop: 2, marginBottom: 12 },
    tracer: { height: 176, borderRadius: 14, overflow: 'hidden' },
    pillRow: { position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center' },
    pill: {
      backgroundColor: p.pillBg, color: p.pillText || theme.bg.primary, fontWeight: '700', fontSize: 13,
      paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, overflow: 'hidden',
    },
    pillAsk: { color: p.bandText, fontWeight: '600', fontSize: 13, paddingVertical: 4 },
    band: {
      position: 'absolute', left: 12, right: 12, top: 46, height: 40, flexDirection: 'row',
      borderRadius: 20, backgroundColor: p.bandBg,
    },
    bandBtn: { flex: 1, minHeight: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    bandBtnOn: { backgroundColor: accent },
    bandText: { fontSize: 13, fontWeight: '600', color: p.bandText },
    bandTextOn: { color: theme.text.inverse, fontWeight: '700' },
    section: {
      fontSize: 11, fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase',
      color: theme.text.secondary, marginTop: 14, marginBottom: 6,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1,
      borderColor: theme.border.default, backgroundColor: theme.bg.card,
      alignItems: 'center', justifyContent: 'center',
    },
    chipOn: { backgroundColor: accent, borderColor: accent },
    chipText: { fontSize: 14, fontWeight: '600', color: theme.text.primary },
    chipTextOn: { color: theme.text.inverse },
    foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18 },
    link: { minHeight: 44, paddingHorizontal: 4, justifyContent: 'center' },
    linkText: { fontSize: 14, fontWeight: '600', color: theme.text.secondary },
    done: {
      minHeight: 44, backgroundColor: accent, borderRadius: 14, paddingHorizontal: 28,
      alignItems: 'center', justifyContent: 'center',
    },
    doneText: { fontSize: 15, fontWeight: '700', color: theme.text.inverse },
  });
}
