// Side-bet stakes editor (setup review + game settings). Each bet is a switch
// with amount chips; "Other" takes a typed amount. Saves { pot, perPoint, skin }
// in cents, or null when every bet is off. Money logic lives in store/sideBets.
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import Switch from './ui/Switch';
import Collapse from './ui/Collapse';
import BottomSheet from './BottomSheet';
import SheetHandle from './ui/SheetHandle';
import { PrimaryButton } from './ui/Buttons';
import { useTheme } from '../theme/ThemeContext';
import { useT } from '../i18n';
import { normalizeStakes, parseEuros, formatEuros } from '../store/sideBets';

const BETS = [
  { key: 'pot', presets: [500, 1000, 2000] },
  { key: 'perPoint', presets: [50, 100, 200] },
  { key: 'skin', presets: [50, 100, 200] },
];

function draftFrom(stakes) {
  const s = normalizeStakes(stakes);
  return Object.fromEntries(BETS.map(({ key, presets }) => {
    const amount = s[key] || presets[1];
    const other = !presets.includes(amount);
    return [key, { on: s[key] > 0, amount, other, text: other ? String(amount / 100) : '' }];
  }));
}

export function stakesSummary(stakes, t) {
  const s = normalizeStakes(stakes);
  const parts = BETS.filter(({ key }) => s[key] > 0)
    .map(({ key }) => t(`stakes.summary.${key}`, { amount: formatEuros(s[key]) }));
  return parts.length ? parts.join(' · ') : t('stakes.none');
}

export default function StakesSheet({ visible, value, playerCount = 0, noSkins = false, onSave, onClose }) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  const [draft, setDraft] = useState(() => draftFrom(value));
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (visible) setDraft(draftFrom(value)); }, [visible, value]);

  const set = (key, patch) => setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch } }));
  const amountOf = (b) => (b.other ? parseEuros(b.text) : b.amount);
  const invalid = (key) => {
    const b = draft[key];
    if (!b.on || !b.other) return false;
    const v = amountOf(b);
    return v == null || v <= 0;
  };
  const active = (key) => draft[key].on && !(key === 'skin' && noSkins) && !invalid(key);
  const hasError = BETS.some(({ key }) => invalid(key));

  const examples = [];
  if (active('pot')) examples.push(t('stakes.example.pot', { count: playerCount, amount: formatEuros(amountOf(draft.pot) * playerCount) }));
  if (active('perPoint')) examples.push(t('stakes.example.perPoint', { amount: formatEuros(amountOf(draft.perPoint)) }));
  if (active('skin')) examples.push(t('stakes.example.skin', { amount: formatEuros(amountOf(draft.skin)) }));

  async function save() {
    const stakes = Object.fromEntries(BETS.map(({ key }) => [key, active(key) ? amountOf(draft[key]) : 0]));
    setBusy(true);
    try {
      await onSave(Object.values(stakes).some((v) => v > 0) ? stakes : null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={s.sheet}>
      <SheetHandle />
      <Text style={s.title}>{t('stakes.title')}</Text>
      {BETS.map(({ key, presets }, i) => {
        const b = draft[key];
        const blocked = key === 'skin' && noSkins;
        return (
          <View key={key} style={[s.bet, i > 0 && s.betDivider]}>
            <View style={s.betHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.betName}>{t(`stakes.bet.${key}`)}</Text>
                <Text style={s.help}>{t(blocked ? 'stakes.bet.skin.scramble' : `stakes.bet.${key}.help`)}</Text>
              </View>
              <Switch
                value={b.on && !blocked}
                disabled={blocked}
                onValueChange={(on) => set(key, { on })}
                trackColor={{ false: theme.bg.secondary, true: theme.accent.primary }}
                thumbColor="#fff"
                accessibilityLabel={t(`stakes.bet.${key}`)}
                testID={`stakes-switch-${key}`}
              />
            </View>
            <Collapse open={b.on && !blocked}>
              <View style={s.chips}>
                {presets.map((p) => {
                  const on = !b.other && b.amount === p;
                  return (
                    <TouchableOpacity
                      key={p}
                      style={[s.chip, on && s.chipOn]}
                      onPress={() => set(key, { amount: p, other: false })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[s.chipText, on && s.chipTextOn]}>{formatEuros(p)}</Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  style={[s.chip, b.other && s.chipOn]}
                  onPress={() => set(key, { other: true })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: b.other }}
                >
                  <Text style={[s.chipText, b.other && s.chipTextOn]}>{t('stakes.other')}</Text>
                </TouchableOpacity>
              </View>
              {b.other && (
                <TextInput
                  style={[s.input, invalid(key) && b.text !== '' && s.inputErr]}
                  value={b.text}
                  onChangeText={(text) => set(key, { text })}
                  keyboardType="decimal-pad"
                  placeholder="0.50"
                  placeholderTextColor={theme.text.muted}
                  accessibilityLabel={t('stakes.otherA11y')}
                  testID={`stakes-input-${key}`}
                />
              )}
              {invalid(key) && b.text !== '' && <Text style={s.err}>{t('stakes.error.amount')}</Text>}
            </Collapse>
          </View>
        );
      })}
      <Text style={s.example}>{examples.length ? examples.join(' ') : t('stakes.example.none')}</Text>
      <PrimaryButton label={t('stakes.save')} onPress={save} disabled={hasError} busy={busy} testID="stakes-save" />
    </BottomSheet>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    sheet: {
      backgroundColor: theme.bg.primary,
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      paddingTop: 10, paddingBottom: 32, paddingHorizontal: 20,
      borderWidth: 1, borderBottomWidth: 0, borderColor: theme.border.default,
    },
    title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary, marginBottom: 4 },
    bet: { paddingVertical: 12, gap: 10 },
    betDivider: { borderTopWidth: 1, borderTopColor: theme.border.subtle },
    betHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    betName: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.primary },
    help: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: theme.text.secondary, marginTop: 2 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      minHeight: 36, paddingHorizontal: 14, borderRadius: 9999, justifyContent: 'center',
      backgroundColor: theme.bg.secondary,
    },
    chipOn: { backgroundColor: theme.accent.primary },
    chipText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.primary },
    chipTextOn: { color: theme.text.inverse },
    input: {
      borderWidth: 1, borderColor: theme.border.default, borderRadius: 10, padding: 12,
      backgroundColor: theme.bg.card, color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-Medium', fontSize: 14,
    },
    inputErr: { borderColor: theme.destructive },
    err: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: theme.destructive },
    example: {
      fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: theme.text.primary,
      backgroundColor: theme.accent.light, borderRadius: 10, padding: 10, marginVertical: 12,
    },
  });
}
