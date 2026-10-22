import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useT, formatOrdinal } from '../../i18n';
import { payoutPreview, stepParticipation } from '../../store/leagueView';

// The participation floor as a stepper (- value +, step 5, 48 px buttons)
// with a live line saying what the table pays: "1st 500 · 2nd 300 · … ·
// 12th 15 · 13th–18th 10 each · no card 0". Used by the create wizard and
// League settings.
//   value        the floor (whole points)
//   onChange     (next) => void
//   pointsTable  the league's table, or null while it is invalid
//   count        members, to close the last range ("13th–18th"); omit when unknown
export default function PointsForPlaying({ value, onChange, pointsTable, count = null }) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  const preview = payoutPreview(pointsTable, value, count);
  const bold = (text) => <Text style={s.bold}>{text}</Text>;

  let restLabel = '';
  if (preview?.rest) {
    const r = preview.rest;
    restLabel = r.open ? t('league.payout.from', { place: r.open }) : r.single ? r.from : `${r.from}–${r.to}`;
  }

  return (
    <View>
      <Text style={s.label}>{t('league.rules.playing')}</Text>
      <View style={s.stepper}>
        <TouchableOpacity
          style={[s.button, value <= 0 && s.buttonOff]}
          onPress={() => onChange(stepParticipation(value, -1))}
          disabled={value <= 0}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('league.rules.playingFewer')}
          accessibilityState={{ disabled: value <= 0 }}
        >
          <Text style={s.buttonText}>−</Text>
        </TouchableOpacity>
        <Text
          style={s.value}
          accessibilityLiveRegion="polite"
          accessibilityLabel={t('league.rules.playingValue', { points: value })}
        >{value}</Text>
        <TouchableOpacity
          style={s.button}
          onPress={() => onChange(stepParticipation(value, 1))}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('league.rules.playingMore')}
        >
          <Text style={s.buttonText}>+</Text>
        </TouchableOpacity>
      </View>
      {!!preview && (
        <Text style={s.preview} testID="payout-preview">
          {preview.items.map((it, i) => (
            <Text key={i}>
              {i > 0 ? ' · ' : ''}
              {it.gap ? '…' : <>{`${it.label} `}{bold(it.points)}</>}
            </Text>
          ))}
          {!!preview.rest && (
            <Text>
              {` · ${restLabel} `}
              {bold(preview.rest.points)}
              {preview.zero ? '.' : ` ${t('league.payout.each')}`}
            </Text>
          )}
          {!preview.zero && <Text>{` · ${t('league.payout.noCard')} `}{bold('0')}</Text>}
          {preview.zero && <Text>{` ${t('league.payout.zero', { place: formatOrdinal(pointsTable.length) })}`}</Text>}
        </Text>
      )}
    </View>
  );
}

function makeStyles(theme) {
  const line = theme.isDark ? theme.glass?.border : theme.border.default;
  return StyleSheet.create({
    label: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 12, marginBottom: 6, marginTop: 8 },
    stepper: {
      flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
      borderWidth: 1, borderColor: line, borderRadius: 12, overflow: 'hidden',
    },
    button: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg.secondary },
    buttonOff: { opacity: 0.4 },
    buttonText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 20, textAlign: 'center' },
    value: {
      minWidth: 64, textAlign: 'center', fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.primary, fontSize: 18,
    },
    preview: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, lineHeight: 18,
      backgroundColor: theme.bg.secondary, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 8, marginBottom: 4,
    },
    bold: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary },
  });
}
