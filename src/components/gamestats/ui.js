// Shared bits for the Game Stats tabs: name helpers, the chart/heat palettes
// (tokens only), the common card/section/chip styles and two tiny controls.
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { semantic, onDeep } from '../../theme/tokens';
import { withAlpha } from '../../theme/alpha';
import { t, tr, formatNumber, useT } from '../../i18n';

// A player dropped from the roster stays a thin { id }: render a dash.
export const firstName = (p) => p?.name?.split(' ')[0] ?? '—';

const firstNameCounts = (players) => {
  const counts = new Map();
  players.forEach((p) => counts.set(firstName(p), (counts.get(firstName(p)) || 0) + 1));
  return counts;
};

// "Ana", "Ana & Bea", "Ana, Bea & Carla"; a repeated first name folds to "Ana ×2".
export const joinNames = (players) => {
  const tokens = [...firstNameCounts(players).entries()].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n));
  if (tokens.length <= 1) return tokens[0] || '';
  if (tokens.length === 2) return t('stats.screen.join.two', { a: tokens[0], b: tokens[1] });
  return t('stats.screen.join.many', { list: tokens.slice(0, -1).join(', '), last: tokens[tokens.length - 1] });
};

// The full name when the first name collides with another player's.
export const shortName = (player, players) => (
  firstNameCounts(players).get(firstName(player)) > 1 ? player.name : firstName(player)
);

export const num = (v, opts) => formatNumber(v, opts);
export const signed = (v, opts) => (v > 0 ? '+' : v < 0 ? '−' : '') + formatNumber(Math.abs(v), opts);

// tr() with every numeric param formatted for the active language.
export const trn = (msg) => {
  if (!msg?.params) return tr(msg);
  const params = Object.fromEntries(Object.entries(msg.params).map(([k, v]) => [
    k, typeof v === 'number' && Number.isFinite(v) ? formatNumber(v) : v,
  ]));
  return tr({ ...msg, params });
};

// Series colours for one line per player, in standings order. Lines always
// carry an end label, so colour never has to identify a player on its own.
export function seriesColors(theme) {
  const dark = theme.isDark;
  return [
    theme.accent.primary,
    theme.pairB,
    theme.info,
    semantic.masters.pink,
    dark ? semantic.warning.dark : semantic.warning.light,
    theme.text.secondary,
  ];
}
export const seriesColor = (theme, i) => {
  const list = seriesColors(theme);
  return list[i % list.length];
};

// Scorecard heat: 0 / 1 / 2 / 3 / 4+ Stableford points. Every cell also
// prints its number, so the tint only supports it.
export function heatColors(theme, points) {
  if (points == null) return { bg: 'transparent', fg: theme.text.muted };
  if (points <= 0) return { bg: withAlpha(theme.destructive, 0.16), fg: theme.scoreColor('poor') };
  if (points === 1) return { bg: theme.bg.secondary, fg: theme.text.secondary };
  if (points === 2) return { bg: theme.accent.light, fg: theme.text.primary };
  if (points === 3) return { bg: withAlpha(theme.accent.primary, 0.38), fg: theme.text.primary };
  return { bg: theme.accent.primary, fg: theme.text.inverse };
}

export function useStatStyles() {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  return { theme, s };
}

// Pill chip — filters and the tab row. 36 px tall with a 4 px hit slop.
export function Chip({ label, active, onPress, disabled, testID, accessibilityLabel }) {
  const { s } = useStatStyles();
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel}
      style={[s.chip, active && s.chipActive, disabled && s.chipDisabled]}
    >
      <Text style={[s.chipText, active && s.chipTextActive]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

// Segmented control. `deep` styles it for the deep-green standings card.
export function Segmented({ options, value, onChange, deep }) {
  const { s } = useStatStyles();
  return (
    <View style={[s.seg, deep && s.segDeep]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <TouchableOpacity
            key={o.key}
            onPress={() => onChange(o.key)}
            hitSlop={{ top: 8, bottom: 8 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[s.segItem, on && (deep ? s.segItemOnDeep : s.segItemOn)]}
          >
            <Text style={[s.segText, deep && s.segTextDeep, on && (deep ? s.segTextOnDeep : s.segTextOn)]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// The screen-wide Strokes | Points switch (the scorecard's Golpes / Puntos
// control: accent fill on the active side). Same labels as the scorecard.
export function ModeToggle({ value, onChange, testID }) {
  const { s } = useStatStyles();
  const tt = useT();
  return (
    <View style={s.mode} testID={testID}>
      {['strokes', 'points'].map((m) => {
        const on = m === value;
        return (
          <TouchableOpacity
            key={m}
            testID={testID ? `${testID}-${m}` : undefined}
            onPress={() => onChange(m)}
            hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[s.modeItem, on && s.modeItemOn]}
          >
            <Text style={[s.modeText, on && s.modeTextOn]}>{tt(m === 'strokes' ? 'scorecard.grid.strokes' : 'scorecard.grid.points')}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// `right` is a string (secondary label) or a node (a control).
export function SectionTitle({ children, right }) {
  const { s } = useStatStyles();
  return (
    <View style={s.sectionRow}>
      <Text style={s.sectionTitle} accessibilityRole="header">{children}</Text>
      {typeof right === 'string' ? <Text style={s.sectionRight}>{right}</Text> : (right ?? null)}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.bg.card, borderRadius: 14, padding: 16, marginBottom: 12,
      borderWidth: 1, borderColor: theme.border.default,
    },
    sectionRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10,
    },
    sectionTitle: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase',
      color: theme.text.secondary, flexShrink: 1,
    },
    sectionRight: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.secondary },
    sub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, lineHeight: 17, color: theme.text.secondary },
    body: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 14, color: theme.text.primary },
    strong: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.primary },
    stat: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 17, color: theme.text.primary, fontVariant: ['tabular-nums'] },
    empty: {
      fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: theme.text.secondary,
      textAlign: 'center', paddingVertical: 24, paddingHorizontal: 16,
    },
    note: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: theme.text.secondary, marginTop: 8 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingVertical: 8,
      borderTopWidth: 1, borderTopColor: theme.border.subtle,
    },
    rowFirst: { borderTopWidth: 0 },
    divider: { borderTopWidth: 1, borderTopColor: theme.border.subtle },
    grow: { flex: 1, minWidth: 0 },
    chipRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
    chip: {
      minHeight: 36, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 999,
      backgroundColor: theme.bg.secondary,
    },
    chipActive: { backgroundColor: theme.accent.primary },
    chipDisabled: { opacity: 0.45 },
    chipText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.secondary },
    chipTextActive: { color: theme.text.inverse },
    seg: { flexDirection: 'row', backgroundColor: theme.bg.secondary, borderRadius: 999, padding: 3, gap: 2 },
    segDeep: { backgroundColor: onDeep.fill },
    segItem: { minHeight: 28, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 999 },
    segItemOn: { backgroundColor: theme.bg.card },
    segItemOnDeep: { backgroundColor: onDeep.strong },
    segText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11, color: theme.text.secondary },
    segTextDeep: { color: onDeep.soft },
    segTextOn: { color: theme.text.primary },
    segTextOnDeep: { color: theme.bg.deep },
    mode: { flexDirection: 'row', backgroundColor: theme.bg.secondary, borderRadius: 999, padding: 2, gap: 2 },
    modeItem: { minHeight: 28, justifyContent: 'center', paddingHorizontal: 11, borderRadius: 999 },
    modeItemOn: { backgroundColor: theme.accent.primary },
    modeText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11, color: theme.text.secondary },
    modeTextOn: { color: theme.text.inverse },
    legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 10 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    legendSwatch: { width: 12, height: 12, borderRadius: 3 },
    legendText: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 10, color: theme.text.secondary },
    tiles: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    tile: {
      flex: 1, backgroundColor: theme.bg.card, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 10,
      borderWidth: 1, borderColor: theme.border.default,
    },
    tileValue: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 20, color: theme.text.primary, fontVariant: ['tabular-nums'] },
    tileLabel: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.secondary, marginTop: 2 },
    barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: theme.bg.secondary, overflow: 'hidden' },
    barFill: { height: '100%', borderRadius: 4 },
    rowLabel: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.primary, width: 116 },
    rowValue: {
      fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.text.primary, minWidth: 40, textAlign: 'right',
      fontVariant: ['tabular-nums'],
    },
    link: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.accent.primary },
  });
}
