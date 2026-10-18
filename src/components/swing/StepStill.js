import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import PressableScale from '../ui/PressableScale';
import SwingOverlay, { fitRect } from './SwingOverlay';
import { hud } from '../../theme/tokens';
import { SWING_STRINGS } from '../../swing/strings';
import { swipeDir } from '../../swing/resultsSteps';

const R = SWING_STRINGS.results;
const TARGET_R = 20;

/**
 * The still of the position on screen, with the two gestures of design D: a horizontal swipe steps to the
 * neighbouring position (one Pan; ‹ › stay the non-gesture path), and, in place mode, a tap puts the
 * clubhead there (the dashed dot the detector was unsure about is a target ring: tap it, or "Confirm the
 * dot", to accept it). Two taps from the summary's place line, one when the screen opens in place mode.
 * It draws on a photograph, so the palette is the fixed HUD one.
 */
export default function StepStill({
  overlay, placing = false, proposal = null, toast = null, stepLabel, frame, onSwipe, onPlacePoint, onConfirmProposal, onOpenEdit,
}) {
  const { width, height, video } = overlay;
  const rect = useMemo(() => fitRect(width, height, video?.width, video?.height), [width, height, video]);
  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-16, 16])
      .failOffsetY([-14, 14])
      .onEnd((e) => { const d = swipeDir(e.translationX, e.translationY); if (d) onSwipe?.(d); })
      .withTestId('step-swipe');
    if (!placing) return pan;
    const tap = Gesture.Tap()
      .runOnJS(true)
      .maxDuration(700)
      .maxDistance(10) // a fling is not a placement
      .onEnd((e, ok) => {
        if (!ok || !rect.w || !rect.h) return;
        const x = Math.min(1, Math.max(0, e.x / rect.w));
        const y = Math.min(1, Math.max(0, e.y / rect.h));
        // a tap on the ring around the proposed dot accepts it as it is
        if (proposal && Math.hypot(x * rect.w - proposal[0] * rect.w, y * rect.h - proposal[1] * rect.h) <= TARGET_R + 8) onConfirmProposal?.();
        else onPlacePoint?.([x, y]);
      })
      .withTestId('place-tap');
    return Gesture.Race(pan, tap);
  }, [placing, rect.w, rect.h, proposal, onSwipe, onPlacePoint, onConfirmProposal]);

  return (
    <View style={s.wrap}>
      <SwingOverlay {...overlay}>
        <GestureDetector gesture={gesture}>
          <View style={StyleSheet.absoluteFill} testID="step-touch-layer" accessible={placing} accessibilityLabel={placing ? R.tapWhereA11y(stepLabel, frame) : undefined} />
        </GestureDetector>
        {placing && proposal ? (
          <Svg width={rect.w} height={rect.h} style={StyleSheet.absoluteFill} pointerEvents="none">
            <Circle cx={proposal[0] * rect.w} cy={proposal[1] * rect.h} r={TARGET_R} fill="none" stroke={hud.accent} strokeWidth={2.5} strokeDasharray="5 4" />
          </Svg>
        ) : null}
      </SwingOverlay>
      {toast ? <View style={s.toast} pointerEvents="box-none" testID="step-toast">{toast}</View> : null}
      {placing ? (
        <View style={s.place} pointerEvents="box-none" testID="place-box">
          <View style={s.box}>
            <Text style={s.boxText}>{`${R.tapWhere} · ${R.frameShort(frame)}`}</Text>
            {proposal ? (
              <PressableScale style={s.hb} onPress={onConfirmProposal} accessibilityRole="button" accessibilityLabel={R.confirmDot} testID="place-confirm">
                <Text style={s.hbText}>{R.confirmDot}</Text>
              </PressableScale>
            ) : null}
          </View>
          <View style={[s.box, s.boxGhost]}>
            <Text style={s.hint}>{R.swipeHint}</Text>
            <PressableScale style={s.link} onPress={onOpenEdit} accessibilityRole="button" accessibilityLabel={R.openEdit} testID="place-open-edit">
              <Text style={s.linkText}>{`${R.openEdit} ›`}</Text>
            </PressableScale>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { borderRadius: 14, overflow: 'hidden', alignItems: 'center', backgroundColor: '#0a0d10' },
  toast: { position: 'absolute', left: 8, right: 8, top: 8 },
  place: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 10, gap: 6 },
  box: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: hud.scrimStrong, borderWidth: 1, borderColor: hud.line, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, minHeight: 44,
  },
  boxGhost: { justifyContent: 'space-between' },
  boxText: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, lineHeight: 16, color: hud.text },
  hb: { minHeight: 36, borderRadius: 18, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: hud.accent },
  hbText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 11.5, color: hud.onAccent },
  hint: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11, color: hud.textSoft },
  link: { minHeight: 44, justifyContent: 'center', flexShrink: 0 },
  linkText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 11.5, color: hud.accent },
});
