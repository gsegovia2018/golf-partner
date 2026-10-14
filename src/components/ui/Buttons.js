// The league screens' two button shapes, declared once. `buttonStyles(theme)`
// is the style set for screens that already render their own touchables (spread
// it into makeStyles, then override margins locally); PrimaryButton and
// SecondaryButton are the ready-made components for new code.
//
// Primary: Clubhouse Green, ExtraBold 14, 14px radius, 14px vertical padding.
// Secondary: hairline border, Slate text (Bold 14). `secondaryTextAccent` is
// the green-text variant used inside sheets and beside a primary action.
import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

export function buttonStyles(theme) {
  return {
    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.accent.primary, borderRadius: 14, paddingVertical: 14, minHeight: 48,
    },
    primaryText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 14 },
    secondaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 14,
      borderWidth: 1, borderColor: theme.border.default, paddingVertical: 14, paddingHorizontal: 16, minHeight: 48,
    },
    secondaryText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 14 },
    secondaryTextAccent: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
  };
}

function Base({
  variant, label, onPress, disabled, busy, accent, style, textStyle, children, ...rest
}) {
  const { theme } = useTheme();
  const b = buttonStyles(theme);
  const primary = variant === 'primary';
  const textBase = primary ? b.primaryText : (accent ? b.secondaryTextAccent : b.secondaryText);
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      {...rest}
      onPress={onPress}
      disabled={disabled || busy}
      style={[primary ? b.primaryBtn : b.secondaryBtn, (disabled || busy) && styles.off, style]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? theme.text.inverse : theme.text.secondary} />
      ) : (
        <>
          {children}
          {label != null ? <Text style={[textBase, textStyle]}>{label}</Text> : null}
        </>
      )}
    </TouchableOpacity>
  );
}

export function PrimaryButton(props) { return <Base variant="primary" {...props} />; }
export function SecondaryButton(props) { return <Base variant="secondary" {...props} />; }

const styles = StyleSheet.create({ off: { opacity: 0.5 } });
