import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { withAlpha } from '../../theme/alpha';
import { formatNumber } from '../../i18n/format';
import { SWING_STRINGS } from '../../swing/strings';
import { CHECKPOINT_DEFS } from '../../swing/checkpoints';
import { markedKeysOf } from '../../swing/markPass';

const T = SWING_STRINGS.results;
const ORDER = ['reading', 'pose', 'planes'];
const TICKS = 60;
const P_OF = Object.fromEntries(CHECKPOINT_DEFS.map((d) => [d.key, d.p]));

const secsOf = (probe) => (probe?.durationMs > 0 ? probe.durationMs / 1000 : null);
const fpsOf = (probe) => Math.round(probe?.captureFps ?? probe?.containerFps ?? 0) || null;
const sec = (v, decimals) => formatNumber(v, { decimals });

/** Axis labels at real positions on the clip: every 0.5, 1 or 2 s, and the clip's end. */
function axisMarks(secs) {
  const step = secs <= 3 ? 0.5 : secs <= 6 ? 1 : 2;
  const marks = [];
  for (let t = 0; t < secs - step * 0.6; t += step) marks.push(t);
  return marks;
}

/**
 * The analysis wait (plan: Swing analyzer, processing view). The clip is drawn as a strip that
 * fills frame by frame: pose frames arrive in decode order, so the playhead is where the phone is
 * in the clip. Below it the three stages, and the six positions the marking pass asks for next.
 * `progress` is runAnalysis's `{ stage, done, total, probe }`.
 */
export default function SwingProcessing({ progress }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const stage = progress?.stage ?? 'reading';
  const marked = markedKeysOf(progress?.view); // down the line until the first pass says the view
  const at = Math.max(0, ORDER.indexOf(stage));
  const total = progress?.total ?? 0;
  const done = progress?.done ?? 0;
  const posing = stage === 'pose' && total > 0;
  const f = stage === 'planes' ? 1 : posing ? Math.min(1, done / total) : 0;
  const probe = progress?.probe;
  const secs = secsOf(probe);
  const fps = fpsOf(probe);
  const on = Math.round(TICKS * f);
  const frames = posing ? done : stage === 'planes' && total ? total : null;
  const a11y = posing && secs ? T.timelineA11y(sec(secs * f, 2), sec(secs, 2), done, total) : T.stages[stage];

  return (
    <View style={s.wrap} testID="results-processing">
      <Text style={s.title} accessibilityRole="header">{T.processingTitle}</Text>
      <View style={s.stageLine} accessibilityLiveRegion="polite">
        <Text style={s.stageName}>{T.stages[stage]}</Text>
        <Text style={s.stepOf}>{T.stepOf(at + 1, ORDER.length)}</Text>
      </View>

      <View style={s.strip} accessible accessibilityRole="progressbar" accessibilityLabel={a11y} testID="processing-timeline">
        <View style={s.reel}>
          <View style={[s.wash, { width: `${f * 100}%` }]} />
          <View style={s.ticks}>
            {Array.from({ length: TICKS }, (_, i) => (
              <View key={i} style={[s.tick, i % 12 === 0 && s.tickTall, i < on && s.tickOn]} />
            ))}
          </View>
          {f > 0 ? <View style={[s.head, { left: `${f * 100}%` }]} /> : null}
        </View>
        {posing && secs ? (
          <View style={[s.flagSlot, { left: `${f * 100}%` }]} pointerEvents="none">
            <Text style={s.flag}>{T.secs(sec(secs * f, 2))}</Text>
          </View>
        ) : null}
        {secs ? (
          <View style={s.axis}>
            {axisMarks(secs).map((t) => (
              <Text key={t} style={[s.axisText, t === 0 ? s.axisFirst : s.axisMid, t > 0 && { left: `${(t / secs) * 100}%` }]}>
                {sec(t, t === 0 ? 0 : 1)}
              </Text>
            ))}
            <Text style={[s.axisText, s.axisEnd]}>{T.secs(sec(secs, 1))}</Text>
          </View>
        ) : null}
      </View>

      <View style={s.stats}>
        <Stat s={s} value={frames ?? '—'} label={T.statFrames} />
        <Stat s={s} value={fps ?? '—'} label={T.statFps} />
        <Stat s={s} value={secs ? T.secs(sec(secs, 1)) : '—'} label={T.statClip} />
      </View>

      <View style={s.steps}>
        {ORDER.map((k, i) => {
          const fill = i < at ? 1 : i > at ? 0 : k === 'pose' ? f : 0.5;
          return (
            <View key={k} style={s.step}>
              <View style={s.stepBar}><View style={[s.stepFill, { width: `${fill * 100}%` }]} /></View>
              <Text style={[s.stepText, i > at && s.stepTodo]}>{T.stages[k]}</Text>
            </View>
          );
        })}
      </View>

      <View style={s.next} testID="processing-up-next">
        <Text style={s.overline}>{T.upNext}</Text>
        <Text style={s.nextTitle}>{T.upNextTitle(marked.length)}</Text>
        <Text style={s.nextBody}>{T.upNextBody}</Text>
        <View style={s.positions}>
          {marked.map((k) => (
            <View key={k} style={s.position}>
              <Text style={s.posP}>{P_OF[k]}</Text>
              <Text style={s.posName}>{SWING_STRINGS.checkpoint[k]}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={s.privacy}>
        <Feather name="lock" size={14} color={theme.text.secondary} style={s.privacyIcon} />
        <Text style={s.privacyText}>{SWING_STRINGS.privacy}</Text>
      </View>
    </View>
  );
}

function Stat({ s, value, label }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: { gap: 12, paddingTop: 4 },
  title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 26, lineHeight: 32, color: theme.text.primary },
  stageLine: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: -4 },
  stageName: { flex: 1, fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.primary },
  stepOf: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.secondary, fontVariant: ['tabular-nums'] },

  strip: { marginTop: 28 },
  reel: {
    height: 78, borderRadius: 10, overflow: 'hidden', justifyContent: 'center', paddingHorizontal: 6,
    backgroundColor: theme.bg.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
  },
  wash: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: theme.accent.light },
  ticks: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  tick: { flex: 1, height: 44, borderRadius: 2, backgroundColor: withAlpha(theme.text.primary, 0.14) },
  tickTall: { height: 58 },
  tickOn: { backgroundColor: theme.accent.primary },
  head: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1, backgroundColor: theme.text.primary },
  flagSlot: { position: 'absolute', top: -26, width: 72, marginLeft: -36, alignItems: 'center' },
  flag: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 11, color: theme.bg.primary, backgroundColor: theme.text.primary,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, overflow: 'hidden', fontVariant: ['tabular-nums'],
  },
  axis: { height: 16, marginTop: 6, marginHorizontal: 6 },
  axisText: { position: 'absolute', top: 0, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11, color: theme.text.secondary, fontVariant: ['tabular-nums'] },
  axisFirst: { left: 0 },
  axisMid: { width: 32, marginLeft: -16, textAlign: 'center' },
  axisEnd: { right: 0 },

  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1 },
  statValue: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 17, color: theme.text.primary, fontVariant: ['tabular-nums'] },
  statLabel: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11, color: theme.text.secondary },

  steps: { flexDirection: 'row', gap: 6 },
  step: { flex: 1, gap: 6 },
  stepBar: { height: 3, borderRadius: 2, backgroundColor: theme.bg.secondary, overflow: 'hidden' },
  stepFill: { height: 3, backgroundColor: theme.accent.primary },
  stepText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11, lineHeight: 15, color: theme.text.primary },
  stepTodo: { color: theme.text.secondary },

  next: {
    backgroundColor: theme.bg.card, borderRadius: theme.radius.lg, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6, gap: 4,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
  },
  overline: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: theme.text.secondary },
  nextTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: theme.text.primary },
  nextBody: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, lineHeight: 18, color: theme.text.secondary },
  positions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, marginTop: 6 },
  position: {
    width: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border.default,
  },
  posP: { width: 20, fontFamily: 'PlusJakartaSans-Bold', fontSize: 11, color: theme.text.secondary, fontVariant: ['tabular-nums'] },
  posName: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, lineHeight: 17, color: theme.text.primary },

  privacy: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  privacyIcon: { marginTop: 1 },
  privacyText: { flex: 1, fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, lineHeight: 17, color: theme.text.secondary },
});
