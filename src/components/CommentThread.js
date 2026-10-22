import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Image, Platform, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { semantic } from '../theme/tokens';
import { loadComments, addComment, deleteComment } from '../store/feedStore';
import { useT, getLanguage } from '../i18n';
import { circleText } from '../theme/circleText';

const MAX_BODY = 500;

// Compact relative time from an ISO timestamp: "just now", "3m", "5h", "2d".
function relTime(iso, t) {
  if (!iso) return '';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '';
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return t('feed.time.now');
  if (min < 60) return t('feed.time.min', { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('feed.time.hour', { count: hr });
  const day = Math.floor(hr / 24);
  if (day < 7) return t('feed.time.day', { count: day });
  return new Date(ts).toLocaleDateString(getLanguage() === 'es' ? 'es-ES' : undefined);
}

// Cross-platform confirm — window.confirm on web, Alert on native.
async function confirmDelete(t) {
  if (Platform.OS === 'web') return window.confirm(t('comments.delete.body'));
  return new Promise((resolve) => Alert.alert(
    t('comments.delete.title'), t('comments.delete.body'),
    [{ text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
     { text: t('comments.delete.confirm'), style: 'destructive', onPress: () => resolve(true) }],
  ));
}

function CommentRow({ comment, theme, s, onDelete }) {
  const t = useT();
  const name = comment.isMine ? t('comments.you') : (comment.author?.name || t('comments.player'));
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const color = comment.author?.avatarColor || theme.accent.primary;
  return (
    <View style={s.row}>
      <View style={[s.avatar, { backgroundColor: color }]}>
        {comment.author?.avatarUrl
          ? <Image source={{ uri: comment.author.avatarUrl }} style={s.avatarImg} />
          : <Text style={s.avatarText}>{initial}</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <View style={s.rowHead}>
          <Text style={s.rowName} numberOfLines={1}>{name}</Text>
          <Text style={s.rowTime}>{relTime(comment.createdAt, t)}</Text>
        </View>
        <Text style={s.rowBody}>{comment.body}</Text>
      </View>
      {comment.isMine ? (
        <TouchableOpacity
          onPress={() => onDelete(comment)}
          style={s.deleteBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={t('comments.delete.title')}
        >
          <Feather name="trash-2" size={14} color={theme.text.muted} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// Comment thread for a single feed item (a round or a photo reel), keyed by
// the feed item key. Loads the thread when active, supports optimistic
// posting and deleting the user's own comments. `onCountChange` reports
// +1 / -1 so the feed's comment badge stays in sync.
//
// `scroll` controls list layout: pass `scroll` (true) when hosted inside a
// BottomSheet (CommentsSheet) so the list gets its own ScrollView; leave it
// false for inline use (round summary) where the thread sits inside the
// host screen's own scroll container and must not nest a second ScrollView.
export default function CommentThread({
  itemKey,
  active = true,
  scroll = false,
  onCountChange,
  onCommentAdded,
}) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);

  const [comments, setComments] = useState([]);
  const [state, setState] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);

  const load = useCallback(async () => {
    if (!itemKey) return;
    setState('loading');
    try {
      setComments(await loadComments(itemKey));
      setState('ready');
    } catch {
      setState('error');
    }
  }, [itemKey]);

  // Reset and (re)load each time the thread becomes active for an item.
  useEffect(() => {
    if (!active || !itemKey) return;
    setDraft('');
    setSendError(false);
    load();
  }, [active, itemKey, load]);

  const onSend = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(false);
    const created = await addComment(itemKey, body);
    setSending(false);
    if (created) {
      setComments((prev) => [...prev, created]);
      setDraft('');
      onCountChange?.(itemKey, 1);
      onCommentAdded?.(itemKey, created);
    } else {
      // Offline, or the feed_comments table is not provisioned yet.
      setSendError(true);
    }
  };

  const onDelete = async (comment) => {
    if (!(await confirmDelete(t))) return;
    const ok = await deleteComment(comment.id);
    if (ok) {
      setComments((prev) => prev.filter((c) => c.id !== comment.id));
      onCountChange?.(itemKey, -1);
    } else if (Platform.OS !== 'web') {
      Alert.alert(t('comments.deleteFail.title'), t('comments.deleteFail.body'));
    }
  };

  const List = scroll ? ScrollView : View;

  return (
    <>
      {state === 'loading' ? (
        <View style={s.centerBox}>
          <ActivityIndicator color={theme.accent.primary} />
        </View>
      ) : state === 'error' ? (
        <View style={s.centerBox}>
          <Feather name="wifi-off" size={44} color={theme.text.muted} />
          <Text style={s.emptyText}>{t('comments.loadError')}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={load} activeOpacity={0.7}>
            <Text style={s.retryBtnText}>{t('comments.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : comments.length === 0 ? (
        <View style={s.centerBox}>
          <Feather name="message-circle" size={44} color={theme.text.muted} />
          <Text style={s.emptyText}>{t('comments.empty')}</Text>
        </View>
      ) : (
        <List
          style={scroll ? s.list : undefined}
          contentContainerStyle={scroll ? s.listContent : undefined}
        >
          {scroll
            ? comments.map((c) => (
                <CommentRow key={c.id} comment={c} theme={theme} s={s} onDelete={onDelete} />
              ))
            : (
              <View style={s.listContent}>
                {comments.map((c) => (
                  <CommentRow key={c.id} comment={c} theme={theme} s={s} onDelete={onDelete} />
                ))}
              </View>
            )}
        </List>
      )}

      {sendError ? (
        <Text style={s.sendError}>
          {t('comments.sendError')}
        </Text>
      ) : null}

      <View style={s.inputRow}>
        <TextInput
          style={s.input}
          placeholder={t('comments.placeholder')}
          placeholderTextColor={theme.text.muted}
          keyboardAppearance={theme.isDark ? 'dark' : 'light'}
          selectionColor={theme.accent.primary}
          value={draft}
          onChangeText={(v) => { setDraft(v); if (sendError) setSendError(false); }}
          maxLength={MAX_BODY}
          multiline
        />
        <TouchableOpacity
          style={[s.sendBtn, (!draft.trim() || sending) && s.sendBtnDisabled]}
          onPress={onSend}
          disabled={!draft.trim() || sending}
          activeOpacity={0.7}
          accessibilityLabel={t('comments.postA11y')}
        >
          {sending
            ? <ActivityIndicator size="small" color={theme.text.inverse} />
            : <Feather name="send" size={16} color={theme.text.inverse} />}
        </TouchableOpacity>
      </View>
    </>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  centerBox: {
    alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 36,
  },
  emptyText: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, color: theme.text.muted,
    textAlign: 'center',
  },
  retryBtn: {
    backgroundColor: theme.accent.light, borderRadius: 10,
    borderWidth: 1, borderColor: theme.accent.primary + '40',
    paddingHorizontal: 16, paddingVertical: 8, marginTop: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  retryBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13, textAlign: 'center' },
  list: { marginBottom: 4 },
  listContent: { gap: 14, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  avatar: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: semantic.winner.dark, fontSize: 13, ...circleText },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowName: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.text.primary,
    flexShrink: 1,
  },
  rowTime: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted },
  rowBody: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: theme.text.primary,
    marginTop: 2, lineHeight: 19,
  },
  deleteBtn: { padding: 4 },
  sendError: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11, color: theme.destructive,
    marginTop: 6,
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 10,
  },
  input: {
    flex: 1, backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 12, borderWidth: 1,
    borderColor: theme.border.default,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14,
    fontFamily: 'PlusJakartaSans-Medium', maxHeight: 110,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: theme.accent.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
});
