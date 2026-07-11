import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import SectionCard from './SectionCard';
import StatTile from './StatTile';

// Career-wide feats — see `careerMilestones` in personalStats.js.
// bestNine/bestRound show '-' when there is no complete round yet;
// birdies/eagles/longestParStreak are always a count (0 is a real value,
// not "no data"). Everything here is NET (handicap-adjusted) — the
// Strokes Gained tab's scoring-mix benchmark counts gross — so the card
// discloses the basis rather than silently disagreeing with that tab.
export default function CareerMilestonesCard({ milestones, onInfo }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const m = milestones ?? {};

  return (
    <SectionCard title="Career Milestones" infoKey="careerMilestones" onInfo={onInfo}>
      <Text style={s.basis}>
        Net (handicap-adjusted) results — the Strokes Gained tab counts gross.
      </Text>
      <View style={s.grid}>
        <StatTile value={`${m.birdies ?? 0}`} caption="Birdies" />
        <StatTile value={`${m.eagles ?? 0}`} caption="Eagles" />
        <StatTile value={`${m.longestParStreak ?? 0}`} caption="Best par streak" />
      </View>
      <View style={s.grid}>
        <StatTile value={m.bestNine != null ? `${m.bestNine}` : '-'} caption="Best nine (pts)" />
        <StatTile value={m.bestRound != null ? `${m.bestRound}` : '-'} caption="Best round (pts)" />
      </View>
    </SectionCard>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    basis: { ...theme.typography.caption, color: theme.text.secondary },
    grid: { flexDirection: 'row', gap: theme.spacing.md },
  });
}
