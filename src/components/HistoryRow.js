import React, { useMemo } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import PressableScale from './ui/PressableScale';
import { useTheme } from '../theme/ThemeContext';
import { semantic } from '../theme/tokens';

// One History timeline row (game or tournament) rendered from a
// historyEntryModel. Tournaments with a resolved champion grow a footer
// strip naming the winner and the viewer's placement.
export default function HistoryRow({ model, onPress, onLongPress }) {
  const { theme } = useTheme();
  const gold = theme.isDark ? semantic.winner.dark : semantic.winner.light;
  const goldBg = theme.isDark ? 'rgba(255,215,0,0.12)' : '#f7f0dd';
  const s = useMemo(() => makeStyles(theme, gold, goldBg), [theme, gold, goldBg]);

  const { result, champion, myPlacement } = model;

  return (
    <PressableScale
      style={s.card}
      activeScale={0.98}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={model.title}
      accessibilityHint={model.isOwner ? 'Opens the event. Long press to delete.' : 'Opens the event.'}
    >
      <View style={s.main}>
        <View style={[s.dateBox, model.kind === 'tournament' && s.dateBoxTournament]}>
          <Text style={[s.dateTop, model.kind === 'tournament' && s.dateTopTournament]}>
            {model.dateBox.top}
          </Text>
          <Text style={s.dateBottom}>{model.dateBox.bottom}</Text>
        </View>

        <View style={s.mid}>
          <Text style={s.title} numberOfLines={1}>{model.title}</Text>
          <View style={s.subline}>
            {model.subtitle ? (
              <Text style={s.subtitle} numberOfLines={1}>{model.subtitle}</Text>
            ) : null}
            <View style={s.avatars}>
              {model.avatars.map((a, i) => (
                <View
                  key={`${a.initials}-${i}`}
                  style={[
                    s.avatar,
                    i > 0 && s.avatarOverlap,
                    a.isMe && (a.avatarUrl ? s.avatarMeRing : s.avatarMe),
                  ]}
                >
                  {a.avatarUrl ? (
                    <Image
                      source={{ uri: a.avatarUrl }}
                      style={s.avatarImg}
                      testID="history-avatar-image"
                    />
                  ) : (
                    <Text style={[s.avatarText, a.isMe && s.avatarTextMe]}>{a.initials}</Text>
                  )}
                </View>
              ))}
              {model.extraPlayers > 0 && (
                <View style={[s.avatar, s.avatarOverlap]}>
                  <Text style={s.avatarText}>{`+${model.extraPlayers}`}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        <View style={s.result}>
          {result.kind === 'won' && (
            <>
              <View style={s.wonBadge}>
                <Feather name="award" size={10} color={gold} />
                <Text style={s.wonBadgeText}>WON</Text>
              </View>
              <Text style={s.resultCaption}>{`${result.points} ${result.unit ?? 'pts'}`}</Text>
            </>
          )}
          {result.kind === 'placement' && (
            <>
              <Text style={s.resultBig}>{result.label}</Text>
              <Text style={s.resultCaption}>{`${result.points} ${result.unit ?? 'pts'}`}</Text>
            </>
          )}
          {result.kind === 'points' && (
            <>
              <Text style={s.resultBig}>{String(result.points)}</Text>
              <Text style={s.resultCaption}>pts</Text>
            </>
          )}
          {result.kind === 'team' && (
            <>
              <Text style={s.resultBig}>—</Text>
              <Text style={s.resultCaption}>team</Text>
            </>
          )}
          {result.kind === 'none' && (
            <>
              <Text style={s.resultBig}>—</Text>
              <Text style={s.resultCaption}>pts</Text>
            </>
          )}
        </View>

        <Feather name="chevron-right" size={18} color={theme.text.muted} />
      </View>

      {champion && (
        <View style={s.foot}>
          <View style={s.champ}>
            <Feather name="award" size={12} color={gold} />
            <Text style={s.champText} numberOfLines={1}>
              {'Champion · '}
              <Text style={s.champName}>{champion.isMe ? 'You' : champion.name}</Text>
              {` · ${champion.points} ${champion.unit}`}
            </Text>
          </View>
          {myPlacement && (
            <View style={[
              s.placePill,
              myPlacement.won ? s.placePillWon : (myPlacement.podium ? s.placePillPodium : null),
            ]}
            >
              <Text style={[
                s.placePillText,
                myPlacement.won ? s.placePillTextWon : (myPlacement.podium ? s.placePillTextPodium : null),
              ]}
              >
                {`${myPlacement.label} of ${myPlacement.fieldSize}`}
              </Text>
            </View>
          )}
        </View>
      )}
    </PressableScale>
  );
}

function makeStyles(theme, gold, goldBg) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.bg.card,
      borderRadius: 18,
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? theme.glass?.border ?? theme.border.default : 'transparent',
      overflow: 'hidden',
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    main: {
      padding: 13, flexDirection: 'row', alignItems: 'center', gap: 13,
    },
    dateBox: {
      width: 46, height: 50, borderRadius: 12,
      backgroundColor: theme.bg.secondary,
      alignItems: 'center', justifyContent: 'center',
    },
    dateBoxTournament: { backgroundColor: theme.accent.light },
    dateTop: {
      fontFamily: 'PlayfairDisplay-Bold', fontSize: 18, lineHeight: 20,
      color: theme.text.primary,
    },
    dateTopTournament: { color: theme.accent.primary },
    dateBottom: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 8.5, letterSpacing: 1,
      color: theme.text.muted, marginTop: 3,
    },
    mid: { flex: 1, minWidth: 0 },
    title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 15.5, color: theme.text.primary },
    subline: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
    subtitle: {
      fontFamily: 'PlusJakartaSans-Medium', fontSize: 11.5,
      color: theme.text.secondary, flexShrink: 1,
    },
    avatars: { flexDirection: 'row' },
    avatar: {
      width: 20, height: 20, borderRadius: 10,
      borderWidth: 1.5, borderColor: theme.bg.card,
      backgroundColor: theme.bg.secondary,
      alignItems: 'center', justifyContent: 'center',
    },
    avatarOverlap: { marginLeft: -5 },
    avatarMe: { backgroundColor: theme.accent.primary },
    avatarMeRing: { borderColor: theme.accent.primary },
    avatarImg: { width: '100%', height: '100%', borderRadius: 10 },
    avatarText: {
      fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 7.5, color: theme.text.secondary,
    },
    avatarTextMe: { color: theme.text.inverse },
    result: { alignItems: 'center', minWidth: 46, gap: 2 },
    resultBig: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 16, color: theme.accent.primary },
    resultCaption: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 8.5, letterSpacing: 0.6,
      color: theme.text.muted, textTransform: 'uppercase',
    },
    wonBadge: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: goldBg, borderRadius: 999,
      paddingHorizontal: 8, paddingVertical: 3,
    },
    wonBadgeText: {
      fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 10, color: gold,
    },
    foot: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      borderTopWidth: 1, borderTopColor: theme.border.subtle,
      backgroundColor: theme.isDark ? theme.bg.secondary : '#faf8f4',
      paddingVertical: 8, paddingHorizontal: 14,
    },
    champ: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
    champText: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11.5, color: theme.text.secondary,
    },
    champName: { color: gold, fontFamily: 'PlusJakartaSans-ExtraBold' },
    placePill: {
      backgroundColor: theme.bg.secondary, borderRadius: 999,
      paddingHorizontal: 10, paddingVertical: 3,
    },
    placePillWon: { backgroundColor: goldBg },
    placePillPodium: { backgroundColor: theme.accent.light },
    placePillText: {
      fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 10.5, color: theme.text.secondary,
    },
    placePillTextWon: { color: gold },
    placePillTextPodium: { color: theme.accent.primary },
  });
}
