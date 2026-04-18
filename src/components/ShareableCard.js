import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { useTheme } from '../theme/ThemeContext';

// ---------------------------------------------------------------------------
// Web: render the leaderboard directly to a 2D canvas.
// Avoids html2canvas (used by react-native-view-shot on web), which is flaky
// with react-native-web's flex layout and custom web fonts.
// ---------------------------------------------------------------------------
function drawLeaderboardCanvas({ tournamentName, leaderboard, theme }) {
  const W = 1200;
  const H = 800;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const bg = theme?.bg?.primary ?? '#ffffff';
  const card = theme?.bg?.card ?? '#ffffff';
  const text = theme?.text?.primary ?? '#111111';
  const sub = theme?.text?.secondary ?? '#555555';
  const muted = theme?.text?.muted ?? '#888888';
  const border = theme?.border?.default ?? '#dddddd';
  const accent = theme?.accent?.primary ?? '#1a6b4a';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = text;
  ctx.font = '800 56px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(truncate(ctx, tournamentName ?? 'Tournament', W - 80), 40, 90);

  ctx.fillStyle = muted;
  ctx.font = '600 18px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('LEADERBOARD', 40, 124);

  // Divider
  ctx.fillStyle = border;
  ctx.fillRect(40, 150, W - 80, 1);

  // Column labels
  ctx.fillStyle = muted;
  ctx.font = '700 16px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('PLAYER', 120, 188);
  ctx.textAlign = 'right';
  ctx.fillText('PTS', 980, 188);
  ctx.fillText('STRK', 1140, 188);
  ctx.textAlign = 'left';

  const RANK_BG = ['#d4af37', '#94a3b8', '#c47c3a'];
  const RANK_LBL = ['1st', '2nd', '3rd'];
  const players = (leaderboard ?? []).slice(0, 4);
  let y = 250;
  const ROW_H = 92;

  players.forEach((entry, i) => {
    // row background
    ctx.fillStyle = card;
    roundRect(ctx, 40, y - 60, W - 80, 80, 16);
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();

    // rank badge
    const rankBg = RANK_BG[i] ?? muted;
    const rankLbl = RANK_LBL[i] ?? `${i + 1}th`;
    ctx.fillStyle = rankBg;
    roundRect(ctx, 60, y - 42, 56, 44, 10);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 18px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(rankLbl, 88, y - 20);

    // name
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = text;
    ctx.font = '700 30px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(truncate(ctx, entry.player?.name ?? 'Unknown', 660), 140, y - 8);

    // pts
    ctx.textAlign = 'right';
    ctx.fillStyle = accent;
    ctx.font = '800 36px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(String(entry.points ?? '-'), 980, y - 4);

    // strokes
    ctx.fillStyle = sub;
    ctx.font = '600 26px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(String(entry.strokes ?? '-'), 1140, y - 4);

    ctx.textAlign = 'left';
    y += ROW_H;
  });

  // Branding
  ctx.fillStyle = muted;
  ctx.font = '700 16px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('GOLF PARTNER', W / 2, H - 28);
  ctx.textAlign = 'left';

  return canvas;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function truncate(ctx, str, maxWidth) {
  if (ctx.measureText(str).width <= maxWidth) return str;
  let s = str;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) {
    s = s.slice(0, -1);
  }
  return s + '…';
}

function leaderboardToText(tournamentName, leaderboard) {
  const lines = [`🏌️ ${tournamentName} — Leaderboard`, ''];
  (leaderboard ?? []).slice(0, 4).forEach((entry, i) => {
    const medal = ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`;
    const name = entry.player?.name ?? 'Unknown';
    const pts = entry.points ?? '-';
    const strokes = entry.strokes;
    lines.push(`${medal} ${name} — ${pts} pts${strokes != null ? ` · ${strokes} strk` : ''}`);
  });
  return lines.join('\n');
}

async function shareBlobOrDownload(blob, fileName, title, fallbackText) {
  const file = new File([blob], fileName, { type: blob.type });

  if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return true;
    } catch (e) {
      if (e?.name === 'AbortError') return true; // user cancelled
      // fall through to download
    }
  }

  if (typeof navigator !== 'undefined' && navigator.share && fallbackText) {
    try {
      await navigator.share({ text: fallbackText, title });
      return true;
    } catch (e) {
      if (e?.name === 'AbortError') return true;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}

// ---------------------------------------------------------------------------
// Public API: share a leaderboard as a PNG.
// Web: renders via Canvas 2D from data — no html2canvas, no off-screen DOM.
// Native: captures the provided viewRef and opens the native share sheet.
// ---------------------------------------------------------------------------
export async function shareLeaderboard({ tournamentName, leaderboard, theme, viewRef, fileName = 'leaderboard.png' }) {
  if (Platform.OS === 'web') {
    try {
      const canvas = drawLeaderboardCanvas({ tournamentName, leaderboard, theme });
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/png');
      });
      await shareBlobOrDownload(blob, fileName, tournamentName ?? 'Leaderboard', leaderboardToText(tournamentName, leaderboard));
    } catch (e) {
      console.warn('Web share failed:', e);
      if (typeof window !== 'undefined') {
        window.alert(`Could not share: ${e?.message ?? e}`);
      }
    }
    return;
  }

  try {
    const uri = await captureRef(viewRef, { format: 'png', quality: 1 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri);
    }
  } catch (e) {
    console.warn('Share failed:', e);
  }
}

// Back-compat: old call sites that only pass a ref still work on native; on web
// they get a degraded experience that uses captureRef. Prefer shareLeaderboard.
export async function shareView(viewRef, fileName = 'leaderboard.png') {
  return shareLeaderboard({ viewRef, fileName });
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
