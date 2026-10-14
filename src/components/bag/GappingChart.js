// The Bag screen's gapping chart: the bag drawn to scale, one row per club.
// Each row shows the distance club recommendations use (bar + number), your
// own number (solid marker), the measured playing distance (hollow marker)
// and every tracked carry (dots) — so a typed number can be read against the
// shots behind it. Between rows, the gap to the next club; gaps under
// TIGHT_GAP_M are flagged as an overlap. Rows come from lib/bagLadder.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import PressableScale from '../ui/PressableScale';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n';
import { TIGHT_GAP_M } from '../../lib/bagLadder';
import { formatDistance, unitSuffix } from '../../lib/units';

// Dots per row: enough to read the spread, few enough to stay cheap on a
// driver with hundreds of marked shots. Most recent carries win.
const MAX_DOTS = 40;

const pct = (m, max) => `${Math.max(0, Math.min(100, (m / max) * 100))}%`;

export function GappingLegend() {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  return (
    <View style={s.legend}>
      <View style={s.legendItem}><View style={[s.markMine, s.legendMark]} /><Text style={s.legendText}>{t('courses.bag.legend.mine')}</Text></View>
      <View style={s.legendItem}><View style={[s.markMeasured, s.legendMark]} /><Text style={s.legendText}>{t('courses.bag.legend.measured')}</Text></View>
      <View style={s.legendItem}><View style={[s.dot, s.legendDot]} /><Text style={s.legendText}>{t('courses.bag.legend.shot')}</Text></View>
    </View>
  );
}

export default function GappingChart({
  rows, max, units, onPressRow,
}) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  const unit = unitSuffix(units);
  const sourceWord = {
    mine: t('courses.bag.legend.mine'),
    measured: t('courses.bag.legend.measured'),
    estimate: t('courses.bag.legend.estimate'),
  };

  return (
    <View>
      {rows.map((r, i) => {
        const next = rows[i + 1];
        const tight = r.gapToNext != null && r.gapToNext < TIGHT_GAP_M;
        const gapText = r.gapToNext != null ? formatDistance(Math.abs(r.gapToNext), units) : null;
        const a11y = [
          t('courses.bag.rowA11y', {
            club: r.label, distance: formatDistance(r.distance, units), unit, source: sourceWord[r.source],
          }),
          next ? t('courses.bag.gapA11y', { gap: gapText, unit, club: next.label }) : null,
        ].filter(Boolean).join('. ');
        return (
          <React.Fragment key={r.club}>
            <PressableScale
              onPress={() => onPressRow(r)}
              style={s.row}
              accessibilityRole="button"
              accessibilityLabel={a11y}
              accessibilityHint={t('courses.bag.rowHint')}
              testID={`bag-row-${r.club}`}
            >
              <Text style={s.club} numberOfLines={2}>{r.label}</Text>
              <View style={s.track}>
                <View style={[s.bar, r.source === 'estimate' && s.barEst, { width: pct(r.distance, max) }]} />
                {r.carries.slice(-MAX_DOTS).map((m, k) => (
                  <View key={k} style={[s.dot, s.dotAt, { left: pct(m, max) }]} />
                ))}
                {r.measured != null && <View style={[s.markMeasured, s.markAt, { left: pct(r.measured, max) }]} />}
                {r.mine != null && <View style={[s.markMine, s.markAt, { left: pct(r.mine, max) }]} />}
              </View>
              <Text
                style={[s.value, r.source === 'mine' && s.valueMine, r.source === 'estimate' && s.valueEst]}
              >
                {r.source === 'estimate' ? '~' : ''}{formatDistance(r.distance, units)}
              </Text>
            </PressableScale>
            {next && (
              <View style={s.gapRow} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                <Text style={[s.gapText, tight && s.gapTight]}>
                  {tight
                    ? t('courses.bag.gapTight', { gap: gapText, unit })
                    : `${gapText} ${unit}`}
                </Text>
              </View>
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const LABEL_W = 70;
const VALUE_W = 44;

const makeStyles = (theme) => {
  const warning = theme.isDark ? theme.semantic.warning.dark : theme.semantic.warning.light;
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', minHeight: 36, gap: 8 },
    club: {
      width: LABEL_W, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, lineHeight: 16,
      color: theme.text.primary,
    },
    track: { flex: 1, height: 22, justifyContent: 'center' },
    bar: {
      position: 'absolute', left: 0, height: 12, borderRadius: 6,
      backgroundColor: theme.accent.light,
    },
    barEst: { backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary },
    dot: {
      width: 6, height: 6, borderRadius: 3, backgroundColor: theme.accent.primary, opacity: 0.45,
    },
    dotAt: { position: 'absolute', marginLeft: -3 },
    markAt: { position: 'absolute', marginLeft: -2 },
    markMine: {
      width: 4, height: 20, borderRadius: 2, backgroundColor: theme.accent.primary,
    },
    markMeasured: {
      width: 4, height: 20, borderRadius: 2, borderWidth: 1.5, borderColor: theme.accent.primary,
      backgroundColor: theme.bg.card,
    },
    value: {
      width: VALUE_W, textAlign: 'right', fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15,
      color: theme.text.primary, fontVariant: ['tabular-nums'],
    },
    valueMine: { color: theme.accent.primary },
    valueEst: { color: theme.text.secondary, fontFamily: 'PlusJakartaSans-Bold' },
    gapRow: { paddingLeft: LABEL_W + 8, marginVertical: -3 },
    gapText: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10, color: theme.text.muted,
      fontVariant: ['tabular-nums'],
    },
    gapTight: { color: warning, fontFamily: 'PlusJakartaSans-Bold' },

    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, alignItems: 'center' },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendMark: { height: 12 },
    legendDot: { opacity: 0.6 },
    legendText: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.secondary },
  });
};
