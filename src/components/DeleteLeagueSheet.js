// Confirms deleting a league (admin, League settings). Lists what goes, offers
// archiving instead while the league is still active, and keeps the red button
// disabled until the admin types the league name. An in-app sheet rather than
// Alert.alert, which does nothing on web.
//
// Parent controls `visible`, runs the delete in `onConfirm`, and passes back
// `busy` and `error` (shown inside the sheet so a retry is one tap).
import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import BottomSheet from './BottomSheet';
import { leagueNameMatches } from '../store/leagueView';

export default function DeleteLeagueSheet({
  visible, leagueName, memberCount, cardCount, hasFinal, canArchive,
  busy, error, onConfirm, onArchiveInstead, onCancel,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (visible) setTyped('');
  }, [visible]);

  const matches = leagueNameMatches(typed, leagueName);
  const lead = memberCount === 1
    ? "Only you are in it. You can't undo this."
    : `This removes it for all ${memberCount} members. You can't undo this.`;

  const row = (label, value, last, keep) => (
    <View style={[s.listRow, !last && s.rowDivider]}>
      <Text style={s.listLabel}>{label}</Text>
      <Text style={[s.listValue, keep && s.keepValue]}>{value}</Text>
    </View>
  );

  return (
    <BottomSheet visible={visible} onClose={busy ? undefined : onCancel} sheetStyle={s.sheet}>
      <Text style={s.title} accessibilityRole="header">{`Delete ${leagueName}?`}</Text>
      <Text style={s.lead}>{lead}</Text>

      <View style={s.list}>
        {row('Members', String(memberCount), false)}
        {row(cardCount > 0 ? 'Cards, with proof photos' : 'Cards', String(cardCount), false)}
        {row('Handicap history and votes', 'All', !hasFinal)}
        {hasFinal && row('The Final', 'Kept as a game', true, true)}
      </View>

      <Text style={s.label}>Type the league name to confirm</Text>
      <TextInput
        style={[s.input, matches && s.inputMatch]}
        value={typed}
        onChangeText={setTyped}
        placeholder={leagueName}
        placeholderTextColor={theme.text.muted}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        accessibilityLabel="Type the league name to confirm"
        keyboardAppearance={theme.isDark ? 'dark' : 'light'}
        selectionColor={theme.destructive}
      />

      {error ? <Text style={s.error}>{`${/[.!?]$/.test(error) ? error : `${error}.`} Nothing was deleted.`}</Text> : null}

      <TouchableOpacity
        style={[s.deleteBtn, (!matches || busy) && s.deleteBtnOff]}
        onPress={() => matches && !busy && onConfirm()}
        disabled={!matches || busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: !matches || busy, busy }}
        accessibilityHint={matches ? undefined : 'Type the league name first'}
      >
        {busy ? (
          <View style={s.busyRow}>
            <ActivityIndicator color={theme.text.inverse} size="small" />
            <Text style={s.deleteText}>Deleting…</Text>
          </View>
        ) : <Text style={s.deleteText}>Delete the league</Text>}
      </TouchableOpacity>

      {canArchive ? (
        <TouchableOpacity style={s.textBtn} onPress={onArchiveInstead} disabled={busy} accessibilityRole="button">
          <Text style={s.archiveText}>Archive instead</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={s.textBtn} onPress={onCancel} disabled={busy} accessibilityRole="button">
          <Text style={s.cancelText}>Cancel</Text>
        </TouchableOpacity>
      )}
    </BottomSheet>
  );
}

function makeStyles(theme) {
  const cardBorder = theme.isDark ? theme.glass?.border : theme.border.default;
  return StyleSheet.create({
    sheet: {
      backgroundColor: theme.bg.primary,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 20,
      paddingBottom: 32,
      gap: 10,
    },
    title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, lineHeight: 28, color: theme.text.primary },
    lead: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, lineHeight: 18, color: theme.text.secondary },
    list: {
      backgroundColor: theme.bg.card, borderRadius: 14, borderWidth: 1, borderColor: cardBorder,
      paddingHorizontal: 14, paddingVertical: 2,
    },
    listRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, gap: 12 },
    rowDivider: { borderBottomWidth: 1, borderBottomColor: theme.border.subtle },
    listLabel: { flex: 1, fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, color: theme.text.primary },
    listValue: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.text.primary, fontVariant: ['tabular-nums'] },
    keepValue: { color: theme.accent.primary },
    label: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.secondary, marginTop: 4 },
    input: {
      backgroundColor: theme.bg.secondary, color: theme.text.primary, borderRadius: 10, borderWidth: 1,
      borderColor: theme.border.default, padding: 12, minHeight: 46, fontSize: 15, fontFamily: 'PlusJakartaSans-Medium',
    },
    inputMatch: { borderColor: theme.destructive },
    error: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 13, lineHeight: 18 },
    deleteBtn: {
      alignItems: 'center', justifyContent: 'center', backgroundColor: theme.destructive,
      borderRadius: 14, minHeight: 48, paddingVertical: 14, marginTop: 4,
    },
    deleteBtnOff: { opacity: 0.4 },
    busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    deleteText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 14 },
    textBtn: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
    archiveText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13 },
    cancelText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 14 },
  });
}
