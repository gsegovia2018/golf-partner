import React, {
  useEffect, useMemo, useRef, useState,
} from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import PressableScale from '../ui/PressableScale';
import { hud } from '../../theme/tokens';
import { formatDistance, unitSuffix } from '../../lib/units';
import { haptic } from '../../lib/haptics';

const ITEM_H = 48;
const VISIBLE = 5; // odd, so one row sits dead-centre
const WHEEL_H = ITEM_H * VISIBLE;
const PAD = (WHEEL_H - ITEM_H) / 2;

// Modal club chooser shown after a spot is placed (or when editing a shot).
// The club list is a vertical WHEEL: each row is a club with its typical carry,
// ordered longest→shortest, and it opens centred on `value` (the club that best
// matches the shot). The header frames it by distance — the carry just made and
// how far is left to the target — so you pick against the number that matters.
//
// clubs: [{ key, label, distance }] (distance in metres, measured or nominal).
export function ClubWheel({
  visible, clubs, value, units,
  seqLabel, carryMeters, toPinMeters,
  onSelect, onMove, onInsert, onDelete, onClose,
}) {
  const ref = useRef(null);
  const initialIndex = useMemo(() => {
    const i = clubs.findIndex((c) => c.key === value);
    return i >= 0 ? i : Math.floor(clubs.length / 2);
  }, [clubs, value]);
  const [focus, setFocus] = useState(initialIndex);

  // Centre the wheel on the initial club whenever it (re)opens.
  useEffect(() => {
    if (!visible) return;
    setFocus(initialIndex);
    const id = setTimeout(() => ref.current?.scrollTo({ y: initialIndex * ITEM_H, animated: false }), 0);
    return () => clearTimeout(id);
  }, [visible, initialIndex]);

  const onScroll = (e) => {
    const i = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
    const clamped = Math.max(0, Math.min(clubs.length - 1, i));
    if (clamped !== focus) { setFocus(clamped); haptic('selection'); }
  };

  const confirm = () => { onSelect?.(clubs[focus]?.key); };
  const suffix = unitSuffix(units);

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.card} onPress={() => {}}>
          <Text style={s.title}>{seqLabel || 'Club'}</Text>
          <Text style={s.sub}>
            {[
              carryMeters != null ? `carried ${formatDistance(carryMeters, units)}${suffix}` : null,
              toPinMeters != null ? `${formatDistance(toPinMeters, units)}${suffix} to pin` : null,
            ].filter(Boolean).join(' · ') || 'Which club got the ball here?'}
          </Text>

          <View style={s.wheelWrap}>
            <View pointerEvents="none" style={s.selBand} />
            <ScrollView
              ref={ref}
              style={s.wheel}
              showsVerticalScrollIndicator={false}
              snapToInterval={ITEM_H}
              decelerationRate="fast"
              scrollEventThrottle={16}
              onScroll={onScroll}
              contentContainerStyle={{ paddingVertical: PAD }}
            >
              {clubs.map((c, i) => {
                const active = i === focus;
                return (
                  <Pressable
                    key={c.key}
                    style={s.row}
                    onPress={() => ref.current?.scrollTo({ y: i * ITEM_H, animated: true })}
                  >
                    <Text style={[s.rowClub, active && s.rowClubActive]} numberOfLines={1}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <PressableScale style={s.confirm} onPress={confirm}>
            <Text style={s.confirmText}>{`Set ${clubs[focus]?.label ?? ''}`}</Text>
          </PressableScale>

          {(onMove || onInsert || onDelete) && (
            <View style={s.editRow}>
              {onMove && (
                <PressableScale style={s.editBtn} onPress={onMove} accessibilityLabel="Move this shot">
                  <Feather name="move" size={15} color={hud.textSoft} />
                  <Text style={s.editText}>Move</Text>
                </PressableScale>
              )}
              {onInsert && (
                <PressableScale style={s.editBtn} onPress={onInsert} accessibilityLabel="Add a shot after this one">
                  <Feather name="plus" size={15} color={hud.textSoft} />
                  <Text style={s.editText}>Add after</Text>
                </PressableScale>
              )}
              {onDelete && (
                <PressableScale style={s.editBtn} onPress={onDelete} accessibilityLabel="Delete this shot">
                  <Feather name="trash-2" size={15} color={hud.danger} />
                  <Text style={[s.editText, s.editTextDanger]}>Delete</Text>
                </PressableScale>
              )}
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: hud.scrim,
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  card: {
    width: '100%', maxWidth: 340,
    backgroundColor: hud.card, borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth, borderColor: hud.line,
    padding: 18,
  },
  title: {
    color: hud.text, fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, textAlign: 'center',
  },
  sub: {
    color: hud.textMuted, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12,
    textAlign: 'center', marginTop: 2, fontVariant: ['tabular-nums'],
  },

  wheelWrap: { height: WHEEL_H, marginTop: 14, marginBottom: 4, justifyContent: 'center' },
  selBand: {
    position: 'absolute', left: 0, right: 0, top: PAD, height: ITEM_H,
    borderRadius: 12, backgroundColor: hud.accent + '24',
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: hud.accent + '66',
  },
  wheel: { flexGrow: 0 },
  row: {
    height: ITEM_H, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  rowClub: {
    color: hud.textDim, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 16,
  },
  rowClubActive: { color: hud.text, fontFamily: 'PlusJakartaSans-Bold', fontSize: 18 },
  rowDist: {
    color: hud.textMuted, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  rowDistActive: { color: hud.accent, fontFamily: 'PlusJakartaSans-Bold', fontSize: 14 },

  confirm: {
    marginTop: 12, backgroundColor: hud.accent, borderRadius: 12,
    paddingVertical: 13, alignItems: 'center',
  },
  confirmText: { color: hud.onAccent, fontFamily: 'PlusJakartaSans-Bold', fontSize: 15 },

  editRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  editBtn: {
    flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 11, borderRadius: 12, backgroundColor: hud.fill,
  },
  editText: { color: hud.textSoft, fontFamily: 'PlusJakartaSans-Bold', fontSize: 13 },
  editTextDanger: { color: hud.danger },
});
