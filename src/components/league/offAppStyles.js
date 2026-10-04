import { StyleSheet } from 'react-native';

// Styles shared by the three off-app league screens (announce, add score, add proof).
export function makeOffAppStyles(theme) {
  const cardBorder = theme.isDark ? theme.glass?.border : theme.border.default;
  return StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    header: {
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, gap: 4,
    },
    headerTitle: {
      fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 17, letterSpacing: -0.3, flexShrink: 1,
    },
    content: { padding: 16, paddingBottom: 40 },
    note: {
      flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.bg.secondary,
      borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 12,
    },
    noteText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 12 },
    card: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: cardBorder,
      padding: 16, marginBottom: 14, ...(theme.isDark ? {} : theme.shadow.card),
    },
    cardTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 15, marginBottom: 6 },
    text: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, lineHeight: 19 },
    fieldLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 12, marginBottom: 6, marginTop: 8,
    },
    input: {
      backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
      color: theme.text.primary, borderRadius: 10, borderWidth: 1, borderColor: theme.border.default,
      padding: 14, marginBottom: 8, fontSize: 15, fontFamily: 'PlusJakartaSans-Medium',
    },
    row: { flexDirection: 'row', gap: 10 },
    pickRow: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: theme.bg.card, borderRadius: 12,
      borderWidth: 1, borderColor: theme.border.default, padding: 14, marginBottom: 8,
    },
    pickTitle: { flex: 1, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 14 },
    pickSub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, marginTop: 2 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
    chip: {
      paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: theme.border.default,
    },
    chipOn: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
    chipText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 12 },
    chipTextOn: { color: theme.text.inverse },
    hint: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 12, lineHeight: 17, marginBottom: 8 },
    errorText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 13, lineHeight: 18, marginBottom: 10 },
    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.accent.primary, borderRadius: 14, paddingVertical: 14, marginTop: 8,
    },
    primaryBtnOff: { opacity: 0.4 },
    primaryText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 14 },
    secondaryBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14,
      borderWidth: 1, borderColor: theme.border.default, paddingVertical: 12,
    },
    secondaryText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 14 },
    linkBtn: { alignItems: 'center', paddingVertical: 12 },
    linkText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
    preview: { width: '100%', height: 200, borderRadius: 12, marginBottom: 10, backgroundColor: theme.bg.secondary },
    toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
    toggleTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 14 },
  });
}
