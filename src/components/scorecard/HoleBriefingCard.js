import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n';
import { renderMsg } from '../mystats/msg';
import { useCourseGeometry } from '../../hooks/useCourseGeometry';
import { holeFeatures, getCourseGeometryVersion } from '../../lib/geo';
import { holeBriefing } from '../../store/holeBriefing';

// Hole briefing (aim-tips spec §2.3): what to do on THIS hole, from the
// golfer's own miss pattern, shown when they arrive at it (the data is
// entered after the hole). Up to two lines — off the tee (par 4/5) and the
// approach with its expected distance — each only when aimTip has one. No
// line, no card. Once the owner's score for the hole exists it folds to one
// summary line (history), still expandable.
export default function HoleBriefingCard({
  par, holeNumber, courseName, stats, handedness, scored,
}) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const course = useCourseGeometry(courseName);
  const version = getCourseGeometryVersion();
  const [open, setOpen] = useState(null);

  const briefing = useMemo(() => {
    if (!stats) return null;
    const geometry = holeFeatures(courseName, holeNumber);
    return holeBriefing({ par, stats, geometry, handedness });
  // course/version: geometry loads on demand and mutates the shared store.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [par, stats, courseName, holeNumber, handedness, course, version]);

  const lines = [briefing?.tee, briefing?.approach].filter(Boolean);
  if (!lines.length) return null;

  const expanded = open ?? !scored;
  const hazardColor = theme.semantic.info[theme.isDark ? 'dark' : 'light'];
  const label = (tip) => (tip.shot === 'tee'
    ? t('stats.aim.card.tee')
    : briefing.approachMeters != null
      ? t('stats.aim.card.approachDist', { m: briefing.approachMeters })
      : t('stats.aim.card.approach'));
  const summary = t('stats.aim.card.summary', {
    parts: lines.map((tip) => t(`stats.aim.short.${tip.aim}`)).join(' · '),
  });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={expanded ? t('stats.aim.card.hide') : t('stats.aim.card.show')}
      onPress={() => setOpen(!expanded)}
      style={s.card}
      testID="hole-briefing"
    >
      <Feather name="crosshair" size={22} color={theme.accent.primary} style={s.icon} />
      {expanded ? (
        <View style={s.body}>
          {lines.map((tip, i) => (
            <View key={tip.shot} style={i > 0 ? s.lineGap : null}>
              <Text style={s.label}>{label(tip)}</Text>
              <Text style={s.headline}>{renderMsg(tip.msg)}</Text>
              <Text style={s.evidence}>
                {renderMsg(tip.detail)}
                {tip.hazardMsg ? (
                  <Text style={[s.hazard, { color: hazardColor }]}>{` · ${renderMsg(tip.hazardMsg)}`}</Text>
                ) : null}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={s.summary} numberOfLines={1}>{summary}</Text>
      )}
    </Pressable>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    marginHorizontal: 14, marginTop: 4, padding: 12, borderRadius: 14,
    backgroundColor: theme.bg.card, borderWidth: 1, borderColor: theme.border.default,
  },
  icon: { marginTop: 1 },
  body: { flex: 1, minWidth: 0 },
  lineGap: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.border.subtle ?? theme.border.default },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: theme.text.muted },
  headline: { marginTop: 2, fontSize: 15, lineHeight: 20, fontWeight: '700', color: theme.text.primary },
  evidence: { marginTop: 2, fontSize: 13, lineHeight: 18, color: theme.text.secondary },
  hazard: { fontWeight: '700' },
  summary: { flex: 1, fontSize: 13, lineHeight: 22, fontWeight: '600', color: theme.text.secondary },
});
