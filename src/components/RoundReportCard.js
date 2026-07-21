import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import PressableScale from './ui/PressableScale';
import ReportVerdictHero from './mystats/ReportVerdictHero';
import ReportCalloutTiles from './mystats/ReportCalloutTiles';
import ReportChapter from './mystats/ReportChapter';
import { buildChapterVM } from './mystats/reportCardView';

const CHAPTER_ICONS = {
  course: 'flag',
  timing: 'clock',
  distribution: 'hash',
  shots: 'crosshair',
};

export default function RoundReportCard({ card, rounds, selectedKey, onSelect, onOpenRound }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const chapters = useMemo(
    () => (card ? card.groups.map((g) => buildChapterVM(g, { hasHistory: card.hasHistory })) : []),
    [card],
  );

  if (!card) {
    return (
      <View style={s.empty}>
        <Feather name="clipboard" size={44} color={theme.text.muted} />
        <Text style={s.emptyText}>No round selected.</Text>
      </View>
    );
  }

  const { round, headline, callouts, hasHistory } = card;

  return (
    <View style={s.wrap}>
      {/* Round selector: course + tournament inline, Change pill opens the picker */}
      <View style={s.dropLine}>
        <View style={{ flex: 1 }}>
          <Text style={s.dropTitle} numberOfLines={1}>{round.courseName}</Text>
          <Text style={s.dropSub} numberOfLines={1}>{round.tournamentName}</Text>
        </View>
        <PressableScale style={s.pickBtn} onPress={() => setPickerOpen(true)}>
          <Text style={s.pickBtnText}>Change</Text>
          <Feather name="chevron-down" size={13} color={theme.accent.primary} />
        </PressableScale>
      </View>

      <ReportVerdictHero headline={headline} round={round} hasHistory={hasHistory} />

      <ReportCalloutTiles callouts={callouts} />

      {/* Remount chapters when the round changes so bar sweeps replay */}
      {chapters.map((ch, i) => (
        <ReportChapter
          key={`${round.key}-${ch.key}`}
          icon={CHAPTER_ICONS[ch.key] ?? 'bar-chart-2'}
          title={ch.label}
          preview={ch.preview}
          rows={ch.rows}
          hasDeltas={ch.hasDeltas}
          initiallyOpen={i === 0}
          testID={`report-chapter-${ch.key}`}
        />
      ))}

      {onOpenRound && (
        <PressableScale
          testID="report-card-open-round"
          style={s.openRoundBtn}
          onPress={onOpenRound}
        >
          <Text style={s.openRoundText}>Round Stats</Text>
          <Feather name="chevron-right" size={16} color={theme.accent.primary} />
        </PressableScale>
      )}

      {/* Round picker modal — unchanged behavior */}
      <Modal statusBarTranslucent hardwareAccelerated visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Choose a round</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {(rounds || []).slice().reverse().map((r) => (
                <TouchableOpacity
                  key={r.key}
                  style={[s.pickRow, r.key === selectedKey && s.pickRowOn]}
                  onPress={() => { onSelect(r.key); setPickerOpen(false); }}
                >
                  <Text style={s.pickName} numberOfLines={1}>{r.courseName}</Text>
                  <Text style={s.pickSub} numberOfLines={1}>{r.tournamentName}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { padding: 4, gap: 12 },
    empty: { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 },
    emptyText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 14 },

    dropLine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 2 },
    dropTitle: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 14, color: theme.text.primary },
    dropSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted, marginTop: 1 },
    pickBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      backgroundColor: theme.accent.light, borderRadius: 999,
      paddingVertical: 6, paddingHorizontal: 11,
    },
    pickBtnText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 11, color: theme.accent.primary },

    openRoundBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      backgroundColor: theme.bg.secondary, borderRadius: 12, padding: 12,
    },
    openRoundText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12, color: theme.accent.primary },

    modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    modalCard: { backgroundColor: theme.bg.card, borderRadius: 16, padding: 16, width: '100%' },
    modalTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 17, color: theme.text.primary, marginBottom: 10 },
    pickRow: { paddingVertical: 11, paddingHorizontal: 10, borderRadius: 10 },
    pickRowOn: { backgroundColor: theme.accent.light },
    pickName: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.primary },
    pickSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted, marginTop: 1 },
  });
}
