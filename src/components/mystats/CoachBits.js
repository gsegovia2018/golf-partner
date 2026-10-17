import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useT, formatNumber } from '../../i18n';
import { semantic } from '../../theme/tokens';
import { DRILLS } from '../../store/coachDrills';
import { DRILLS as SWING_DRILLS } from '../../swing/drills';
import { MAX_LEVEL } from '../../store/coachFocus';
import PressableScale from '../ui/PressableScale';
import DrillSheet from './DrillSheet';
import { drillText, drillLocation, drillLevelText, metricValueText, renderMsg } from './msg';

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

// A drill resolved against its catalogue (coach or swing); null for an id the
// catalogues do not have. Shared by DrillLine and DoRow.
function drillParts(drill, t) {
  const swing = drill.source === 'swing';
  const entry = swing
    ? SWING_DRILLS.find((d) => d.id === drill.drillId)
    : DRILLS.find((d) => d.id === drill.drillId);
  if (!entry) return null;
  const where = swing ? drillLocation('range') : drillLocation(entry.location);
  return {
    swing,
    entry,
    title: swing ? entry.title : drillText(entry, 'title'),
    pass: swing ? entry.passTarget : drillLevelText(entry, drill.level),
    where,
    minutes: t('stats.my.coach.ui.fix.minutes', { minutes: drill.minutes }),
  };
}

function DrillDetail({ drill, parts, visible, onClose }) {
  const { swing, entry, title, where, minutes } = parts;
  return (
    <DrillSheet
      visible={visible}
      onClose={onClose}
      title={title}
      meta={[where, minutes].join(' · ')}
      instruction={swing ? entry.instruction : drillText(entry, 'instruction')}
      passTargets={swing ? null : Array.from({ length: MAX_LEVEL }, (_, i) => ({ level: i + 1, text: drillLevelText(entry, i + 1) }))}
      passTarget={swing ? entry.passTarget : null}
      level={swing ? null : (drill.level || 1)}
    />
  );
}

// One drill of a plan (coach catalogue or swing catalogue): name, tags,
// where and how long, and the pass target at its level. Pressing it opens
// the drill's detail sheet (how to do it, all pass-target levels).
export function DrillLine({ drill, showLocation = true }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [open, setOpen] = useState(false);
  const parts = drillParts(drill, t);
  if (!parts) return null;
  const { swing, title, pass, where, minutes } = parts;
  const meta = [showLocation ? where : null, minutes].filter(Boolean).join(' · ');
  return (
    <>
      <PressableScale
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={title}
        style={s.drill}
        testID={`drill-${drill.drillId}`}
      >
        <View style={s.drillHead}>
          <Text style={s.drillTitle}>
            {title}
            {swing ? <Text style={s.tag}>{`  ${t('stats.my.coach.ui.fix.swingTag')}`}</Text> : null}
            {!swing && drill.level ? <Text style={s.tag}>{`  ${t('stats.my.coach.ui.fix.level', { level: drill.level, max: MAX_LEVEL })}`}</Text> : null}
          </Text>
          <Text style={s.drillMeta}>{meta}</Text>
        </View>
        {pass ? <Text style={s.pass}>{t('stats.my.coach.ui.fix.pass', { target: pass })}</Text> : null}
      </PressableScale>
      <DrillDetail drill={drill} parts={parts} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

// "Do this: Clock drill 2.5 m · 15 min ›": the one drill to start with, as a
// 44 px row that opens the same detail sheet as a DrillLine.
export function DoRow({ drill }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [open, setOpen] = useState(false);
  const parts = drillParts(drill, t);
  if (!parts) return null;
  const label = t('stats.my.coach.ui.do.label');
  return (
    <>
      <PressableScale
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${parts.title}`}
        style={s.row44}
        testID="do-row"
      >
        <View style={s.rowLead}>
          <Feather name={parts.swing ? 'video' : 'flag'} size={16} color={theme.accent.primary} />
        </View>
        <Text style={s.rowTitle} numberOfLines={2}>{`${label}: ${parts.title}`}</Text>
        <Text style={s.rowMeta}>{parts.minutes}</Text>
        <Feather name="chevron-right" size={14} color={theme.text.muted} />
      </PressableScale>
      <DrillDetail drill={drill} parts={parts} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

const PAIR_KEY = 'stats.my.coach.ui.pair.';

function pairLabel(t, label) {
  return label.kind === 'target' ? t(`${PAIR_KEY}target`, { hcp: formatNumber(label.hcp) }) : t(`${PAIR_KEY}${label.kind}`);
}

// The two bars under the issue: you against a reference, numbers in text (the
// bars are decorative), or one bar with its count when there is no reference.
// `pair` is store/coachCausePair.js causePair's result.
export function CausePair({ pair }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (!pair) return null;
  const bar = (fraction, ref) => (
    <View style={s.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[s.fill, ref && s.fillRef, { width: `${Math.max(2, Math.round(fraction * 100))}%` }]} />
    </View>
  );
  if (pair.kind === 'single') {
    return (
      <View style={s.pair} testID="cause-pair">
        {pair.fraction != null ? bar(pair.fraction, false) : null}
        <Text style={s.pairText}>{renderMsg(pair.text)}</Text>
      </View>
    );
  }
  return (
    <View style={s.pair} testID="cause-pair">
      {pair.rows.map((row, i) => (
        <View key={row.label.kind} style={s.pairRow}>
          <Text style={s.pairLabel}>{pairLabel(t, row.label)}</Text>
          {bar(row.fraction, i > 0)}
          <Text style={s.pairValue}>{metricValueText(row.value.unit, row.value.n)}</Text>
        </View>
      ))}
      <Text style={s.pairCaption}>{renderMsg(pair.caption)}</Text>
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
    drill: { gap: 2, minHeight: 44, justifyContent: 'center' },
    drillHead: { gap: 1 },
    drillTitle: { ...theme.typography.body, color: theme.text.primary, fontWeight: '800' },
    tag: { ...theme.typography.caption, color: theme.text.secondary, fontWeight: '700' },
    drillMeta: { ...theme.typography.caption, color: theme.text.muted },
    pass: { ...theme.typography.caption, color: theme.info, fontWeight: '700' },
    row44: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm + 2, minHeight: 44 },
    rowLead: {
      width: 30, height: 30, borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.accent.light,
    },
    rowTitle: { ...theme.typography.body, flex: 1, minWidth: 0, color: theme.text.primary, fontWeight: '800' },
    rowMeta: { ...theme.typography.caption, color: theme.text.secondary, fontWeight: '700' },
    pair: { gap: 4 },
    pairRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
    pairLabel: { ...theme.typography.caption, width: 72, color: theme.text.secondary, fontWeight: '700' },
    pairValue: { ...theme.typography.caption, minWidth: 44, textAlign: 'right', color: theme.text.primary, fontWeight: '800', fontVariant: ['tabular-nums'] },
    track: { flex: 1, height: 10, justifyContent: 'center' },
    fill: { height: 10, borderTopRightRadius: 4, borderBottomRightRadius: 4, backgroundColor: theme.text.primary },
    fillRef: { backgroundColor: theme.text.muted },
    pairText: { ...theme.typography.caption, color: theme.text.secondary },
    pairCaption: { ...theme.typography.tiny, color: theme.text.secondary, paddingLeft: 80 },
  });
}
