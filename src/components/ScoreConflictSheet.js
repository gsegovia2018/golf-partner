import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import BottomSheet from './BottomSheet';
import { useTheme } from '../theme/ThemeContext';

const CONFLICT = '#c77a0a';
const DEFAULT_STROKES = 4; // par-ish fallback when no current value exists

// Compact relative time for a candidate's edit timestamp.
function relTime(ts) {
  if (!ts) return '';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h ago`;
  return `${Math.floor(hr / 24)} d ago`;
}

/**
 * Bottom sheet for resolving a casual-round score conflict. One player's hole
 * score was recorded with two (or more) different values by two devices; the
 * merge kept one provisionally. This sheet shows every competing value and lets
 * anyone pick the correct one (or enter a different number).
 *
 * Props:
 *   visible       — bool
 *   onClose       — () => void
 *   hole          — hole number being resolved
 *   subjectName   — display name of the player whose score this is
 *   candidates    — [{ value, ts }] competing values, mine-first (local
 *                   value first)
 *   currentValue  — the value currently kept in scores (the LWW winner)
 *   onResolve     — (value) => void — picks the final value
 */
export default function ScoreConflictSheet({
  visible, onClose, hole, subjectName, candidates, currentValue, onResolve,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [picked, setPicked] = useState(null);
  const [manual, setManual] = useState(currentValue ?? DEFAULT_STROKES);

  // Reset whenever the sheet (re)opens.
  useEffect(() => {
    if (visible) { setPicked(null); setManual(currentValue ?? DEFAULT_STROKES); }
  }, [visible, currentValue]);

  const list = Array.isArray(candidates) ? candidates : [];

  const stepManual = (delta) => {
    const next = Math.max(1, Math.min(15, manual + delta));
    setManual(next);
    setPicked(next);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={s.sheet}>
      <View style={s.handle} />
          <View style={s.titleRow}>
            <Feather name="alert-circle" size={16} color={CONFLICT} />
            <Text style={s.title}>Resolve hole {hole}</Text>
          </View>
          <Text style={s.subtitle}>
            Two phones recorded a different score for {subjectName || 'this player'}. Pick the correct one.
          </Text>

          <View style={s.cardsRow}>
            {list.map((c) => {
              const isPicked = picked === c.value;
              return (
                <TouchableOpacity
                  key={`${c.value}-${c.ts}`}
                  style={[s.card, isPicked && s.cardPicked]}
                  onPress={() => { setPicked(c.value); setManual(c.value); }}
                  activeOpacity={0.8}
                  accessibilityLabel={
                    c.value == null
                      ? `Use no score for ${subjectName || 'this player'}`
                      : `Use ${c.value} ${c.value === 1 ? 'stroke' : 'strokes'} for ${subjectName || 'this player'}`
                  }
                >
                  {isPicked && (
                    <View style={s.tick}>
                      <Feather name="check" size={12} color={theme.text.inverse} />
                    </View>
                  )}
                  <Text style={s.cardLabel}>
                    {c.value === currentValue ? 'Current score' : 'Other entry'}
                  </Text>
                  <Text style={s.cardValue}>{c.value == null ? '—' : c.value}</Text>
                  <Text style={s.cardHint}>{relTime(c.ts)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={s.manualRow}>
            <Text style={s.manualLabel}>Or enter a different score</Text>
            <View style={s.stepper}>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => stepManual(-1)}
                accessibilityLabel={subjectName ? `Decrease ${subjectName}'s score` : 'Decrease score'}
              >
                <Feather name="minus" size={18} color={theme.text.primary} />
              </TouchableOpacity>
              <Text style={s.manualValue}>{manual}</Text>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => stepManual(1)}
                accessibilityLabel={subjectName ? `Increase ${subjectName}'s score` : 'Increase score'}
              >
                <Feather name="plus" size={18} color={theme.text.primary} />
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[s.confirm, picked == null && s.confirmDisabled]}
            disabled={picked == null}
            onPress={() => { if (picked != null) onResolve?.(picked); }}
            activeOpacity={0.8}
          >
            <Text style={[s.confirmText, picked == null && s.confirmTextDisabled]}>
              {picked == null
                ? 'Pick a score'
                : `Confirm ${picked} ${picked === 1 ? 'stroke' : 'strokes'}`}
            </Text>
          </TouchableOpacity>
          <Text style={s.foot}>Anyone in the group can resolve this · syncs to every phone</Text>
    </BottomSheet>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  sheet: {
    backgroundColor: theme.bg.primary,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24,
    width: '100%', maxWidth: 560, alignSelf: 'center',
  },
  handle: {
    alignSelf: 'center', width: 36, height: 4, borderRadius: 2,
    backgroundColor: theme.border.default, marginBottom: 12,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: theme.text.primary },
  subtitle: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, color: theme.text.muted,
    marginTop: 4, marginBottom: 16,
  },
  cardsRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  card: {
    flexGrow: 1, flexBasis: 0, minWidth: 120,
    backgroundColor: theme.bg.card,
    borderRadius: 14, borderWidth: 1.5, borderColor: theme.border.default,
    paddingVertical: 16, paddingHorizontal: 12,
    alignItems: 'center', gap: 6, position: 'relative',
  },
  cardPicked: { borderColor: theme.accent.primary, backgroundColor: theme.accent.light },
  tick: {
    position: 'absolute', top: 8, right: 8,
    width: 20, height: 20, borderRadius: 10, backgroundColor: theme.accent.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  cardLabel: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 11, color: theme.text.muted,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  cardValue: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 30, color: theme.text.primary,
  },
  cardHint: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted },
  manualRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 16, paddingTop: 16,
    borderTopWidth: 1, borderTopColor: theme.border.default,
  },
  manualLabel: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: theme.text.secondary },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: theme.bg.secondary,
    borderWidth: 1, borderColor: theme.border.default,
    alignItems: 'center', justifyContent: 'center',
  },
  manualValue: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 20, color: theme.text.primary,
    minWidth: 24, textAlign: 'center',
  },
  confirm: {
    marginTop: 18, backgroundColor: theme.accent.primary,
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  confirmDisabled: { backgroundColor: theme.bg.secondary },
  confirmText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15, color: theme.text.inverse },
  confirmTextDisabled: { color: theme.text.muted },
  foot: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted,
    textAlign: 'center', marginTop: 10,
  },
});
