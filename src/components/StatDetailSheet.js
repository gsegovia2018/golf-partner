import React from 'react';
import { Modal, View, Text, TouchableOpacity, TouchableWithoutFeedback, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

export default function StatDetailSheet({ visible, onClose, title, subtitle, explainer, rows = [] }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const toneColor = (tone) => {
    if (!tone) return theme.text.primary;
    return theme.scoreColor(tone);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.backdrop} />
      </TouchableWithoutFeedback>
      <View style={s.sheet}>
        <View style={s.handle} />
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{title}</Text>
            {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="x" size={22} color={theme.text.muted} />
          </TouchableOpacity>
        </View>
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
          {explainer ? (
            <View style={s.explainerBox}>
              <Feather name="info" size={14} color={theme.text.muted} />
              <Text style={s.explainerText}>{explainer}</Text>
            </View>
          ) : null}
          {rows.length === 0 ? (
            <Text style={s.empty}>No details available.</Text>
          ) : rows.map(r => {
            if (r.section) {
              return (
                <View key={r.key} style={s.sectionHeader}>
                  <Text style={s.sectionHeaderText}>{r.label}</Text>
                  {r.rightLabel ? <Text style={s.sectionHeaderRight}>{r.rightLabel}</Text> : null}
                </View>
              );
            }
            return (
              <View key={r.key} style={s.row}>
                <View style={s.rowLeft}>
                  <Text style={s.rowPrimary}>{r.primary}</Text>
                  {r.secondary ? <Text style={s.rowSecondary}>{r.secondary}</Text> : null}
                </View>
                <View style={s.rowRight}>
                  {r.rightPrimary != null ? (
                    <Text style={[s.rowRightPrimary, { color: toneColor(r.tone) }]}>{r.rightPrimary}</Text>
                  ) : null}
                  {r.rightSecondary ? <Text style={s.rowRightSecondary}>{r.rightSecondary}</Text> : null}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: t.bg.primary,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '80%',
    paddingBottom: 32,
    borderTopWidth: 1, borderColor: t.border.default,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: t.border.default,
    alignSelf: 'center', marginTop: 10,
  },
  header: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: t.border.subtle,
  },
  title: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 17 },
  subtitle: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 12, marginTop: 3 },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  empty: { fontFamily: 'PlusJakartaSans-Regular', color: t.text.muted, fontSize: 13, textAlign: 'center', paddingVertical: 24 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: t.border.subtle,
  },
  rowLeft: { flex: 1, paddingRight: 8 },
  rowPrimary: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.primary, fontSize: 13 },
  rowSecondary: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 11, marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  rowRightPrimary: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14 },
  rowRightSecondary: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 11, marginTop: 2 },
  explainerBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: t.bg.secondary, borderRadius: 10, padding: 12,
    marginBottom: 12,
  },
  explainerText: {
    flex: 1,
    fontFamily: 'PlusJakartaSans-Medium', color: t.text.secondary, fontSize: 12, lineHeight: 18,
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 14, paddingBottom: 6, marginTop: 2,
    borderBottomWidth: 1, borderBottomColor: t.accent.primary + '30',
  },
  sectionHeaderText: {
    fontFamily: 'PlusJakartaSans-ExtraBold', color: t.accent.primary,
    fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase',
  },
  sectionHeaderRight: {
    fontFamily: 'PlusJakartaSans-Bold', color: t.text.muted, fontSize: 11,
  },
});
