// Awards: a sideways-scrolling strip of compact cards, glory first, then
// shame. Each card is one button that opens its detail sheet.
import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n';
import { joinNames, trn } from './ui';

const CARD_W = 152;
const GAP = 10;

export default function AwardsStrip({ awards, onOpen }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={CARD_W + GAP}
      decelerationRate="fast"
      contentContainerStyle={s.strip}
      style={s.scroller}
      testID="awards-strip"
    >
      {awards.map((a) => {
        const title = t(`stats.game.award.title.${a.id}`);
        const names = joinNames(a.players);
        const value = trn(a.value);
        const detail = trn(a.detail);
        const shame = a.tone === 'shame';
        return (
          <TouchableOpacity
            key={a.id}
            testID={`award-${a.id}`}
            style={s.card}
            onPress={() => onOpen(a)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${title}. ${names}, ${value}. ${detail}`}
          >
            <View style={s.head}>
              <Feather name={a.icon} size={14} color={shame ? theme.destructive : theme.accent.primary} />
              <Text style={[s.title, shame && { color: theme.destructive }]} numberOfLines={1}>{title}</Text>
            </View>
            <Text style={s.names} numberOfLines={2}>{names}</Text>
            <Text style={s.value} numberOfLines={1}>{value}</Text>
            <Text style={s.detail} numberOfLines={2}>{detail}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    scroller: { marginHorizontal: -16, marginBottom: 12 },
    strip: { paddingHorizontal: 16, gap: GAP },
    card: {
      width: CARD_W, minHeight: 124, backgroundColor: theme.bg.card, borderRadius: 14, padding: 12, gap: 3,
      borderWidth: 1, borderColor: theme.border.default,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
    title: {
      flex: 1, fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase',
      color: theme.text.secondary,
    },
    names: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15, lineHeight: 19, color: theme.text.primary },
    value: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.text.primary },
    detail: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, lineHeight: 15, color: theme.text.secondary },
  });
}
