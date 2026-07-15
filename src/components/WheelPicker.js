import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export const WHEEL_ROW_HEIGHT = 36;
// Odd count → exactly one row sits in the center selection band.
const VISIBLE_ROWS = 3;

// Pure: converts a scroll offset into the snapped, clamped item index.
export function snapIndex(offsetY, itemCount, rowHeight = WHEEL_ROW_HEIGHT) {
  if (itemCount <= 0) return 0;
  const raw = Math.round(offsetY / rowHeight);
  return Math.max(0, Math.min(itemCount - 1, raw));
}

// Snap-scroll wheel (native date-picker feel) built on ScrollView so it
// behaves the same on web and Android. Rows are also tappable — on web,
// wheel-scrolling small areas is fiddly and momentum events don't fire.
export default function WheelPicker({ items, selectedIndex, onChange, testID }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const scrollRef = useRef(null);
  const pad = WHEEL_ROW_HEIGHT * ((VISIBLE_ROWS - 1) / 2);

  // Keep the wheel aligned with the controlled selection — initial mount and
  // external changes (e.g. the hole reset after a round switch).
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ y: selectedIndex * WHEEL_ROW_HEIGHT, animated: false });
  }, [selectedIndex, items.length]);

  const settle = (e) => {
    const idx = snapIndex(e.nativeEvent?.contentOffset?.y ?? 0, items.length);
    if (idx !== selectedIndex) onChange(idx);
  };

  return (
    <View style={s.wrap} testID={testID}>
      <View pointerEvents="none" style={s.selectionBand} />
      <ScrollView
        ref={scrollRef}
        testID={testID ? `${testID}-scroll` : undefined}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ROW_HEIGHT}
        decelerationRate="fast"
        onMomentumScrollEnd={settle}
        onScrollEndDrag={settle}
        contentContainerStyle={{ paddingVertical: pad }}
        nestedScrollEnabled
      >
        {items.map((item, i) => (
          <Pressable
            key={item.key}
            style={s.row}
            onPress={() => onChange(i)}
            accessibilityRole="button"
            accessibilityLabel={item.sublabel ? `${item.label}, ${item.sublabel}` : item.label}
          >
            <Text
              style={[s.label, i === selectedIndex && s.labelSelected]}
              numberOfLines={1}
            >
              {item.label}
            </Text>
            {item.sublabel ? (
              <Text
                style={[s.sublabel, i === selectedIndex && s.sublabelSelected]}
                numberOfLines={1}
              >
                {item.sublabel}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
      <View pointerEvents="none" style={[s.fade, s.fadeTop]} />
      <View pointerEvents="none" style={[s.fade, s.fadeBottom]} />
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: {
    flex: 1,
    height: WHEEL_ROW_HEIGHT * VISIBLE_ROWS,
    maxHeight: WHEEL_ROW_HEIGHT * VISIBLE_ROWS,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border.default,
    backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.card,
    overflow: 'hidden',
  },
  selectionBand: {
    position: 'absolute',
    top: WHEEL_ROW_HEIGHT,
    height: WHEEL_ROW_HEIGHT,
    left: 6,
    right: 6,
    borderRadius: 8,
    backgroundColor: theme.accent.light,
    borderWidth: 1,
    borderColor: theme.accent.primary,
  },
  row: {
    height: WHEEL_ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  label: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 13,
    color: theme.text.muted,
  },
  labelSelected: {
    fontFamily: 'PlusJakartaSans-ExtraBold',
    fontSize: 14,
    color: theme.accent.primary,
  },
  sublabel: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 9.5,
    color: theme.text.muted,
  },
  sublabelSelected: {
    color: theme.accent.primary,
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: WHEEL_ROW_HEIGHT * 0.7,
    backgroundColor: theme.bg.primary,
    opacity: 0.45,
  },
  fadeTop: { top: 0 },
  fadeBottom: { bottom: 0 },
});
