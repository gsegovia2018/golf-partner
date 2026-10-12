// Confirms a league card action that changes someone's deadline or score:
// reschedule (owner), reopen a missed card, approve an unannounced card
// (admins). Each states the consequence before the button. An in-app sheet
// rather than Alert.alert, which does nothing on web.
//
// Parent runs the action in `onConfirm` and passes back `busy` and `error`.
// kind: 'reschedule' | 'reopen' | 'approve'. Reschedule hands the new tee time
// (ISO) to onConfirm.
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import BottomSheet from '../BottomSheet';
import DateField from '../DateField';
import { POST_WINDOW_HOURS, postByFor } from '../../store/leagueRules';
import { buildTeeTime, localDateText, localTimeText } from '../../store/leagueOffApp';
import { clockWithDay } from './DeadlineLine';

export default function CardActionSheet({
  visible, kind, card, who, monthLabel, busy, error, onConfirm, onCancel,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [dateText, setDateText] = useState('');
  const [timeText, setTimeText] = useState('');

  useEffect(() => {
    if (!visible) return;
    const tee = card?.teeTime ? new Date(card.teeTime) : new Date();
    setDateText(localDateText(tee));
    setTimeText(localTimeText(tee));
  }, [visible, card?.teeTime]);

  const now = new Date();
  const newTee = kind === 'reschedule' ? buildTeeTime(dateText, timeText) : null;
  const newPostBy = postByFor(newTee);
  const reopenUntil = new Date(now.getTime() + POST_WINDOW_HOURS * 3600000);
  const score = card?.gross != null ? `${card.gross}` : card?.points != null ? `${card.points} pts` : 'card';
  const where = card?.course?.name ? ` at ${card.course.name}` : '';

  const copy = {
    reschedule: {
      title: 'Change tee time',
      lead: "Pick the new tee time. It has to stay in the same month, and you can't change it once the original tee time has passed.",
      consequence: newPostBy ? `New post-by ${clockWithDay(newPostBy, now, true)}` : 'Pick a valid date and time.',
      action: 'Change tee time',
    },
    reopen: {
      title: `Reopen ${who}'s card?`,
      lead: "It goes back to where it was, with a fresh deadline.",
      consequence: `${who} gets ${POST_WINDOW_HOURS} more hours, until ${clockWithDay(reopenUntil, now, true)}.`,
      action: 'Reopen card',
    },
    approve: {
      title: `Approve ${who}'s card?`,
      lead: 'It was not announced in the app, so it does not count until an admin approves it.',
      consequence: `${who}'s ${score}${where} will count for ${monthLabel}.`,
      action: 'Approve card',
    },
  }[kind] ?? { title: '', lead: '', consequence: '', action: '' };
  const disabled = busy || (kind === 'reschedule' && !newTee);

  return (
    <BottomSheet visible={visible} onClose={busy ? undefined : onCancel} sheetStyle={s.sheet}>
      <Text style={s.title} accessibilityRole="header">{copy.title}</Text>
      <Text style={s.lead}>{copy.lead}</Text>
      {kind === 'reschedule' && (
        <DateField
          label="New date and tee time"
          value={dateText}
          onChange={setDateText}
          time={timeText}
          onTimeChange={setTimeText}
          min={localDateText()}
        />
      )}
      <View style={s.consequence}><Text style={s.consequenceText}>{copy.consequence}</Text></View>
      {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
      <TouchableOpacity
        style={[s.btn, disabled && s.btnOff]}
        onPress={() => !disabled && onConfirm(newTee)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled, busy }}
      >
        {busy ? <ActivityIndicator color={theme.text.inverse} size="small" /> : <Text style={s.btnText}>{copy.action}</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={s.textBtn} onPress={onCancel} disabled={busy} accessibilityRole="button">
        <Text style={s.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    sheet: {
      backgroundColor: theme.bg.primary, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 20, paddingBottom: 32, gap: 10,
    },
    title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, lineHeight: 28, color: theme.text.primary },
    lead: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, lineHeight: 18, color: theme.text.secondary },
    consequence: { backgroundColor: theme.bg.secondary, borderRadius: 12, padding: 12 },
    consequenceText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, lineHeight: 19, color: theme.text.primary },
    error: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 13, lineHeight: 18 },
    btn: {
      alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent.primary,
      borderRadius: 14, minHeight: 48, paddingVertical: 14, marginTop: 4,
    },
    btnOff: { opacity: 0.4 },
    btnText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 14 },
    textBtn: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
    cancelText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 14 },
  });
}
