import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import BottomSheet from '../../components/BottomSheet';
import { useT } from '../../i18n';

// "New tournament": casual, official or league. Opened from the list's
// tournament tile and from the no-active-game page.
export default function TournamentKindSheet({ visible, onClose, navigation, theme, s }) {
  const tx = useT();
  const go = (screen, params) => { onClose(); navigation.navigate(screen, params); };
  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={s.modalSheet}>
      <View style={s.modalHandle} />
      <Text style={s.modalTitle}>{tx('home.kind.title')}</Text>

      <TouchableOpacity
        style={s.menuItem}
        onPress={() => go('Setup', { kind: 'tournament' })}
        activeOpacity={0.7}
      >
        <Feather name="users" size={14} color={theme.text.primary} />
        <View style={{ flex: 1 }}>
          <Text style={s.menuItemTitle}>{tx('home.kind.casual')}</Text>
          <Text style={s.modalSubtle}>{tx('home.kind.casualSub')}</Text>
        </View>
        <Feather name="chevron-right" size={16} color={theme.text.muted} />
      </TouchableOpacity>

      <TouchableOpacity
        style={s.menuItem}
        onPress={() => go('OfficialCreate')}
        activeOpacity={0.7}
      >
        <Feather name="award" size={14} color={theme.text.primary} />
        <View style={{ flex: 1 }}>
          <Text style={s.menuItemTitle}>{tx('home.kind.official')}</Text>
          <Text style={s.modalSubtle}>{tx('home.kind.officialSub')}</Text>
        </View>
        <Feather name="chevron-right" size={16} color={theme.text.muted} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[s.menuItem, { borderBottomWidth: 0 }]}
        onPress={() => go('LeagueCreate')}
        activeOpacity={0.7}
      >
        <Feather name="users" size={14} color={theme.text.primary} />
        <View style={{ flex: 1 }}>
          <Text style={s.menuItemTitle}>{tx('home.kind.league')}</Text>
          <Text style={s.modalSubtle}>{tx('home.kind.leagueSub')}</Text>
        </View>
        <Feather name="chevron-right" size={16} color={theme.text.muted} />
      </TouchableOpacity>
    </BottomSheet>
  );
}
