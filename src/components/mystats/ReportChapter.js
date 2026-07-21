import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import ReportDeltaRow from './ReportDeltaRow';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

// Expandable chapter card: icon + title + collapsed preview in the header,
// center-baseline delta rows in the body. The chevron rotates on toggle;
// rows carry their own staggered bar sweeps.
export default function ReportChapter({
  icon, title, preview, rows, hasDeltas, initiallyOpen = false, testID,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [open, setOpen] = useState(initiallyOpen);
  const reduced = useReducedMotion();
  const rotation = useSharedValue(initiallyOpen ? 1 : 0);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    rotation.value = reduced ? (next ? 1 : 0)
      : withTiming(next ? 1 : 0, { duration: 200, easing: EASE_OUT });
  };

  const chevStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value * 180}deg` }],
  }));

  return (
    <View style={s.card}>
      <TouchableOpacity
        style={s.head}
        onPress={toggle}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        testID={testID}
      >
        <View style={s.ico}>
          <Feather name={icon} size={14} color={theme.accent.primary} />
        </View>
        <View style={s.headCopy}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.preview} numberOfLines={1}>{preview}</Text>
        </View>
        <Animated.View style={chevStyle}>
          <Feather name="chevron-down" size={16} color={theme.text.muted} />
        </Animated.View>
      </TouchableOpacity>
      {open && (
        <View style={s.body}>
          {hasDeltas && (
            <View style={s.legend}>
              <Text style={[s.legendText, { color: theme.destructive }]}>◂ COST YOU</Text>
              <Text style={[s.legendText, { color: theme.accent.primary }]}>GAINED ▸</Text>
            </View>
          )}
          {rows.map((row, i) => (
            <ReportDeltaRow
              key={row.label}
              row={row}
              rowIndex={i}
              first={i === 0}
              testID={testID ? `${testID}-row-${i}` : undefined}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.bg.card, borderRadius: theme.radius.lg,
      borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
      paddingHorizontal: 14, paddingVertical: 13,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    ico: {
      width: 30, height: 30, borderRadius: 999, backgroundColor: theme.accent.light,
      alignItems: 'center', justifyContent: 'center',
    },
    headCopy: { flex: 1, gap: 1 },
    title: { fontSize: 13, fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.primary },
    preview: {
      fontSize: 10.5, fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary,
      fontVariant: ['tabular-nums'],
    },
    body: {
      marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.subtle, paddingTop: 2,
    },
    legend: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
    legendText: { fontSize: 8.5, fontFamily: 'PlusJakartaSans-Bold', letterSpacing: 0.8 },
  });
}
