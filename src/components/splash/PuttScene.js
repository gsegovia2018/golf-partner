import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue } from 'react-native-reanimated';
import Svg, {
  ClipPath, Defs, Ellipse, LinearGradient, Path, RadialGradient, Rect, Stop,
} from 'react-native-svg';
import GolfBall from './GolfBall';
import { puttFrame } from './splashMath';

// Side view of a putt: a blade putter swings as a pendulum from 130 px above the turf,
// the ball rolls with friction, dies at the lip and drops below the rim of a to-scale cup.
// Scene box 210 x 120; ground contact at y = 70.
const W = 210;
const H = 120;
// The putter view is 30 x 130; its pivot (top of the shaft) sits at (16.9, 0).
const PIVOT_DX = 16.9 - 15;
const PIVOT_DY = 0 - 65;

export default function PuttScene({ clock }) {
  const frame = useDerivedValue(() => puttFrame(clock.value));

  const putterStyle = useAnimatedStyle(() => ({
    opacity: frame.value.putterOpacity,
    transform: [
      { translateX: PIVOT_DX }, { translateY: PIVOT_DY },
      { rotate: `${frame.value.putterRot}deg` },
      { translateX: -PIVOT_DX }, { translateY: -PIVOT_DY },
    ],
  }));
  const rollStyle = useAnimatedStyle(() => ({
    opacity: frame.value.ballOpacity,
    transform: [{ translateX: frame.value.ballX }],
  }));
  const dropStyle = useAnimatedStyle(() => ({ transform: [{ translateY: frame.value.ballY }] }));
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${frame.value.ballRot}deg` }] }));
  const shadowStyle = useAnimatedStyle(() => ({ opacity: frame.value.shadowOpacity }));

  return (
    <View style={styles.scene} testID="splash-scene-putt">
      <Svg style={styles.green} width={W + 20} height={56} viewBox="0 0 230 56">
        <Defs>
          <RadialGradient id="ptGreen" cx="58%" cy="36%" rx="58%" ry="48%">
            <Stop offset="0" stopColor="#96d2a5" stopOpacity={0.11} />
            <Stop offset="0.72" stopColor="#96d2a5" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={230} height={56} fill="url(#ptGreen)" />
      </Svg>

      <Svg style={styles.hole} width={40} height={12} viewBox="0 0 40 12">
        <Defs>
          <ClipPath id="ptHole"><Ellipse cx={20} cy={5} rx={20} ry={5} /></ClipPath>
          <RadialGradient id="ptDepth" cx="50%" cy="30%" r="60%">
            <Stop offset="0" stopColor="#031109" />
            <Stop offset="1" stopColor="#072018" />
          </RadialGradient>
        </Defs>
        <Ellipse cx={20} cy={6} rx={20} ry={5} fill="#c8ebd2" fillOpacity={0.12} />
        <Ellipse cx={20} cy={5} rx={20} ry={5} fill="#f0eee6" fillOpacity={0.55} />
        <Ellipse cx={20} cy={7.5} rx={20} ry={5} fill="url(#ptDepth)" clipPath="url(#ptHole)" />
      </Svg>

      <View style={styles.clip}>
        <Animated.View style={[styles.putter, putterStyle]}>
          <Svg width={30} height={130} viewBox="0 0 30 130">
            <Defs>
              <LinearGradient id="ptShaft" x1="0" y1="58" x2="0" y2="96" gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor="#9aa29f" stopOpacity={0} />
                <Stop offset="1" stopColor="#9aa29f" />
              </LinearGradient>
              <LinearGradient id="ptShaftHi" x1="0" y1="58" x2="0" y2="96" gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor="#f1f4f2" stopOpacity={0} />
                <Stop offset="1" stopColor="#f1f4f2" stopOpacity={0.9} />
              </LinearGradient>
              <LinearGradient id="ptHead" x1="0" y1="121" x2="0" y2="130" gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor="#f1f3f2" />
                <Stop offset="0.45" stopColor="#b3bab7" />
                <Stop offset="1" stopColor="#5f6764" />
              </LinearGradient>
            </Defs>
            <Ellipse cx={14} cy={129.5} rx={7.5} ry={1.1} fill="#000" fillOpacity={0.3} />
            <Rect x={16} y={40} width={1.8} height={80} fill="url(#ptShaft)" />
            <Rect x={16.3} y={40} width={0.6} height={80} fill="url(#ptShaftHi)" />
            <Rect x={15.4} y={116.5} width={3} height={5.5} rx={0.7} fill="#a6adaa" />
            <Path d="M20 121.2 L20 130 L9 130 Q8 130 8 129 L8 126.2 L10.6 124.6 L16.4 124.2 L17.2 121.2 Z" fill="url(#ptHead)" />
            <Path d="M17.4 121.45 L19.8 121.45" stroke="#ffffff" strokeWidth={0.5} strokeOpacity={0.85} />
            <Rect x={19.3} y={121.2} width={0.7} height={8.8} fill="#4f5754" fillOpacity={0.55} />
          </Svg>
        </Animated.View>

        <Animated.View style={[styles.ballBox, rollStyle]}>
          <Animated.View style={[styles.shadow, shadowStyle]}>
            <Svg width={16} height={6} viewBox="0 0 16 6">
              <Defs>
                <RadialGradient id="ptShadow" cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor="#000" stopOpacity={0.55} />
                  <Stop offset="1" stopColor="#000" stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Ellipse cx={8} cy={3} rx={8} ry={3} fill="url(#ptShadow)" />
            </Svg>
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, dropStyle]}>
            <GolfBall size={16} line spinStyle={spinStyle} />
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { width: W, height: H },
  green: { position: 'absolute', left: -10, top: 50 },
  hole: { position: 'absolute', left: 156, top: 65 },
  // Everything below the near rim of the cup is hidden, so the ball sinks rather than fades.
  clip: { position: 'absolute', left: 0, top: 0, width: W, height: 74, overflow: 'hidden' },
  putter: { position: 'absolute', left: 8, top: -60, width: 30, height: 130 },
  ballBox: { position: 'absolute', left: 28, top: 54, width: 16, height: 16 },
  shadow: { position: 'absolute', left: 0, top: 12 },
});
