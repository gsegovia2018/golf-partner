// An in-app confirm / notice sheet — the league screens' stand-in for
// Alert.alert (a no-op on web). `useConfirmSheet()` hands back `ask(spec)`,
// which resolves true (confirmed) or false (cancelled / dismissed), and the
// `sheet` element to render once in the screen. A spec with no `confirmLabel`
// is a notice: a single Done button.
import React, { useCallback, useRef, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n';
import BottomSheet from '../BottomSheet';
import { buttonStyles } from '../ui/Buttons';

export function ConfirmSheet({
  visible, title, message, confirmLabel, cancelLabel, destructive, onConfirm, onCancel,
}) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme, destructive);
  const notice = !confirmLabel;
  return (
    <BottomSheet visible={visible} onClose={onCancel} sheetStyle={s.sheet}>
      {title ? <Text style={s.title} accessibilityRole="header">{title}</Text> : null}
      {message ? <Text style={s.message}>{message}</Text> : null}
      <TouchableOpacity
        style={s.confirmBtn}
        onPress={notice ? onCancel : onConfirm}
        activeOpacity={0.8}
        accessibilityRole="button"
      >
        <Text style={s.confirmText}>{notice ? t('common.done') : confirmLabel}</Text>
      </TouchableOpacity>
      {notice ? null : (
        <TouchableOpacity style={s.cancelBtn} onPress={onCancel} accessibilityRole="button">
          <Text style={s.cancelText}>{cancelLabel ?? t('common.cancel')}</Text>
        </TouchableOpacity>
      )}
    </BottomSheet>
  );
}

export function useConfirmSheet() {
  const [spec, setSpec] = useState(null);
  const resolveRef = useRef(null);
  // Kept after dismissal so the copy doesn't blank out while the sheet slides away.
  const lastRef = useRef({});
  if (spec) lastRef.current = spec;

  const ask = useCallback((next) => new Promise((resolve) => {
    if (resolveRef.current) resolveRef.current(false);
    resolveRef.current = resolve;
    setSpec(next);
  }), []);

  const settle = useCallback((value) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setSpec(null);
    if (resolve) resolve(value);
  }, []);

  const sheet = (
    <ConfirmSheet
      {...lastRef.current}
      visible={!!spec}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
  return { ask, sheet };
}

function makeStyles(theme, destructive) {
  const b = buttonStyles(theme);
  return StyleSheet.create({
    sheet: { padding: 20, gap: 10 },
    title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, lineHeight: 28, color: theme.text.primary },
    message: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 14, lineHeight: 20, color: theme.text.secondary },
    confirmBtn: { ...b.primaryBtn, marginTop: 4, ...(destructive ? { backgroundColor: theme.destructive } : null) },
    confirmText: b.primaryText,
    cancelBtn: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
    cancelText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 14 },
  });
}
