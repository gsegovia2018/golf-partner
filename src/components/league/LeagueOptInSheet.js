// "Count this round for <league>?" (D5 B): the one-time sheet a league member
// sees when they open a game they play in, before their first shot. Their
// phone announces their own card (R16). An in-app sheet, not Alert.alert,
// which does nothing on web.
import React from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useT, formatNumber } from '../../i18n';
import BottomSheet from '../BottomSheet';
import { buttonStyles } from '../ui/Buttons';
import { leagueStrokes, setupPlayerTee } from '../../store/leagueSetup';
import { cardMonth } from '../../store/leagueRules';
import { monthWord } from './LeagueCardsList';
import { teeDisplayName } from '../../lib/teeName';

export default function LeagueOptInSheet({
  visible, league, round, meId, starterName = null, busy = false, error = null,
  onCountIt, onNotThisRound,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const t = useT();
  if (!league || !round) return null;
  const month = monthWord(cardMonth(new Date()));
  const hcp = league.leagueHandicap;
  const tee = setupPlayerTee(round, meId);
  const lines = [
    hcp != null
      ? t('league.optIn.strokes', { strokes: leagueStrokes(round, meId, hcp), hcp: formatNumber(hcp, { decimals: 1 }) })
      : null,
    tee?.label && tee.slope != null ? t('league.optIn.tee', { tee: teeDisplayName(tee.label), slope: tee.slope }) : null,
  ].filter(Boolean).join(' · ');
  const errorText = error === 'offline' ? t('league.optIn.offline') : error;

  return (
    <BottomSheet visible={visible} onClose={busy ? undefined : onNotThisRound} sheetStyle={s.sheet}>
      <Text style={s.title} accessibilityRole="header">{t('league.optIn.title', { league: league.name })}</Text>
      <Text style={s.lead}>
        {starterName
          ? t('league.optIn.lead', { name: starterName, month })
          : t('league.optIn.leadNoName', { month })}
      </Text>
      <View style={s.cons}>
        {!!lines && <Text style={s.consMain}>{lines}</Text>}
        {hcp != null ? (
          <Text style={s.consSub}>{t('league.optIn.scoredFrom', { hcp: formatNumber(hcp, { decimals: 1 }) })}</Text>
        ) : null}
        <Text style={s.consSub}>{t('league.optIn.rule')}</Text>
      </View>
      {errorText ? <Text style={s.error} accessibilityRole="alert">{errorText}</Text> : null}
      <TouchableOpacity
        style={[s.primary, busy && { opacity: 0.7 }]}
        onPress={() => !busy && onCountIt()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
      >
        {busy
          ? <ActivityIndicator color={theme.text.inverse} size="small" />
          : <Text style={s.primaryText}>{error ? t('league.cards.tryAgain') : t('league.optIn.countIt')}</Text>}
      </TouchableOpacity>
      <TouchableOpacity
        style={s.secondary}
        onPress={onNotThisRound}
        disabled={busy}
        accessibilityRole="button"
      >
        <Text style={s.secondaryText}>{t('league.optIn.notThisRound')}</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

function makeStyles(theme) {
  const btn = buttonStyles(theme);
  return StyleSheet.create({
    sheet: { padding: 20 },
    title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary, marginBottom: 8 },
    lead: {
      fontFamily: 'PlusJakartaSans-Medium', fontSize: 14, lineHeight: 20, color: theme.text.secondary, marginBottom: 14,
    },
    cons: {
      backgroundColor: theme.bg.secondary, borderRadius: 14, padding: 14, marginBottom: 16,
    },
    consMain: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: theme.text.primary, marginBottom: 4 },
    consSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, lineHeight: 17, color: theme.text.secondary },
    error: {
      fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.destructive, marginBottom: 12,
    },
    primary: { ...btn.primaryBtn, marginBottom: 10 },
    primaryText: btn.primaryText,
    secondary: btn.secondaryBtn,
    secondaryText: btn.secondaryTextAccent,
  });
}
