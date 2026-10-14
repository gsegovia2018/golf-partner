// The "Card actions" menu of a card (opened by the ⋯ in the screen's header)
// and the confirm sheet each item opens. The items come from
// leagueView.cardActions: each states its deadline or consequence, and a
// disabled one says why. The server still has the last word and its message
// (or a friendlier one for the known hints) is shown in the sheet.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import CardActionSheet from './CardActionSheet';
import BottomSheet from '../BottomSheet';
import { useTheme } from '../../theme/ThemeContext';
import { useT, tr } from '../../i18n';
import {
  rescheduleLeagueCard, reopenLeagueCard, approveLeagueCard, withdrawLeagueCard, voidLeagueCard,
} from '../../store/leagueStore';

const RUN = {
  reschedule: (card, teeTime) => rescheduleLeagueCard(card.id, teeTime),
  reopen: (card) => reopenLeagueCard(card.id),
  approve: (card) => approveLeagueCard(card.id),
  withdraw: (card) => withdrawLeagueCard(card.id),
  void: (card, reason) => voidLeagueCard(card.id, reason),
};

export default function LeagueCardActions({
  card, who, monthLabel, isOwner, items, menuOpen, onMenuClose, onDone, onShare,
}) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // A friendlier message for the hints the server uses; its own text otherwise.
  function messageFor(kind, e) {
    const key = `league.actions.${kind}.err.${e?.hint}`;
    const known = e?.hint ? t(key, { month: monthLabel }) : key;
    return known !== key ? known : (e?.message || t('league.actions.failed'));
  }

  async function confirm(arg) {
    if (busy || !open) return;
    const kind = open;
    setBusy(true);
    setError(null);
    try {
      await RUN[kind](card, arg);
      setOpen(null);
      await onDone?.(kind);
    } catch (e) {
      setError(messageFor(kind, e));
    } finally {
      setBusy(false);
    }
  }

  function pick(item) {
    if (!item.enabled) return;
    setError(null);
    onMenuClose?.();
    // "Share card" opens the share sheet, not a confirm sheet.
    if (item.kind === 'share') onShare?.();
    else setOpen(item.kind);
  }

  return (
    <>
      <BottomSheet visible={!!menuOpen} onClose={onMenuClose} sheetStyle={s.sheet}>
        <Text style={s.title} accessibilityRole="header">{t('league.actions.menu')}</Text>
        {(items ?? []).map((it) => {
          const color = !it.enabled ? theme.text.muted : it.tone === 'danger' ? theme.destructive : theme.text.primary;
          return (
            <TouchableOpacity
              key={it.kind}
              style={[s.item, !it.enabled && s.itemOff]}
              onPress={() => pick(it)}
              disabled={!it.enabled}
              accessibilityRole="button"
              accessibilityLabel={`${tr(it.title)}. ${tr(it.sub)}`}
              accessibilityState={{ disabled: !it.enabled }}
            >
              <Feather name={it.icon} size={18} color={color} />
              <View style={s.itemText}>
                <Text style={[s.itemTitle, { color }]}>{tr(it.title)}</Text>
                <Text style={s.itemSub}>{tr(it.sub)}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </BottomSheet>
      <CardActionSheet
        visible={!!open}
        kind={open}
        card={card}
        who={who}
        isOwn={isOwner}
        monthLabel={monthLabel}
        busy={busy}
        error={error}
        onConfirm={confirm}
        onCancel={() => setOpen(null)}
      />
    </>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    sheet: {
      backgroundColor: theme.bg.primary, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 20, paddingBottom: 32, gap: 6,
    },
    title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, lineHeight: 28, color: theme.text.primary, marginBottom: 6 },
    item: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 14, minHeight: 56, paddingVertical: 10,
      paddingHorizontal: 4,
    },
    itemOff: { opacity: 0.85 },
    itemText: { flex: 1, minWidth: 0 },
    itemTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, lineHeight: 20 },
    itemSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, lineHeight: 17, color: theme.text.secondary, marginTop: 1 },
  });
}
