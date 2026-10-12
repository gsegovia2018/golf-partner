import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { hud } from '../../theme/tokens';
import { MARKED_KEYS, positionStatus, passCounts } from '../../swing/markPass';
import { SWING_STRINGS } from '../../swing/strings';

const T = SWING_STRINGS.mark;
const HUD_WARN = '#e0b24d';

/**
 * The six positions of the marking pass (D25) as a filmstrip of chapters, each with its name
 * and a status dot (confirmed / skipped / to do), and the count line under it (D26).
 * `themed` draws it in the app theme for Results; the default is the canvas's HUD palette.
 * `current` is the open chapter (none for an automatic frame); `right` fills the count line's
 * right end ("3 of 6", "editing from Results").
 */
export default function MarkChapters({
  status, current = null, onSelect, themed = false, right = null, testID = 'mark-chapters',
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme, themed), [theme, themed]);
  const n = passCounts(status);
  return (
    <View style={s.wrap} testID={testID}>
      <View style={s.row} accessibilityRole="tablist">
        {MARKED_KEYS.map((k) => {
          const st = positionStatus(status, k);
          const on = k === current;
          const name = SWING_STRINGS.checkpoint[k];
          return (
            <Pressable
              key={k}
              style={s.chapter}
              onPress={() => onSelect?.(k)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={T.chapterA11y(name, st)}
              testID={`chapter-${k}`}
            >
              <View style={[s.tile, on && s.tileOn]}>
                <Text style={[s.p, on && s.pOn]}>{CP_P[k]}</Text>
              </View>
              <View style={[s.dot, st === 'confirmed' && s.dotDone, st === 'skipped' && s.dotSkip]} />
              <Text style={[s.name, on && s.nameOn]} numberOfLines={1}>{name}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={s.countLine} accessible accessibilityLabel={T.countA11y(n.confirmed, n.skipped, n.todo)}>
        <Text style={s.count}>{T.counts(n.confirmed, n.skipped, n.todo)}</Text>
        {right ? <Text style={s.count}>{right}</Text> : null}
      </View>
    </View>
  );
}

const CP_P = {
  address: 'P1', leadArm: 'P3', top: 'P4', shaftDown: 'P6', impact: 'P7', shaftThrough: 'P8',
};

const makeStyles = (theme, themed) => {
  const c = themed ? {
    tile: theme.bg.secondary, tileBorder: theme.border.default, onBorder: theme.accent.primary, onFill: theme.accent.light,
    text: theme.text.secondary, textOn: theme.text.primary, ring: theme.text.muted, done: theme.accent.primary, skip: theme.isDark ? HUD_WARN : '#b8791a',
  } : {
    tile: hud.fill, tileBorder: 'transparent', onBorder: hud.text, onFill: 'rgba(255,255,255,0.14)',
    text: hud.textMuted, textOn: hud.text, ring: hud.textMuted, done: hud.accent, skip: HUD_WARN,
  };
  return StyleSheet.create({
    wrap: { gap: 6 },
    row: { flexDirection: 'row', gap: 3 },
    chapter: { flex: 1, minHeight: 56, alignItems: 'center', gap: 3, paddingTop: 2 },
    tile: {
      width: 40, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
      backgroundColor: c.tile, borderWidth: 1.5, borderColor: c.tileBorder,
    },
    tileOn: { borderColor: c.onBorder, backgroundColor: c.onFill },
    p: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 11, color: c.text },
    pOn: { color: c.textOn },
    dot: { width: 7, height: 7, borderRadius: 4, borderWidth: 1.5, borderColor: c.ring },
    dotDone: { backgroundColor: c.done, borderColor: c.done },
    dotSkip: { backgroundColor: c.skip, borderColor: c.skip },
    name: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 9, color: c.text, maxWidth: '100%' },
    nameOn: { color: c.textOn },
    countLine: { flexDirection: 'row', justifyContent: 'space-between' },
    count: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 11, color: c.text, fontVariant: ['tabular-nums'] },
  });
};
