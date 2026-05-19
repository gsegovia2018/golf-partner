import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';

// Card shell with a title and an optional (i) button. The button does not own
// any sheet — it just calls onInfo(infoKey). `right` renders extra header
// content (e.g. period chips). `tone='hero'` gives the filled green variant.
export default function SectionCard({ title, infoKey, onInfo, right, tone = 'default', children, style }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const hero = tone === 'hero';

  return (
    <View style={[s.card, hero && s.cardHero, style]}>
      <View style={s.head}>
        <View style={s.titleWrap}>
          <Text style={[s.title, hero && s.titleHero]}>{title}</Text>
          {infoKey && onInfo ? (
            <TouchableOpacity
              onPress={() => onInfo(infoKey)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={`What is ${title}`}
            >
              <Feather name="info" size={15} color={hero ? 'rgba(255,255,255,0.85)' : theme.text.muted} />
            </TouchableOpacity>
          ) : null}
        </View>
        {right ?? null}
      </View>
      {children}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.bg.card, borderRadius: theme.radius.lg,
      padding: theme.spacing.lg, gap: theme.spacing.sm,
      borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
    },
    cardHero: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    title: { ...theme.typography.heading, color: theme.text.primary },
    titleHero: { color: theme.text.inverse },
  });
}
