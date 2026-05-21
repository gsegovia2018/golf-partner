// Bottom-sheet modal for picking a player to remove from an in-progress
// game. The parent supplies `players` already filtered (the meId player is
// excluded by the caller). Parent controls `visible`; selecting a row calls
// onSelect(playerId), dismissing calls onCancel().
import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

export default function PlayerRemoveSheet({ visible, players, onSelect, onCancel }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={s.backdrop}>
        <SafeAreaView style={s.sheet}>
          <Text style={s.title}>Remove a player</Text>
          <Text style={s.subtitle}>
            Their scores for this round will be removed.
          </Text>
          <View style={s.list}>
            {(players ?? []).map((player) => (
              <TouchableOpacity
                key={player.id}
                style={s.row}
                onPress={() => onSelect(player.id)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${player.name}`}
              >
                <Feather name="user-x" size={20} color={theme.accent.primary} />
                <View style={s.rowText}>
                  <Text style={s.rowLabel}>{player.name}</Text>
                  <Text style={s.rowSubtitle}>Handicap {player.handicap ?? 0}</Text>
                </View>
                <Feather name="chevron-right" size={16} color={theme.text.muted} />
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={s.cancelBtn} onPress={onCancel}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: {
      backgroundColor: theme.bg.primary,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 20,
      paddingBottom: 32,
    },
    title: {
      fontFamily: 'PlayfairDisplay-Bold',
      fontSize: 20,
      color: theme.text.primary,
      marginBottom: 4,
    },
    subtitle: {
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 13,
      color: theme.text.muted,
      marginBottom: 12,
    },
    list: { marginBottom: 16 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 14,
      paddingHorizontal: 4,
      borderBottomWidth: 1,
      borderBottomColor: theme.border.subtle,
    },
    rowText: { flex: 1 },
    rowLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 15,
      color: theme.text.primary,
    },
    rowSubtitle: {
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 12,
      color: theme.text.muted,
      marginTop: 2,
    },
    cancelBtn: {
      padding: 12,
      alignItems: 'center',
      borderRadius: 8,
      backgroundColor: theme.bg.secondary,
    },
    cancelText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.primary,
    },
  });
}
