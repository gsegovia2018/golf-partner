import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n';
import PressableScale from '../ui/PressableScale';

export function TargetHandicapPicker({
  visible,
  currentValue,
  currentHandicap,
  onSave,
  onCancel,
}) {
  const { theme } = useTheme();
  const t = useT();
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
    // A Spanish keyboard types the decimal comma (12,5).
    const n = parseFloat(trimmed.replace(',', '.'));
    if (Number.isNaN(n) || n < 0 || n > 36) {
      return;
    }
    onSave(n);
  };

  return (
    <Modal statusBarTranslucent hardwareAccelerated visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 }}
        onPress={onCancel}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{ backgroundColor: theme.bg.card, borderRadius: 12, padding: 20 }}
        >
          <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text.primary, marginBottom: 12 }}>
            {t('stats.my.target.set')}
          </Text>

          <TextInput
            value={text}
            onChangeText={setText}
            keyboardType="decimal-pad"
            placeholder={t('stats.my.target.placeholder')}
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
              ? t('stats.my.target.blank')
              : t('stats.my.target.comparedWith', { value: text.trim() })}
          </Text>

          {currentHandicap != null && (
            <PressableScale
              onPress={() => setText(String(currentHandicap))}
              style={{ marginTop: 12 }}
            >
              <Text style={{ color: theme.accent.primary, fontSize: 13 }}>
                {t('stats.my.target.useCurrent', { value: currentHandicap })}
              </Text>
            </PressableScale>
          )}

          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 20, gap: 12 }}>
            <PressableScale onPress={onCancel}>
              <Text style={{ color: theme.text.secondary, fontSize: 14, fontWeight: '600', padding: 8 }}>
                {t('common.cancel')}
              </Text>
            </PressableScale>
            <PressableScale onPress={handleSave}>
              <Text style={{ color: theme.accent.primary, fontSize: 14, fontWeight: '600', padding: 8 }}>
                {t('common.save')}
              </Text>
            </PressableScale>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
