// "Settle up" card on the game screen: who pays whom from the game's stakes
// (store/sideBets.js stakeLedger). Live games read "If it ended now"; tapping a
// transfer shows the payer's per-bet amounts; Share sends the lines as text.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Share } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { semantic } from '../theme/tokens';
import { useT } from '../i18n';
import { stakeLedger, formatEuros } from '../store/sideBets';
import { shortName } from './gamestats/ui';
import { circleText } from '../theme/circleText';

const initials = (p) => (p?.name ?? '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export default function SettleUpCard({ tournament, live, onAddStakes, cardStyle }) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  const [open, setOpen] = useState(null);

  const ledger = stakeLedger(tournament);
  if (!ledger && !onAddStakes) return null;

  const players = tournament.players ?? [];
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  // Game Stats' rule: first name, or the full name when two players share it.
  const nameOf = (p) => (p ? shortName(p, players) : '—');
  const header = (
    <View style={s.head}>
      <Text style={s.title}>{t('settle.title')}</Text>
      {ledger && (
        <Text style={[s.pill, live && s.pillLive]}>{t(live ? 'settle.live' : 'settle.final')}</Text>
      )}
    </View>
  );

  if (!ledger) {
    return (
      <View style={cardStyle} testID="settle-up-card">
        {header}
        <Text style={s.empty}>{t('settle.empty')}</Text>
        <TouchableOpacity onPress={onAddStakes} accessibilityRole="button" style={s.addBtn}>
          <Text style={s.link}>{t('settle.add')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const share = () => {
    const lines = ledger.transfers.map((x) => t('settle.shareLine', {
      from: nameOf(byId[x.from]), to: nameOf(byId[x.to]), amount: formatEuros(x.amount),
    }));
    Share.share({ message: [tournament.name, ...lines].join('\n') }).catch(() => {});
  };

  return (
    <View style={cardStyle} testID="settle-up-card">
      {header}
      {ledger.transfers.length === 0 && <Text style={s.empty}>{t('settle.allSquare')}</Text>}
      {ledger.transfers.map((x, i) => {
        const from = byId[x.from];
        const to = byId[x.to];
        const key = `${x.from}-${x.to}`;
        const row = ledger.byPlayer[x.from];
        const parts = ['pot', 'perPoint', 'skin'].filter((k) => row[k] !== 0)
          .map((k) => t(`settle.breakdown.${k}`, { amount: formatEuros(row[k], { sign: true }) }));
        return (
          <TouchableOpacity
            key={key}
            style={[s.tr, i > 0 && s.trDivider]}
            onPress={() => setOpen(open === key ? null : key)}
            accessibilityRole="button"
            accessibilityState={{ expanded: open === key }}
            accessibilityLabel={t('settle.payA11y', { from: from?.name, to: to?.name, amount: formatEuros(x.amount) })}
          >
            <View style={s.av}><Text style={s.avText}>{initials(from)}</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.who} numberOfLines={open === key ? undefined : 1}>
                {t('settle.pays', { from: nameOf(from), to: nameOf(to) })}
              </Text>
              {open === key && <Text style={s.help}>{parts.join(' · ')}</Text>}
            </View>
            <Text style={s.money}>{formatEuros(x.amount)}</Text>
            <Feather name={open === key ? 'chevron-up' : 'chevron-down'} size={16} color={theme.text.muted} />
          </TouchableOpacity>
        );
      })}
      <View style={s.chips}>
        {players.map((p) => {
          const net = ledger.byPlayer[p.id].net;
          return (
            <View key={p.id} style={s.chip}>
              <Text style={s.chipName} numberOfLines={1}>{nameOf(p)}</Text>
              <Text style={[s.chipNet, net > 0 && s.plus, net < 0 && s.minus]}>{formatEuros(net, { sign: true })}</Text>
            </View>
          );
        })}
      </View>
      {live && ledger.skinCarry > 0 && (
        <Text style={s.help}>{t('settle.carry', { count: ledger.skinCarry })}</Text>
      )}
      {ledger.transfers.length > 0 && (
        <TouchableOpacity onPress={share} accessibilityRole="button" style={s.shareBtn}>
          <Feather name="share-2" size={16} color={theme.accent.primary} />
          <Text style={s.link}>{t('settle.share')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function makeStyles(theme) {
  const good = theme.isDark ? semantic.score.excellent.dark : semantic.score.excellent.light;
  const poor = theme.isDark ? semantic.score.poor.dark : semantic.score.poor.light;
  return StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
    title: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10, color: theme.accent.primary,
      letterSpacing: 1.5, textTransform: 'uppercase',
    },
    pill: {
      fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase',
      paddingHorizontal: 8, paddingVertical: 2, borderRadius: 9999, overflow: 'hidden',
      backgroundColor: theme.bg.secondary, color: theme.text.secondary,
    },
    pillLive: { backgroundColor: theme.accent.light, color: theme.accent.primary },
    tr: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, minHeight: 48 },
    trDivider: { borderTopWidth: 1, borderTopColor: theme.border.subtle },
    av: {
      width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.accent.light,
    },
    avText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 11, color: theme.accent.primary, ...circleText },
    who: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: theme.text.primary },
    help: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: theme.text.secondary, marginTop: 4 },
    money: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 14, color: theme.text.primary, fontVariant: ['tabular-nums'] },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6,
      borderRadius: 9999, backgroundColor: theme.bg.secondary, maxWidth: '100%',
    },
    chipName: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.primary, flexShrink: 1 },
    chipNet: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12, color: theme.text.secondary, fontVariant: ['tabular-nums'] },
    plus: { color: good },
    minus: { color: poor },
    empty: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: theme.text.secondary, paddingVertical: 6 },
    addBtn: { minHeight: 44, justifyContent: 'center' },
    shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44, marginTop: 6 },
    link: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.accent.primary },
  });
}
