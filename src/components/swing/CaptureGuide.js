import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { hud } from '../../theme/tokens';

// Down-the-line set-up silhouette for the capture preview (plan S2, R5): our own drawing, a
// golfer at address seen from behind the hands, ball on the right for a right-hander (the
// golfer's back to the left edge), mirrored for left-handers. The box is where the whole body
// and the club should fit; the room above the head is for the top of the swing.
//
// Drawn in a 360 × 640 (9:16) box over exactly the recorded picture (previewRect), so the box
// means the same on every phone.
export default function CaptureGuide({ rect, left = false, label }) {
  if (!rect || !rect.width || !rect.height) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { left: rect.x, top: rect.y, width: rect.width, height: rect.height }]}>
      <Svg width="100%" height="100%" viewBox="0 0 360 640" preserveAspectRatio="xMidYMid meet">
        <Rect x={40} y={92} width={280} height={500} rx={16} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={1.5} />
        {label ? (
          <SvgText x={180} y={80} textAnchor="middle" fontSize={13} fontWeight="700" fill={hud.textSoft}>{label}</SvgText>
        ) : null}
        <G
          transform={left ? 'translate(360 0) scale(-1 1)' : undefined}
          fill="none"
          stroke="rgba(255,255,255,0.75)"
          strokeWidth={2.5}
          strokeDasharray="7 6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* head, tilted toward the ball */}
          <Circle cx={176} cy={196} r={19} />
          {/* spine: neck down and back to the hips */}
          <Path d="M168 222 L120 352" />
          {/* seat */}
          <Path d="M120 352 Q100 366 112 388" />
          {/* legs, knees flexed */}
          <Path d="M124 372 L150 450 L138 552" />
          <Path d="M118 380 L132 456 L116 556" />
          {/* feet */}
          <Path d="M138 552 L170 556" />
          <Path d="M116 556 L146 560" />
          {/* arms hanging from the shoulder to the hands */}
          <Path d="M172 232 L196 300 L206 352" />
          {/* club: hands down to the ball */}
          <Path d="M206 352 L282 546" />
        </G>
        <Circle cx={left ? 360 - 288 : 288} cy={552} r={7} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={2} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute' },
});
