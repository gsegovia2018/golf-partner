import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { loadTournament, saveTournament } from '../store/tournamentStore';

export default function EditTeamsScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const { roundIndex } = route?.params ?? {};

  const [tournament, setTournament] = useState(null);
  const [pairs, setPairs] = useState(null);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadTournament().then((t) => {
      setTournament(t);
      const current = t?.rounds?.[roundIndex]?.pairs;
      if (current && current.length === 2) {
        setPairs([[...current[0]], [...current[1]]]);
      }
    });
  }, [roundIndex]);

  if (!tournament || !pairs) return null;

  const round = tournament.rounds[roundIndex];

  function onTapPlayer(pairIdx, slotIdx) {
    if (!selected) {
      setSelected({ pairIdx, slotIdx });
      return;
    }
    if (selected.pairIdx === pairIdx && selected.slotIdx === slotIdx) {
      setSelected(null);
      return;
    }
    const next = [[...pairs[0]], [...pairs[1]]];
    const a = next[selected.pairIdx][selected.slotIdx];
    const b = next[pairIdx][slotIdx];
    next[selected.pairIdx][selected.slotIdx] = b;
    next[pairIdx][slotIdx] = a;
    setPairs(next);
    setSelected(null);
  }

  async function onSave() {
    setSaving(true);
    try {
      const updated = { ...tournament };
      updated.rounds = updated.rounds.map((r, i) =>
        i === roundIndex ? { ...r, pairs, revealed: true } : r,
      );
      await saveTournament(updated);
      navigation.goBack();
    } catch (err) {
      setSaving(false);
    }
  }

  const isSelected = (pi, si) => selected?.pairIdx === pi && selected?.slotIdx === si;

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Edit Teams</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={s.body}>
        <Text style={s.roundLabel}>ROUND {roundIndex + 1}</Text>
        <Text style={s.course}>{round?.courseName}</Text>
        <Text style={s.hint}>
          {selected ? 'Tap another player to swap' : 'Tap a player to start a swap'}
        </Text>

        {pairs.map((pair, pi) => {
          const accent = pi === 0 ? theme.pairA : theme.pairB;
          return (
            <View key={pi} style={[s.pairCard, { borderLeftColor: accent }]}>
              <Text style={[s.pairLabel, { color: accent }]}>PAIR {pi + 1}</Text>
              {pair.map((player, si) => (
                <TouchableOpacity
                  key={`${pi}-${si}-${player.id}`}
                  style={[s.playerChip, isSelected(pi, si) && s.playerChipSelected]}
                  onPress={() => onTapPlayer(pi, si)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.playerName, isSelected(pi, si) && s.playerNameSelected]}>
                    {player.name}
                  </Text>
                  {isSelected(pi, si) && (
                    <Feather name="repeat" size={16} color={theme.accent.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          );
        })}

        <TouchableOpacity
          style={[s.saveBtn, saving && { opacity: 0.6 }]}
          onPress={onSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          <Feather name="check" size={18} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
          <Text style={s.saveBtnText}>{saving ? 'Saving…' : 'Save Teams'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    screen: { ...StyleSheet.absoluteFillObject, backgroundColor: t.bg.primary },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    },
    backBtn: {
      width: 36, height: 36, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: t.isDark ? t.bg.secondary : t.bg.card,
      borderWidth: 1, borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    },
    headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: t.text.primary },

    body: { flex: 1, padding: 20, gap: 12 },
    roundLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.muted,
      fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase',
    },
    course: {
      fontFamily: 'PlusJakartaSans-ExtraBold', color: t.text.primary,
      fontSize: 22, marginBottom: 4,
    },
    hint: {
      fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted,
      fontSize: 13, marginBottom: 8,
    },

    pairCard: {
      backgroundColor: t.bg.card,
      borderRadius: 16, borderWidth: 1,
      borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
      borderLeftWidth: 4,
      padding: 14,
      ...(t.isDark ? {} : t.shadow.card),
    },
    pairLabel: {
      fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 10,
      letterSpacing: 2, marginBottom: 10,
    },
    playerChip: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: t.bg.secondary,
      borderRadius: 12, borderWidth: 1, borderColor: t.border.default,
      paddingVertical: 14, paddingHorizontal: 14, marginTop: 8,
    },
    playerChipSelected: {
      backgroundColor: t.accent.light,
      borderColor: t.accent.primary,
    },
    playerName: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.primary, fontSize: 15,
    },
    playerNameSelected: { color: t.accent.primary },

    saveBtn: {
      marginTop: 24,
      backgroundColor: t.isDark ? t.accent.light : t.accent.primary,
      borderRadius: 14, padding: 16,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      borderWidth: t.isDark ? 1 : 0,
      borderColor: t.isDark ? t.accent.primary + '33' : 'transparent',
      ...(t.isDark ? {} : t.shadow.accent),
    },
    saveBtnText: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: t.isDark ? t.accent.primary : t.text.inverse,
      fontSize: 15,
    },
  });
}
