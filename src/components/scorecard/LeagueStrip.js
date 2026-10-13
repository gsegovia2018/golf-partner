// The scorecard's league strip (D5 B): who counts for the league in this
// round, my post deadline once my 8 hours run, a "Count mine" link when I
// said "Not this round" but can still opt in, and "too late" after my first
// score. State from store/leagueGameCards.leagueStripState.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { semantic } from '../../theme/tokens';
import { useT, formatTime } from '../../i18n';
import { listText } from '../../store/leagueGameCards';
import { cardMonth } from '../../store/leagueRules';
import { monthWord } from '../league/LeagueCardsList';

export default function LeagueStrip({ strip, postBy = null, onCountMine }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const t = useT();
  if (!strip) return null;
  const gold = theme.isDark ? semantic.winner.dark : semantic.winner.light;
  const names = listText(strip.names, { you: t('league.cards.youLower'), and: t('league.cards.and') });

  let body;
  let icon = 'award';
  if (strip.kind === 'tooLate') {
    icon = 'clock';
    body = <Text style={s.text}>{t('league.strip.tooLate', { month: monthWord(cardMonth(new Date())) })}</Text>;
  } else if (strip.kind === 'cards') {
    // "{cards} in this game: {names}", with the count in bold.
    const marker = '\u0001';
    const [before, after] = t('league.strip.inGame', { cards: marker, names }).split(marker);
    body = (
      <Text style={s.text}>
        {before}
        <Text style={s.bold}>{t('league.strip.cards', { count: strip.count })}</Text>
        {after}
        {postBy ? ` · ${t('league.strip.postBy', { time: formatTime(postBy, { timeZone: 'Europe/Madrid' }) })}` : ''}
      </Text>
    );
  } else {
    body = (
      <Text style={s.text}>
        {t('league.strip.others', { count: strip.count, names })}
        {strip.canOptIn && onCountMine ? (
          <>
            {' '}
            <Text style={s.link} onPress={onCountMine} accessibilityRole="link">{t('league.strip.countMine')}</Text>
          </>
        ) : null}
      </Text>
    );
  }
  return (
    <View style={s.strip}>
      <Feather name={icon} size={14} color={icon === 'award' ? gold : theme.text.secondary} />
      <View style={{ flex: 1, minWidth: 0 }}>{body}</View>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    strip: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: theme.bg.secondary, borderRadius: 12,
      paddingVertical: 8, paddingHorizontal: 12, marginHorizontal: 16, marginBottom: 8,
    },
    text: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, lineHeight: 17, color: theme.text.secondary },
    bold: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary },
    link: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary },
  });
}
