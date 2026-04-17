import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { useTheme } from '../theme/ThemeContext';

// ---------------------------------------------------------------------------
// shareView  --  capture a view ref as PNG and open the native share sheet
// (with web fallback to Web Share API or file download)
// ---------------------------------------------------------------------------
export async function shareView(viewRef, fileName = 'leaderboard.png') {
  try {
    if (Platform.OS === 'web') {
      const uri = await captureRef(viewRef, { format: 'png', quality: 1, result: 'data-uri' });
      const blob = await (await fetch(uri)).blob();
      const file = new File([blob], fileName, { type: 'image/png' });

      if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Leaderboard' });
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }

    const uri = await captureRef(viewRef, { format: 'png', quality: 1 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri);
    }
  } catch (e) {
    console.warn('Share failed:', e);
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.alert('Could not share. Try again or take a screenshot.');
    }
  }
}

// ---------------------------------------------------------------------------
// Rank badge helpers
// ---------------------------------------------------------------------------
const RANK_COLORS = ['#d4af37', '#94a3b8', '#c47c3a']; // gold, silver, bronze
const RANK_LABELS = ['1st', '2nd', '3rd'];

function RankBadge({ index, theme }) {
  const isTop3 = index < 3;
  const badgeBg = isTop3 ? RANK_COLORS[index] : theme.bg.secondary;
  const badgeText = isTop3 ? '#ffffff' : theme.text.secondary;

  return (
    <View style={[styles.rankBadge, { backgroundColor: badgeBg }]}>
      <Text
        style={[
          styles.rankText,
          { color: badgeText, fontFamily: 'PlusJakartaSans-Bold' },
        ]}
      >
        {isTop3 ? RANK_LABELS[index] : `${index + 1}th`}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ShareableLeaderboard
// ---------------------------------------------------------------------------
export const ShareableLeaderboard = React.forwardRef(
  ({ tournamentName, leaderboard = [] }, ref) => {
    const { theme } = useTheme();
    const players = leaderboard.slice(0, 4);

    return (
      <View
        ref={ref}
        collapsable={false}
        style={[
          styles.card,
          {
            backgroundColor: theme.bg.primary,
            borderColor: theme.border.default,
          },
        ]}
      >
        {/* ---- Header ---- */}
        <View style={styles.header}>
          <Text
            style={[
              styles.tournamentName,
              {
                color: theme.text.primary,
                fontFamily: 'PlusJakartaSans-ExtraBold',
              },
            ]}
            numberOfLines={2}
          >
            {tournamentName}
          </Text>

          <Text
            style={[
              styles.subtitle,
              {
                color: theme.text.muted,
                fontFamily: 'PlusJakartaSans-Medium',
              },
            ]}
          >
            Leaderboard
          </Text>
        </View>

        {/* ---- Divider ---- */}
        <View style={[styles.divider, { backgroundColor: theme.border.default }]} />

        {/* ---- Column labels ---- */}
        <View style={styles.columnLabels}>
          <Text
            style={[
              styles.colLabel,
              styles.colLabelPlayer,
              { color: theme.text.muted, fontFamily: 'PlusJakartaSans-SemiBold' },
            ]}
          >
            Player
          </Text>
          <Text
            style={[
              styles.colLabel,
              { color: theme.text.muted, fontFamily: 'PlusJakartaSans-SemiBold' },
            ]}
          >
            Pts
          </Text>
          <Text
            style={[
              styles.colLabel,
              { color: theme.text.muted, fontFamily: 'PlusJakartaSans-SemiBold' },
            ]}
          >
            Strk
          </Text>
        </View>

        {/* ---- Player rows ---- */}
        {players.map((entry, idx) => (
          <View
            key={idx}
            style={[
              styles.row,
              idx < players.length - 1 && {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: theme.border.subtle,
              },
            ]}
          >
            <RankBadge index={idx} theme={theme} />

            <Text
              style={[
                styles.playerName,
                {
                  color: theme.text.primary,
                  fontFamily: 'PlusJakartaSans-SemiBold',
                },
              ]}
              numberOfLines={1}
            >
              {entry.player?.name ?? 'Unknown'}
            </Text>

            <Text
              style={[
                styles.stat,
                {
                  color: theme.accent.primary,
                  fontFamily: 'PlusJakartaSans-Bold',
                },
              ]}
            >
              {entry.points ?? '-'}
            </Text>

            <Text
              style={[
                styles.stat,
                {
                  color: theme.text.secondary,
                  fontFamily: 'PlusJakartaSans-Medium',
                },
              ]}
            >
              {entry.strokes ?? '-'}
            </Text>
          </View>
        ))}

        {/* ---- Branding ---- */}
        <View style={styles.branding}>
          <Text
            style={[
              styles.brandText,
              {
                color: theme.text.muted,
                fontFamily: 'PlusJakartaSans-SemiBold',
              },
            ]}
          >
            Golf Partner
          </Text>
        </View>
      </View>
    );
  },
);

ShareableLeaderboard.displayName = 'ShareableLeaderboard';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  card: {
    minWidth: 320,
    aspectRatio: 16 / 9,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    justifyContent: 'space-between',
  },

  /* Header */
  header: {
    marginBottom: 4,
  },
  tournamentName: {
    fontSize: 28,
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  subtitle: {
    fontSize: 12,
    letterSpacing: 1.5,
    lineHeight: 16,
    textTransform: 'uppercase',
    marginTop: 4,
  },

  /* Divider */
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },

  /* Column labels */
  columnLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    marginBottom: 2,
  },
  colLabel: {
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    width: 44,
    textAlign: 'center',
  },
  colLabelPlayer: {
    flex: 1,
    textAlign: 'left',
    paddingLeft: 40,
  },

  /* Player row */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  rankBadge: {
    width: 32,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  rankText: {
    fontSize: 11,
    lineHeight: 14,
  },
  playerName: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  stat: {
    width: 44,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },

  /* Branding */
  branding: {
    alignItems: 'center',
    marginTop: 8,
  },
  brandText: {
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    lineHeight: 14,
  },
});
