import React, {
  useEffect, useMemo, useRef, useState,
} from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image, useWindowDimensions,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import { useSwingTone } from '../components/swing/swingTone';
import { useTheme } from '../theme/ThemeContext';
import {
  getSwing, hydrateSwings, readAnalysis, readProbe,
} from '../store/swingStore';
import { getStill, ensureStills } from '../swing/frames';
import { compareAnalyses } from '../swing/compare';
import { normClub } from '../swing/checks';
import { SWING_STRINGS } from '../swing/strings';
import { useT } from '../i18n';
import { formatDate } from '../i18n/format';

const T = SWING_STRINGS.compare;

/** "11 Oct" for the two column heads. */
export function shortDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : formatDate(d, 'day');
}

const impactFrame = (analysis) => analysis?.checkpoints?.impact?.i ?? null;

// --- The view (props in, pixels out) ----------------------------------------------------------

/**
 * left/right: { row, analysis, stillUri, aspect }. The Change column reads left against right,
 * so a golfer puts the newer swing on the left and swap flips the question.
 */
export function SwingCompareView({ left, right, onBack, onSwap }) {
  const { theme } = useTheme();
  const tone = useSwingTone();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { width: winW } = useWindowDimensions();
  const colW = (Math.min(winW, 480) - 40 - 10) / 2;
  const ready = !!(left?.analysis && right?.analysis);
  const result = useMemo(() => (ready ? compareAnalyses(left.analysis, right.analysis) : null), [ready, left, right]);
  const clubOf = (side) => normClub(side?.analysis?.club ?? side?.row?.club);
  const mixedClubs = ready && clubOf(left) !== clubOf(right);
  const changeColor = { better: tone.green, worse: tone.red, same: theme.text.secondary, unclear: theme.text.secondary };

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton icon="chevron-left" accessibilityLabel={T.back} onPress={onBack} />
        <Text style={s.headerTitle} numberOfLines={1}>{T.title}</Text>
        {ready ? <IconButton icon="repeat" accessibilityLabel={T.swap} onPress={onSwap} /> : <View style={s.headerSpacer} />}
      </View>
      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        {!ready ? (
          <Text style={s.hint}>{T.loadFailed}</Text>
        ) : (
          <>
            <View style={s.hero}>
              <Text style={s.overline}>{T.overline}</Text>
              <Text style={s.verdict}>{result.verdict}</Text>
              <Text style={s.why}>{result.sentence}</Text>
              <View style={s.chips}>
                {['better', 'same', 'worse', 'unclear'].map((k) => (
                  <View key={k} style={s.chip}><Text style={s.chipText}>{T[k](result.counts[k])}</Text></View>
                ))}
              </View>
            </View>

            <View style={s.stills}>
              {[left, right].map((side, i) => (
                <View key={side.row.id} style={{ width: colW }}>
                  <Text style={s.colName} numberOfLines={1}>{`${side.row.name} · ${SWING_STRINGS.club[clubOf(side)]}`}</Text>
                  <View style={[s.stillBox, { width: colW, height: colW / (side.aspect || 0.75) }]} accessibilityLabel={T.stillA11y(side.row.name, T.impactStills.toLowerCase())}>
                    {side.stillUri ? (
                      <Image source={{ uri: side.stillUri }} style={s.still} resizeMode="cover" />
                    ) : <Text style={s.noStill}>{T.noStill}</Text>}
                    <View style={s.stillTag}><Text style={s.stillTagText}>{i === 0 ? shortDate(left.row.createdAt) : shortDate(right.row.createdAt)}</Text></View>
                  </View>
                </View>
              ))}
            </View>
            <Text style={s.hint}>{T.impactStills}</Text>
            {mixedClubs ? <Text style={s.clubNote} accessibilityRole="alert">{T.differentClubs}</Text> : null}

            <View style={s.card}>
              <View style={s.tr}>
                <Text style={[s.th, s.cLabel]}>{T.check}</Text>
                <Text style={[s.th, s.cVal]}>{shortDate(left.row.createdAt)}</Text>
                <Text style={[s.th, s.cVal]}>{shortDate(right.row.createdAt)}</Text>
                <Text style={[s.th, s.cChange]}>{T.change}</Text>
              </View>
              {result.groups.map((g) => (
                <View key={g.cp}>
                  <Text style={s.phase}>{g.name}</Text>
                  {g.rows.map((r) => {
                    const word = T.changeWord[r.change];
                    return (
                      <View
                        key={r.key}
                        style={s.tr}
                        accessible
                        accessibilityLabel={T.rowLabel(r.label, r.a.text, r.b.text, word)}
                      >
                        <Text style={[s.label, s.cLabel]}>{r.label}</Text>
                        <View style={[s.cVal, s.valCell]}>
                          <View style={[s.dot, { backgroundColor: tone[r.a.status] }]} />
                          <Text style={s.value}>{r.a.text}</Text>
                        </View>
                        <View style={[s.cVal, s.valCell]}>
                          <View style={[s.dot, { backgroundColor: tone[r.b.status] }]} />
                          <Text style={s.value}>{r.b.text}</Text>
                        </View>
                        <View style={s.cChange}>
                          <Text style={[s.changeWord, { color: changeColor[r.change] }]}>{word}</Text>
                          {r.delta ? <Text style={s.delta}>{r.delta}</Text> : null}
                        </View>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
            {result.counts.unclear ? <Text style={s.hint}>{T.unclearHint}</Text> : null}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

// --- The route --------------------------------------------------------------------------------

async function loadSide(id) {
  if (!getSwing(id)) await hydrateSwings();
  const row = getSwing(id);
  if (!row || row.status !== 'ready') return null;
  const [analysis, probe] = await Promise.all([readAnalysis(id), readProbe(id)]);
  if (!analysis) return null;
  const frame = impactFrame(analysis);
  let stillUri = frame == null ? null : getStill(id, frame);
  if (!stillUri && frame != null) stillUri = (await ensureStills(id, [frame]))[frame] ?? null;
  const aspect = probe?.width && probe?.height ? probe.width / probe.height : 0.75;
  return { row, analysis, stillUri, aspect };
}

export default function SwingCompareScreen({ navigation, route }) {
  useT(); // the swing copy reads the language as it renders: re-render when it changes
  const ids = route?.params?.ids ?? [];
  const [sides, setSides] = useState(null); // [left, right] | 'failed'
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    (async () => {
      const loaded = ids.length === 2 ? await Promise.all(ids.map(loadSide)) : [null, null];
      if (!alive.current) return;
      if (loaded.some((x) => !x)) { setSides('failed'); return; }
      // Newer swing on the left: "what changed" reads the way the golfer asks it.
      setSides([...loaded].sort((a, b) => b.row.createdAt.localeCompare(a.row.createdAt)));
    })();
    return () => { alive.current = false; };
  }, [ids.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const ok = Array.isArray(sides);
  return (
    <SwingCompareView
      left={ok ? sides[0] : null}
      right={ok ? sides[1] : null}
      onBack={() => navigation.goBack()}
      onSwap={() => setSides((cur) => (Array.isArray(cur) ? [cur[1], cur[0]] : cur))}
    />
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, gap: 8 },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  headerSpacer: { width: 36, height: 36 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 28, gap: 12 },

  hero: { backgroundColor: theme.bg.deep, borderRadius: theme.radius.lg, padding: 16, gap: 4 },
  overline: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)' },
  verdict: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 26, lineHeight: 32, color: '#ffffff' },
  why: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12.5, lineHeight: 18, color: 'rgba(255,255,255,0.88)' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11.5, color: '#ffffff' },

  stills: { flexDirection: 'row', gap: 10 },
  colName: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12.5, color: theme.text.primary, marginBottom: 6 },
  stillBox: { borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: '#0a0d10', alignItems: 'center', justifyContent: 'center' },
  still: { ...StyleSheet.absoluteFillObject },
  noStill: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: 'rgba(255,255,255,0.7)' },
  stillTag: { position: 'absolute', left: 8, bottom: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  stillTagText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 11, color: '#ffffff' },
  clubNote: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.primary, lineHeight: 17 },
  hint: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11.5, color: theme.text.secondary, lineHeight: 16 },

  card: {
    backgroundColor: theme.bg.card, borderRadius: theme.radius.lg, padding: 12, gap: 2,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
  },
  tr: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingVertical: 4 },
  th: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: theme.text.secondary },
  phase: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: theme.text.secondary, marginTop: 10, marginBottom: 2 },
  cLabel: { flex: 1 },
  cVal: { width: 62 },
  cChange: { width: 58, alignItems: 'flex-end' },
  valCell: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12.5, lineHeight: 16, color: theme.text.primary },
  value: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12.5, color: theme.text.primary, fontVariant: ['tabular-nums'] },
  changeWord: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12 },
  delta: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10.5, color: theme.text.secondary, fontVariant: ['tabular-nums'] },
});
