import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../../components/ScreenContainer';
import { useTheme } from '../../theme/ThemeContext';
import { semantic } from '../../theme/tokens';
import { pairsMatchDuels } from '../../store/scoring';

const firstName = (p) => (p?.name ?? '').split(' ')[0];
const initials = (name) => (name ?? '?').trim().slice(0, 2).toUpperCase();

// Avatar with an optional team-colored ring; fills with the accent when armed.
function Avatar({ name, size, ring, armed, s, theme }) {
  const dim = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View
      style={[
        s.avatar, dim,
        ring ? { borderWidth: 2, borderColor: ring } : null,
        armed ? { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary } : null,
      ]}
    >
      <Text style={[s.avatarText, { fontSize: size * 0.34 }, armed && s.avatarTextArmed]}>
        {initials(name)}
      </Text>
    </View>
  );
}

// One tappable roster row: avatar + name + handicap, with a trailing affordance.
function PlayerTile({ name, hcp, ring, armed, dimmed, trailing, onPress, s, theme }) {
  return (
    <TouchableOpacity
      style={[s.tile, armed && s.tileArmed, dimmed && s.tileDimmed]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <Avatar name={name} size={40} ring={ring} armed={armed} s={s} theme={theme} />
      <View style={s.tileText}>
        <Text style={[s.tileName, armed && s.tileNameArmed]} numberOfLines={1}>{name}</Text>
        {hcp != null && <Text style={s.tileHcp}>HCP {hcp}</Text>}
      </View>
      {trailing}
    </TouchableOpacity>
  );
}

function VsDivider({ s }) {
  return (
    <View style={s.vsRow}>
      <View style={s.vsLine} />
      <Text style={s.vsText}>VS</Text>
      <View style={s.vsLine} />
    </View>
  );
}

export default function EditTeamsView({
  roundNumber,
  courseName,
  scoringMode,
  players,
  pairs,
  soloId,
  selected,
  saving,
  handicaps = {},
  onBack,
  onTapPlayer,
  onTapSolo,
  onShuffle,
  onRandomizeDuels,
  onSwapDuels,
  onSave,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const isThreeVsOne = scoringMode === 'scramble3v1';
  const isPairsMatch = scoringMode === 'pairsmatchplay';
  const duels = isPairsMatch ? pairsMatchDuels(pairs) : null;

  const nameFor = (p) => players?.find((x) => x.id === p.id)?.name ?? p.name;
  const hcpFor = (p) => handicaps?.[p.id];
  const teamHcp = (pair) => {
    const vals = pair.map(hcpFor).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const isArmed = (pi, si) => selected?.pairIdx === pi && selected?.slotIdx === si;
  const armedName = selected ? nameFor(pairs[selected.pairIdx][selected.slotIdx]) : null;

  const helper = isThreeVsOne
    ? 'Tap a player to send them solo'
    : armedName
      ? `Swapping ${firstName({ name: armedName })} — tap who takes their place`
      : 'Tap a player, then tap another to swap them';

  const teamAccent = (pi) => (pi === 0 ? theme.pairA : theme.pairB);

  const renderTeam = (pair, pi) => {
    const accent = teamAccent(pi);
    const total = teamHcp(pair);
    return (
      <View style={s.teamBlock}>
        <View style={s.teamHead}>
          <View style={[s.teamDot, { backgroundColor: accent }]} />
          <Text style={[s.teamLabel, { color: accent }]}>PAIR {pi + 1}</Text>
          {total != null && <Text style={s.teamTotal}>{total} hcp</Text>}
        </View>
        {pair.map((player, si) => {
          const armed = isArmed(pi, si);
          const otherArmed = !!selected && !armed;
          return (
            <PlayerTile
              key={`${pi}-${si}-${player.id}`}
              name={nameFor(player)}
              hcp={hcpFor(player)}
              ring={accent}
              armed={armed}
              dimmed={false}
              onPress={() => onTapPlayer(pi, si)}
              s={s}
              theme={theme}
              trailing={
                armed
                  ? <Feather name="move" size={18} color={theme.accent.primary} />
                  : otherArmed
                    ? <View style={s.swapHere}><Feather name="repeat" size={13} color={theme.accent.primary} /></View>
                    : <Feather name="repeat" size={16} color={theme.text.muted} style={{ opacity: 0.45 }} />
              }
            />
          );
        })}
      </View>
    );
  };

  const renderThreeVsOne = () => {
    const solo = (players ?? []).find((p) => p.id === soloId) ?? players?.[0];
    const pack = (players ?? []).filter((p) => p.id !== solo?.id);
    return (
      <View style={s.matchup}>
        <View style={s.teamBlock}>
          <View style={s.teamHead}>
            <View style={[s.teamDot, { backgroundColor: theme.pairB }]} />
            <Text style={[s.teamLabel, { color: theme.pairB }]}>PLAYS SOLO</Text>
          </View>
          {solo && (
            <View style={[s.tile, s.soloTile]}>
              <Avatar name={solo.name} size={46} ring={theme.pairB} s={s} theme={theme} />
              <View style={s.tileText}>
                <Text style={s.soloName} numberOfLines={1}>{solo.name}</Text>
                {hcpFor(solo) != null && <Text style={s.tileHcp}>HCP {hcpFor(solo)}</Text>}
              </View>
              <View style={s.soloPill}><Text style={s.soloPillText}>1 v 3</Text></View>
            </View>
          )}
        </View>

        <VsDivider s={s} />

        <View style={s.teamBlock}>
          <View style={s.teamHead}>
            <View style={[s.teamDot, { backgroundColor: theme.pairA }]} />
            <Text style={[s.teamLabel, { color: theme.pairA }]}>TEAM OF {pack.length}</Text>
          </View>
          {pack.map((player) => (
            <PlayerTile
              key={player.id}
              name={nameFor(player)}
              hcp={hcpFor(player)}
              ring={theme.pairA}
              onPress={() => onTapSolo(player.id)}
              s={s}
              theme={theme}
              trailing={
                <View style={s.sendSolo}>
                  <Text style={s.sendSoloText}>Solo</Text>
                  <Feather name="arrow-up-right" size={13} color={theme.text.muted} />
                </View>
              }
            />
          ))}
        </View>
      </View>
    );
  };

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} style={s.backBtn} activeOpacity={0.7}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Edit Teams</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.hero}>
          <Text style={s.roundLabel}>ROUND {roundNumber}</Text>
          <Text style={s.course}>{courseName}</Text>
        </View>

        <View style={[s.helper, armedName && s.helperArmed]}>
          <Feather
            name={isThreeVsOne ? 'user' : armedName ? 'move' : 'shuffle'}
            size={14}
            color={armedName ? theme.accent.primary : theme.text.muted}
          />
          <Text style={[s.helperText, armedName && s.helperTextArmed]}>{helper}</Text>
          {armedName && (
            <TouchableOpacity onPress={() => onTapPlayer(selected.pairIdx, selected.slotIdx)} hitSlop={8}>
              <Text style={s.helperCancel}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>

        {isThreeVsOne ? renderThreeVsOne() : (
          <View style={s.matchup}>
            {renderTeam(pairs[0], 0)}
            <VsDivider s={s} />
            {renderTeam(pairs[1], 1)}
          </View>
        )}

        <TouchableOpacity style={s.shuffleBtn} onPress={onShuffle} activeOpacity={0.7}>
          <Feather name="shuffle" size={15} color={theme.accent.primary} />
          <Text style={s.shuffleBtnText}>
            {isThreeVsOne ? 'Shuffle — pick a random solo' : 'Shuffle teams'}
          </Text>
        </TouchableOpacity>

        {isPairsMatch && duels && (
          <View style={s.card}>
            <View style={s.cardHead}>
              <Text style={s.cardLabel}>DUELS · 1 v 1</Text>
              <View style={s.duelActions}>
                <TouchableOpacity style={s.swapBtn} onPress={onRandomizeDuels} activeOpacity={0.7}>
                  <Feather name="shuffle" size={14} color={theme.accent.primary} />
                  <Text style={s.swapBtnText}>Randomize</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.swapBtn} onPress={onSwapDuels} activeOpacity={0.7}>
                  <Feather name="repeat" size={14} color={theme.accent.primary} />
                  <Text style={s.swapBtnText}>Swap</Text>
                </TouchableOpacity>
              </View>
            </View>
            {duels.map(([a, b], di) => (
              <View key={di} style={s.duel}>
                <View style={s.duelPlayer}>
                  <Avatar name={nameFor(a)} size={28} ring={theme.pairA} s={s} theme={theme} />
                  <Text style={s.duelName} numberOfLines={1}>{firstName({ name: nameFor(a) })}</Text>
                </View>
                <Text style={s.duelVs}>vs</Text>
                <View style={[s.duelPlayer, s.duelPlayerEnd]}>
                  <Text style={s.duelName} numberOfLines={1}>{firstName({ name: nameFor(b) })}</Text>
                  <Avatar name={nameFor(b)} size={28} ring={theme.pairB} s={s} theme={theme} />
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={s.footer}>
        <TouchableOpacity
          style={[s.saveBtn, saving && { opacity: 0.6 }]}
          onPress={onSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          <Feather name="check" size={18} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
          <Text style={s.saveBtnText}>{saving ? 'Saving…' : 'Save Teams'}</Text>
        </TouchableOpacity>
      </View>
    </ScreenContainer>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    screen: { ...StyleSheet.absoluteFillObject, backgroundColor: t.bg.primary },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    },
    backBtn: {
      width: 36, height: 36, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: t.isDark ? t.bg.secondary : t.bg.card,
      borderWidth: 1, borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    },
    headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: t.text.primary },

    scroll: { flex: 1 },
    content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24, gap: 14 },

    hero: { marginBottom: 2 },
    roundLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.muted,
      fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase',
    },
    course: {
      fontFamily: 'PlayfairDisplay-Bold', color: t.text.primary,
      fontSize: 27, marginTop: 3,
    },

    helper: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: t.bg.secondary,
      borderRadius: 12, borderWidth: 1, borderColor: t.border.default,
      paddingVertical: 10, paddingHorizontal: 12,
    },
    helperArmed: {
      backgroundColor: t.accent.light,
      borderColor: t.accent.primary,
    },
    helperText: { flex: 1, fontFamily: 'PlusJakartaSans-Medium', color: t.text.secondary, fontSize: 13 },
    helperTextArmed: { color: t.accent.primary, fontFamily: 'PlusJakartaSans-SemiBold' },
    helperCancel: { fontFamily: 'PlusJakartaSans-Bold', color: t.accent.primary, fontSize: 13 },

    matchup: {
      backgroundColor: t.bg.card,
      borderRadius: 20, borderWidth: 1,
      borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
      padding: 14,
      ...(t.isDark ? {} : t.shadow.card),
    },
    teamBlock: { gap: 8 },
    teamHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
    teamDot: { width: 9, height: 9, borderRadius: 5 },
    teamLabel: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 11, letterSpacing: 1.6 },
    teamTotal: {
      marginLeft: 'auto', fontFamily: 'PlusJakartaSans-SemiBold',
      color: t.text.muted, fontSize: 12,
    },

    tile: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: t.bg.secondary,
      borderRadius: 14, borderWidth: 1, borderColor: t.border.default,
      paddingVertical: 11, paddingHorizontal: 12,
    },
    tileArmed: { backgroundColor: t.accent.light, borderColor: t.accent.primary },
    tileDimmed: { opacity: 0.5 },
    tileText: { flex: 1 },
    tileName: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.primary, fontSize: 16 },
    tileNameArmed: { color: t.accent.primary },
    tileHcp: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 11, marginTop: 2 },

    soloTile: { borderColor: t.pairB + '66' },
    soloName: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 18 },
    soloPill: {
      backgroundColor: t.pairB + '22', borderRadius: 8,
      paddingHorizontal: 8, paddingVertical: 4,
    },
    soloPillText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: t.pairB, fontSize: 11, letterSpacing: 0.5 },
    sendSolo: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    sendSoloText: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.muted, fontSize: 12 },

    swapHere: {
      width: 26, height: 26, borderRadius: 13,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: t.accent.light,
      borderWidth: 1, borderColor: t.accent.primary,
    },

    avatar: {
      backgroundColor: t.isDark ? t.bg.card : '#006747',
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    },
    avatarText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: semantic.winner.dark },
    avatarTextArmed: { color: t.isDark ? t.accent.primary : t.text.inverse },

    vsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 14 },
    vsLine: { flex: 1, height: 1, backgroundColor: t.border.default },
    vsText: {
      fontFamily: 'PlayfairDisplay-Bold', fontStyle: 'italic',
      color: t.text.muted, fontSize: 15, letterSpacing: 1,
    },

    card: {
      backgroundColor: t.bg.card,
      borderRadius: 18, borderWidth: 1,
      borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
      padding: 14,
      ...(t.isDark ? {} : t.shadow.card),
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    cardLabel: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 10, letterSpacing: 2, color: t.text.muted },

    shuffleBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: t.bg.card,
      borderRadius: 14, borderWidth: 1,
      borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
      paddingVertical: 13,
      ...(t.isDark ? {} : t.shadow.card),
    },
    shuffleBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: t.accent.primary, fontSize: 14 },

    swapBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      backgroundColor: t.bg.secondary,
      borderRadius: 9, borderWidth: 1, borderColor: t.border.default,
      paddingVertical: 6, paddingHorizontal: 10,
    },
    swapBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.accent.primary, fontSize: 12 },
    duelActions: { flexDirection: 'row', gap: 8 },
    duel: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: t.bg.secondary,
      borderRadius: 12, borderWidth: 1, borderColor: t.border.default,
      paddingVertical: 10, paddingHorizontal: 12, marginTop: 8,
    },
    duelPlayer: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
    duelPlayerEnd: { justifyContent: 'flex-end' },
    duelName: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.primary, fontSize: 15 },
    duelVs: {
      fontFamily: 'PlayfairDisplay-Bold', fontStyle: 'italic',
      color: t.text.muted, fontSize: 13, paddingHorizontal: 10,
    },

    footer: {
      paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10,
      borderTopWidth: 1, borderTopColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
      backgroundColor: t.bg.primary,
    },
    saveBtn: {
      backgroundColor: t.isDark ? t.accent.light : t.accent.primary,
      borderRadius: 14, padding: 16,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      borderWidth: t.isDark ? 1 : 0,
      borderColor: t.isDark ? t.accent.primary + '33' : 'transparent',
      ...(t.isDark ? {} : t.shadow.accent),
    },
    saveBtnText: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: t.isDark ? t.accent.primary : t.text.inverse,
      fontSize: 15,
    },
  });
}
