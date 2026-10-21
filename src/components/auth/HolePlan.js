import React, { useEffect } from 'react';
import Svg, {
  Defs, Pattern, Line, Path, G, Rect, Circle, Text as SvgText,
} from 'react-native-svg';
import Animated, {
  useSharedValue, useAnimatedProps, withDelay, withTiming, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { semantic } from '../../theme/tokens';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedG = Animated.createAnimatedComponent(G);
const EASE = Easing.bezier(0.4, 0, 0.2, 1);

// Cream linework and the muted winner gold, both drawn on bg.deep (same in
// either theme), so the plan never depends on light/dark tokens.
const INK = '#f6f3ee';
const GOLD = semantic.winner.soft;

// Hole 1 in its own 390×410 drawing space. Lengths are precomputed (no
// pathLength: react-native-svg ignores it on Android) so each stroke can draw
// itself in by animating its dash offset.
const FAIRWAY = 'M 140 358 C 122 346, 114 318, 120 290 C 126 260, 146 234, 172 210 C 200 184, 226 160, 248 140 C 262 128, 284 128, 298 138 C 306 146, 300 158, 288 168 C 266 186, 246 204, 242 232 C 238 262, 232 290, 210 314 C 190 336, 162 366, 140 358 Z';
const ROUGH = 'M 132 372 C 104 356, 100 318, 108 284 C 116 250, 138 222, 166 198 C 194 174, 218 150, 240 128 C 258 112, 290 112, 308 128 C 320 142, 314 166, 298 180 C 278 198, 260 214, 256 238 C 250 272, 242 300, 220 326 C 196 352, 164 384, 132 372 Z';
const GREEN = 'M 266 96 C 262 72, 286 56, 314 58 C 342 60, 356 78, 350 100 C 344 120, 316 128, 292 124 C 276 121, 268 110, 266 96 Z';
const COLLAR = 'M 258 96 C 254 66, 284 48, 314 50 C 348 52, 364 76, 357 102 C 350 126, 318 136, 290 132 C 270 129, 260 114, 258 96 Z';
const ROUTE = 'M 112 400 L 196 252 L 312 88';
const BUNKERS = [
  'M 258 216 C 256 204, 270 196, 282 200 C 294 204, 296 220, 286 228 C 276 236, 260 230, 258 216 Z',
  'M 104 238 C 102 228, 112 220, 122 224 C 130 228, 130 240, 122 246 C 114 251, 106 248, 104 238 Z',
  'M 328 128 C 330 118, 344 113, 352 119 C 360 125, 354 137, 344 139 C 334 141, 326 135, 328 128 Z',
  'M 252 62 C 254 52, 266 48, 274 54 C 280 60, 274 70, 264 70 C 256 70, 251 67, 252 62 Z',
];
const POND = 'M 212 114 C 210 100, 224 92, 238 94 C 254 96, 262 106, 258 118 C 254 130, 236 134, 224 130 C 216 127, 213 121, 212 114 Z';
const RIPPLES = 'M 222 108 q 6 -3 12 0 q 6 3 12 0 M 226 118 q 6 -3 12 0 q 6 3 10 0';
const LENGTHS = { fairway: 622, rough: 712, green: 245, collar: 294, route: 372 };

export const PLAN_WIDTH = 390;
export const PLAN_HEIGHT = 410;

// One stroke that draws itself in after `delay` ms.
function DrawPath({ d, length, delay, duration = 2000, reduced, ...props }) {
  const progress = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    progress.value = withDelay(delay, withTiming(1, { duration, easing: EASE }));
  }, [reduced, delay, duration, progress]);
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - progress.value) }));
  if (reduced) return <Path d={d} fill="none" {...props} />;
  return (
    <AnimatedPath
      d={d}
      fill="none"
      strokeDasharray={`${length} ${length}`}
      animatedProps={animatedProps}
      {...props}
    />
  );
}

// A group that fades in after `delay` ms.
function Fade({ delay, reduced, children }) {
  const progress = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    progress.value = withDelay(delay, withTiming(1, { duration: 800, easing: EASE }));
  }, [reduced, delay, progress]);
  const animatedProps = useAnimatedProps(() => ({ opacity: progress.value }));
  if (reduced) return <G>{children}</G>;
  return <AnimatedG animatedProps={animatedProps}>{children}</AnimatedG>;
}

function Label({ x, y, rotate, children }) {
  return (
    <SvgText
      x={x} y={y} transform={`rotate(${rotate} ${x} ${y})`}
      fill={GOLD} fontFamily="PlusJakartaSans-Bold" fontSize={12.5} letterSpacing={1.5}
    >
      {children}
    </SvgText>
  );
}

// The login's architect's plan of a hole: fairway and rough outlines, a gold
// green, hatched bunkers, a pond, the tee and the route of play with its two
// distances. It draws itself in once on mount (reduced motion ⇒ drawn) and
// then stays still. Decorative: hidden from screen readers.
export default function HolePlan({ width = PLAN_WIDTH, height = PLAN_HEIGHT, transform = 'translate(36 -14) scale(.95)' }) {
  const reduced = useReducedMotion();
  return (
    <Svg
      width={width} height={height} viewBox={`0 0 ${PLAN_WIDTH} ${PLAN_HEIGHT}`}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden
    >
      <Defs>
        <Pattern id="plan-hatch" width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <Line x1={0} y1={0} x2={0} y2={4} stroke={INK} strokeWidth={0.8} opacity={0.38} />
        </Pattern>
      </Defs>
      <G transform={transform} strokeLinecap="round" strokeLinejoin="round">
        <Fade delay={900} reduced={reduced}>
          <Path d={FAIRWAY} fill={INK} fillOpacity={0.05} />
        </Fade>
        <DrawPath d={FAIRWAY} length={LENGTHS.fairway} delay={100} reduced={reduced} stroke={INK} strokeWidth={1.5} strokeOpacity={0.72} />
        <DrawPath d={ROUGH} length={LENGTHS.rough} delay={100} reduced={reduced} stroke={INK} strokeWidth={1} strokeOpacity={0.3} />
        <Fade delay={900} reduced={reduced}>
          <Path d={GREEN} fill={GOLD} fillOpacity={0.09} />
        </Fade>
        <DrawPath d={GREEN} length={LENGTHS.green} delay={500} reduced={reduced} stroke={GOLD} strokeWidth={1.6} />
        <DrawPath d={COLLAR} length={LENGTHS.collar} delay={500} reduced={reduced} stroke={GOLD} strokeWidth={1} strokeOpacity={0.45} />
        <Fade delay={900} reduced={reduced}>
          {BUNKERS.map((d) => (
            <Path key={d} d={d} fill="url(#plan-hatch)" stroke={INK} strokeWidth={1.1} strokeOpacity={0.78} />
          ))}
          <Path d={POND} fill="none" stroke={INK} strokeWidth={1.1} strokeOpacity={0.62} />
          <Path d={RIPPLES} fill="none" stroke={INK} strokeWidth={0.9} strokeOpacity={0.42} />
          <G transform="rotate(-60 112 400)">
            <Rect x={94} y={393} width={36} height={14} rx={3} fill="none" stroke={INK} strokeWidth={1.1} strokeOpacity={0.72} />
          </G>
          <G transform="rotate(-60 130 371)">
            <Rect x={119} y={365.5} width={22} height={11} rx={3} fill="none" stroke={INK} strokeWidth={1.1} strokeOpacity={0.5} />
          </G>
        </Fade>
        <DrawPath d={ROUTE} length={LENGTHS.route} delay={1300} duration={1600} reduced={reduced} stroke={GOLD} strokeWidth={1.4} />
        <Fade delay={2400} reduced={reduced}>
          <Circle cx={196} cy={252} r={4} fill="none" stroke={GOLD} strokeWidth={1.4} />
          <Circle cx={312} cy={88} r={3} fill={GOLD} />
          <Circle cx={112} cy={400} r={3} fill={GOLD} />
          <Label x={140} y={318} rotate={-60}>235 M</Label>
          <Label x={270} y={176} rotate={-55}>127 M</Label>
        </Fade>
      </G>
    </Svg>
  );
}
