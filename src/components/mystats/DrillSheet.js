import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n';
import { ROUNDS_PER_LEVEL, MAX_LEVEL } from '../../store/coachFocus';
import BottomSheet from '../BottomSheet';
import IconButton from '../ui/IconButton';
import SheetHandle from '../ui/SheetHandle';

// The drill detail behind a DrillLine: how to do it, the pass target (all
// three levels with the current one marked, or the single target of a swing
// drill) and how levels are earned.
// passTargets: [{ level, text }] for a coach drill, null for a swing drill
// (`passTarget` then holds its one target).
export default function DrillSheet({
  visible, onClose, title, meta, instruction, passTargets = null, passTarget = null, level = null,
}) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={s.sheet}>
      <SheetHandle style={s.handle} />
      <View style={s.header}>
        <View style={s.headCopy}>
          <Text style={s.title} testID="drill-sheet-title">{title}</Text>
          <Text style={s.meta}>{meta}</Text>
        </View>
        <IconButton icon="x" onPress={onClose} accessibilityLabel={t('stats.my.coach.ui.drill.close')} />
      </View>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        <Text style={s.section}>{t('stats.my.coach.ui.drill.how')}</Text>
        <Text style={s.body}>{instruction}</Text>

        <Text style={s.section}>{t('stats.my.coach.ui.drill.pass')}</Text>
        {passTargets ? passTargets.map((p) => (
          <View key={p.level} style={s.levelRow} testID={`drill-level-${p.level}`}>
            <Text style={s.levelTag}>
              {t('stats.my.coach.ui.drill.levelN', { level: p.level })}
              {p.level === level ? <Text style={s.yourLevel}>{`  ${t('stats.my.coach.ui.drill.yourLevel')}`}</Text> : null}
            </Text>
            <Text style={s.body}>{p.text}</Text>
          </View>
        )) : <Text style={s.body}>{passTarget}</Text>}

        {passTargets ? <Text style={s.note}>{t('stats.my.coach.ui.drill.levels', { rounds: ROUNDS_PER_LEVEL, max: MAX_LEVEL })}</Text> : null}
      </ScrollView>
    </BottomSheet>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    sheet: {
      backgroundColor: theme.bg.primary,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      maxHeight: '80%',
      paddingBottom: 32,
      borderTopWidth: 1,
      borderColor: theme.border.default,
    },
    handle: { marginTop: 10 },
    header: {
      flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.spacing.md,
      paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12,
      borderBottomWidth: 1, borderBottomColor: theme.border.subtle,
    },
    headCopy: { flex: 1, minWidth: 0, gap: 2 },
    title: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 17 },
    meta: { ...theme.typography.caption, color: theme.text.muted },
    scroll: { flexGrow: 0 },
    scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 6 },
    section: { ...theme.typography.overline, color: theme.info, marginTop: 8 },
    body: { ...theme.typography.body, color: theme.text.primary },
    levelRow: { gap: 1 },
    levelTag: { ...theme.typography.caption, color: theme.text.secondary, fontWeight: '700' },
    yourLevel: { color: theme.info, fontWeight: '800' },
    note: { ...theme.typography.caption, color: theme.text.secondary, marginTop: 8 },
  });
}
