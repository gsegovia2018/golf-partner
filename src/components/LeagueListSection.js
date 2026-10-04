import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useMyLeagueRows } from '../hooks/useMyLeagueRows';

// LEAGUES section of the Play tab: one row per league I'm in, showing my
// position. Reuses HomeScreen's list styles (`s`) so it matches GAMES and
// TOURNAMENTS. Renders nothing when I'm in no league.
export default function LeagueListSection({ navigation, meId, theme, s }) {
  const rows = useMyLeagueRows(navigation, meId);
  if (rows.length === 0) return null;
  return (
    <>
      <Text style={s.sectionLabel}>LEAGUES</Text>
      {rows.map((row) => (
        <View key={row.id} style={s.tournamentCardWrapper}>
          <TouchableOpacity
            style={s.tournamentCard}
            onPress={() => navigation.navigate('LeagueBoard', { leagueId: row.id })}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${row.name} league`}
          >
            <View style={s.tournamentCardLeft}>
              <View style={s.tournamentCardHeader}>
                <Text style={s.tournamentCardName}>{row.name}</Text>
                <View style={s.statusBadge}>
                  <Text style={s.statusBadgeText}>League</Text>
                </View>
              </View>
              <Text style={s.tournamentCardMeta}>{row.position ?? 'No cards confirmed yet'}</Text>
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
