import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import PressableScale from '../ui/PressableScale';
import { useTheme } from '../../theme/ThemeContext';
import { useSwingTone } from './swingTone';
import { SWING_STRINGS } from '../../swing/strings';

const R = SWING_STRINGS.results;

/** "Clubhead placed · Downswing re-read", the new main fault when it changed, and Undo (design D, frame 3). */
export default function PlacedBanner({
  name, mainChange = null, failed = false, onUndo,
}) {
  const { theme } = useTheme();
  const tone = useSwingTone();
  const s = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={s.banner} accessibilityLiveRegion="polite" testID="results-placed">
      <Feather name={failed ? 'alert-triangle' : 'check'} size={16} color={failed ? tone.warning : tone.green} />
      <View style={s.flex}>
        {failed ? <Text style={s.title}>{R.placeFailed}</Text> : (
          <>
            <Text style={s.title}>{R.placed(name)}</Text>
            {mainChange ? <Text style={s.sub}>{R.mainChanged(mainChange)}</Text> : null}
          </>
        )}
      </View>
      {failed ? null : (
        <PressableScale style={s.undo} onPress={onUndo} accessibilityRole="button" accessibilityLabel={R.undo} testID="results-undo">
          <Text style={s.undoText}>{R.undo}</Text>
        </PressableScale>
      )}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.bg.card, borderRadius: theme.radius.lg, padding: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
  },
  flex: { flex: 1 },
  title: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12.5, lineHeight: 18, color: theme.text.primary },
  sub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12.5, lineHeight: 18, color: theme.text.secondary },
  undo: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  undoText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.accent.primary },
});
