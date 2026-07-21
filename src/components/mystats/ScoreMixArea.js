import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';

// rounds: [{ label, birdie, par, bogey }] — counts per round. Each round is
// normalised to a 0..1 share, then drawn as three stacked bands.
export default function ScoreMixArea({ rounds = [] }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const C = { birdie: theme.accent.primary, par: '#7fb59f', bogey: '#e7d7b4' };
  const width = 300;
  const height = 92;
  const padX = 22;

  const cols = useMemo(() => {
    const n = rounds.length;
    return rounds.map((r, i) => {
      const total = r.birdie + r.par + r.bogey || 1;
      const x = n === 1 ? width / 2 : padX + ((width - padX * 2) * i) / (n - 1);
      const birdieShare = r.birdie / total;
      const parShare = r.par / total;
      // y boundaries: 0 = top. birdie band top..b1, par b1..b2, bogey b2..height.
      const b1 = height * birdieShare;
      const b2 = height * (birdieShare + parShare);
      return { x, b1, b2 };
    });
  }, [rounds]);

  if (cols.length < 2) {
    return <Text style={s.empty}>Select two or more rounds to see the score mix.</Text>;
  }

  const band = (topFn, botFn) => {
    const top = cols.map((c) => `${c.x},${topFn(c)}`);
    const bot = cols.map((c) => `${c.x},${botFn(c)}`).reverse();
    return `M${top.join(' L')} L${bot.join(' L')} Z`;
  };
  // Open path along a band's top boundary — stroked at full opacity so each
  // band keeps a crisp edge over the slightly translucent fills.
  const topEdge = (topFn) => `M${cols.map((c) => `${c.x},${topFn(c)}`).join(' L')}`;

  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <Path d={band(() => 0, (c) => c.b1)} fill={C.birdie} fillOpacity={0.85} />
        <Path d={band((c) => c.b1, (c) => c.b2)} fill={C.par} fillOpacity={0.85} />
        <Path d={band((c) => c.b2, () => height)} fill={C.bogey} fillOpacity={0.85} />
        <Path d={topEdge(() => 0)} fill="none" stroke={C.birdie} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <Path d={topEdge((c) => c.b1)} fill="none" stroke={C.par} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <Path d={topEdge((c) => c.b2)} fill="none" stroke={C.bogey} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </Svg>
      <View style={s.legend}>
        {[['Birdie+', C.birdie], ['Par', C.par], ['Bogey+', C.bogey]].map(([label, color]) => (
          <View key={label} style={s.lg}>
            <View style={[s.sw, { backgroundColor: color }]} />
            <Text style={s.lgText}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    empty: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic', paddingVertical: theme.spacing.md, textAlign: 'center' },
    legend: { flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.sm },
    lg: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    sw: { width: 10, height: 10, borderRadius: 3 },
    lgText: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
  });
}
