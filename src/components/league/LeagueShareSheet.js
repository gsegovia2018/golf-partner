// "Share to the group" (D4 B): one in-app sheet for every league share. Chips
// pick the message (October so far / Season / My card, plus the preset the
// sheet was opened with: an announcement or a month's results), the preview
// shows the exact text, and a switch adds the public board link. The text is
// built by store/leagueShare in the sharer's language.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet,
} from 'react-native';
import Switch from '../ui/Switch';
import { Feather } from '@expo/vector-icons';
import BottomSheet from '../BottomSheet';
import SheetHandle from '../ui/SheetHandle';
import { buttonStyles } from '../ui/Buttons';
import { useTheme } from '../../theme/ThemeContext';
import { useT, getLanguage, formatDate } from '../../i18n';
import { getLeagueShareLink } from '../../store/leagueStore';
import { currentMonthKey } from '../../store/leagueView';
import {
  publicBoardUrl, standingsMessage, seasonMessage, resultsMessage, cardMessage, announcementMessage, shareableCard,
} from '../../store/leagueShare';
import { shareOrigin } from '../../lib/shareOrigin';
import { copyText, shareText } from '../../lib/shareText';

const TOAST_MS = 2500;

export default function LeagueShareSheet({
  visible, onClose, leagueId, snapshot = null, meId = null, mode = 'month', card = null,
  announce = null, resultsMonth = null, now = new Date(),
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const t = useT();
  const lang = getLanguage();
  const [selected, setSelected] = useState(mode);
  const [link, setLink] = useState({ state: 'loading', token: null });
  const [withLink, setWithLink] = useState(true);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const toastTimer = useRef(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; clearTimeout(toastTimer.current); }, []);

  // Each opening starts on the preset and asks for the link again (an admin
  // may have switched the board off or made a new link meanwhile).
  useEffect(() => {
    if (!visible) return undefined;
    setSelected(mode);
    setToast(null);
    setLink({ state: 'loading', token: null });
    let alive = true;
    getLeagueShareLink(leagueId)
      .then((token) => { if (alive) setLink({ state: token ? 'ready' : 'off', token }); })
      .catch(() => { if (alive) setLink({ state: 'failed', token: null }); });
    return () => { alive = false; };
  }, [visible, mode, leagueId]);

  const monthKey = currentMonthKey(now);
  const monthWord = formatDate(`${monthKey}-01`, 'monthName');
  const myCard = card ?? (snapshot ? shareableCard(snapshot, monthKey, meId) : null);
  const chips = [
    announce && { key: 'announce', label: t('league.share.chipAnnounce') },
    resultsMonth && snapshot && {
      key: 'results', label: t('league.share.chipResults', { month: formatDate(`${resultsMonth}-01`, 'monthName') }),
    },
    snapshot && { key: 'month', label: cap(t('league.share.chipMonth', { month: monthWord })) },
    snapshot && { key: 'season', label: t('league.share.chipSeason') },
    snapshot && myCard && { key: 'card', label: t('league.share.chipCard') },
  ].filter(Boolean);
  const active = chips.some((c) => c.key === selected) ? selected : chips[0]?.key;

  const url = withLink && link.state === 'ready' ? publicBoardUrl(shareOrigin(), link.token) : null;
  let message = '';
  if (active === 'announce') message = announcementMessage(announce, { url, lang });
  else if (active === 'results') message = resultsMessage(snapshot, { month: resultsMonth, now, url, lang });
  else if (active === 'season') message = seasonMessage(snapshot, { url, lang });
  else if (active === 'card') message = cardMessage(snapshot, myCard, { now, url, lang });
  else if (active === 'month') message = standingsMessage(snapshot, { now, url, lang });

  function flash(key) {
    setToast(key);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => { if (mounted.current) setToast(null); }, TOAST_MS);
  }

  async function copy() {
    flash((await copyText(message)) ? 'league.share.copied' : 'league.share.copyFailed');
  }

  async function share() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await shareText(message);
      if (!mounted.current) return;
      if (res === 'copied') flash('league.share.copied');
      else if (res === 'failed') flash('league.share.copyFailed');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const linkNote = link.state === 'loading' ? t('league.share.linkLoading')
    : link.state === 'off' ? t('league.share.linkOff')
      : link.state === 'failed' ? t('league.share.linkFailed') : t('league.share.linkSub');

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={s.sheet}>
      <SheetHandle />
      <Text style={s.title} accessibilityRole="header">{t('league.share.title')}</Text>

      {chips.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow} contentContainerStyle={s.chipRowContent}>
          {chips.map((c) => {
            const on = c.key === active;
            return (
              <TouchableOpacity
                key={c.key}
                style={[s.chip, on && s.chipOn]}
                onPress={() => setSelected(c.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                hitSlop={{ top: 8, bottom: 8 }}
              >
                <Text style={[s.chipText, on && s.chipTextOn]}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <ScrollView style={s.preview} contentContainerStyle={s.previewContent} nestedScrollEnabled>
        <Text selectable style={s.previewText} accessibilityLabel={t('league.share.preview')} testID="league-share-preview">
          {message}
        </Text>
      </ScrollView>

      <View style={s.linkRow}>
        <View style={s.linkText}>
          <Text style={s.linkTitle}>{t('league.share.linkRow')}</Text>
          <Text style={s.linkSub}>{linkNote}</Text>
        </View>
        {link.state === 'loading'
          ? <ActivityIndicator size="small" color={theme.accent.primary} />
          : (
            <Switch
              value={withLink && link.state === 'ready'}
              onValueChange={setWithLink}
              disabled={link.state !== 'ready'}
              accessibilityLabel={t('league.share.linkRow')}
              trackColor={{ true: theme.accent.primary }}
            />
          )}
      </View>

      {toast ? (
        <View style={s.toast} accessibilityLiveRegion="polite" accessibilityRole="alert">
          <Feather name={toast === 'league.share.copied' ? 'check-circle' : 'alert-circle'} size={14} color={theme.accent.primary} />
          <Text style={s.toastText}>{t(toast)}</Text>
        </View>
      ) : null}

      <View style={s.buttons}>
        <TouchableOpacity style={s.secondary} onPress={copy} accessibilityRole="button">
          <Feather name="copy" size={16} color={theme.accent.primary} />
          <Text style={s.secondaryText}>{t('league.share.copy')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.primary, busy && { opacity: 0.7 }]}
          onPress={share}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ busy, disabled: busy }}
        >
          <Feather name="share-2" size={16} color={theme.text.inverse} />
          <Text style={s.primaryText}>{t('league.share.share')}</Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

const cap = (x) => (x ? x.charAt(0).toUpperCase() + x.slice(1) : x);

function makeStyles(theme) {
  const btn = buttonStyles(theme);
  return StyleSheet.create({
    sheet: { paddingHorizontal: 20, paddingTop: 10, maxHeight: '92%' },
    title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, lineHeight: 28, color: theme.text.primary, marginBottom: 12 },
    chipRow: { flexGrow: 0, marginBottom: 12 },
    chipRowContent: { gap: 8 },
    chip: {
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: theme.bg.secondary,
      borderWidth: 1, borderColor: theme.border.default, minHeight: 32, justifyContent: 'center',
    },
    chipOn: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
    chipText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.secondary },
    chipTextOn: { color: theme.text.inverse },
    preview: {
      maxHeight: 260, backgroundColor: theme.bg.secondary, borderRadius: 14, borderWidth: 1,
      borderColor: theme.border.subtle, marginBottom: 14,
    },
    previewContent: { padding: 14 },
    previewText: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, lineHeight: 20, color: theme.text.primary },
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
    linkText: { flex: 1, minWidth: 0 },
    linkTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.primary },
    linkSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, lineHeight: 17, color: theme.text.secondary, marginTop: 2 },
    toast: {
      flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.accent.light,
      borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 12,
    },
    toastText: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: theme.accent.primary },
    buttons: { flexDirection: 'row', gap: 10 },
    secondary: { ...btn.secondaryBtn, flex: 1, gap: 8 },
    secondaryText: btn.secondaryTextAccent,
    primary: { ...btn.primaryBtn, flex: 1, gap: 8 },
    primaryText: btn.primaryText,
  });
}
