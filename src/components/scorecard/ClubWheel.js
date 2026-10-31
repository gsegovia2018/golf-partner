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
import { useT } from '../../i18n';
import { clubAverages } from '../../lib/shotStats';
import { swingClubs, clubLabel, clubNominal } from '../../lib/clubs';

// The wheel's rows for a bag: each club with its carry — the player's own
// override, else their measured average from `shots`, else the nominal.
export function wheelClubsFor(bag, overrides, shots) {
  const averages = clubAverages(shots);
  return swingClubs(bag).map((k) => {
    const o = overrides?.[k];
    const distance = (Number.isFinite(o) && o > 0) ? o : (averages.get(k) ?? clubNominal(k));
    return { key: k, label: clubLabel(k), distance };
  });
}

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
// pickClub=false drops the wheel and its confirm, leaving the edit buttons and
// a Close — for a spot that takes no club (the first putt, on the green).
export function ClubWheel({
  visible, clubs, value, units, pickClub = true,
  seqLabel, carryMeters, toPinMeters,
  onSelect, onMove, onInsert, onRepeat, onDelete, onClose,
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
  const tl = useT();

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.card} onPress={() => {}}>
          <Text style={s.title}>{seqLabel || tl('shots.wheel.club')}</Text>
          <Text style={s.sub}>
            {[
              carryMeters != null ? tl('shots.wheel.carried', { distance: `${formatDistance(carryMeters, units)}${suffix}` }) : null,
              toPinMeters != null ? tl('shots.wheel.toPin', { distance: `${formatDistance(toPinMeters, units)}${suffix}` }) : null,
            ].filter(Boolean).join(' · ') || tl('shots.wheel.prompt')}
          </Text>

          {pickClub && (
            <>
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
                <Text style={s.confirmText}>{tl('shots.wheel.set', { club: clubs[focus]?.label ?? '' })}</Text>
              </PressableScale>
            </>
          )}

          {(onMove || onInsert || onRepeat || onDelete) && (
            <View style={s.editRow}>
              {onMove && (
                <PressableScale style={s.editBtn} onPress={onMove} accessibilityLabel={tl('shots.wheel.moveA11y')}>
                  <Feather name="move" size={15} color={hud.textSoft} />
                  <Text style={s.editText}>{tl('shots.wheel.move')}</Text>
                </PressableScale>
              )}
              {onInsert && (
                <PressableScale style={s.editBtn} onPress={onInsert} accessibilityLabel={tl('shots.wheel.addAfterA11y')}>
                  <Feather name="plus" size={15} color={hud.textSoft} />
                  <Text style={s.editText}>{tl('shots.wheel.addAfter')}</Text>
                </PressableScale>
              )}
              {onRepeat && (
                <PressableScale style={s.editBtn} onPress={onRepeat} accessibilityLabel={tl('shots.seen.plusOneA11y')}>
                  <Feather name="rotate-ccw" size={15} color={hud.textSoft} />
                  <Text style={s.editText}>{tl('shots.seen.plusOne')}</Text>
                </PressableScale>
              )}
              {onDelete && (
                <PressableScale style={s.editBtn} onPress={onDelete} accessibilityLabel={tl('shots.wheel.deleteA11y')}>
                  <Feather name="trash-2" size={15} color={hud.danger} />
                  <Text style={[s.editText, s.editTextDanger]}>{tl('shots.wheel.delete')}</Text>
                </PressableScale>
              )}
            </View>
          )}

          {!pickClub && (
            <PressableScale style={[s.editBtn, s.closeBtn]} onPress={onClose} accessibilityLabel={tl('shots.wheel.close')}>
              <Text style={s.editText}>{tl('shots.wheel.close')}</Text>
            </PressableScale>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// The same wheel, small and in place: three rows with each club's carry, for a
// card that picks a club and acts on it (a seen pin: Add · <club>). Opens on
// `value` (the middle club without one) and reports every club it settles on.
const MINI_H = 44;
const MINI_VISIBLE = 3;

export function InlineClubWheel({ clubs, value, units, onChange, style }) {
  const ref = useRef(null);
  const start = useMemo(() => {
    const i = clubs.findIndex((c) => c.key === value);
    return i >= 0 ? i : Math.floor(clubs.length / 2);
  }, [clubs, value]);
  const [focus, setFocus] = useState(start);
  const tl = useT();
  const suffix = unitSuffix(units);

  useEffect(() => {
    setFocus(start);
    onChange?.(clubs[start]?.key ?? null);
    const id = setTimeout(() => ref.current?.scrollTo({ y: start * MINI_H, animated: false }), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  const onScroll = (e) => {
    const i = Math.max(0, Math.min(clubs.length - 1, Math.round(e.nativeEvent.contentOffset.y / MINI_H)));
    if (i === focus) return;
    setFocus(i);
    haptic('selection');
    onChange?.(clubs[i]?.key ?? null);
  };

  return (
    <View
      style={[s.mini, style]}
      accessibilityRole="adjustable"
      accessibilityLabel={tl('shots.wheel.club')}
      accessibilityValue={{ text: clubs[focus]?.label ?? '' }}
      testID="inline-club-wheel"
    >
      <View pointerEvents="none" style={s.miniBand} />
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={MINI_H}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={onScroll}
        nestedScrollEnabled
        testID="inline-club-wheel-scroll"
        contentContainerStyle={{ paddingVertical: MINI_H * ((MINI_VISIBLE - 1) / 2) }}
      >
        {clubs.map((c, i) => {
          const active = i === focus;
          return (
            <Pressable
              key={c.key}
              style={s.miniRow}
              onPress={() => ref.current?.scrollTo({ y: i * MINI_H, animated: true })}
              testID={`inline-club-${c.key}`}
            >
              <Text style={[s.miniClub, active && s.miniClubActive]} numberOfLines={1}>{c.label}</Text>
              {c.distance != null && c.distance > 0 ? (
                <Text style={[s.rowDist, s.miniDist, active && s.rowDistActive, active && s.miniDistActive]}>
                  {`${formatDistance(c.distance, units)} ${suffix}`}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
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
  closeBtn: { flex: 0, marginTop: 10 },

  mini: {
    height: MINI_H * MINI_VISIBLE, borderRadius: 12, overflow: 'hidden',
    backgroundColor: hud.inset, borderWidth: 1, borderColor: hud.border,
  },
  miniBand: {
    position: 'absolute', left: 0, right: 0, top: MINI_H, height: MINI_H,
    borderRadius: 12, backgroundColor: hud.accent + '24',
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: hud.accent + '66',
  },
  miniRow: {
    height: MINI_H, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 10, gap: 6,
  },
  miniClub: { flexShrink: 1, color: hud.textDim, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13 },
  miniClubActive: { color: hud.text, fontFamily: 'PlusJakartaSans-Bold', fontSize: 15 },
  miniDist: { fontSize: 11 },
  miniDistActive: { fontSize: 12 },
});
