import React, { useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import BottomSheet from './BottomSheet';
import { useTheme } from '../theme/ThemeContext';
import { scoreCellState } from '../store/officialScoring';

/**
 * Bottom-sheet for resolving a single flagged (discrepancy) hole in an
 * official round. A subject's hole has two entries — their own `self` count
 * and their marker's `marker` count. When the two disagree the hole is a
 * discrepancy; this sheet shows both side by side and lets the viewer adjust
 * whichever entry they own (`editableSource`) until the two match.
 *
 * The sheet does not "save" — `onChange` writes immediately through the
 * official RPC layer. It auto-closes once both entries agree.
 *
 * Props:
 *   visible        — bool
 *   onClose        — () => void
 *   hole           — hole number being resolved
 *   subjectName    — display name of the player whose score this is
 *   selfStrokes    — the subject's own `self` entry (number | null)
 *   markerStrokes  — the marker's `marker` entry (number | null)
 *   markerName     — display name of the player who marks this subject
 *   editableSource — 'self' | 'marker' — which entry the viewer may edit
 *   onChange       — (strokes) => void — adjusts the viewer's own entry
 */
export default function DiscrepancySheet({
  visible, onClose, hole, subjectName,
  selfStrokes, markerStrokes, markerName, editableSource, onChange,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  // Resolve automatically: once the two entries match, the discrepancy is
  // gone — close the sheet rather than leaving a stale "resolve" view open.
  useEffect(() => {
    if (!visible) return;
    if (scoreCellState(selfStrokes, markerStrokes) === 'agreed') onClose?.();
  }, [visible, selfStrokes, markerStrokes, onClose]);

  // Each side: the viewer edits exactly one (the one matching editableSource).
  const editingSelf = editableSource === 'self';
  const editingMarker = editableSource === 'marker';

  const selfValue = selfStrokes == null ? '—' : String(selfStrokes);
  const markerValue = markerStrokes == null ? '—' : String(markerStrokes);

  // Clamp a stepped value to a sane golf range; null entries start at par-ish.
  const step = (current, delta) => {
    const base = current == null ? 4 : current;
    const next = Math.max(1, Math.min(15, base + delta));
    onChange?.(next);
  };

  const renderEntry = (label, value, strokes, isEditable) => (
    <View style={[s.entry, isEditable && s.entryEditable]}>
      <Text style={s.entryLabel} numberOfLines={1}>{label}</Text>
      {isEditable ? (
        <View style={s.stepperRow}>
          <TouchableOpacity
            style={s.stepBtn}
            onPress={() => step(strokes, -1)}
            accessibilityLabel={`Decrease ${label} strokes`}
          >
            <Feather name="minus" size={14} color={theme.text.primary} />
          </TouchableOpacity>
          <Text style={s.entryValue}>{value}</Text>
          <TouchableOpacity
            style={s.stepBtn}
            onPress={() => step(strokes, 1)}
            accessibilityLabel={`Increase ${label} strokes`}
          >
            <Feather name="plus" size={14} color={theme.text.primary} />
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={[s.entryValue, s.entryValueReadOnly]}>{value}</Text>
      )}
      <Text style={s.entryHint}>
        {isEditable ? 'Your entry' : 'Read only'}
      </Text>
    </View>
  );

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={s.sheet}>
      <View style={s.handle} />
          <View style={s.titleRow}>
            <Feather name="alert-circle" size={16} color={theme.destructive} />
            <Text style={s.title}>Resolve hole {hole}</Text>
          </View>
          <Text style={s.subtitle}>
            {subjectName ? `${subjectName}'s score` : 'Score'} doesn't match.
          </Text>

          <View style={s.entryRow}>
            {renderEntry(
              subjectName || 'Player',
              selfValue,
              selfStrokes,
              editingSelf,
            )}
            {renderEntry(
              markerName ? `${markerName} (marker)` : 'Marker',
              markerValue,
              markerStrokes,
              editingMarker,
            )}
          </View>

          <Text style={s.resolveHint}>
            Resolves automatically when both entries match.
          </Text>
    </BottomSheet>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  sheet: {
    backgroundColor: theme.bg.primary,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  handle: {
    alignSelf: 'center', width: 36, height: 4, borderRadius: 2,
    backgroundColor: theme.border.default, marginBottom: 12,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: theme.text.primary,
  },
  subtitle: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, color: theme.text.muted,
    marginTop: 4, marginBottom: 16,
  },
  entryRow: { flexDirection: 'row', gap: 12 },
  entry: {
    flex: 1,
    backgroundColor: theme.bg.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border.default,
    paddingVertical: 16, paddingHorizontal: 12,
    alignItems: 'center',
    gap: 10,
  },
  entryEditable: {
    borderColor: theme.accent.primary + '66',
  },
  entryLabel: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, color: theme.text.primary,
    textAlign: 'center',
  },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: theme.bg.secondary,
    borderWidth: 1, borderColor: theme.border.default,
    alignItems: 'center', justifyContent: 'center',
  },
  entryValue: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 28, color: theme.text.primary,
    minWidth: 36, textAlign: 'center',
  },
  entryValueReadOnly: { color: theme.text.muted },
  entryHint: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted,
  },
  resolveHint: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: theme.text.muted,
    textAlign: 'center', marginTop: 16,
  },
});
