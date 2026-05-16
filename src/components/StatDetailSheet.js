import React, { useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, TouchableWithoutFeedback, ScrollView, StyleSheet, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { useTheme } from '../theme/ThemeContext';

// Captures a branded off-screen card and opens the native share sheet (or
// triggers a download on web). Reused by the highlight cards too — see
// ShareableStatCard / shareStatCard in StatsScreen.
export async function captureAndShare(viewRef, fileName = 'golf-stat.png') {
  if (!viewRef?.current) return;
  try {
    if (Platform.OS === 'web') {
      // react-native-view-shot uses html2canvas on web; good enough for a
      // simple flat card and avoids adding a new dependency.
      const uri = await captureRef(viewRef, { format: 'png', quality: 1, result: 'data-uri' });
      const a = document.createElement('a');
      a.href = uri;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }
    const uri = await captureRef(viewRef, { format: 'png', quality: 1 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri);
    }
  } catch (e) {
    console.warn('Share failed:', e);
  }
}

// Off-screen branded card rendered for capture. Shows the sheet's headline and
// up to six data rows so the shared image stays legible.
const ShareableStatCard = React.forwardRef(({ title, subtitle, rows }, ref) => {
  const dataRows = (rows || []).filter(r => !r.section).slice(0, 6);
  return (
    <View ref={ref} collapsable={false} style={shareStyles.card}>
      <Text style={shareStyles.brand}>GOLF PARTNER</Text>
      <Text style={shareStyles.title} numberOfLines={2}>{title}</Text>
      {subtitle ? <Text style={shareStyles.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
      <View style={shareStyles.divider} />
      {dataRows.map((r, i) => (
        <View key={r.key || i} style={shareStyles.row}>
          <Text style={shareStyles.rowPrimary} numberOfLines={1}>{r.primary}</Text>
          {r.rightPrimary != null ? (
            <Text style={shareStyles.rowValue}>{r.rightPrimary}</Text>
          ) : null}
        </View>
      ))}
      <Text style={shareStyles.footer}>golfpartner.app</Text>
    </View>
  );
});
ShareableStatCard.displayName = 'ShareableStatCard';

export default function StatDetailSheet({ visible, onClose, title, subtitle, explainer, rows = [], shareable = true }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const shareRef = useRef(null);
  const [sharing, setSharing] = useState(false);

  const toneColor = (tone) => {
    if (!tone) return theme.text.primary;
    return theme.scoreColor(tone);
  };

  const canShare = shareable && rows.some(r => !r.section);

  const onShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      await captureAndShare(shareRef, `${(title || 'stat').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
    } finally {
      setSharing(false);
    }
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
      {/* Off-screen capture target — positioned out of view, never visible. */}
      <View style={s.captureHost} pointerEvents="none">
        <ShareableStatCard ref={shareRef} title={title} subtitle={subtitle} rows={rows} />
      </View>
      <View style={s.sheet}>
        <View style={s.handle} />
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{title}</Text>
            {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
          </View>
          {canShare ? (
            <TouchableOpacity
              onPress={onShare}
              disabled={sharing}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={[s.shareBtn, sharing && { opacity: 0.4 }]}
            >
              <Feather name="share-2" size={18} color={theme.accent.primary} />
            </TouchableOpacity>
          ) : null}
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
  captureHost: { position: 'absolute', left: -10000, top: 0, width: 360 },
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
  shareBtn: { marginRight: 14, padding: 2 },
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

const shareStyles = StyleSheet.create({
  card: {
    width: 360, backgroundColor: '#006747', borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.4)', padding: 24,
  },
  brand: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: '#ffd700',
    fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8,
  },
  title: { fontFamily: 'PlusJakartaSans-ExtraBold', color: '#ffffff', fontSize: 22, lineHeight: 28 },
  subtitle: { fontFamily: 'PlusJakartaSans-Medium', color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 4 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,215,0,0.4)', marginVertical: 14 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 7,
  },
  rowPrimary: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', color: '#ffffff', fontSize: 13, paddingRight: 10 },
  rowValue: { fontFamily: 'PlusJakartaSans-Bold', color: '#ffd700', fontSize: 14 },
  footer: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: 'rgba(255,255,255,0.45)',
    fontSize: 10, letterSpacing: 1, textAlign: 'center', marginTop: 16,
  },
});
