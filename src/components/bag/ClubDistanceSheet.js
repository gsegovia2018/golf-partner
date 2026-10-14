// Type your own distance for one club. Opens from a gapping-chart row, with
// the measured playing distance and the spread of tracked shots beside the
// field so the number is set against real data.
//
// Every way out saves: Save, the keyboard's done key, tapping the scrim and
// the back gesture all commit a changed, valid draft. (The old inline field
// only saved in onEndEditing, which never fires on web and is skipped on
// Android when the keyboard is closed with back before leaving the screen.)
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import BottomSheet from '../BottomSheet';
import { PrimaryButton, SecondaryButton } from '../ui/Buttons';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n';
import { parseDistanceInput } from '../../lib/bagLadder';
import { formatDistance, unitSuffix } from '../../lib/units';

// `row` is a bagLadder row (or null while closed). `onSave(metres)` stores
// your number; 0 clears it.
export default function ClubDistanceSheet({
  row, units, onSave, onClose, onOpenStats,
}) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  const unit = unitSuffix(units);
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  // The row stays rendered through the sheet's exit tween after the parent
  // clears it.
  const shown = useRef(row);
  if (row) shown.current = row;
  const r = shown.current;

  useEffect(() => {
    if (row) {
      setDraft(row.mine != null ? formatDistance(row.mine, units) : '');
      setInvalid(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.club]);

  // Commit the draft if it changed; returns false when it can't be read.
  const commit = () => {
    if (!r) return true;
    const meters = parseDistanceInput(draft, units);
    if (meters == null) { setInvalid(true); return false; }
    const before = r.mine ?? 0;
    if (meters !== before) onSave(r.club, meters);
    return true;
  };

  const save = () => { if (commit()) onClose(); };
  // Scrim / back: keep a valid edit, drop an unreadable one rather than trap
  // the player in the sheet.
  const dismiss = () => { commit(); onClose(); };

  const useMeasured = () => {
    onSave(r.club, Math.round(r.measured));
    onClose();
  };
  const clear = () => {
    onSave(r.club, 0);
    onClose();
  };

  if (!r) return null;
  const count = r.carries.length;
  const placeholder = formatDistance(r.measured ?? r.estimate, units);

  return (
    <BottomSheet visible={!!row} onClose={dismiss} sheetStyle={s.sheet}>
      <View style={s.head}>
        <Text style={s.title} accessibilityRole="header">{r.label}</Text>
        <Text style={[s.source, r.source === 'mine' && s.sourceMine]}>
          {t(`courses.bag.legend.${r.source}`)}
        </Text>
      </View>

      <Text style={s.label} nativeID="bag-distance-label">{t('courses.bag.sheet.label', { unit })}</Text>
      <View style={[s.field, invalid && s.fieldInvalid]}>
        <TextInput
          style={s.input}
          value={draft}
          onChangeText={(v) => { setDraft(v); setInvalid(false); }}
          onSubmitEditing={save}
          keyboardType="number-pad"
          returnKeyType="done"
          autoFocus
          selectTextOnFocus
          maxLength={4}
          placeholder={placeholder}
          placeholderTextColor={theme.text.muted}
          selectionColor={theme.accent.primary}
          keyboardAppearance={theme.isDark ? 'dark' : 'light'}
          accessibilityLabel={t('courses.bag.carryA11y', { club: r.label, unit })}
          accessibilityLabelledBy="bag-distance-label"
          testID="bag-distance-input"
        />
        <Text style={s.unit}>{unit}</Text>
      </View>
      {invalid && <Text style={s.error}>{t('courses.bag.sheet.invalid', { unit })}</Text>}

      <Text style={s.facts}>
        {count > 0
          ? t('courses.bag.sheet.measured', {
            count,
            distance: formatDistance(r.measured, units),
            min: formatDistance(Math.min(...r.carries), units),
            max: formatDistance(Math.max(...r.carries), units),
            unit,
          })
          : t('courses.bag.sheet.noShots', { distance: formatDistance(r.estimate, units), unit })}
      </Text>

      <PrimaryButton label={t('courses.bag.sheet.save')} onPress={save} testID="bag-distance-save" />
      <View style={s.secondaryRow}>
        {r.measured != null && Math.round(r.measured) !== r.mine && (
          <SecondaryButton
            accent
            style={s.flex}
            label={t('courses.bag.sheet.useMeasured', { distance: formatDistance(r.measured, units) })}
            onPress={useMeasured}
          />
        )}
        {r.mine != null && (
          <SecondaryButton style={s.flex} label={t('courses.bag.sheet.clear')} onPress={clear} />
        )}
      </View>
      {count > 0 && (
        <SecondaryButton
          style={s.textBtn}
          accent
          label={t('courses.bag.sheet.history', { count })}
          onPress={() => { commit(); onClose(); onOpenStats(r.club); }}
        />
      )}
    </BottomSheet>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  sheet: { padding: 20, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, lineHeight: 28, color: theme.text.primary },
  source: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.secondary },
  sourceMine: { color: theme.accent.primary },
  label: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.secondary },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: theme.bg.card, borderRadius: 12, borderWidth: 1.5, borderColor: theme.accent.primary,
    paddingHorizontal: 14,
  },
  fieldInvalid: { borderColor: theme.destructive },
  input: {
    flex: 1, minWidth: 0, minHeight: 56, fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 28,
    color: theme.text.primary, fontVariant: ['tabular-nums'], outlineStyle: 'none',
  },
  unit: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: theme.text.secondary },
  error: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.destructive },
  facts: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, lineHeight: 18, color: theme.text.secondary },
  secondaryRow: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  textBtn: { borderWidth: 0, paddingVertical: 8, minHeight: 44 },
});
