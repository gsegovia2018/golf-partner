import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { hud } from '../../theme/tokens';
import { useT, formatNumber, formatTime } from '../../i18n';
import { useAppSettings } from '../../hooks/useAppSettings';
import { formatDistance, unitSuffix } from '../../lib/units';
import { clubLabel } from '../../lib/clubs';
import { getShots } from '../../store/shotStore';
import { ClubWheel, wheelClubsFor } from './ClubWheel';

// Review UI for automatically detected shots (hooks/useShotProposals): a
// quiet badge on the hole header's map button, and on the hole map hollow
// "seen" pins (drawn by the map page) with a card for the tapped one, plus a
// pill when the hole's score says shots are missing.

// The map button's badge: "3 seen", "1 unmarked", or both. Nothing otherwise.
export function SeenBadge({ seen, missing }) {
  const { theme } = useTheme();
  const tl = useT();
  const parts = [
    seen > 0 ? tl('shots.seen.badge', { count: formatNumber(seen) }) : null,
    missing > 0 ? tl('shots.seen.missingBadge', { count: missing }) : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  const a11y = [
    seen > 0 ? tl('shots.seen.badgeA11y', { count: seen }) : null,
    missing > 0 ? tl('shots.seen.missing', { count: missing }) : null,
  ].filter(Boolean).join('. ');
  return (
    <View
      pointerEvents="none"
      accessible
      accessibilityLabel={a11y}
      testID="seen-badge"
      style={[s.badge, { backgroundColor: theme.accent.primary, borderColor: theme.bg.primary }]}
    >
      <Text style={[s.badgeTxt, { color: theme.text.inverse }]}>{parts.join(' · ')}</Text>
    </View>
  );
}

// On the map: "1 shot not on the map", bottom-left, out of the shot buttons' way.
export function MissingPill({ missing }) {
  const tl = useT();
  if (!(missing > 0)) return null;
  return (
    <View style={s.pill} testID="missing-pill" accessibilityRole="text">
      <Feather name="alert-circle" size={14} color={hud.text} />
      <Text style={s.pillTxt}>{tl('shots.seen.missing', { count: missing })}</Text>
    </View>
  );
}

// What the phone heard and felt at a seen pin (useShotProposals' `sound`):
// "Strike heard" + "Your swing" / "No swing from you", or "No strike heard".
// Nothing without sound data.
export function SoundEvidence({ level }) {
  const tl = useT();
  if (!level) return null;
  const chips = level === 'quiet'
    ? [{ key: 'noStrike', on: false, icon: 'activity' }]
    : [
      { key: 'strike', on: true, icon: 'activity' },
      level === 'shot' ? { key: 'swing', on: true, icon: 'rotate-cw' } : { key: 'noSwing', on: false, icon: 'rotate-cw' },
    ];
  return (
    <View style={s.ev} testID={`seen-sound-${level}`}>
      {chips.map((c) => (
        <View key={c.key} style={[s.evChip, c.on ? s.evOn : s.evOff]}>
          <Feather name={c.icon} size={13} color={c.on ? hud.textSoft : hud.textMuted} />
          <Text style={[s.evTxt, { color: c.on ? hud.textSoft : hud.textMuted }]}>{tl(`shots.seen.sound.${c.key}`)}</Text>
        </View>
      ))}
    </View>
  );
}

// The card for one tapped "seen" pin: where it is, a club button that opens
// the shot tracker's club wheel, what the phone heard there, then Not a shot /
// Add · club, and "+1 from here" while the score says shots are missing.
export function SeenMapCard({ proposal, onAdd, onDismiss, onPlusOne, missing }) {
  const tl = useT();
  const settings = useAppSettings();
  const { units } = settings;
  const [club, setClub] = useState(proposal?.club ?? null);
  const [wheel, setWheel] = useState(false);
  useEffect(() => { setClub(proposal?.club ?? null); setWheel(false); }, [proposal?.id, proposal?.club]);
  if (!proposal) return null;

  const dist = (m) => `${formatDistance(m, units)} ${unitSuffix(units)}`;
  const where = proposal.fromTee
    ? tl('shots.seen.tee')
    : proposal.toGreen != null ? tl('shots.seen.toGreen', { distance: dist(proposal.toGreen) }) : tl('shots.seen.here');
  const seconds = formatNumber(Math.max(1, Math.round((proposal.end - proposal.start) / 1000)));
  const withClub = { ...proposal, club };

  return (
    <View style={s.card} testID="seen-map-card">
      <Text style={s.ask}>{tl('shots.seen.mapAsk').toUpperCase()}</Text>
      <View style={s.whereRow}>
        <Text style={s.where} numberOfLines={1}>{where}</Text>
        <Pressable
          style={s.clubBtn}
          onPress={() => setWheel(true)}
          accessibilityRole="button"
          accessibilityLabel={tl('shots.seen.clubA11y', { club: club ? clubLabel(club) : tl('shots.wheel.club') })}
          testID="seen-club"
        >
          <Text style={s.clubTxt}>{club ? clubLabel(club) : tl('shots.wheel.club')}</Text>
          <Feather name="chevron-down" size={16} color={hud.text} />
        </Pressable>
      </View>
      <Text style={s.when}>{tl('shots.seen.mapWhen', { seconds, time: formatTime(proposal.start) })}</Text>
      <SoundEvidence level={proposal.sound} />
      <View style={s.btns}>
        <Pressable style={s.btn2} onPress={onDismiss} accessibilityRole="button">
          <Text style={s.btn2Txt}>{tl('shots.seen.notAShot')}</Text>
        </Pressable>
        <Pressable style={s.btn1} onPress={() => onAdd(withClub)} accessibilityRole="button">
          <Text style={s.btn1Txt} numberOfLines={1}>{tl('shots.seen.add')}</Text>
        </Pressable>
      </View>
      {missing > 0 ? (
        <Pressable
          style={s.plusOne}
          onPress={() => onPlusOne(withClub)}
          accessibilityRole="button"
          accessibilityLabel={tl('shots.seen.plusOneA11y')}
        >
          <Feather name="rotate-ccw" size={14} color={hud.textSoft} />
          <Text style={s.plusOneTxt}>{tl('shots.seen.plusOne')}</Text>
        </Pressable>
      ) : null}
      <ClubWheel
        visible={wheel}
        clubs={wheelClubsFor(settings.bag, settings.clubDistances, getShots())}
        value={club}
        units={units}
        seqLabel={tl('shots.wheel.club')}
        toPinMeters={proposal.toGreen}
        onSelect={(k) => { if (k) setClub(k); setWheel(false); }}
        onClose={() => setWheel(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  badge: {
    position: 'absolute', top: -9, right: -8, borderRadius: 999, borderWidth: 2,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  badgeTxt: { fontSize: 11, fontFamily: 'PlusJakartaSans-ExtraBold' },
  pill: {
    position: 'absolute', left: 12, bottom: 24, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: hud.card, borderWidth: 1, borderColor: hud.line, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  pillTxt: { color: hud.text, fontSize: 13, fontFamily: 'PlusJakartaSans-Bold' },
  card: {
    position: 'absolute', left: 12, right: 12, bottom: 84,
    backgroundColor: hud.card, borderWidth: 1, borderColor: hud.line, borderRadius: 16, padding: 14,
  },
  ask: { color: hud.textMuted, fontSize: 10, letterSpacing: 1.5, fontFamily: 'PlusJakartaSans-Bold' },
  whereRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  where: { flex: 1, color: hud.text, fontSize: 17, fontFamily: 'PlusJakartaSans-Bold' },
  clubBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: 12,
    borderRadius: 12, borderWidth: 1, borderColor: hud.border, backgroundColor: hud.inset,
  },
  clubTxt: { color: hud.text, fontSize: 14, fontFamily: 'PlusJakartaSans-Bold' },
  when: { color: hud.textSoft, fontSize: 13, fontFamily: 'PlusJakartaSans-Medium', marginTop: 2 },
  ev: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  evChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, borderWidth: 1,
    paddingHorizontal: 9, paddingVertical: 4,
  },
  // hud.accent at 16% / 55%: the evidence that backs the pin.
  evOn: { backgroundColor: 'rgba(79,174,138,0.16)', borderColor: 'rgba(79,174,138,0.55)' },
  evOff: { backgroundColor: hud.inset, borderColor: hud.border, borderStyle: 'dashed' },
  evTxt: { fontSize: 12, fontFamily: 'PlusJakartaSans-Bold' },
  btns: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn2: {
    flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: hud.border,
    backgroundColor: hud.fill, alignItems: 'center', justifyContent: 'center',
  },
  btn2Txt: { color: hud.text, fontSize: 14, fontFamily: 'PlusJakartaSans-Bold' },
  btn1: {
    flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: hud.accent,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8,
  },
  btn1Txt: { color: hud.onAccent, fontSize: 14, fontFamily: 'PlusJakartaSans-ExtraBold' },
  plusOne: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: 44, marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: hud.border,
  },
  plusOneTxt: { color: hud.textSoft, fontSize: 13, fontFamily: 'PlusJakartaSans-Bold' },
});
