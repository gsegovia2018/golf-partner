// Confirms a members-admin action (remove a member, release a claimed spot,
// make a new invite code). States the consequence before the button. An
// in-app sheet rather than Alert.alert, which does nothing on web.
//
// The parent runs the action in `onConfirm` and passes back `busy` and
// `error`. `children` sits between the consequences and the button (the
// "also make a new invite code" option).
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n';
import BottomSheet from '../BottomSheet';

export default function MemberAdminSheet({
  visible, title, lead, lines = [], danger = false, action, busy, error, onConfirm, onCancel, children,
}) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  const tone = danger ? theme.destructive : theme.accent.primary;
  return (
    <BottomSheet visible={visible} onClose={busy ? undefined : onCancel} sheetStyle={s.sheet}>
      <Text style={s.title} accessibilityRole="header">{title}</Text>
      {!!lead && <Text style={s.lead}>{lead}</Text>}
      {lines.length > 0 && (
        <View style={s.consequence}>
          {lines.map((line, i) => <Text key={i} style={[s.consequenceText, i > 0 && s.consequenceNext]}>{line}</Text>)}
        </View>
      )}
      {children}
      {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
      <TouchableOpacity
        style={[s.btn, { backgroundColor: tone }, busy && s.btnOff]}
        onPress={() => !busy && onConfirm()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={action}
        accessibilityState={{ disabled: !!busy, busy: !!busy }}
      >
        {busy ? <ActivityIndicator color={theme.text.inverse} size="small" /> : <Text style={s.btnText}>{action}</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={s.textBtn} onPress={onCancel} disabled={busy} accessibilityRole="button">
        <Text style={s.cancelText}>{t('league.members.cancel')}</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    sheet: {
      backgroundColor: theme.bg.primary, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 20, paddingBottom: 32, gap: 10,
    },
    title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, lineHeight: 28, color: theme.text.primary },
    lead: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, lineHeight: 18, color: theme.text.secondary },
    consequence: { backgroundColor: theme.bg.secondary, borderRadius: 12, padding: 12 },
    consequenceText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, lineHeight: 19, color: theme.text.primary },
    consequenceNext: { marginTop: 8, fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary },
    error: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 13, lineHeight: 18 },
    btn: {
      alignItems: 'center', justifyContent: 'center', borderRadius: 14, minHeight: 48, paddingVertical: 14, marginTop: 4,
    },
    btnOff: { opacity: 0.6 },
    btnText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 14 },
    textBtn: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
    cancelText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 14 },
  });
}
