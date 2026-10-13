import React, { memo, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { hud, semantic } from '../../theme/tokens';
import { withAlpha } from '../../theme/alpha';
import { MARKED_KEYS, positionStatus, passCounts } from '../../swing/markPass';
import { SWING_STRINGS } from '../../swing/strings';
import Pictogram from './Pictogram';

const T = SWING_STRINGS.mark;

/**
 * The six positions of the marking pass (D25) as a filmstrip of chapters, each with its name
 * and a status dot (confirmed / skipped / to do), and the count line under it (D26).
 * `themed` draws it in the app theme for Results; the default is the canvas's HUD palette.
 * `current` is the open chapter (none for an automatic frame); `right` fills the count line's
 * right end ("3 of 6", "editing from Results").
 */
function MarkChapters({
  status, current = null, onSelect, themed = false, right = null, mirror = false, testID = 'mark-chapters',
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme, themed), [theme, themed]);
  const ink = iconInk(theme, themed);
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
                <Pictogram swingKey={k} size={ICON} color={on ? ink.on : ink.off} accent={ink.accent} mirror={mirror} testID={`chapter-icon-${k}`} />
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

export default memo(MarkChapters);

const ICON = 40; // the pictogram icon (V3); the tile is a little wider than the old P-number chip

// The pictogram's quiet parts and its accent: the HUD palette on the canvas, the theme on Results.
const iconInk = (theme, themed) => (themed
  ? { off: theme.text.secondary, on: theme.text.primary, accent: theme.accent.primary }
  : { off: hud.textMuted, on: hud.textSoft, accent: hud.accent });

const makeStyles = (theme, themed) => {
  const c = themed ? {
    tile: theme.bg.secondary, tileBorder: theme.border.default, onBorder: theme.accent.primary, onFill: theme.accent.light,
    text: theme.text.secondary, textOn: theme.text.primary, ring: theme.text.muted, done: theme.accent.primary, skip: theme.isDark ? semantic.warning.dark : semantic.warning.light,
  } : {
    tile: hud.fill, tileBorder: 'transparent', onBorder: hud.text, onFill: withAlpha(hud.text, 0.14),
    text: hud.textMuted, textOn: hud.text, ring: hud.textMuted, done: hud.accent, skip: semantic.warning.dark,
  };
  return StyleSheet.create({
    wrap: { gap: 6 },
    row: { flexDirection: 'row', gap: 3 },
    chapter: { flex: 1, minHeight: 70, alignItems: 'center', gap: 3, paddingTop: 2 },
    tile: {
      width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
      backgroundColor: c.tile, borderWidth: 1.5, borderColor: c.tileBorder,
    },
    tileOn: { borderColor: c.onBorder, backgroundColor: c.onFill },
    dot: { width: 7, height: 7, borderRadius: 4, borderWidth: 1.5, borderColor: c.ring },
    dotDone: { backgroundColor: c.done, borderColor: c.done },
    // shape as well as colour: confirmed is a filled dot, skipped a filled square, to do a ring
    dotSkip: { backgroundColor: c.skip, borderColor: c.skip, borderRadius: 1 },
    name: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 9, color: c.text, maxWidth: '100%' },
    nameOn: { color: c.textOn },
    countLine: { flexDirection: 'row', justifyContent: 'space-between' },
    count: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 11, color: c.text, fontVariant: ['tabular-nums'] },
  });
};
