import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedProps, useAnimatedStyle, useDerivedValue } from 'react-native-reanimated';
import Svg, {
  Circle, Defs, Ellipse, Line, RadialGradient, Rect, Stop,
} from 'react-native-svg';
import GolfBall from './GolfBall';
import { waterFrame } from './splashMath';

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedLine = Animated.createAnimatedComponent(Line);

// Every group has one: a ball arrives on a steep line, plops into a pond, throws a few
// droplets and leaves rings spreading. The design's 160 x 130 frame plus room above
// for the ball's arrival.
const VB_X = -30;
const VB_Y = -30;
const W = 220;
const H = 168;
const BALL = 10;
const RIPPLES = [0, 1, 2];
const DROPS = [0, 1, 2, 3, 4];
const GLINTS = [0, 1];

function Ripple({ frame, index }) {
  const props = useAnimatedProps(() => {
    const r = frame.value.ripples[index];
    return { rx: r.rx, ry: r.ry, strokeOpacity: r.opacity };
  });
  return <AnimatedEllipse animatedProps={props} cx={80} cy={83} fill="none" stroke="#dcf0f0" strokeWidth={1} />;
}

function Drop({ frame, index }) {
  const props = useAnimatedProps(() => {
    const d = frame.value.drops[index];
    return { cx: d.x, cy: d.y, opacity: d.opacity };
  });
  return <AnimatedCircle animatedProps={props} r={1} fill="#e6f5f5" />;
}

function Glint({ frame, index }) {
  const props = useAnimatedProps(() => {
    const g = frame.value.glints[index];
    return { x1: g.x1, x2: g.x2, y1: g.y, y2: g.y, strokeOpacity: g.opacity };
  });
  return <AnimatedLine animatedProps={props} stroke="#dcf0f0" strokeWidth={1} strokeLinecap="round" />;
}

export default function WaterScene({ clock }) {
  const frame = useDerivedValue(() => waterFrame(clock.value));
  const ballStyle = useAnimatedStyle(() => ({
    opacity: frame.value.ballOpacity,
    transform: [
      { translateX: frame.value.ballX - VB_X - BALL / 2 },
      { translateY: frame.value.ballY - VB_Y - BALL / 2 },
      { scale: frame.value.ballScale },
    ],
  }));

  return (
    <View style={styles.scene} testID="splash-scene-water">
      <Svg width={W} height={H} viewBox={`${VB_X} ${VB_Y} ${W} ${H}`}>
        <Defs>
          <RadialGradient id="waPond" cx="50%" cy="32%" rx="55%" ry="45%">
            <Stop offset="0" stopColor="#78b4be" stopOpacity={0.2} />
            <Stop offset="0.72" stopColor="#78b4be" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={-30} y={64} width={220} height={70} fill="url(#waPond)" />
        {GLINTS.map((i) => <Glint key={i} frame={frame} index={i} />)}
        {RIPPLES.map((i) => <Ripple key={i} frame={frame} index={i} />)}
        {DROPS.map((i) => <Drop key={i} frame={frame} index={i} />)}
      </Svg>
      <Animated.View style={[styles.ball, ballStyle]}>
        <GolfBall size={BALL} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { width: W, height: H, overflow: 'hidden' },
  ball: { position: 'absolute', left: 0, top: 0, width: BALL, height: BALL },
});
