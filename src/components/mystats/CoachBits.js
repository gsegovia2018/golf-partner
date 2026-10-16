import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n';
import { semantic } from '../../theme/tokens';
import { DRILLS } from '../../store/coachDrills';
import { DRILLS as SWING_DRILLS } from '../../swing/drills';
import { drillText, drillLocation, drillLevelText } from './msg';

// Shared pieces of the Coach tab cards (DiagnosisCard, WeeklyPlanCard).

// "Fix first" / "Your focus": the gold marker for the work (quiet-clubhouse
// rules: gold on the card surface, never a fill).
export function GoldBadge({ label, testID }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={s.badge} testID={testID}>
      <Feather name="target" size={10} color={theme.isDark ? semantic.winner.dark : semantic.winner.light} />
      <Text style={s.badgeText}>{label}</Text>
    </View>
  );
}

// A text chip with a check icon: the evidence is words, never colour alone.
export function EvidenceChip({ label }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={s.chip}>
      <Feather name="check-circle" size={12} color={theme.text.muted} />
      <Text style={s.chipText}>{label}</Text>
    </View>
  );
}

// One drill of a plan (coach catalogue or swing catalogue): name, tags,
// where and how long, and the pass target at its level.
export function DrillLine({ drill, showLocation = true }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const swing = drill.source === 'swing';
  const entry = swing
    ? SWING_DRILLS.find((d) => d.id === drill.drillId)
    : DRILLS.find((d) => d.id === drill.drillId);
  if (!entry) return null;
  const title = swing ? entry.title : drillText(entry, 'title');
  const pass = swing ? entry.passTarget : drillLevelText(entry, drill.level);
  const where = swing ? drillLocation('range') : drillLocation(entry.location);
  const meta = [showLocation ? where : null, t('stats.my.coach.ui.fix.minutes', { minutes: drill.minutes })]
    .filter(Boolean).join(' · ');
  return (
    <View style={s.drill} testID={`drill-${drill.drillId}`}>
      <View style={s.drillHead}>
        <Text style={s.drillTitle}>
          {title}
          {swing ? <Text style={s.tag}>{`  ${t('stats.my.coach.ui.fix.swingTag')}`}</Text> : null}
          {!swing && drill.level ? <Text style={s.tag}>{`  ${t('stats.my.coach.ui.fix.level', { level: drill.level })}`}</Text> : null}
        </Text>
        <Text style={s.drillMeta}>{meta}</Text>
      </View>
      {pass ? <Text style={s.pass}>{t('stats.my.coach.ui.fix.pass', { target: pass })}</Text> : null}
    </View>
  );
}

function makeStyles(theme) {
  const gold = theme.isDark ? semantic.winner.dark : semantic.winner.light;
  return StyleSheet.create({
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: theme.isDark ? 'rgba(255,215,0,0.16)' : 'rgba(169,130,30,0.12)',
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 4,
    },
    badgeText: {
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: gold,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: theme.bg.secondary,
    },
    chipText: { fontSize: 11, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary },
    drill: { gap: 2 },
    drillHead: { gap: 1 },
    drillTitle: { ...theme.typography.body, color: theme.text.primary, fontWeight: '800' },
    tag: { ...theme.typography.caption, color: theme.text.secondary, fontWeight: '700' },
    drillMeta: { ...theme.typography.caption, color: theme.text.muted },
    pass: { ...theme.typography.caption, color: theme.info, fontWeight: '700' },
  });
}
