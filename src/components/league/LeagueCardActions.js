// The action buttons on a card (change tee time, reopen, approve) and the
// sheet each one opens. Shows only what this viewer may do; the server still
// has the last word and its message is shown in the sheet.
import React, { useState } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import CardActionSheet from './CardActionSheet';
import { makeOffAppStyles } from './offAppStyles';
import { useTheme } from '../../theme/ThemeContext';
import { isMissed, needsApproval } from '../../store/leagueRules';
import { rescheduleLeagueCard, reopenLeagueCard, approveLeagueCard } from '../../store/leagueStore';

export function cardActionsFor(card, { isOwner, isAdmin }, now = new Date()) {
  if (!card) return [];
  const out = [];
  const teeOpen = card.teeTime && new Date(card.teeTime).getTime() > now.getTime();
  if (isOwner && card.source === 'offapp' && card.status === 'announced' && teeOpen) {
    out.push({ kind: 'reschedule', label: 'Change tee time' });
  }
  if (isAdmin && !isOwner && isMissed(card, now)) out.push({ kind: 'reopen', label: 'Reopen card' });
  if (isAdmin && !isOwner && needsApproval(card)) out.push({ kind: 'approve', label: 'Approve card' });
  return out;
}

const RUN = {
  reschedule: (card, teeTime) => rescheduleLeagueCard(card.id, teeTime),
  reopen: (card) => reopenLeagueCard(card.id),
  approve: (card) => approveLeagueCard(card.id),
};

export default function LeagueCardActions({ card, who, monthLabel, isOwner, isAdmin, onDone }) {
  const { theme } = useTheme();
  const s = makeOffAppStyles(theme);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const actions = cardActionsFor(card, { isOwner, isAdmin });

  async function confirm(teeTime) {
    if (busy || !open) return;
    setBusy(true);
    setError(null);
    try {
      await RUN[open](card, teeTime);
      setOpen(null);
      await onDone?.();
    } catch (e) {
      setError(e?.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (actions.length === 0) return null;
  return (
    <>
      {actions.map((a) => (
        <TouchableOpacity
          key={a.kind}
          style={s.primaryBtn}
          onPress={() => { setError(null); setOpen(a.kind); }}
          activeOpacity={0.8}
          accessibilityRole="button"
        >
          <Text style={s.primaryText}>{a.label}</Text>
        </TouchableOpacity>
      ))}
      <CardActionSheet
        visible={!!open}
        kind={open}
        card={card}
        who={who}
        monthLabel={monthLabel}
        busy={busy}
        error={error}
        onConfirm={confirm}
        onCancel={() => setOpen(null)}
      />
    </>
  );
}
