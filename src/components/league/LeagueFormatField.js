import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useT } from '../../i18n';
import { useTheme } from '../../theme/ThemeContext';
import BottomSheet from '../BottomSheet';
import IconButton from '../ui/IconButton';
import { scoringPickerStyles } from '../ScoringModePicker';
import { LEAGUE_FORMATS, LEAGUE_FORMAT_SECTIONS } from '../../store/leagueDraft';

// The league's scoring format, drawn exactly like the New Game scoring-mode
// field. With one option there is nothing to choose, so the field is plain
// text (no chevron, not pressable).
export default function LeagueFormatField({ value, onChange }) {
  const t = useT();
  const { theme } = useTheme();
  const s = scoringPickerStyles(theme);
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState(false);

  const current = LEAGUE_FORMATS.find((f) => f.key === value) ?? LEAGUE_FORMATS[0];
  const choosable = LEAGUE_FORMATS.length > 1;
  const body = (
    <>
      <Feather name={current.icon} size={20} color={theme.accent.primary} />
      <View style={s.fieldText}>
        <Text style={s.fieldLabel}>{t(current.labelKey)}</Text>
        <Text style={s.fieldSubtitle}>{t(current.subtitleKey)}</Text>
      </View>
      {choosable && <Feather name="chevron-down" size={20} color={theme.text.muted} />}
    </>
  );

  if (!choosable) {
    return <View style={s.field} accessibilityRole="text">{body}</View>;
  }

  return (
    <View>
      <TouchableOpacity
        style={s.field}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={t('league.format.fieldLabel', { format: t(current.labelKey) })}
        accessibilityHint={t('league.format.fieldHint')}
      >
        {body}
      </TouchableOpacity>

      <BottomSheet visible={open} onClose={() => setOpen(false)} sheetStyle={s.sheet}>
        <View style={s.sheetHeader}>
          <Text style={s.sheetTitle}>{t('league.format.choose')}</Text>
          <IconButton icon="x" onPress={() => setOpen(false)} accessibilityLabel={t('league.format.close')} />
        </View>
        <ScrollView style={{ maxHeight: Math.round(height * 0.7) }} showsVerticalScrollIndicator={false}>
          {LEAGUE_FORMAT_SECTIONS.map((section) => {
            const options = LEAGUE_FORMATS.filter((f) => f.section === section.section);
            if (options.length === 0) return null;
            return (
              <View key={section.section}>
                <Text style={s.sectionHeader}>{t(section.labelKey)}</Text>
                {options.map((f) => {
                  const active = f.key === current.key;
                  return (
                    <TouchableOpacity
                      key={f.key}
                      style={s.row}
                      activeOpacity={0.7}
                      onPress={() => { setOpen(false); onChange(f.key); }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Feather name={f.icon} size={20} color={theme.accent.primary} />
                      <View style={s.rowText}>
                        <Text style={s.rowLabel}>{t(f.labelKey)}</Text>
                        <Text style={s.rowSubtitle}>{t(f.subtitleKey)}</Text>
                      </View>
                      {active && <Feather name="check" size={14} color={theme.accent.primary} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            );
          })}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}
