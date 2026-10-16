import React from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import Svg, {
  G, Line, Circle, Rect, Polyline, Text as SvgText,
} from 'react-native-svg';
import { SWING_STRINGS } from '../../swing/strings';
import { extendToEdge } from '../../swing/highlights';
import { hud } from '../../theme/tokens';

// The still of a checkpoint with everything drawn on it (design B): pose skeleton, hands
// square, clubhead (dot when placed, dashed ring when estimated), ball ring, the address
// planes and the drawing of the selected measure. Used by Results and Edit marks (and
// Compare later). Everything arrives in coordinates normalised to the decoded frame; the
// still is contain-fit into the box, so the drawing always sits on the picture.
//
// It draws on photographs, so the palette is the fixed HUD one, not the theme.

const ACCENT = '#4fae8a';
const WHITE = '#ffffff';
const INK = '#0a0d10';
const HIGHLIGHT = '#ffd98a';
const SOFT = '#cfe3d5';
const DEFAULT_TONE = '#f87171';

const BONES = [[11, 12], [23, 24], [11, 23], [12, 24], [23, 25], [25, 27], [24, 26], [26, 28], [11, 13], [13, 15], [12, 14], [14, 16]];
const JOINTS = [11, 12, 13, 14, 23, 24, 25, 26, 27, 28];
const NOSE = 0;
const MIN_VIS = 0.2;

/** The rect the frame occupies inside a box of boxW x boxH (contain fit), in view px. */
export function fitRect(boxW, boxH, videoW, videoH) {
  if (!boxW || !boxH || !videoW || !videoH) return { x: 0, y: 0, w: boxW || 0, h: boxH || 0 };
  const s = Math.min(boxW / videoW, boxH / videoH);
  const w = videoW * s;
  const h = videoH * s;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

function Label({ x, y, text, anchor = 'start', color = WHITE }) {
  const common = {
    x, y, fontSize: 10.5, fontWeight: '700', fontFamily: 'PlusJakartaSans-Bold', textAnchor: anchor,
  };
  return (
    <>
      <SvgText {...common} stroke={INK} strokeWidth={3} strokeLinejoin="round" fill={INK}>{text}</SvgText>
      <SvgText {...common} fill={color}>{text}</SvgText>
    </>
  );
}

// A plane's name sits just inside the frame where the line leaves it.
function PlaneLabel({ p, X, Y, w, text, color }) {
  const right = X(p[0]) > w / 2;
  return <Label x={X(p[0]) + (right ? -6 : 6)} y={Math.min(Y(p[1]) + 16, Y(1) - 8)} text={text} anchor={right ? 'end' : 'start'} color={color} />;
}

export default function SwingOverlay({
  width, height, video, uri = null, pose = null, club = null, ball = null, reference = null,
  highlight = [], keyLines = null, keyTone = HIGHLIGHT, showPlanes = true, edit = false, focus = false, tone = DEFAULT_TONE, label, style, children, resizeMethod,
}) {
  const r = fitRect(width, height, video?.width, video?.height);
  const X = (x) => x * r.w;
  const Y = (y) => y * r.h;
  const lm = (i) => {
    const p = pose?.[i];
    return p && p[2] >= MIN_VIS ? [X(p[0]), Y(p[1])] : null;
  };
  const dash = '4 3';
  const handHalf = edit ? 14 : 8;
  const headR = edit ? 10 : 7;
  const labelAnchor = (x) => (x > r.w * 0.62 ? 'end' : 'start');

  const hands = club?.hands ? [X(club.hands[0]), Y(club.hands[1])] : null;
  const head = club?.head ? [X(club.head[0]), Y(club.head[1])] : null;
  const prior = !head && club?.priorHead ? [X(club.priorHead[0]), Y(club.priorHead[1])] : null;

  const planes = showPlanes && !focus && reference?.ball && reference.handsAddress && reference.trailShoulder ? (() => {
    const b = reference.ball;
    const e1 = extendToEdge(b, reference.handsAddress);
    const e2 = extendToEdge(b, reference.trailShoulder);
    return { b, e1, e2 };
  })() : null;

  const showShaft = !keyLines || keyLines.shaft;
  const showShoulder = !keyLines || keyLines.shoulder;

  // One drawing primitive; `c` = { color, w, d, text } decides how it looks (in focus the status
  // colour and the green target, otherwise the highlight / key-line colours).
  // A dark halo under every stroke, so a line stays readable on grass, sky or a dark shirt.
  const halo = (key, el, w) => (
    <G key={key}>
      {React.cloneElement(el, { stroke: INK, strokeOpacity: 0.55, strokeWidth: w + 2.5, strokeDasharray: undefined })}
      {el}
    </G>
  );
  const drawPrim = (h, key, c) => {
    const el = strokeOf(h, c);
    if (!el) return null;
    return h.t === 'dot' || h.t === 'label' ? <G key={key}>{el}</G> : halo(key, el, c.w);
  };
  const strokeOf = (h, c) => {
    switch (h.t) {
      case 'line': return <Line x1={X(h.a[0])} y1={Y(h.a[1])} x2={X(h.b[0])} y2={Y(h.b[1])} stroke={c.color} strokeWidth={c.w} strokeDasharray={c.d} />;
      case 'circle': return <Circle cx={X(h.c[0])} cy={Y(h.c[1])} r={X(h.r)} fill="none" stroke={c.color} strokeWidth={c.w} strokeDasharray={c.d} />;
      case 'rect': return <Rect x={X(h.c[0]) - X(h.half)} y={Y(h.c[1]) - X(h.half)} width={X(h.half) * 2} height={X(h.half) * 2} fill="none" stroke={c.color} strokeWidth={c.w} strokeDasharray={c.d} />;
      case 'dot': return <Circle cx={X(h.c[0])} cy={Y(h.c[1])} r={4} fill={c.color} />;
      case 'poly': return <Polyline points={h.pts.map((p) => `${X(p[0])},${Y(p[1])}`).join(' ')} fill="none" stroke={c.color} strokeWidth={c.w} strokeDasharray={c.d} />;
      case 'label': return <Label x={X(h.at[0])} y={Y(h.at[1]) + 4} text={h.text} anchor={labelAnchor(X(h.at[0]))} color={c.text} />;
      default: return null;
    }
  };

  return (
    <View style={[styles.box, { width, height }, style]}>
      <View style={[styles.frame, { left: r.x, top: r.y, width: r.w, height: r.h }]}>
        {uri ? (
          // the marking canvas passes resizeMethod "scale": decoded once at full size and scaled by the
          // GPU, so its loupe (DragLoupe, same uri) reuses this bitmap instead of decoding it again
          <Image source={{ uri }} style={{ width: r.w, height: r.h }} resizeMode="stretch" resizeMethod={resizeMethod} accessibilityLabel={label} accessibilityIgnoresInvertColors />
        ) : (
          <View style={[styles.none, { width: r.w, height: r.h }]} accessibilityLabel={label}>
            <Text style={styles.noneText}>{SWING_STRINGS.results.noStill}</Text>
          </View>
        )}
        <Svg width={r.w} height={r.h} style={StyleSheet.absoluteFill} pointerEvents="none">
          {planes ? (
            <>
              {showShaft ? halo('ps', <Line x1={X(planes.b[0])} y1={Y(planes.b[1])} x2={X(planes.e1[0])} y2={Y(planes.e1[1])} stroke={ACCENT} strokeWidth={2} />, 2) : null}
              {showShoulder ? halo('pu', <Line x1={X(planes.b[0])} y1={Y(planes.b[1])} x2={X(planes.e2[0])} y2={Y(planes.e2[1])} stroke={SOFT} strokeWidth={2} strokeDasharray="5 4" />, 2) : null}
              {showShaft && reference.shaftPlaneDeg != null ? <PlaneLabel p={planes.e1} X={X} Y={Y} w={r.w} text={SWING_STRINGS.overlay.shaftPlane(reference.shaftPlaneDeg)} color={ACCENT} /> : null}
              {showShoulder && reference.shoulderPlaneDeg != null ? <PlaneLabel p={planes.e2} X={X} Y={Y} w={r.w} text={SWING_STRINGS.overlay.shoulderPlane(reference.shoulderPlaneDeg)} color={SOFT} /> : null}
            </>
          ) : null}

          {pose ? (
            <>
              {BONES.map(([a, b]) => {
                const p = lm(a);
                const q = lm(b);
                if (!p || !q) return null;
                return focus
                  ? <Line key={`${a}-${b}`} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={WHITE} strokeOpacity={0.28} strokeWidth={1.5} />
                  : <Line key={`${a}-${b}`} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={ACCENT} strokeWidth={2} />;
              })}
              {focus ? null : JOINTS.map((j) => {
                const p = lm(j);
                return p ? <Circle key={j} cx={p[0]} cy={p[1]} r={3} fill={WHITE} stroke={ACCENT} strokeWidth={1.5} /> : null;
              })}
              {!focus && lm(NOSE) ? <Circle cx={lm(NOSE)[0]} cy={lm(NOSE)[1]} r={X(0.04)} fill="none" stroke={ACCENT} strokeWidth={1.5} /> : null}
            </>
          ) : null}

          {!focus ? (keyLines?.extra ?? []).map((h, k) => {
            const target = h.role === 'target';
            return drawPrim(h, `k${k}`, {
              color: target ? ACCENT : keyTone, w: target ? 2 : 2.5, d: h.dash ? dash : undefined, text: WHITE,
            });
          }) : null}

          {highlight.map((h, k) => {
            const target = focus && h.role === 'target';
            return drawPrim(h, `h${k}`, {
              color: focus ? (target ? ACCENT : tone) : HIGHLIGHT,
              w: focus ? (target ? 2.5 : 3) : 2,
              d: h.dash && (!focus || target) ? dash : undefined,
              text: focus ? WHITE : HIGHLIGHT,
            });
          })}

          {ball ? <Circle cx={X(ball[0])} cy={Y(ball[1])} r={Math.max(10, X(ball[2]) + 4)} fill="none" stroke={WHITE} strokeWidth={2} /> : null}

          {hands && focus && head ? <Line x1={hands[0]} y1={hands[1]} x2={head[0]} y2={head[1]} stroke={WHITE} strokeOpacity={0.35} strokeWidth={1.5} /> : null}
          {hands && !focus ? (
            <>
              {head ? <Line x1={hands[0]} y1={hands[1]} x2={head[0]} y2={head[1]} stroke="rgba(255,255,255,0.7)" strokeWidth={2} /> : null}
              <Rect x={hands[0] - handHalf} y={hands[1] - handHalf} width={handHalf * 2} height={handHalf * 2} fill="rgba(79,174,138,0.35)" stroke={WHITE} strokeWidth={2} />
              {edit ? <Circle cx={hands[0]} cy={hands[1]} r={22} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="3 3" /> : null}
            </>
          ) : null}
          {!focus && head && club?.source === 'user' ? <Circle cx={head[0]} cy={head[1]} r={headR} fill={WHITE} stroke={INK} strokeWidth={1.5} /> : null}
          {!focus && head && club?.source !== 'user' ? (
            <>
              <Circle cx={head[0]} cy={head[1]} r={headR} fill="none" stroke={WHITE} strokeWidth={2} strokeDasharray="3 2" />
              <Label x={head[0] + 14} y={head[1] + 4} text={SWING_STRINGS.results.estimated} />
            </>
          ) : null}
          {!focus && head && edit ? <Circle cx={head[0]} cy={head[1]} r={22} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="3 3" /> : null}
          {!focus && prior ? <Circle cx={prior[0]} cy={prior[1]} r={headR} fill="none" stroke={WHITE} strokeWidth={2} strokeDasharray="3 2" /> : null}
          {!focus && club?.hidden && hands ? <Label x={hands[0] + 22} y={hands[1] + 18} text={SWING_STRINGS.results.clubHidden} /> : null}
        </Svg>
        {focus ? (
          <View style={styles.legend} pointerEvents="none" testID="overlay-legend">
            <View style={[styles.swatch, { backgroundColor: tone }]} />
            <Text style={styles.legendText}>{SWING_STRINGS.results.fixes.legendYou}</Text>
            <View style={[styles.swatch, styles.swatchDash, { borderColor: ACCENT }]} />
            <Text style={styles.legendText}>{SWING_STRINGS.results.fixes.legendTarget}</Text>
          </View>
        ) : null}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: '#0a0d10', overflow: 'hidden' },
  frame: { position: 'absolute' },
  none: { backgroundColor: '#1b2420', alignItems: 'center', justifyContent: 'center' },
  legend: {
    position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: hud.scrimStrong, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  swatch: { width: 16, height: 3, borderRadius: 1.5 },
  swatchDash: { height: 0, borderTopWidth: 2.5, borderStyle: 'dashed', backgroundColor: 'transparent', borderRadius: 0 },
  legendText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10.5, color: WHITE, marginRight: 6 },
  noneText: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: '#9fb0a4' },
});
