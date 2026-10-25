// "League cards · <league>" (D5 B): every player of the round with their
// league status. Only my row has a control (my own switch); every other
// member decides on their own phone. Rows come from
// store/leagueGameCards.leagueCardRows. Used by Setup's review step and by
// Start Round N.
import React from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import Switch from '../ui/Switch';
import { useTheme } from '../../theme/ThemeContext';
import { useT, formatDate } from '../../i18n';
import InitialsAvatar from './InitialsAvatar';

const MUTED = new Set(['hasCard', 'unrated', 'notMember']);

export function monthWord(monthKey) {
  return formatDate(`${monthKey}-01`, 'monthName');
}

// "Already has an October card" / "a November card".
function hasCardText(t, monthKey) {
  const month = monthWord(monthKey);
  return t(/^[AEIOU]/i.test(month) ? 'league.cards.hasCardVowel' : 'league.cards.hasCard', { month });
}

export default function LeagueCardsList({
  title, state = 'ready', rows = [], monthKey, short = false,
  me = null, others = null, onRetry, footer = null, children = null,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const t = useT();

  const rowView = (row) => {
    let sub = null;
    let right = null;
    let name = row.name;
    if (row.kind === 'me') {
      name = t('league.cards.you');
      right = me ? (
        <Switch
          value={!!me.value}
          onValueChange={me.onChange}
          disabled={!!me.disabled}
          accessibilityLabel={me.label}
          trackColor={{ true: theme.accent.primary }}
        />
      ) : null;
    } else if (row.kind === 'counts') {
      sub = t('league.cards.countsSub');
      right = <Text style={[s.pill, s.badgeOn]}>{t('league.cards.counts')}</Text>;
    } else if (row.kind === 'asked' && others) {
      // The game's creator can count it for them (Setup).
      const on = others.isOn(row);
      sub = t(on ? 'league.cards.otherOnSub' : 'league.cards.otherOffSub');
      right = (
        <Switch
          value={on}
          onValueChange={(v) => others.onChange(row, v)}
          accessibilityLabel={others.label(row)}
          trackColor={{ true: theme.accent.primary }}
        />
      );
    } else if (row.kind === 'asked') {
      sub = t(short ? 'league.cards.askedShort' : 'league.cards.asked');
      right = <Text style={s.pill}>{t(short ? 'league.cards.askedPillShort' : 'league.cards.askedPill')}</Text>;
    } else if (row.kind === 'hasCard') {
      sub = hasCardText(t, monthKey);
      right = <Text style={[s.pill, s.badgeGrey]}>{t('league.cards.hasOne')}</Text>;
    } else if (row.kind === 'unrated') {
      sub = row.tee ? t('league.cards.unrated', { tee: row.tee }) : t('league.cards.unratedNoTee');
      right = <Text style={[s.pill, s.badgeGrey]}>{t('league.cards.cant')}</Text>;
    } else {
      sub = t('league.cards.notMember');
    }
    const isMe = row.kind === 'me';
    return (
      <View key={row.playerId} style={[s.row, s.rowDivider]}>
        <InitialsAvatar name={row.name} size={28} muted={MUTED.has(row.kind)} />
        <View
          style={{ flex: 1, minWidth: 0 }}
          accessible={!isMe}
          accessibilityLabel={!isMe ? `${name}, ${sub}` : undefined}
        >
          <Text style={s.name} numberOfLines={1}>{name}</Text>
          {isMe ? (
            <>
              {!!me?.sub && <Text style={[s.sub, me.subDanger && s.subDanger]}>{me.sub}</Text>}
              {me?.extra ?? null}
            </>
          ) : <Text style={s.sub}>{sub}</Text>}
        </View>
        {right ? <View style={s.right}>{right}</View> : null}
      </View>
    );
  };

  return (
    <View style={s.card}>
      <Text style={s.title} accessibilityRole="header">{title}</Text>
      {state === 'loading' ? (
        <View style={[s.row, s.rowDivider]}>
          <ActivityIndicator color={theme.accent.primary} size="small" style={{ marginRight: 10 }} />
          <Text style={s.name}>{t('league.cards.checking')}</Text>
        </View>
      ) : null}
      {state === 'error' ? (
        <View style={[s.row, s.rowDivider]}>
          <InitialsAvatar name={t('league.cards.you')} size={28} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.name}>{t('league.cards.you')}</Text>
            <Text style={s.sub}>
              <Text style={s.subDanger}>{t('league.cards.offline')}</Text>
              {` ${t('league.cards.offlineHint')}`}
            </Text>
            {onRetry ? (
              <TouchableOpacity onPress={onRetry} accessibilityRole="button" style={{ paddingVertical: 6 }}>
                <Text style={s.link}>{t('league.cards.tryAgain')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <View style={s.right}>
            <Switch value={false} disabled accessibilityLabel={me?.label} trackColor={{ true: theme.accent.primary }} />
          </View>
        </View>
      ) : null}
      {state === 'ready' ? rows.map(rowView) : null}
      {children}
      {footer ? <Text style={s.footer}>{footer}</Text> : null}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.bg.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border ?? theme.border.default : theme.border.default,
      paddingHorizontal: 14,
      marginTop: 16,
    },
    title: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10, letterSpacing: 1.5,
      textTransform: 'uppercase', color: theme.text.secondary, marginTop: 12, marginBottom: 2,
    },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
    right: { marginLeft: 10 },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border.default },
    name: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: theme.text.primary },
    sub: {
      fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, lineHeight: 17,
      color: theme.text.secondary, marginTop: 2,
    },
    subDanger: { color: theme.destructive, fontFamily: 'PlusJakartaSans-Bold' },
    link: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, color: theme.accent.primary },
    pill: {
      fontFamily: 'PlusJakartaSans-Bold', fontSize: 11, overflow: 'hidden',
      color: theme.accent.primary, backgroundColor: theme.accent.light,
      borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
    },
    badgeOn: { paddingHorizontal: 10, paddingVertical: 4 },
    badgeGrey: { color: theme.text.secondary, backgroundColor: theme.bg.secondary },
    footer: {
      fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, lineHeight: 17,
      color: theme.text.secondary, paddingBottom: 12,
    },
  });
}
