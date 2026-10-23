import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, Path, RadialGradient, Stop } from 'react-native-svg';
import { ballDimples } from './splashMath';

const DIMPLES = ballDimples();
const BALL = '#f8f7f2';

// A dimpled ball under a fixed light. `spinStyle` turns only the dimpled face, so the
// highlight stays put while the ball rolls; `line` adds an alignment line.
export default function GolfBall({ size, line = false, spinStyle }) {
  return (
    <View style={[styles.ball, { width: size, height: size, borderRadius: size / 2 }]}>
      <Animated.View style={[StyleSheet.absoluteFill, spinStyle]}>
        <Svg width={size} height={size} viewBox="0 0 16 16">
          {DIMPLES.map((d, i) => (
            <Ellipse
              key={i}
              cx={d.cx}
              cy={d.cy}
              rx={d.rx}
              ry={d.ry}
              transform={`rotate(${d.deg.toFixed(1)} ${d.cx.toFixed(2)} ${d.cy.toFixed(2)})`}
              fill="#0a2c20"
              fillOpacity={d.alpha}
            />
          ))}
          {line && <Path d="M8 3.2 L8 12.8" stroke="#10221a" strokeOpacity={0.8} strokeWidth={0.9} strokeLinecap="round" />}
        </Svg>
      </Animated.View>
      <Svg style={StyleSheet.absoluteFill} width={size} height={size} viewBox="0 0 16 16">
        <Defs>
          <RadialGradient id="gbHi" cx="34%" cy="28%" r="40%">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={0.95} />
            <Stop offset="0.22" stopColor="#ffffff" stopOpacity={0.95} />
            <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="gbShade" cx="50%" cy="50%" r="50%">
            <Stop offset="0.44" stopColor="#061e14" stopOpacity={0} />
            <Stop offset="0.74" stopColor="#061e14" stopOpacity={0.42} />
            <Stop offset="1" stopColor="#061e14" stopOpacity={0.42} />
          </RadialGradient>
        </Defs>
        <Circle cx={8} cy={8} r={8} fill="url(#gbHi)" />
        <Circle cx={8} cy={8} r={8} fill="url(#gbShade)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  ball: { overflow: 'hidden', backgroundColor: BALL },
});
