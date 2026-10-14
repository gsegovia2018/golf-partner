import React, { useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import BottomSheet from '../BottomSheet';
import IconButton from '../ui/IconButton';
import PressableScale from '../ui/PressableScale';
import SwingOverlay from './SwingOverlay';
import { focusTone } from './swingTone';
import { useTheme } from '../../theme/ThemeContext';
import { SWING_STRINGS } from '../../swing/strings';
import { PROGRESSION } from '../../swing/drills';
import { highlightFor } from '../../swing/highlights';
import { homeOf, frameOfKey } from '../../swing/checkpointChecks';
import { CHECKPOINT_KEYS } from '../../swing/phases';
import { poseAtFrame } from '../../swing/poseAt';

const F = SWING_STRINGS.results.fixes;

/**
 * One fix at a time in a bottom sheet: the focus-mode still, what we saw, why it matters, three
 * steps, the drill, and the way on. `fixes` is [{ check, copy, drill }]; `index` is the one shown.
 */
export default function SwingFixSheet({
  visible, fixes, index, onIndex, onClose, onSeeOnSwing, stillFor, onNeedStills, analysis, pose, width,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { height: winH } = useWindowDimensions();
  const fix = visible ? fixes?.[index] : null;
  const check = fix?.check;
  const key = check ? homeOf(check) : null;
  const frame = check ? frameOfKey(analysis, key) : null;
  const uri = check ? stillFor?.(frame) ?? null : null;
  useEffect(() => { if (check && !uri) onNeedStills?.(frame); }, [check, uri, frame]); // eslint-disable-line react-hooks/exhaustive-deps

  const highlight = useMemo(() => (check ? highlightFor(check, {
    analysis, poseAt: (f) => poseAtFrame(pose, f), frameOf: (k) => frameOfKey(analysis, k),
  }) : []), [check, analysis, pose]);

  const total = fixes?.length ?? 0;
  const last = index >= total - 1;
  const video = pose?.video ?? null;
  const boxH = video ? Math.min(width * (video.height / video.width), winH * 0.4) : width * 0.9;
  const ball = key && CHECKPOINT_KEYS.indexOf(key) <= CHECKPOINT_KEYS.indexOf('impact') && analysis.reference?.ball
    ? [...analysis.reference.ball, pose?.ball?.r ?? 0.012] : null;
  const cpName = key ? SWING_STRINGS.checkpoint[key] : '';

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={s.sheet}>
      {fix ? (
        <ScrollView style={{ maxHeight: winH * 0.88 }} contentContainerStyle={s.content} showsVerticalScrollIndicator={false} testID="fix-sheet">
          <View style={s.top}>
            <Text style={[s.overline, s.flex]}>{F.sheetOverline(index + 1, total, cpName)}</Text>
            <IconButton icon="x" accessibilityLabel={F.close} onPress={onClose} />
          </View>
          <Text style={s.headline} accessibilityRole="header">{fix.copy.headline}</Text>
          <View style={s.still}>
            <SwingOverlay
              width={width}
              height={boxH}
              video={video}
              uri={uri}
              pose={poseAtFrame(pose, frame)}
              club={analysis.clubMarks?.[key] ?? null}
              ball={ball}
              reference={analysis.reference}
              highlight={highlight}
              focus
              tone={focusTone(check.status)}
              label={`${cpName} still, frame ${frame}`}
            />
          </View>
          <Text style={s.saw}>{F.saw(check.text)}</Text>
          <View style={s.block}>
            <Text style={s.overline}>{F.whyTitle}</Text>
            <Text style={s.body}>{fix.copy.cost}</Text>
          </View>
          <View style={s.block}>
            <Text style={s.overline}>{F.howTitle}</Text>
            {fix.copy.steps.map((t, i) => (
              <View key={t} style={s.step} accessible accessibilityLabel={F.stepLabel(i + 1, t)}>
                <View style={s.stepNum}><Text style={s.stepNumText}>{i + 1}</Text></View>
                <Text style={[s.body, s.flex]}>{t}</Text>
              </View>
            ))}
          </View>
          {fix.drill ? (
            <View style={s.drill}>
              <Text style={s.drillTitle}>{F.drill(fix.drill.title)}</Text>
              <Text style={s.goal}>{F.goal(fix.drill.passTarget)}</Text>
              <Text style={s.body}>{fix.drill.instruction}</Text>
              <Text style={s.progress}>{PROGRESSION}</Text>
            </View>
          ) : null}
          <View style={s.btnRow}>
            <PressableScale style={[s.btn, s.btnSecondary, s.flex]} onPress={() => onSeeOnSwing?.(check)} accessibilityRole="button" accessibilityLabel={F.seeOnSwing}>
              <Text style={s.btnSecondaryText}>{F.seeOnSwing}</Text>
            </PressableScale>
            <PressableScale
              style={[s.btn, s.btnPrimary, s.flex]}
              onPress={last ? onClose : () => onIndex(index + 1)}
              accessibilityRole="button"
              accessibilityLabel={last ? F.done : F.next}
            >
              <Text style={s.btnPrimaryText}>{last ? F.done : F.next}</Text>
              {last ? null : <Feather name="chevron-right" size={18} color={theme.text.inverse} />}
            </PressableScale>
          </View>
        </ScrollView>
      ) : null}
    </BottomSheet>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  sheet: { backgroundColor: theme.bg.primary, paddingTop: 12, paddingBottom: 24, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  content: { paddingHorizontal: 20, paddingBottom: 8, gap: 12 },
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  overline: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: theme.text.secondary },
  headline: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, lineHeight: 28, color: theme.text.primary },
  still: { borderRadius: theme.radius.lg, overflow: 'hidden', alignItems: 'center', backgroundColor: '#0a0d10' },
  saw: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12.5, lineHeight: 18, color: theme.text.secondary },
  block: { gap: 6 },
  body: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13.5, lineHeight: 20, color: theme.text.primary },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: theme.accent.primary, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12.5, color: theme.text.inverse },
  drill: {
    backgroundColor: theme.bg.card, borderRadius: theme.radius.lg, padding: 14, gap: 4,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
  },
  drillTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.primary },
  goal: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.accent.primary },
  progress: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11.5, lineHeight: 16, color: theme.text.secondary, fontStyle: 'italic' },
  btnRow: { flexDirection: 'row', gap: 10 },
  btn: { minHeight: 48, borderRadius: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  btnPrimary: { backgroundColor: theme.accent.primary },
  btnPrimaryText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, color: theme.text.inverse },
  btnSecondary: { backgroundColor: theme.bg.secondary, borderWidth: 1, borderColor: theme.border.default },
  btnSecondaryText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.primary },
});
