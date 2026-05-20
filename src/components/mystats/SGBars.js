import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Rect, Line } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';

const HEIGHT = 14;
const WIDTH = 200;
const MAX_ABS = 1.5; // ±1.5 SG/round visual cap

export function SGBar({ label, value }) {
  const { theme } = useTheme();

  if (value == null) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 4 }}>
        <Text style={{ width: 110, color: theme.text.secondary }}>{label}</Text>
        <Text style={{ color: theme.text.muted }}>—</Text>
      </View>
    );
  }

  const clamped = Math.max(-MAX_ABS, Math.min(MAX_ABS, value));
  const center = WIDTH / 2;
  const px = (clamped / MAX_ABS) * (WIDTH / 2);
  const barX = clamped >= 0 ? center : center + px;
  const barW = Math.abs(px);
  // theme.scoreColor is a function: scoreColor('good') / scoreColor('poor')
  const fill = clamped >= 0 ? theme.scoreColor('good') : theme.scoreColor('poor');

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 4 }}>
      <Text style={{ width: 110, color: theme.text.secondary, fontSize: 13 }}>{label}</Text>
      <Svg width={WIDTH} height={HEIGHT}>
        <Line x1={center} y1={0} x2={center} y2={HEIGHT} stroke={theme.border.default} />
        <Rect x={barX} y={2} width={barW} height={HEIGHT - 4} fill={fill} rx={2} />
      </Svg>
      <Text style={{ marginLeft: 8, color: theme.text.primary, fontSize: 13, fontWeight: '600' }}>
        {value >= 0 ? '+' : ''}{value.toFixed(2)}
      </Text>
    </View>
  );
}
