import React from 'react';
import { View } from 'react-native';
import Svg, { Line, Circle, G } from 'react-native-svg';

// The six reference pictograms (D26, design V3): our own line drawings of the target shape at each
// marked position, seen down the line. The part the rule is about is drawn in the accent colour;
// the "parallel" rules (lead arm, shaft down, shaft through) add a dashed level line. They are
// schematic on purpose, and decorative: the stop line and the chapter carry the meaning, so they
// are hidden from screen readers rather than announced twice.
// Points are in the design's 320x340 box (viewBox "20 90 320 340"), for a right-handed golfer.

const BOX = '20 90 320 340';
const MIRROR_AXIS = 360; // x -> 360 - x flips the 20..340 box onto itself
const BALL = [124, 404];
const GROUND = [[40, 412], [320, 412]];

// head, shoulder, hip, knee, ankle, elbow, hands, club (clubhead end, null = no club),
// seg = the part drawn in accent, level = the point whose height the dashed line marks.
const SHAPES = {
  address: {
    head: [176, 150], sh: [190, 182], hip: [244, 268], knee: [240, 340], ank: [240, 400], elb: [178, 238], hands: [178, 292], club: [98, 398], seg: 'club', ball: false,
  },
  leadArm: {
    head: [176, 150], sh: [194, 186], hip: [248, 268], knee: [242, 340], ank: [240, 400], elb: [220, 188], hands: [250, 188], club: [291, 120], seg: 'arm', level: 'sh', ball: false,
  },
  top: {
    head: [178, 152], sh: [198, 188], hip: [250, 268], knee: [244, 340], ank: [240, 400], elb: [236, 168], hands: [262, 150], club: [334, 116], seg: 'club', ball: false,
  },
  shaftDown: {
    head: [178, 152], sh: [194, 184], hip: [240, 262], knee: [240, 340], ank: [240, 400], elb: [214, 236], hands: [232, 266], club: [302, 266], seg: 'club', level: 'hands', ball: false,
  },
  impact: {
    head: [182, 148], sh: [192, 176], hip: [232, 262], knee: [232, 338], ank: [240, 400], elb: [184, 228], hands: [176, 276], club: [108, 398], seg: 'club', ball: true,
  },
  shaftThrough: {
    head: [182, 148], sh: [192, 176], hip: [230, 262], knee: [232, 338], ank: [240, 400], elb: [160, 212], hands: [122, 236], club: [50, 238], seg: 'club', level: 'hands', ball: false,
  },
};

export const PICTOGRAM_KEYS = Object.keys(SHAPES);

const flip = (p) => [MIRROR_AXIS - p[0], p[1]];

/**
 * `swingKey` is one of the six marked positions. `color` draws the quiet parts, `accent` the part
 * the rule is about (and the level line and ball). `mirror` flips it for a left-handed golfer.
 */
export default function Pictogram({
  swingKey, size = 40, color, accent, mirror = false, testID,
}) {
  const sh = SHAPES[swingKey];
  if (!sh) return null;
  const pt = (p) => (mirror ? flip(p) : p);
  const seg = (a, b, stroke, w, dashed) => {
    const [x1, y1] = pt(a);
    const [x2, y2] = pt(b);
    return (
      <Line
        x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={w} strokeLinecap="round"
        strokeDasharray={dashed ? '10 8' : undefined}
      />
    );
  };
  const body = color;
  const arm = sh.seg === 'arm' ? accent : color;
  const club = sh.seg === 'club' ? accent : color;
  const head = pt(sh.head);
  const clubEnd = sh.club ? pt(sh.club) : null;
  const ball = pt(BALL);
  const levelY = sh.level ? sh[sh.level][1] : null;
  return (
    <View
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID ?? `pictogram-${swingKey}`}
    >
      <Svg width={size} height={size} viewBox={BOX}>
        <G>
          {seg(GROUND[0], GROUND[1], color, 5, true)}
          {seg(sh.sh, sh.hip, body, 16)}
          {seg(sh.hip, sh.knee, body, 14)}
          {seg(sh.knee, sh.ank, body, 14)}
          <Circle cx={head[0]} cy={head[1]} r={18} fill="none" stroke={body} strokeWidth={12} />
          {seg(sh.sh, sh.elb, arm, 13)}
          {seg(sh.elb, sh.hands, arm, 13)}
          {sh.club ? seg(sh.hands, sh.club, club, 9) : null}
          {clubEnd ? <Circle cx={clubEnd[0]} cy={clubEnd[1]} r={10} fill={club} /> : null}
          {levelY != null ? seg([sh.hands[0] - 70, levelY], [sh.hands[0] + 70, levelY], accent, 5, true) : null}
          {sh.ball ? <Circle cx={ball[0]} cy={ball[1]} r={10} fill={accent} /> : null}
        </G>
      </Svg>
    </View>
  );
}
