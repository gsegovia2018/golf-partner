import React from 'react';
import { View, Text, StyleSheet, Platform, Alert } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { useTheme } from '../theme/ThemeContext';
import { semantic } from '../theme/tokens';

// Cross-platform themed alert. On web there is no Alert UI, so fall back to
// window.alert; native uses the OS dialog.
function notify(title, message) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(message ?? title);
  } else {
    Alert.alert(title, message);
  }
}

// ---------------------------------------------------------------------------
// Web: render the leaderboard directly to a 2D canvas.
// Avoids html2canvas (used by react-native-view-shot on web), which is flaky
// with react-native-web's flex layout and custom web fonts.
// ---------------------------------------------------------------------------
// Resolve the shared-card palette from the active theme. The card keeps a
// golf-green identity but adapts its depth/accent to light vs dark so a
// shared image matches the app the user is looking at.
function cardPalette(theme) {
  const isDark = !!theme?.isDark;
  return {
    bg: isDark ? '#0c1a14' : '#006747',
    card: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.08)',
    text: '#ffffff',
    sub: 'rgba(255,255,255,0.5)',
    muted: 'rgba(255,255,255,0.5)',
    border: isDark ? 'rgba(79,174,138,0.45)' : 'rgba(255,215,0,0.4)',
    accent: isDark ? '#4fae8a' : semantic.winner.dark,
  };
}

function drawLeaderboardCanvas({ tournamentName, leaderboard, theme }) {
  const W = 1200;
  const H = 800;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const { bg, card, text, sub, muted, border, accent } = cardPalette(theme);

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = text;
  ctx.font = '800 56px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(truncate(ctx, tournamentName ?? 'Tournament', W - 80), 40, 90);

  ctx.fillStyle = accent;
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

  const RANK_BG = ['rgba(212,175,55,0.3)', 'rgba(148,163,184,0.3)', 'rgba(196,124,58,0.3)'];
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

    ctx.fillStyle = text;
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
  ctx.fillStyle = accent;
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

// ---------------------------------------------------------------------------
// Web: render the round summary directly to a 2D canvas. Same rationale as
// drawLeaderboardCanvas above — no html2canvas, no off-screen DOM.
// ---------------------------------------------------------------------------
function drawRoundCanvas({
  tournamentName, roundLabel, courseName, recap, ranked, unit, theme,
}) {
  const W = 1200;
  const H = 800;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const { bg, card, text, sub, muted, border, accent } = cardPalette(theme);
  const unitLabel = unit === 'holes' ? 'holes' : 'pts';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = accent;
  ctx.font = '600 18px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('ROUND SUMMARY', 40, 56);

  ctx.fillStyle = text;
  ctx.font = '800 40px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(truncate(ctx, tournamentName ?? 'Golf Partner', W - 80), 40, 104);

  ctx.fillStyle = sub;
  ctx.font = '600 20px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(truncate(ctx, roundLabel ?? '', W - 80), 40, 134);

  // Divider
  ctx.fillStyle = border;
  ctx.fillRect(40, 156, W - 80, 1);

  // Winner hero
  ctx.fillStyle = muted;
  ctx.font = '700 16px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('WINNER', 40, 196);

  ctx.fillStyle = text;
  ctx.font = '800 64px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(truncate(ctx, recap?.winnerName || 'No winner yet', 700), 40, 264);

  ctx.fillStyle = accent;
  ctx.font = '800 48px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${recap?.winnerPoints ?? '-'} ${unitLabel}`, W - 40, 264);
  ctx.textAlign = 'left';

  // Podium — top 3
  const podium = (ranked ?? []).slice(0, 3);
  const PODIUM_Y = 330;
  const PODIUM_H = 140;
  const COL_GAP = 16;
  const COL_W = (W - 80 - COL_GAP * 2) / 3;
  const MEDALS = ['🥇', '🥈', '🥉'];

  podium.forEach((entry, i) => {
    const x = 40 + i * (COL_W + COL_GAP);
    ctx.fillStyle = card;
    roundRect(ctx, x, PODIUM_Y, COL_W, PODIUM_H, 16);
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = text;
    ctx.font = '700 32px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(MEDALS[i] ?? `${i + 1}.`, x + 20, PODIUM_Y + 48);

    ctx.font = '700 24px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(truncate(ctx, entry.player?.name ?? 'Unknown', COL_W - 40), x + 20, PODIUM_Y + 88);

    ctx.fillStyle = accent;
    ctx.font = '800 26px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(`${entry.points ?? '-'} ${unitLabel}`, x + 20, PODIUM_Y + 122);
  });

  // Footer: course + date, and branding
  ctx.fillStyle = muted;
  ctx.font = '600 18px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const dateStr = new Date().toLocaleDateString();
  const footerLeft = [courseName, dateStr].filter(Boolean).join(' · ');
  ctx.fillText(truncate(ctx, footerLeft, W / 2 - 40), 40, H - 36);

  ctx.fillStyle = accent;
  ctx.font = '700 16px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('GOLF PARTNER 🏌️', W - 40, H - 36);
  ctx.textAlign = 'left';

  return canvas;
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

// Text fallback for a round summary share, à la leaderboardToText above.
// Exported so its content (winner, podium, boardUrl placement) can be unit
// tested without going through the canvas/native capture paths.
export function roundSummaryToText({
  tournamentName, roundLabel, ranked, unit, boardUrl,
} = {}) {
  const unitLabel = unit === 'holes' ? 'holes' : 'pts';
  const title = roundLabel || tournamentName || 'Round';
  const lines = [`🏌️ ${title} — Round Summary`, ''];
  (ranked ?? []).slice(0, 4).forEach((entry, i) => {
    const medal = ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`;
    const name = entry.player?.name ?? 'Unknown';
    const pts = entry.points ?? '-';
    lines.push(`${medal} ${name} — ${pts} ${unitLabel}`);
  });
  // Blank line before the URL keeps WhatsApp from wrapping the text into the
  // middle of the link and breaking the tap target — see HomeScreen.js.
  if (boardUrl) lines.push('', boardUrl);
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
//
// `onBusy(isBusy)` is an optional callback the caller can use to drive a
// "Sharing…" busy state in its UI. It is always called with `false` once the
// operation settles (success or failure).
// Returns true on success, false on failure.
// ---------------------------------------------------------------------------
export async function shareLeaderboard({
  tournamentName, leaderboard, theme, viewRef, fileName = 'leaderboard.png', onBusy,
}) {
  onBusy?.(true);

  if (Platform.OS === 'web') {
    try {
      const canvas = drawLeaderboardCanvas({ tournamentName, leaderboard, theme });
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/png');
      });
      await shareBlobOrDownload(blob, fileName, tournamentName ?? 'Leaderboard', leaderboardToText(tournamentName, leaderboard));
      return true;
    } catch (e) {
      console.warn('Web share failed:', e);
      notify('Could not share', `Sharing failed: ${e?.message ?? e}`);
      return false;
    } finally {
      onBusy?.(false);
    }
  }

  try {
    if (!viewRef?.current) throw new Error('Nothing to capture');
    const uri = await captureRef(viewRef, { format: 'png', quality: 1 });
    if (!(await Sharing.isAvailableAsync())) {
      notify('Sharing unavailable', 'Sharing is not available on this device.');
      return false;
    }
    await Sharing.shareAsync(uri);
    return true;
  } catch (e) {
    // A user-cancelled share sheet is not an error worth surfacing.
    if (e?.message && /cancel/i.test(e.message)) return false;
    console.warn('Share failed:', e);
    notify('Could not share', `Sharing failed: ${e?.message ?? e}`);
    return false;
  } finally {
    onBusy?.(false);
  }
}

// Back-compat: old call sites that only pass a ref still work on native; on web
// they get a degraded experience that uses captureRef. Prefer shareLeaderboard.
export async function shareView(viewRef, fileName = 'leaderboard.png') {
  return shareLeaderboard({ viewRef, fileName });
}

// ---------------------------------------------------------------------------
// Public API: share a round summary as a PNG. Cloned from shareLeaderboard —
// same web (Canvas 2D → shareBlobOrDownload, so navigator.share({files})
// offers WhatsApp) vs. native (captureRef → Sharing.shareAsync) split, same
// busy/cancel/notify handling.
//
// `boardUrl`, when given, is appended to the web text fallback after a blank
// line (see roundSummaryToText). Native sharing shares the image only, same
// as shareLeaderboard.
// ---------------------------------------------------------------------------
export async function shareRoundSummary({
  recap, ranked, unit, courseName, roundLabel, tournamentName, boardUrl, theme, viewRef,
  fileName = 'round-summary.png', onBusy,
}) {
  onBusy?.(true);

  if (Platform.OS === 'web') {
    try {
      const canvas = drawRoundCanvas({
        tournamentName, roundLabel, courseName, recap, ranked, unit, theme,
      });
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/png');
      });
      const fallbackText = roundSummaryToText({
        tournamentName, roundLabel, ranked, unit, boardUrl,
      });
      await shareBlobOrDownload(blob, fileName, roundLabel ?? tournamentName ?? 'Round Summary', fallbackText);
      return true;
    } catch (e) {
      console.warn('Web share failed:', e);
      notify('Could not share', `Sharing failed: ${e?.message ?? e}`);
      return false;
    } finally {
      onBusy?.(false);
    }
  }

  try {
    if (!viewRef?.current) throw new Error('Nothing to capture');
    const uri = await captureRef(viewRef, { format: 'png', quality: 1 });
    if (!(await Sharing.isAvailableAsync())) {
      notify('Sharing unavailable', 'Sharing is not available on this device.');
      return false;
    }
    await Sharing.shareAsync(uri);
    return true;
  } catch (e) {
    // A user-cancelled share sheet is not an error worth surfacing.
    if (e?.message && /cancel/i.test(e.message)) return false;
    console.warn('Share failed:', e);
    notify('Could not share', `Sharing failed: ${e?.message ?? e}`);
    return false;
  } finally {
    onBusy?.(false);
  }
}

// ---------------------------------------------------------------------------
// Rank badge helpers
// ---------------------------------------------------------------------------
const RANK_COLORS = [semantic.rank.gold, semantic.rank.silver, semantic.rank.bronze];
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
    const pal = cardPalette(theme);
    const players = leaderboard.slice(0, 4);

    return (
      <View
        ref={ref}
        collapsable={false}
        style={[
          styles.card,
          {
            backgroundColor: pal.bg,
            borderColor: pal.border,
          },
        ]}
      >
        {/* ---- Header ---- */}
        <View style={styles.header}>
          <Text
            style={[
              styles.tournamentName,
              {
                color: pal.text,
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
                color: pal.accent,
                fontFamily: 'PlusJakartaSans-Medium',
              },
            ]}
          >
            Leaderboard
          </Text>
        </View>

        {/* ---- Divider ---- */}
        <View style={[styles.divider, { backgroundColor: pal.border }]} />

        {/* ---- Column labels ---- */}
        <View style={styles.columnLabels}>
          <Text
            style={[
              styles.colLabel,
              styles.colLabelPlayer,
              { color: pal.sub, fontFamily: 'PlusJakartaSans-SemiBold' },
            ]}
          >
            Player
          </Text>
          <Text
            style={[
              styles.colLabel,
              { color: pal.sub, fontFamily: 'PlusJakartaSans-SemiBold' },
            ]}
          >
            Pts
          </Text>
          <Text
            style={[
              styles.colLabel,
              { color: pal.sub, fontFamily: 'PlusJakartaSans-SemiBold' },
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
                  color: pal.text,
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
                  color: pal.accent,
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
                  color: pal.sub,
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
                color: pal.accent,
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
// ShareableRoundCard
// ---------------------------------------------------------------------------
export const ShareableRoundCard = React.forwardRef(
  ({
    tournamentName, roundLabel, courseName, recap, ranked = [], unit = 'pts',
  }, ref) => {
    const { theme } = useTheme();
    const pal = cardPalette(theme);
    const podium = ranked.slice(0, 3);
    const unitLabel = unit === 'holes' ? 'holes' : 'pts';
    const dateStr = new Date().toLocaleDateString();

    return (
      <View
        ref={ref}
        collapsable={false}
        style={[
          roundStyles.card,
          {
            backgroundColor: pal.bg,
            borderColor: pal.border,
          },
        ]}
      >
        {/* ---- Header ---- */}
        <View>
          <Text
            style={[
              roundStyles.eyebrow,
              { color: pal.accent, fontFamily: 'PlusJakartaSans-SemiBold' },
            ]}
          >
            ROUND SUMMARY
          </Text>
          {tournamentName ? (
            <Text
              style={[
                roundStyles.tournamentName,
                { color: pal.text, fontFamily: 'PlusJakartaSans-ExtraBold' },
              ]}
              numberOfLines={1}
            >
              {tournamentName}
            </Text>
          ) : null}
          {roundLabel ? (
            <Text
              style={[
                roundStyles.roundLabel,
                { color: pal.sub, fontFamily: 'PlusJakartaSans-Medium' },
              ]}
              numberOfLines={1}
            >
              {roundLabel}
            </Text>
          ) : null}
        </View>

        {/* ---- Divider ---- */}
        <View style={[roundStyles.divider, { backgroundColor: pal.border }]} />

        {/* ---- Winner hero ---- */}
        <View style={roundStyles.winnerRow}>
          <View style={roundStyles.winnerNameCol}>
            <Text
              style={[
                roundStyles.winnerLabel,
                { color: pal.muted, fontFamily: 'PlusJakartaSans-SemiBold' },
              ]}
            >
              WINNER
            </Text>
            <Text
              style={[
                roundStyles.winnerName,
                { color: pal.text, fontFamily: 'PlusJakartaSans-ExtraBold' },
              ]}
              numberOfLines={1}
            >
              {recap?.winnerName || 'No winner yet'}
            </Text>
          </View>
          <Text
            style={[
              roundStyles.winnerPoints,
              { color: pal.accent, fontFamily: 'PlusJakartaSans-ExtraBold' },
            ]}
          >
            {`${recap?.winnerPoints ?? '-'} ${unitLabel}`}
          </Text>
        </View>

        {/* ---- Podium ---- */}
        <View style={roundStyles.podiumRow}>
          {podium.map((entry, idx) => (
            <View
              key={idx}
              style={[
                roundStyles.podiumCell,
                { backgroundColor: pal.card, borderColor: pal.border },
              ]}
            >
              <Text style={roundStyles.medal}>{['🥇', '🥈', '🥉'][idx]}</Text>
              <Text
                style={[
                  roundStyles.podiumName,
                  { color: pal.text, fontFamily: 'PlusJakartaSans-SemiBold' },
                ]}
                numberOfLines={1}
              >
                {entry.player?.name ?? 'Unknown'}
              </Text>
              <Text
                style={[
                  roundStyles.podiumPoints,
                  { color: pal.accent, fontFamily: 'PlusJakartaSans-Bold' },
                ]}
              >
                {`${entry.points ?? '-'} ${unitLabel}`}
              </Text>
            </View>
          ))}
        </View>

        {/* ---- Footer ---- */}
        <View style={roundStyles.footer}>
          <Text
            style={[
              roundStyles.footerMeta,
              { color: pal.muted, fontFamily: 'PlusJakartaSans-Medium' },
            ]}
            numberOfLines={1}
          >
            {[courseName, dateStr].filter(Boolean).join(' · ')}
          </Text>
          <Text
            style={[
              roundStyles.brandText,
              { color: pal.accent, fontFamily: 'PlusJakartaSans-SemiBold' },
            ]}
          >
            Golf Partner 🏌️
          </Text>
        </View>
      </View>
    );
  },
);

ShareableRoundCard.displayName = 'ShareableRoundCard';

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

// ---------------------------------------------------------------------------
// Styles: ShareableRoundCard
// ---------------------------------------------------------------------------
const roundStyles = StyleSheet.create({
  card: {
    minWidth: 320,
    aspectRatio: 16 / 9,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    justifyContent: 'space-between',
  },

  /* Header */
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  tournamentName: {
    fontSize: 24,
    letterSpacing: -0.4,
    lineHeight: 30,
    marginTop: 4,
  },
  roundLabel: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },

  /* Divider */
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },

  /* Winner hero */
  winnerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
  },
  winnerNameCol: {
    flex: 1,
    minWidth: 0,
  },
  winnerLabel: {
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  winnerName: {
    fontSize: 26,
    lineHeight: 32,
  },
  winnerPoints: {
    fontSize: 22,
  },

  /* Podium */
  podiumRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  podiumCell: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    alignItems: 'flex-start',
  },
  medal: {
    fontSize: 20,
    marginBottom: 4,
  },
  podiumName: {
    fontSize: 13,
    width: '100%',
  },
  podiumPoints: {
    fontSize: 13,
    marginTop: 2,
  },

  /* Footer */
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 8,
  },
  footerMeta: {
    fontSize: 11,
    flexShrink: 1,
  },
  brandText: {
    fontSize: 11,
    letterSpacing: 0.5,
  },
});
