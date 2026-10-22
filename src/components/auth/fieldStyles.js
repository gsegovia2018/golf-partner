import { StyleSheet } from 'react-native';

// Field, label and primary-button styles shared by the login form and the
// set-new-password form. Opaque field fill and a border with real contrast on
// both themes; the disabled button keeps readable text instead of fading.
export default function makeFieldStyles(theme) {
  const fieldBg = theme.isDark ? '#13221b' : '#ffffff';
  const fieldBorder = theme.isDark ? 'rgba(255,255,255,0.16)' : '#d9d3c4';
  return StyleSheet.create({
    heading: {
      fontFamily: 'PlusJakartaSans-Bold', fontSize: 22, lineHeight: 28,
      color: theme.text.primary, marginBottom: 16,
    },
    label: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13,
      color: theme.text.primary, marginBottom: 6,
    },
    labelGap: { marginTop: 14 },
    input: {
      height: 50, backgroundColor: fieldBg,
      color: theme.text.primary, borderRadius: 12, borderWidth: 1,
      borderColor: fieldBorder, paddingHorizontal: 14, fontSize: 16,
      fontFamily: 'PlusJakartaSans-Medium',
    },
    inputFocused: { borderColor: theme.accent.primary },
    inputError: { borderColor: theme.destructive },
    fieldError: {
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 12, color: theme.destructive,
      marginTop: 6, marginLeft: 2,
    },
    btn: {
      height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.accent.primary,
    },
    btnDisabled: { backgroundColor: theme.isDark ? '#1b3328' : '#dfe8e3' },
    btnText: {
      fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: theme.text.inverse,
      textAlign: 'center',
    },
    btnTextDisabled: { color: theme.isDark ? '#a9b8b0' : '#3f5a4c' },
    fieldBorderColor: { borderColor: fieldBorder },
  });
}
