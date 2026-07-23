import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import PressableScale from '../ui/PressableScale';
import { useAppSettings } from '../../hooks/useAppSettings';
import {
  logMeasuredShot, deleteShot, getShots, subscribeShots, getShotsVersion,
} from '../../store/shotStore';
import { haversineMeters } from '../../lib/geo';
import { recommendClub, clubAverages } from '../../lib/shotStats';
import { swingClubs, clubLabel, clubNominal } from '../../lib/clubs';
import { formatDistance, unitSuffix } from '../../lib/units';
import { haptic } from '../../lib/haptics';
import { ClubIcon } from './ClubIcon';
import { ClubWheel } from './ClubWheel';

const MIN_SAVE_M = 20;   // under this, tap ② is a no-op (mis-tap guard)
const MAX_PLAIN_M = 350; // over this, require a second confirming tap
const MAX_ACCURACY_M = 25; // same usable-fix bar as the scorecard header

// Floating shot-measurer on the scorecard (bottom-right). Idle: a small club
// FAB with the suggested-club badge. Tap ① stamps the start at the live fix
// and expands into a live card; tap ② (the whole card) stamps the end and
// saves via logMeasuredShot. With no usable fix, tap ① opens the hole map —
// the manual flow. The header distance block never shows this carry.
export function MeasureFab({ roundId, roundIndex, holeNumber, fix, targetMeters, onOpenMap }) {
  const appSettings = useAppSettings();
  const { units } = appSettings;
  const bag = useMemo(() => swingClubs(appSettings.bag), [appSettings.bag]);
  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);
  const overrides = appSettings.clubDistances;
  const suggestion = useMemo(
    () => recommendClub(targetMeters, appSettings.bag, getShots(), overrides),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetMeters, appSettings.bag, overrides, shotsVersion],
  );

  const [armed, setArmed] = useState(null);   // { start:[lat,lng], club }
  const [saved, setSaved] = useState(null);   // { label, meters, originId, shotId }
  const [confirmOver, setConfirmOver] = useState(false);
  const [wheelOpen, setWheelOpen] = useState(false);

  if (!roundId) return null;

  const pos = fix?.position ?? null;
  const usable = !!pos && (fix.accuracy == null || fix.accuracy <= MAX_ACCURACY_M);
  const dist = armed && pos ? haversineMeters(armed.start, pos) : 0;
  const fmt = (m) => `${formatDistance(m, units)}${unitSuffix(units)}`;

  const arm = () => {
    setSaved(null);
    if (!usable) { onOpenMap?.(); return; }
    haptic('selection');
    setArmed({ start: pos, club: suggestion?.club ?? null, holeNumber });
    setConfirmOver(false);
  };

  const finish = async () => {
    if (!armed || !pos) return;
    if (dist < MIN_SAVE_M) return;
    if (dist > MAX_PLAIN_M && !confirmOver) { setConfirmOver(true); return; }
    const { start, club, holeNumber: armedHoleNumber } = armed;
    setArmed(null);
    setConfirmOver(false);
    const r = await logMeasuredShot({
      roundId, roundIndex, holeNumber: armedHoleNumber, start, end: pos, club,
    });
    haptic('success');
    setSaved({ label: club ? clubLabel(club) : 'Shot', meters: dist, ...r });
  };

  const undo = () => {
    if (!saved) return;
    deleteShot(saved.shotId);
    if (saved.originId) deleteShot(saved.originId);
    haptic('selection');
    setSaved(null);
  };

  const averages = clubAverages(getShots());
  const effDist = (k) => {
    const o = overrides?.[k];
    return (Number.isFinite(o) && o > 0) ? o : (averages.get(k) ?? clubNominal(k));
  };
  const wheelClubs = bag.map((k) => ({ key: k, label: clubLabel(k), distance: effDist(k) }));

  return (
    <View style={s.wrap} pointerEvents="box-none">
      {saved && (
        <View style={s.toast}>
          <Feather name="check" size={14} color="#006747" />
          <Text style={s.toastText}>{`${saved.label} · ${fmt(saved.meters)} saved`}</Text>
          <Pressable onPress={undo} hitSlop={8} accessibilityLabel="Undo measured shot">
            <Text style={s.toastUndo}>Undo</Text>
          </Pressable>
        </View>
      )}

      {armed ? (
        <Pressable
          onPress={finish}
          style={[s.card, dist < MIN_SAVE_M && s.cardDim]}
          accessibilityLabel="Ball is here — save the measured shot"
        >
          <View style={s.cardTop}>
            <Pressable onPress={() => setWheelOpen(true)} hitSlop={6}>
              <Text style={s.cardClub}>
                {armed.club ? clubLabel(armed.club).toUpperCase() : 'CLUB?'}
                <Text style={s.cardChg}>  ⌄</Text>
              </Text>
            </Pressable>
            <Pressable
              onPress={() => { setArmed(null); setConfirmOver(false); }}
              hitSlop={8} style={s.cardX} accessibilityLabel="Cancel measuring"
            >
              <Feather name="x" size={14} color="rgba(255,255,255,0.6)" />
            </Pressable>
          </View>
          <Text style={s.cardNum}>
            {formatDistance(dist, units)}
            <Text style={s.cardUnit}>{` ${unitSuffix(units)}`}</Text>
          </Text>
          <Text style={s.cardSub}>
            {confirmOver ? `Over ${formatDistance(MAX_PLAIN_M, units)}${unitSuffix(units)} — tap again to save`
              : dist < MIN_SAVE_M ? 'Start marked — hit, then walk'
              : "Tap when you're at the ball"}
          </Text>
          {fix?.accuracy != null && <Text style={s.cardAcc}>{`GPS ±${Math.round(fix.accuracy)} m`}</Text>}
        </Pressable>
      ) : (
        <View style={s.fabCol}>
          {suggestion && <Text style={s.badge}>{`≈ ${clubLabel(suggestion.club)}`}</Text>}
          <PressableScale onPress={arm} style={s.fab} accessibilityLabel="Measure my shot">
            <ClubIcon size={25} color="#ffffff" />
          </PressableScale>
        </View>
      )}

      <ClubWheel
        visible={wheelOpen}
        clubs={wheelClubs}
        value={armed?.club ?? null}
        units={units}
        seqLabel="Club"
        carryMeters={null}
        toPinMeters={targetMeters ?? null}
        onSelect={(club) => { if (club) setArmed((a) => (a ? { ...a, club } : a)); setWheelOpen(false); }}
        onClose={() => setWheelOpen(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', right: 14, bottom: 18, alignItems: 'flex-end', gap: 8, zIndex: 40 },
  fabCol: { alignItems: 'center', gap: 6 },
  badge: {
    backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e7e2d5', color: '#006747',
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 11, borderRadius: 999,
    paddingHorizontal: 9, paddingVertical: 3, overflow: 'hidden',
    fontVariant: ['tabular-nums'],
  },
  fab: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: '#006747',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#006747', shadowOpacity: 0.4, shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  card: {
    width: 212, backgroundColor: '#00553c', borderRadius: 18, padding: 14,
    shadowColor: '#00553c', shadowOpacity: 0.45, shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  cardDim: { opacity: 0.92 },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  cardClub: { color: '#fff', fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, letterSpacing: 0.4 },
  cardChg: { color: 'rgba(255,255,255,0.6)', fontSize: 11 },
  cardX: { marginLeft: 'auto' },
  cardNum: {
    color: '#fff', fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 34,
    letterSpacing: -1, marginTop: 4, fontVariant: ['tabular-nums'],
  },
  cardUnit: { fontSize: 14, color: 'rgba(255,255,255,0.65)', letterSpacing: 0 },
  cardSub: {
    color: 'rgba(255,255,255,0.7)', fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 10, letterSpacing: 0.4, marginTop: 3, textTransform: 'uppercase',
  },
  cardAcc: {
    color: 'rgba(255,255,255,0.55)', fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 9.5, marginTop: 5, fontVariant: ['tabular-nums'],
  },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: 7, width: 212,
    backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e7e2d5',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 }, elevation: 5,
  },
  toastText: { color: '#006747', fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, fontVariant: ['tabular-nums'] },
  toastUndo: { marginLeft: 'auto', color: '#6b7280', fontFamily: 'PlusJakartaSans-Bold', fontSize: 11, textDecorationLine: 'underline' },
});
