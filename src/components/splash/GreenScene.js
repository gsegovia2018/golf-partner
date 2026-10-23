import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedProps, useAnimatedStyle, useDerivedValue } from 'react-native-reanimated';
import Svg, {
  Circle, ClipPath, Defs, Ellipse, G, Line, LinearGradient, Path, Pattern, RadialGradient, Rect, Stop,
} from 'react-native-svg';
import GolfBall from './GolfBall';
import { greenFrame } from './splashMath';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedLine = Animated.createAnimatedComponent(Line);
const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

// Top-down putt on a mown green: a right-handed golfer in a gold cap, west of the ball with
// the target up the screen, rocks a pendulum stroke; the ball takes the break into the cup.
// Scene coordinates keep the design's 160 x 130 frame; the canvas adds room for the green.
const VB_X = -60;
const VB_Y = -28;
const W = 280;
const H = 202;
const BALL = 12;
const GREEN = 'M-48 46 C -34 -4, 40 -22, 112 -14 C 160 -8, 192 22, 186 66 C 181 104, 158 138, 112 152 C 70 164, 6 168, -36 150 C -64 136, -60 84, -48 46 Z';

function usePath(frame, key) {
  return useAnimatedProps(() => ({ d: frame.value[key] }));
}

export default function GreenScene({ clock }) {
  const frame = useDerivedValue(() => greenFrame(clock.value));

  const blade = usePath(frame, 'blade');
  const topline = usePath(frame, 'topline');
  const cavity = usePath(frame, 'cavity');
  const sight = usePath(frame, 'sight');
  const neck = usePath(frame, 'neck');
  const forearmL = usePath(frame, 'forearmL');
  const forearmR = usePath(frame, 'forearmR');
  const sleeveL = usePath(frame, 'sleeveL');
  const sleeveR = usePath(frame, 'sleeveR');
  const brim = usePath(frame, 'brim');
  const seams = usePath(frame, 'seams');
  const aim = useAnimatedProps(() => ({ opacity: frame.value.aimOpacity }));
  const shaft = useAnimatedProps(() => {
    const [x1, y1, x2, y2] = frame.value.shaft;
    return { x1, y1, x2, y2 };
  });
  const glove = useAnimatedProps(() => ({ cx: frame.value.hands[0], cy: frame.value.hands[1] - 0.4 }));
  const hand = useAnimatedProps(() => ({ cx: frame.value.hands[0], cy: frame.value.hands[1] + 3 }));
  const ballStyle = useAnimatedStyle(() => ({
    opacity: frame.value.ballOpacity,
    transform: [
      { translateX: frame.value.ballX - VB_X - BALL / 2 },
      { translateY: frame.value.ballY - VB_Y - BALL / 2 },
      { scale: frame.value.ballScale },
    ],
  }));

  return (
    <View style={styles.scene} testID="splash-scene-green">
      <Svg width={W} height={H} viewBox={`${VB_X} ${VB_Y} ${W} ${H}`}>
        <Defs>
          <ClipPath id="grClip"><Path d={GREEN} /></ClipPath>
          <Pattern id="grMowA" width={22} height={22} patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <Rect width={11} height={22} fill="#ffffff" fillOpacity={0.055} />
          </Pattern>
          <Pattern id="grMowB" width={22} height={22} patternUnits="userSpaceOnUse" patternTransform="rotate(-55)">
            <Rect width={11} height={22} fill="#000000" fillOpacity={0.05} />
          </Pattern>
          <RadialGradient id="grLight" cx="30%" cy="25%" r="85%">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={0.09} />
            <Stop offset="0.6" stopColor="#ffffff" stopOpacity={0} />
            <Stop offset="1" stopColor="#000000" stopOpacity={0.14} />
          </RadialGradient>
          <LinearGradient id="grSand" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#e3d4ae" />
            <Stop offset="1" stopColor="#c7b58a" />
          </LinearGradient>
          <RadialGradient id="grCup" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#020d08" />
            <Stop offset="0.55" stopColor="#020d08" />
            <Stop offset="0.78" stopColor="#0b2c1f" />
            <Stop offset="0.82" stopColor="#ebe9e0" stopOpacity={0.55} />
            <Stop offset="0.95" stopColor="#ebe9e0" stopOpacity={0.55} />
            <Stop offset="1" stopColor="#ebe9e0" stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="grSteel" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#f2f4f3" />
            <Stop offset="0.5" stopColor="#bfc5c2" />
            <Stop offset="1" stopColor="#7d8582" />
          </LinearGradient>
          <RadialGradient id="grCap" cx="40%" cy="35%" r="70%">
            <Stop offset="0" stopColor="#f1d27a" />
            <Stop offset="1" stopColor="#c9a543" />
          </RadialGradient>
          <RadialGradient id="grShirt" cx="45%" cy="40%" r="70%">
            <Stop offset="0" stopColor="#f3efe4" />
            <Stop offset="1" stopColor="#cfc8b6" />
          </RadialGradient>
        </Defs>

        {/* The green: collar halo, surface, criss-cross mowing, light, edge, and a bunker in the rough */}
        <Path d={GREEN} fill="#1f5a3a" stroke="#1f5a3a" strokeWidth={14} strokeLinejoin="round" opacity={0.55} />
        <Path d={GREEN} fill="#2e7049" stroke="#26633f" strokeWidth={7} strokeLinejoin="round" />
        <G clipPath="url(#grClip)">
          <Rect x={-80} y={-40} width={300} height={220} fill="url(#grMowA)" />
          <Rect x={-80} y={-40} width={300} height={220} fill="url(#grMowB)" />
          <Rect x={-80} y={-40} width={300} height={220} fill="url(#grLight)" />
        </G>
        <Path d={GREEN} fill="none" stroke="#1d5537" strokeWidth={1} opacity={0.6} />
        <Path d="M176 96 C 190 84, 214 92, 214 114 C 213 134, 192 142, 176 134 C 166 128, 166 106, 176 96 Z" fill="url(#grSand)" />
        <Path d="M176 96 C 190 84, 214 92, 214 114" fill="none" stroke="#000" strokeOpacity={0.28} strokeWidth={2.2} strokeLinecap="round" />

        <Circle cx={132} cy={30} r={15} fill="url(#grCup)" />
        <AnimatedPath animatedProps={aim} d="M48 104 L56 34" stroke="#e8c45f" strokeWidth={1} strokeDasharray="1.5 3.5" strokeLinecap="round" fill="none" />

        {/* Soft shadow of the golfer, light from the upper left */}
        <G opacity={0.22} transform="translate(4 5)">
          <Rect x={-9} y={91} width={22} height={58} rx={10.5} fill="#000" />
          <Circle cx={5} cy={120} r={11.5} fill="#000" />
        </G>

        {/* The golfer from directly above */}
        <AnimatedPath animatedProps={forearmL} fill="#c9a27f" />
        <AnimatedPath animatedProps={forearmR} fill="#bb9472" />
        <AnimatedPath animatedProps={sleeveL} fill="#e6e0d0" />
        <AnimatedPath animatedProps={sleeveR} fill="#d9d2c0" />
        <Rect x={-9} y={91} width={22} height={58} rx={10.5} fill="url(#grShirt)" />
        <Path d="M2 96 L2 144" stroke="#bfb7a3" strokeWidth={0.5} opacity={0.6} />
        <Circle cx={7} cy={97.5} r={6.8} fill="#ebe6d8" />
        <Circle cx={7} cy={142.5} r={6.8} fill="#e2dccb" />
        <AnimatedLine animatedProps={shaft} stroke="#aeb5b2" strokeWidth={1.5} strokeLinecap="round" />
        <AnimatedPath animatedProps={blade} fill="url(#grSteel)" />
        <AnimatedPath animatedProps={topline} fill="#fafbfa" fillOpacity={0.9} />
        <AnimatedPath animatedProps={cavity} fill="#4f5754" fillOpacity={0.5} />
        <AnimatedPath animatedProps={sight} stroke="#ffffff" strokeWidth={0.41} fill="none" />
        <AnimatedPath animatedProps={neck} stroke="#a9b0ad" strokeWidth={1.04} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <AnimatedEllipse animatedProps={hand} rx={4.2} ry={3.4} fill="#c9a27f" />
        <AnimatedEllipse animatedProps={glove} rx={5} ry={4.2} fill="#f6f4ee" />
        <AnimatedPath animatedProps={brim} fill="#b8963c" />
        <Circle cx={5} cy={120} r={11.5} fill="url(#grCap)" />
        <AnimatedPath animatedProps={seams} stroke="#a88a35" strokeWidth={0.4} opacity={0.5} fill="none" />
        <Circle cx={5} cy={120} r={1.3} fill="#a88a35" />
      </Svg>
      <Animated.View style={[styles.ball, ballStyle]}>
        <GolfBall size={BALL} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { width: W, height: H },
  ball: { position: 'absolute', left: 0, top: 0, width: BALL, height: BALL },
});
