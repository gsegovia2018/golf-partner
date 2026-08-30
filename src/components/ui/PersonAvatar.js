import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { semantic } from '../../theme/tokens';

// Round avatar with an initials fallback — used by FriendsScreen's rows and
// PlayerStatsScreen's header. `person` needs displayName/username and
// optional avatarColor/avatarUrl.
export default function PersonAvatar({ person, theme, size }) {
  const initials = (person.displayName || person.username || '?')
    .slice(0, 2).toUpperCase();
  const dim = size ?? 42;
  return (
    <View style={[
      styles.wrap,
      { width: dim, height: dim, borderRadius: dim / 2 },
      { backgroundColor: person.avatarColor || theme.accent.primary },
    ]}>
      {person.avatarUrl
        ? <Image source={{ uri: person.avatarUrl }} style={styles.img} />
        : <Text style={styles.text}>{initials}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  img: { width: '100%', height: '100%' },
  text: { fontFamily: 'PlusJakartaSans-ExtraBold', color: semantic.winner.dark, fontSize: 14 },
});
