import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, Pressable } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

export function TargetHandicapPicker({
  visible,
  currentValue,
  currentHandicap,
  onSave,
  onCancel,
}) {
  const { theme } = useTheme();
  const [text, setText] = useState(
    currentValue == null ? '' : String(currentValue)
  );

  useEffect(() => {
    if (visible) setText(currentValue == null ? '' : String(currentValue));
  }, [visible, currentValue]);

  const handleSave = () => {
    const trimmed = text.trim();
    if (trimmed === '') {
      onSave(null);
      return;
    }
    const n = parseFloat(trimmed);
    if (Number.isNaN(n) || n < 0 || n > 36) {
      return;
    }
    onSave(n);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 }}
        onPress={onCancel}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{ backgroundColor: theme.bg.card, borderRadius: 12, padding: 20 }}
        >
          <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text.primary, marginBottom: 12 }}>
            Set your target
          </Text>

          <TextInput
            value={text}
            onChangeText={setText}
            keyboardType="decimal-pad"
            placeholder="e.g. 12.5"
            placeholderTextColor={theme.text.muted}
            style={{
              borderWidth: 1,
              borderColor: theme.border.default,
              borderRadius: 8,
              padding: 10,
              fontSize: 18,
              color: theme.text.primary,
            }}
          />

          <Text style={{ marginTop: 12, color: theme.text.secondary, fontSize: 13 }}>
            {text.trim() === ''
              ? 'Leave blank to compare against scratch.'
              : `Compared against a handicap-${text.trim()} golfer.`}
          </Text>

          {currentHandicap != null && (
            <TouchableOpacity
              onPress={() => setText(String(currentHandicap))}
              style={{ marginTop: 12 }}
            >
              <Text style={{ color: theme.accent.primary, fontSize: 13 }}>
                ⓘ Use my current handicap ({currentHandicap})
              </Text>
            </TouchableOpacity>
          )}

          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 20, gap: 12 }}>
            <TouchableOpacity onPress={onCancel}>
              <Text style={{ color: theme.text.secondary, fontSize: 14, fontWeight: '600', padding: 8 }}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSave}>
              <Text style={{ color: theme.accent.primary, fontSize: 14, fontWeight: '600', padding: 8 }}>
                Save
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
