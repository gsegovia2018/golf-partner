import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedProps, useDerivedValue } from 'react-native-reanimated';
import Svg, {
  Circle, Defs, Ellipse, G, Line, Path, RadialGradient, Rect, Stop,
} from 'react-native-svg';
import { swingFrame } from './splashMath';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedLine = Animated.createAnimatedComponent(Line);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedG = Animated.createAnimatedComponent(G);

// Face-on iron swing (target to our right), posed from the P1-P10 positions of a real
// swing. The design's 160 x 176 frame plus room for the club at the top and the ball's flight.
const VB_X = -40;
const VB_Y = -12;
const W = 260;
const H = 196;

const SHIRT = '#ece6d6';
const SKIN = '#c9a27f';
const TURF = [
  { w: 1.6, h: 1.2, fill: '#3d7a52' },
  { w: 1.4, h: 1, fill: '#6b5838' },
  { w: 1.2, h: 1.2, fill: '#3d7a52' },
  { w: 1.4, h: 1, fill: '#4c8a5e' },
];

function usePath(frame, key) {
  return useAnimatedProps(() => ({ d: frame.value[key] }));
}

function useLine(frame, key) {
  return useAnimatedProps(() => {
    const [x1, y1, x2, y2] = frame.value[key];
    return { x1, y1, x2, y2 };
  });
}

function usePoint(frame, key) {
  return useAnimatedProps(() => ({ cx: frame.value[key][0], cy: frame.value[key][1] }));
}

function TurfBit({ frame, index, spec }) {
  const props = useAnimatedProps(() => {
    const bit = frame.value.turf[index];
    return { x: bit.x, y: bit.y, opacity: bit.opacity };
  });
  return <AnimatedRect animatedProps={props} width={spec.w} height={spec.h} fill={spec.fill} />;
}

export default function SwingScene({ clock }) {
  const frame = useDerivedValue(() => swingFrame(clock.value));

  const figure = useAnimatedProps(() => ({ opacity: frame.value.figureOpacity }));
  const trail = usePath(frame, 'trail');
  const legL = usePath(frame, 'legL');
  const legR = usePath(frame, 'legR');
  const shoeL = usePath(frame, 'shoeL');
  const shoeR = usePath(frame, 'shoeR');
  const torso = usePath(frame, 'torso');
  const belt = useLine(frame, 'belt');
  const neck = useLine(frame, 'neckLine');
  const armL = usePath(frame, 'armL');
  const sleeveL = usePath(frame, 'sleeveL');
  const handT = usePoint(frame, 'handT');
  const shaft = useLine(frame, 'shaft');
  const grip = useLine(frame, 'grip');
  const clubhead = usePath(frame, 'clubhead');
  const armR = usePath(frame, 'armR');
  const sleeveR = usePath(frame, 'sleeveR');
  const hands = usePoint(frame, 'hands');
  const head = usePoint(frame, 'head');
  const capDome = usePath(frame, 'capDome');
  const brim = usePath(frame, 'brim');
  const ball = useAnimatedProps(() => ({
    cx: frame.value.ballX, cy: frame.value.ballY, r: frame.value.ballR, opacity: frame.value.ballOpacity,
  }));

  return (
    <View style={styles.scene} testID="splash-scene-swing">
      <Svg width={W} height={H} viewBox={`${VB_X} ${VB_Y} ${W} ${H}`}>
        <Defs>
          <RadialGradient id="swCap" cx="40%" cy="30%" r="80%">
            <Stop offset="0" stopColor="#f1d27a" />
            <Stop offset="1" stopColor="#c9a543" />
          </RadialGradient>
          <RadialGradient id="swBall" cx="35%" cy="30%" r="80%">
            <Stop offset="0" stopColor="#ffffff" />
            <Stop offset="1" stopColor="#cfccc2" />
          </RadialGradient>
        </Defs>
        <Ellipse cx={80} cy={160} rx={64} ry={7} fill="#96d2a5" fillOpacity={0.1} />
        <Line x1={14} y1={159.6} x2={146} y2={159.6} stroke="#96d2a5" strokeOpacity={0.22} strokeWidth={1} />
        <Ellipse cx={80} cy={160} rx={24} ry={2.6} fill="#000" fillOpacity={0.28} />
        <AnimatedPath animatedProps={trail} fill="none" stroke="#e8c45f" strokeOpacity={0.85} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />

        <AnimatedG animatedProps={figure}>
          <AnimatedPath animatedProps={legL} fill="none" stroke="#c4b692" strokeWidth={7.5} strokeLinecap="round" strokeLinejoin="round" />
          <AnimatedPath animatedProps={legR} fill="none" stroke="#d3c7a6" strokeWidth={7.5} strokeLinecap="round" strokeLinejoin="round" />
          <AnimatedPath animatedProps={shoeL} fill="#f4f2ec" />
          <AnimatedPath animatedProps={shoeR} fill="#f4f2ec" />
          <AnimatedPath animatedProps={torso} fill={SHIRT} stroke={SHIRT} strokeWidth={6} strokeLinejoin="round" />
          <AnimatedLine animatedProps={belt} stroke="#7d6a45" strokeWidth={1.8} strokeLinecap="round" />
          <AnimatedLine animatedProps={neck} stroke={SKIN} strokeWidth={5} strokeLinecap="round" />
          <AnimatedPath animatedProps={armL} fill="none" stroke="#bb9472" strokeWidth={3.8} strokeLinecap="round" strokeLinejoin="round" />
          <AnimatedPath animatedProps={sleeveL} fill="none" stroke="#e2dccb" strokeWidth={5.6} strokeLinecap="round" />
          <AnimatedCircle animatedProps={handT} r={2.4} fill="#c49c78" />
          <AnimatedLine animatedProps={shaft} stroke="#c3c9c6" strokeWidth={1.2} strokeLinecap="round" />
          <AnimatedLine animatedProps={grip} stroke="#1d2723" strokeWidth={2.1} strokeLinecap="round" />
          <AnimatedPath animatedProps={clubhead} fill="#d9dedb" />
          <AnimatedPath animatedProps={armR} fill="none" stroke={SKIN} strokeWidth={3.8} strokeLinecap="round" strokeLinejoin="round" />
          <AnimatedPath animatedProps={sleeveR} fill="none" stroke={SHIRT} strokeWidth={5.6} strokeLinecap="round" />
          <AnimatedCircle animatedProps={hands} r={2.7} fill="#f6f4ee" />
          <AnimatedCircle animatedProps={head} r={7.5} fill={SKIN} />
          <AnimatedPath animatedProps={capDome} fill="url(#swCap)" />
          <AnimatedPath animatedProps={brim} fill="#b8963c" />
        </AnimatedG>

        {TURF.map((spec, i) => <TurfBit key={i} frame={frame} index={i} spec={spec} />)}
        <AnimatedCircle animatedProps={ball} fill="url(#swBall)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { width: W, height: H },
});
