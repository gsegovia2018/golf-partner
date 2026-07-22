import React, { useMemo, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useAppSettings } from '../../hooks/useAppSettings';
import { formatDistance, unitSuffix } from '../../lib/units';
import { subscribeShots, getShotsVersion, getShots } from '../../store/shotStore';
import { clubDistances } from '../../lib/shotStats';
import { swingClubs, clubLabel, clubOrder } from '../../lib/clubs';
import SectionCard from './SectionCard';

// Measured carry per club from the GPS shot log, in bag order. Renders nothing
// until at least one club has a measured carry — GPS shot tracking is a
// separate signal from the strokes-gained shot detail this tab is built on,
// so it self-gates rather than riding the SG "has data" check.
export default function ClubDistancesCard({ onInfo }) {
  const { theme } = useTheme();
  const { units, bag } = useAppSettings();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => clubDistances(getShots()), [shotsVersion]);

  if (!rows.length) return null;

  const inBag = new Set(swingClubs(bag));
  const ordered = rows
    .filter((r) => inBag.has(r.club))
    .sort((a, b) => clubOrder(a.club) - clubOrder(b.club));
  const shown = ordered.length ? ordered : rows; // clubs dropped from the bag still show if that's all there is

  return (
    <SectionCard title="Club distances" infoKey="clubDistances" onInfo={onInfo}>
      <Text style={s.sub}>Average carry from your marked shots.</Text>
      {shown.map((r) => (
        <View key={r.club} style={s.row}>
          <Text style={s.club}>{clubLabel(r.club)}</Text>
          <View style={s.right}>
            <Text style={s.dist}>{`${formatDistance(r.avg, units)} ${unitSuffix(units)}`}</Text>
            <Text style={s.meta}>{`${r.count} shot${r.count === 1 ? '' : 's'} · ${formatDistance(r.min, units)}–${formatDistance(r.max, units)}`}</Text>
          </View>
        </View>
      ))}
    </SectionCard>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  sub: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 11,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border.subtle,
  },
  club: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 14 },
  right: { alignItems: 'flex-end' },
  dist: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  meta: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 10,
    fontVariant: ['tabular-nums'], marginTop: 1,
  },
});
