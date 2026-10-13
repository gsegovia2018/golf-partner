// Confirms a league card action that changes someone's deadline, score or
// month: reschedule and withdraw (owner), void, reopen a missed card and
// approve an unannounced card (admins). Each states the consequence before the
// button. An in-app sheet rather than Alert.alert, which does nothing on web.
//
// Parent runs the action in `onConfirm` and passes back `busy` and `error`.
// kind: 'reschedule' | 'withdraw' | 'void' | 'reopen' | 'approve'.
// onConfirm gets the new tee time (ISO) for reschedule, the reason text for
// void, nothing otherwise.
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import BottomSheet from '../BottomSheet';
import DateField from '../DateField';
import { useT, tr } from '../../i18n';
import { POST_WINDOW_HOURS, OFFAPP_NOTICE_HOURS, postByFor } from '../../store/leagueRules';
import { buildTeeTime, localDateText, localTimeText } from '../../store/leagueOffApp';
import { VOID_REASONS, voidReasonText, autoWithdrawNote } from '../../store/leagueView';
import { clockWithDay } from './DeadlineLine';
import { stamp } from './stamp';

export default function CardActionSheet({
  visible, kind, card, who, isOwn, monthLabel, busy, error, onConfirm, onCancel,
}) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  const [dateText, setDateText] = useState('');
  const [timeText, setTimeText] = useState('');
  const [reasonId, setReasonId] = useState(VOID_REASONS[0].id);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!visible) return;
    const tee = card?.teeTime ? new Date(card.teeTime) : new Date();
    setDateText(localDateText(tee));
    setTimeText(localTimeText(tee));
    setReasonId(VOID_REASONS[0].id);
    setNote('');
  }, [visible, card?.teeTime]);

  const now = new Date();
  const newTee = kind === 'reschedule' ? buildTeeTime(dateText, timeText) : null;
  const newPostBy = postByFor(newTee);
  const reopenUntil = new Date(now.getTime() + POST_WINDOW_HOURS * 3600000);
  const course = card?.course?.name;
  const reasonLabel = t(VOID_REASONS.find((r) => r.id === reasonId).key);
  const pts = card?.points != null ? String(card.points) : null;
  const scoreText = pts != null ? t('league.actions.approve.points', { points: pts }) : t('league.actions.approve.word');
  const auto = kind === 'withdraw' ? autoWithdrawNote(card, stamp) : null;

  let copy = { title: '', lead: '', consequence: '', then: '', action: '', danger: false };
  if (kind === 'reschedule') {
    copy = {
      title: t('league.actions.reschedule.title'),
      lead: t('league.actions.reschedule.lead', { hours: OFFAPP_NOTICE_HOURS }),
      consequence: newPostBy
        ? t('league.actions.reschedule.postBy', { at: clockWithDay(newPostBy, now, true) })
        : t('league.actions.reschedule.invalid'),
      action: t('league.actions.reschedule.title'),
    };
  } else if (kind === 'reopen') {
    copy = {
      title: t('league.actions.reopen.sheetTitle', { name: who }),
      lead: t('league.actions.reopen.lead'),
      consequence: t('league.actions.reopen.consequence', {
        name: who, hours: POST_WINDOW_HOURS, until: clockWithDay(reopenUntil, now, true),
      }),
      action: t('league.actions.reopen.title'),
    };
  } else if (kind === 'approve') {
    copy = {
      title: t('league.actions.approve.sheetTitle', { name: who }),
      lead: t('league.actions.approve.lead'),
      consequence: t('league.actions.approve.consequence', {
        name: who,
        score: scoreText,
        where: course ? t('league.actions.approve.at', { course }) : '',
        month: monthLabel,
      }),
      action: t('league.actions.approve.title'),
    };
  } else if (kind === 'withdraw') {
    copy = {
      title: t('league.actions.withdraw.sheetTitle', { month: monthLabel }),
      lead: card?.source === 'offapp'
        ? t('league.actions.withdraw.leadOff', { tee: stamp(card?.teeTime) })
        : t('league.actions.withdraw.leadApp'),
      consequence: t('league.actions.withdraw.free', { month: monthLabel }),
      then: t('league.actions.withdraw.told'),
      action: t('league.actions.withdraw.title'),
      danger: true,
    };
  } else if (kind === 'void') {
    const stops = pts != null
      ? t(isOwn ? 'league.actions.void.stopsOwn' : 'league.actions.void.stops', {
        name: who, points: pts, course: course ?? '', month: monthLabel,
      })
      : t(isOwn ? 'league.actions.void.stopsOwnNoPts' : 'league.actions.void.stopsNoPts', { name: who, month: monthLabel });
    copy = {
      title: isOwn ? t('league.actions.void.sheetTitleOwn') : t('league.actions.void.sheetTitle', { name: who }),
      lead: t(isOwn ? 'league.actions.void.leadOwn' : 'league.actions.void.lead'),
      consequence: stops,
      then: t(isOwn ? 'league.actions.void.keepsOwn' : 'league.actions.void.keeps', { name: who, month: monthLabel }),
      action: t('league.actions.void.title'),
      danger: true,
    };
  }
  const disabled = busy || (kind === 'reschedule' && !newTee) || !kind;
  const confirm = () => {
    if (disabled) return;
    if (kind === 'reschedule') onConfirm(newTee);
    else if (kind === 'void') onConfirm(voidReasonText(reasonLabel, note));
    else onConfirm();
  };

  return (
    <BottomSheet visible={visible} onClose={busy ? undefined : onCancel} sheetStyle={s.sheet}>
      <Text style={s.title} accessibilityRole="header">{copy.title}</Text>
      <Text style={s.lead}>{copy.lead}</Text>
      {kind === 'reschedule' && (
        <DateField
          label={t('league.actions.reschedule.field')}
          value={dateText}
          onChange={setDateText}
          time={timeText}
          onTimeChange={setTimeText}
          min={localDateText()}
        />
      )}
      {kind === 'void' && (
        <>
          <Text style={s.fieldLabel}>{t('league.actions.void.reason')}</Text>
          <View style={s.chips}>
            {VOID_REASONS.map((r) => {
              const on = r.id === reasonId;
              return (
                <TouchableOpacity
                  key={r.id}
                  style={[s.chip, on && s.chipOn]}
                  onPress={() => setReasonId(r.id)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[s.chipText, on && s.chipTextOn]}>{t(r.key)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={s.fieldLabel}>{t('league.actions.void.note')}</Text>
          <TextInput
            style={s.input}
            value={note}
            onChangeText={setNote}
            editable={!busy}
            multiline
            maxLength={300}
            placeholderTextColor={theme.text.muted}
            accessibilityLabel={t('league.actions.void.note')}
          />
        </>
      )}
      <View style={s.consequence}>
        <Text style={s.consequenceText}>{copy.consequence}</Text>
        {!!copy.then && <Text style={s.consequenceThen}>{copy.then}</Text>}
        {!!auto && <Text style={s.consequenceThen}>{tr(auto)}</Text>}
      </View>
      {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
      <TouchableOpacity
        style={[s.btn, copy.danger && s.btnDanger, disabled && s.btnOff]}
        onPress={confirm}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled, busy }}
      >
        {busy ? <ActivityIndicator color={theme.text.inverse} size="small" /> : <Text style={s.btnText}>{copy.action}</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={s.textBtn} onPress={onCancel} disabled={busy} accessibilityRole="button">
        <Text style={s.cancelText}>{t('common.cancel')}</Text>
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
    fieldLabel: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.secondary },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      paddingHorizontal: 12, minHeight: 36, justifyContent: 'center', borderRadius: 999, borderWidth: 1,
      borderColor: theme.border.default,
    },
    chipOn: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
    chipText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 12 },
    chipTextOn: { color: theme.text.inverse },
    input: {
      backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card, color: theme.text.primary,
      borderRadius: 10, borderWidth: 1, borderColor: theme.border.default, padding: 12, minHeight: 64,
      fontSize: 14, fontFamily: 'PlusJakartaSans-Medium', textAlignVertical: 'top',
    },
    consequence: { backgroundColor: theme.bg.secondary, borderRadius: 12, padding: 12, gap: 4 },
    consequenceText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, lineHeight: 19, color: theme.text.primary },
    consequenceThen: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, lineHeight: 18, color: theme.text.secondary },
    error: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 13, lineHeight: 18 },
    btn: {
      alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent.primary,
      borderRadius: 14, minHeight: 48, paddingVertical: 14, marginTop: 4,
    },
    btnDanger: { backgroundColor: theme.destructive },
    btnOff: { opacity: 0.4 },
    btnText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 14 },
    textBtn: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
    cancelText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 14 },
  });
}
