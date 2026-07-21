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
      <View testID="sg-bar-row" style={styles.row}>
        <Text style={[styles.label, { color: theme.text.muted }]} numberOfLines={1}>{label}</Text>
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
    <View testID="sg-bar-row" style={styles.row}>
      <Text style={[styles.label, { color: theme.text.muted }]} numberOfLines={1}>{label}</Text>
      <View testID="sg-bar-track" style={[styles.track, { backgroundColor: theme.bg.secondary }]}>
        <Svg width="100%" height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
          <Line x1={center} y1={0} x2={center} y2={HEIGHT} stroke={theme.border.default} />
          <Rect x={barX} y={2} width={barW} height={HEIGHT - 4} fill={fill} rx={4} />
        </Svg>
      </View>
      <Text
        testID="sg-bar-value"
        style={[styles.value, { color: fill }]}
      >
        {value >= 0 ? '+' : ''}{value.toFixed(2)}
      </Text>
    </View>
  );
}

const styles = {
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 4,
    width: '100%',
  },
  label: {
    width: 92,
    flexShrink: 0,
    fontSize: 11.5,
    fontFamily: 'PlusJakartaSans-Bold',
  },
  track: {
    flex: 1,
    minWidth: 80,
    maxWidth: WIDTH,
    height: HEIGHT,
    borderRadius: 999,
    overflow: 'hidden',
  },
  value: {
    width: 46,
    flexShrink: 0,
    textAlign: 'right',
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-ExtraBold',
    fontVariant: ['tabular-nums'],
  },
};
