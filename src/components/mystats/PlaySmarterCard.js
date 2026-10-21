import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { msgText, sampleLabel } from './msg';
import { useT, formatNumber } from '../../i18n';
import SectionCard from './SectionCard';

// On-course strategy tips — decisions that pay off without practicing.
export default function PlaySmarterCard({ tips, onInfo }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (!tips || tips.length === 0) return null;

  return (
    <SectionCard title={t('stats.my.tip.title')} infoKey="playSmarter" onInfo={onInfo}>
      {tips.map((tip, index) => (
        <View key={tip.id} style={[s.row, index === 0 && s.rowFirst]}>
          <View style={s.iconWrap}>
            <Feather name="map" size={14} color={theme.accent.primary} />
          </View>
          <View style={s.copy}>
            <Text style={s.title}>{msgText(tip.titleMsg, tip.title)}</Text>
            <Text style={s.reason}>{msgText(tip.reasonMsg, tip.reason)}</Text>
            <Text style={s.evidence}>{t('stats.my.tip.evidence', { basis: msgText(tip.basisMsg, tip.basis), sample: sampleLabel(tip.sample) })}</Text>
          </View>
          <Text style={s.payoff}>{t('stats.my.tip.payoff', { value: formatNumber(tip.payoffPointsPerRound) })}</Text>
        </View>
      ))}
    </SectionCard>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.subtle,
    },
    rowFirst: { borderTopWidth: 0, paddingTop: 0 },
    iconWrap: {
      width: 30, height: 30, borderRadius: theme.radius.sm,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.accent.light,
    },
    copy: { flex: 1, minWidth: 0, gap: 1 },
    title: { ...theme.typography.body, color: theme.text.primary, fontWeight: '700' },
    reason: { ...theme.typography.caption, color: theme.text.secondary },
    evidence: { ...theme.typography.tiny, color: theme.text.muted },
    payoff: { ...theme.typography.caption, color: theme.accent.primary, fontWeight: '800', maxWidth: 92, textAlign: 'right' },
  });
}
