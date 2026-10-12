import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { hud } from '../../theme/tokens';

// Down-the-line set-up silhouette for the capture preview (plan S2, R5): our own drawing, a
// golfer at address seen from behind the hands, ball on the right for a right-hander (the
// golfer's back to the left edge), mirrored for left-handers. The box is where the whole body
// and the club should fit; the room above the head is for the top of the swing.
//
// Drawn in a 360 × 640 (9:16) box over exactly the recorded picture (previewRect), so the box
// means the same on every phone. The box stays in the upper part, clear of the record controls.
const SHADOW = 'rgba(4,6,8,0.45)';

// Golfer at address (head is the circle at 196,120): spine tilted from the hips with the seat
// back, flexed legs and feet, arms hanging under the shoulders, club from the hands to the ball.
const FIGURE = [
  'M182 146 L128 262 Q108 268 116 284',
  'M128 262 L152 348 L140 440 L172 446',
  'M120 276 L140 352 L128 442 L158 448',
  'M184 152 L198 222 L204 282',
  'M204 282 L270 434',
];

export default function CaptureGuide({ rect, left = false, label }) {
  if (!rect || !rect.width || !rect.height) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { left: rect.x, top: rect.y, width: rect.width, height: rect.height }]}>
      <Svg width="100%" height="100%" viewBox="0 0 360 640" preserveAspectRatio="xMidYMid meet">
        <Rect x={70} y={70} width={240} height={400} rx={16} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={1.5} />
        <G transform={left ? 'translate(380 0) scale(-1 1)' : undefined} fill="none" strokeLinecap="round" strokeLinejoin="round">
          {/* a soft dark underlay keeps the dashes visible on bright backgrounds */}
          {FIGURE.map((d) => <Path key={`u${d}`} d={d} stroke={SHADOW} strokeWidth={4.5} />)}
          {FIGURE.map((d) => <Path key={d} d={d} stroke="rgba(255,255,255,0.85)" strokeWidth={2.5} strokeDasharray="7 6" />)}
          <Circle cx={196} cy={120} r={17} stroke={SHADOW} strokeWidth={4.5} />
          <Circle cx={196} cy={120} r={17} stroke="rgba(255,255,255,0.85)" strokeWidth={2.5} strokeDasharray="7 6" />
          <Circle cx={277} cy={440} r={6} stroke="rgba(255,255,255,0.85)" strokeWidth={2} />
        </G>
      </Svg>
      {label ? (
        <View style={[styles.labelRow, { top: rect.height * (40 / 640) }]}>
          <Text style={styles.label}>{label}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute' },
  labelRow: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  label: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 11.5, color: hud.textSoft, backgroundColor: hud.scrim,
    borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, overflow: 'hidden',
  },
});
