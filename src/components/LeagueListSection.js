import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useMyLeagueRows } from '../hooks/useMyLeagueRows';
import { useT, tr } from '../i18n';

// LEAGUES section of the Play tab: one row per league I'm in, showing my
// position and, underneath, where this month's card stands. Reuses
// HomeScreen's list styles (`s`) so it matches GAMES and TOURNAMENTS.
// Renders nothing when I'm in no league.
export default function LeagueListSection({ navigation, meId, theme, s }) {
  const rows = useMyLeagueRows(navigation, meId);
  const t = useT(); // re-render on a language switch
  if (rows.length === 0) return null;
  // Rows cached by an older version hold plain strings.
  const text = (m) => (typeof m === 'string' ? m : tr(m));
  return (
    <>
      <Text style={s.sectionLabel}>{t('league.list.section')}</Text>
      {rows.map((row) => (
        <View key={row.id} style={s.tournamentCardWrapper}>
          <TouchableOpacity
            style={s.tournamentCard}
            onPress={() => navigation.navigate('LeagueBoard', { leagueId: row.id })}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('league.list.a11y', { name: row.name })}
          >
            <View style={s.tournamentCardLeft}>
              <View style={s.tournamentCardHeader}>
                <Text style={s.tournamentCardName}>{row.name}</Text>
                <View style={s.statusBadge}>
                  <Text style={s.statusBadgeText}>{t('league.list.badge')}</Text>
                </View>
              </View>
              <Text style={s.tournamentCardMeta}>{row.position ? text(row.position) : t('league.list.noCards')}</Text>
              {!!row.month && <Text style={[s.tournamentCardMeta, { color: theme.text.secondary }]}>{text(row.month)}</Text>}
            </View>
            <View style={s.tournamentCardRight}>
              <Feather name="chevron-right" size={18} color={theme.text.muted} />
            </View>
          </TouchableOpacity>
        </View>
      ))}
    </>
  );
}
