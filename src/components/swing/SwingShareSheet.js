// The owner's "Share this swing" sheet (Results → ⋯ → Share link; plan 2026-10-31-swing-share).
// Before: what gets uploaded and how the name shows, one button. While uploading: "n of m".
// After: the link (copy), the system share sheet, and "Stop sharing", which deletes the files.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import BottomSheet from '../BottomSheet';
import IconButton from '../ui/IconButton';
import PressableScale from '../ui/PressableScale';
import { PrimaryButton } from '../ui/Buttons';
import { useTheme } from '../../theme/ThemeContext';
import { useSwingTone } from './swingTone';
import { swingType } from './swingStyles';
import { SWING_STRINGS } from '../../swing/strings';
import { formatNumber } from '../../i18n/format';
import { useAuth } from '../../context/AuthContext';
import { loadCachedProfile } from '../../store/profileStore';
import { publicNameRule } from '../../store/leagueShare';
import { swingShareUrl } from '../../store/swingShare';
import { shareSwing, unshareSwing } from '../../store/swingShareStore';
import { MAX_VIDEO_UPLOAD_BYTES } from '../../lib/mediaLimits';
import { shareOrigin } from '../../lib/shareOrigin';
import { copyText, shareText } from '../../lib/shareText';

const S = SWING_STRINGS.share;
const mb = (bytes) => `${formatNumber(Math.max(1, Math.round((bytes || 0) / (1024 * 1024))))} MB`;

export default function SwingShareSheet({ visible, onClose, swingId, row }) {
  const { theme } = useTheme();
  const tone = useSwingTone();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const ty = useMemo(() => swingType(theme), [theme]);
  const { user } = useAuth() ?? {};
  const [name, setName] = useState(null);
  const [busy, setBusy] = useState(null); // null | { done, total } while uploading | 'stopping'
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const token = row?.share?.token ?? null;
  const url = token ? swingShareUrl(shareOrigin(), token) : null;
  const tooBig = (row?.bytes ?? 0) > MAX_VIDEO_UPLOAD_BYTES;

  useEffect(() => {
    if (!visible || !user?.id) return;
    let live = true;
    loadCachedProfile(user.id).then((p) => { if (live) setName(publicNameRule(p?.displayName ?? p?.display_name)); }).catch(() => {});
    return () => { live = false; };
  }, [visible, user?.id]);
  useEffect(() => { if (visible) { setError(null); setCopied(false); } }, [visible]);

  const upload = async () => {
    setError(null);
    setBusy({ done: 0, total: 1 });
    try {
      await shareSwing(swingId, { onProgress: (p) => setBusy(p) });
    } catch {
      setError(S.failed);
    } finally {
      setBusy(null);
    }
  };
  const stop = async () => {
    setError(null);
    setBusy('stopping');
    try {
      await unshareSwing(swingId);
      onClose?.();
    } catch {
      setError(S.stopFailed);
    } finally {
      setBusy(null);
    }
  };
  const copy = async () => { if (await copyText(url)) setCopied(true); };
  const send = async () => { if ((await shareText(S.message(url))) === 'copied') setCopied(true); };

  const uploading = busy && busy !== 'stopping';
  return (
    <BottomSheet visible={visible} onClose={busy ? () => {} : onClose} sheetStyle={s.sheet}>
      <View testID="swing-share-sheet">
        <Text style={[ty.title, s.title]} accessibilityRole="header">{S.title}</Text>
        {token && !uploading ? (
          <>
            <View style={s.linkRow}>
              <Feather name="link" size={18} color={theme.accent.primary} />
              <Text style={s.linkText} numberOfLines={1} selectable testID="swing-share-url">{url}</Text>
              <IconButton icon={copied ? 'check' : 'copy'} size={18} accessibilityLabel={copied ? S.copied : S.copy} onPress={copy} />
            </View>
            <View style={s.statusRow}>
              <View style={[s.dot, { backgroundColor: tone.green }]} />
              <Text style={ty.body}>{copied ? S.copied : S.uploaded}</Text>
            </View>
            <PrimaryButton style={s.btn} icon="share" label={S.shareLink} onPress={send} disabled={!!busy} accessibilityLabel={S.shareLink} testID="swing-share-send" />
            <PressableScale style={s.stopBtn} onPress={stop} disabled={!!busy} accessibilityRole="button" accessibilityLabel={S.stop} testID="swing-share-stop">
              <Text style={[s.stopText, { color: tone.red }]}>{busy === 'stopping' ? '…' : S.stop}</Text>
            </PressableScale>
            <Text style={[ty.body, s.note]}>{S.stopNote}</Text>
          </>
        ) : (
          <>
            <Text style={ty.body}>{tooBig ? S.tooBig(mb(row?.bytes)) : S.body(name, mb(row?.bytes))}</Text>
            <PrimaryButton
              style={s.btn}
              icon={uploading ? null : 'upload-cloud'}
              label={uploading ? S.uploading(busy.done, busy.total) : S.upload}
              onPress={upload}
              disabled={tooBig || !!busy}
              accessibilityLabel={S.upload}
              testID="swing-share-upload"
            />
          </>
        )}
        {error ? <Text style={[ty.body, s.error, { color: tone.red }]} accessibilityLiveRegion="polite">{error}</Text> : null}
      </View>
    </BottomSheet>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  sheet: { paddingHorizontal: 20, paddingBottom: 28 },
  title: { marginBottom: 6 },
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, paddingLeft: 14, paddingRight: 4, minHeight: 52,
    borderRadius: 14, borderWidth: 1, borderColor: theme.border.default, backgroundColor: theme.bg.card,
  },
  linkText: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: theme.text.primary },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  btn: { marginTop: 16 },
  stopBtn: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  stopText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15 },
  note: { textAlign: 'center', fontSize: 11, lineHeight: 15 },
  error: { marginTop: 10 },
});
