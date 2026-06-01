import React, { useEffect, useState } from 'react';
import { TouchableOpacity, View, Text, Modal, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme/ThemeContext';

const STORAGE_PREFIX = 'shotDetailExplainer:';

export function ShotDetailExplainer({ rowKey, title, body }) {
  const { theme } = useTheme();
  const [dismissed, setDismissed] = useState(true);    // start "dismissed" until we know
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_PREFIX + rowKey).then((v) => {
      if (cancelled) return;
      setDismissed(v === '1');
    });
    return () => { cancelled = true; };
  }, [rowKey]);

  const dismiss = async () => {
    await AsyncStorage.setItem(STORAGE_PREFIX + rowKey, '1');
    setDismissed(true);
    setOpen(false);
  };

  const iconColor = dismissed ? theme.text.muted : theme.accent.primary;
  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Open ${title} info`}
      >
        <Feather name="help-circle" size={14} color={iconColor} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={dismiss}>
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 }}
          onPress={dismiss}
        >
          <View style={{ backgroundColor: theme.bg.card, borderRadius: 12, padding: 20 }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text.primary, marginBottom: 8 }}>
              {title}
            </Text>
            <Text style={{ fontSize: 14, color: theme.text.secondary, lineHeight: 20 }}>
              {body}
            </Text>
            <TouchableOpacity onPress={dismiss} style={{ marginTop: 16, alignSelf: 'flex-end' }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: theme.accent.primary }}>Got it</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
