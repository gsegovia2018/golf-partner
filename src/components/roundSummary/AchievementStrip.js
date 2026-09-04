import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { semantic } from '../../theme/tokens';

// Icon per achievement id, falling back to a per-tone default so a new
// detector in roundAchievements.js renders sensibly before it gets one here.
const ICONS = {
  bestRoundEver: 'award',
  bestDifferentialEver: 'award',
  brokeGross: 'award',
  courseRecord: 'award',
  bestAtCourse: 'award',
  bestNineEver: 'award',
  longestStreakEver: 'award',
  mostBirdiesEver: 'award',
  nemesisSlain: 'check-circle',
  aboveCourseAverage: 'chevrons-up',
  roundMilestone: 'flag',
  courseMilestone: 'flag',
  birdieMilestone: 'flag',
  newCourse: 'map-pin',
  parStreak: 'trending-up',
  backNineCharge: 'trending-up',
  hotStretch: 'trending-up',
  eagle: 'star',
  birdies: 'star',
  birdieStreak: 'star',
  playedToHandicap: 'target',
  clutchOnHardest: 'target',
  par5Playground: 'flag',
  skinsKing: 'crosshair',
  bounceBack: 'shield',
  carriedThePair: 'users',
  metronome: 'clock',
  bogeyTrain: 'repeat',
  chaosHole: 'zap',
  everyoneBlanked: 'cloud-lightning',
  everyoneScored: 'sun',
  blowUp: 'alert-triangle',
  pickupKing: 'x-circle',
  zeroHero: 'slash',
  frontNineFade: 'trending-down',
  par3Trouble: 'wind',
};
const TONE_ICONS = { great: 'award', good: 'trending-up', fun: 'zap', roast: 'alert-triangle' };

// Gold for a record or a feat, green for solid play, slate for a neutral
// group fact, red for the roast — the same duties these tokens already carry
// elsewhere (winner gold on the leaderboard, scoreColor on the scorecard).
function toneColor(tone, theme) {
  if (tone === 'great') return theme.isDark ? semantic.winner.soft : semantic.winner.light;
  if (tone === 'good') return theme.scoreColor('excellent');
  if (tone === 'roast') return theme.destructive;
  return theme.info;
}

function AchievementRow({ item }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const color = toneColor(item.tone, theme);
  const icon = ICONS[item.id] ?? TONE_ICONS[item.tone] ?? 'star';

  return (
    <View style={s.row}>
      <View style={[s.iconWrap, { backgroundColor: `${color}1f` }]}>
        <Feather name={icon} size={15} color={color} />
      </View>
      <View style={s.rowText}>
        <Text style={[s.title, { color }]} numberOfLines={1}>
          {item.playerName ? `${item.playerName} — ${item.title}` : item.title}
        </Text>
        {item.subtitle ? (
          <Text style={s.subtitle} numberOfLines={2}>{item.subtitle}</Text>
        ) : null}
      </View>
    </View>
  );
}

// The highlights strip under the round's summary card. `items` is
// selectAchievements output; an empty list renders nothing at all rather than
// an empty shell — a quiet round should look quiet, not broken.
export default function AchievementStrip({ items }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (!items || items.length === 0) return null;

  return (
    <View style={s.card} accessibilityLabel="Round highlights">
      <Text style={s.heading}>HIGHLIGHTS</Text>
      {items.map((item) => (
        <AchievementRow key={`${item.id}:${item.playerId ?? 'me'}`} item={item} />
      ))}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.bg.card,
      borderColor: theme.border.default,
      borderRadius: 10,
      borderWidth: 1,
      gap: 10,
      padding: 14,
    },
    heading: {
      color: theme.text.muted,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 10,
      letterSpacing: 1.5,
    },
    row: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10,
    },
    iconWrap: {
      alignItems: 'center',
      borderRadius: 8,
      height: 30,
      justifyContent: 'center',
      width: 30,
    },
    rowText: {
      flex: 1,
      gap: 1,
      minWidth: 0,
    },
    title: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 14,
      lineHeight: 19,
    },
    subtitle: {
      color: theme.text.secondary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 12,
      lineHeight: 16,
    },
  });
}
