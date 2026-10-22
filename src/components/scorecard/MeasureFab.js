import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import PressableScale from '../ui/PressableScale';
import { useTheme } from '../../theme/ThemeContext';
import { useT, formatTime } from '../../i18n';
import { light as lightTokens } from '../../theme/tokens';
import { useAppSettings } from '../../hooks/useAppSettings';
import { usePlayConditions } from '../../hooks/usePlayConditions';
import { guessClub, shotBearing } from '../../store/clubGuess';
import {
  logMeasuredShot, deleteShot, setShotClub, getShots, subscribeShots, getShotsVersion,
  shotsForHole, chainEndNear,
} from '../../store/shotStore';
import { getRoundStops, loadShotProposals, markProposalAdded } from '../../store/shotProposalStore';
import { haversineMeters, holeFeatures } from '../../lib/geo';
import { clubAverages } from '../../lib/shotStats';
import { swingClubs, clubLabel, clubNominal } from '../../lib/clubs';
import { formatDistance, unitSuffix } from '../../lib/units';
import { haptic } from '../../lib/haptics';
import { ClubIcon } from './ClubIcon';
import { ClubWheel } from './ClubWheel';
import { isOnGreen } from './ShotTracker';

const SAVED_TOAST_MS = 8000; // how long the "saved · Undo" confirmation stays up
const MIN_SAVE_M = 20;   // under this, tap ② is a no-op (mis-tap guard)
const MAX_PLAIN_M = 350; // over this, require a second confirming tap
const MAX_ACCURACY_M = 25; // same usable-fix bar as the scorecard header
// A trail stop counts as a forgotten tap ② when going through it adds at most
// this much to the straight start → end distance (it lies on the way).
const SPLIT_DETOUR = 1.25;

// Floating shot-measurer on the scorecard (bottom-right). Idle: a small club
// FAB with the suggested-club badge. Tap ① stamps the start at the live fix
// and expands into a live card; tap ② (the whole card) stamps the end and
// saves via logMeasuredShot. With no usable fix, tap ① opens the hole map —
// the manual flow. The header distance block never shows this carry.
//
// Tap ② also starts the next shot from that same spot — the ball you walked
// to is where the next shot is played from — with the club guessed for what's
// left to the green, until a save lands on the green (the rest are putts).
// × cancels the shot being measured and keeps everything already saved; Undo
// takes back the last save and puts the card back on that shot. With the GPS
// trail on, tap ② first checks for a stop on the way (a forgotten tap ②) and
// offers to split the shot there.
export function MeasureFab({ roundId, roundIndex, holeNumber, courseName, fix, targetMeters, offTee = false, onOpenMap }) {
  const tl = useT();
  // Tolerate a missing ThemeProvider (render tests mount this bare) — fall
  // back to the light tokens, matching BottomSheet's theme-defensiveness.
  const theme = useTheme()?.theme ?? lightTokens;
  const s = useMemo(() => makeStyles(theme), [theme]);
  const appSettings = useAppSettings();
  const { units } = appSettings;
  const bag = useMemo(() => swingClubs(appSettings.bag), [appSettings.bag]);
  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);
  const overrides = appSettings.clubDistances;
  // Clubbed to the plays-like distance (wind/air), like every other club tip.
  const from = fix?.position ?? null;
  const bearing = useMemo(
    () => shotBearing(courseName, holeNumber, from),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [courseName, holeNumber, from?.[0], from?.[1]],
  );
  const cond = usePlayConditions(courseName, bearing); // re-guess when the forecast lands
  const suggestion = useMemo(
    () => guessClub({
      meters: targetMeters, bearing, courseName, settings: appSettings, fromTee: !offTee, shots: getShots(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetMeters, appSettings, offTee, shotsVersion, cond, bearing, courseName],
  );

  const [armed, setArmed] = useState(null);   // { start:[lat,lng], club, holeNumber, at, asked? }
  const [saved, setSaved] = useState(null);   // { label, meters, onGreen, parts: logMeasuredShot results, prev: armed }
  const [notice, setNotice] = useState(null); // a toast with no Undo ("Measuring stopped")
  const [confirmOver, setConfirmOver] = useState(false);
  const [split, setSplit] = useState(null);   // the trail stop offered as a forgotten tap ②
  const [wheelOpen, setWheelOpen] = useState(false);
  const trailOn = appSettings.recordGpsTrail === true;
  useEffect(() => { if (trailOn && roundId) loadShotProposals(roundId, roundIndex); }, [trailOn, roundId, roundIndex]);

  // The confirmation is a toast, not a status line: without this it would sit
  // on the scorecard for the rest of the round, since the only other things
  // that clear it are arming the next measure and Undo itself.
  useEffect(() => {
    if (!saved && !notice) return undefined;
    const id = setTimeout(() => { setSaved(null); setNotice(null); }, SAVED_TOAST_MS);
    return () => clearTimeout(id);
  }, [saved, notice]);

  if (!roundId) return null;

  const pos = fix?.position ?? null;
  const usable = !!pos && (fix.accuracy == null || fix.accuracy <= MAX_ACCURACY_M);
  const dist = armed && pos ? haversineMeters(armed.start, pos) : 0;
  const fmt = (m) => `${formatDistance(m, units)}${unitSuffix(units)}`;

  const arm = () => {
    setSaved(null);
    setNotice(null);
    if (!usable) { onOpenMap?.(); return; }
    haptic('selection');
    setArmed({ start: pos, club: suggestion?.club ?? null, holeNumber, at: Date.now() });
    setConfirmOver(false);
  };

  // The club for a shot played from `from` on hole `h`: what covers the
  // distance left to that hole's green (never the driver — it's not a tee).
  const clubFrom = (from, h) => {
    const feat = holeFeatures(courseName, h);
    if (!feat?.greenCenter) return null;
    return guessClub({
      meters: haversineMeters(from, feat.greenCenter), bearing: shotBearing(courseName, h, from),
      courseName, settings: appSettings, fromTee: false, shots: getShots(),
    })?.club ?? null;
  };

  // The open stop the trail saw on the way from `start` to `end` since the
  // shot was armed: you stood at a ball and walked on without tap ②.
  const stopOnTheWay = (start, end, since) => {
    const direct = haversineMeters(start, end);
    return getRoundStops(roundId, roundIndex).find((st) => {
      if (st.status !== 'open' || st.start < since) return false;
      const at = [st.lat, st.lng];
      const a = haversineMeters(start, at);
      const b = haversineMeters(at, end);
      return a >= MIN_SAVE_M && b >= MIN_SAVE_M && a + b <= direct * SPLIT_DETOUR;
    }) ?? null;
  };

  // Writes the measured segment(s) and, unless the last one ended on the
  // green, starts the next shot from where it ended.
  const save = async (segments, stopId = null) => {
    const before = armed;
    const h = armed.holeNumber;
    setArmed(null);
    setConfirmOver(false);
    setSplit(null);
    const parts = [];
    for (const sg of segments) {
      parts.push(await logMeasuredShot({
        roundId, roundIndex, holeNumber: h, start: sg.start, end: sg.end, club: sg.club,
      }));
    }
    if (stopId) markProposalAdded(roundId, roundIndex, stopId, parts[1]?.originId ?? null);
    haptic('success');
    const last = segments[segments.length - 1];
    const feat = holeFeatures(courseName, h);
    const ended = !!feat && isOnGreen(last.end, feat.green, feat.greenCenter);
    setSaved({
      label: last.club ? clubLabel(last.club) : tl('shots.measure.shot'),
      meters: haversineMeters(last.start, last.end),
      onGreen: ended,
      parts,
      prev: before,
    });
    if (!ended) setArmed({ start: last.end, club: clubFrom(last.end, h), holeNumber: h, at: Date.now() });
  };

  const finish = async () => {
    if (!armed || !pos) return;
    if (dist < MIN_SAVE_M) return;
    if (trailOn && !armed.asked) {
      const st = stopOnTheWay(armed.start, pos, armed.at);
      if (st) { setSplit(st); setArmed({ ...armed, asked: true }); return; }
    }
    // Confirm tap for anything that would pollute the carry averages: an
    // implausibly long measure, or a fix that has degraded past the same
    // accuracy bar that gated arming (tap ① checked it; tap ② must too).
    const poorAcc = fix?.accuracy != null && fix.accuracy > MAX_ACCURACY_M;
    if ((dist > MAX_PLAIN_M || poorAcc) && !confirmOver) { setConfirmOver(true); return; }
    await save([{ start: armed.start, end: pos, club: armed.club }]);
  };

  // The forgotten tap ②: two shots, the second from the trail's stop.
  const splitAtStop = () => {
    if (!armed || !split || !pos) return;
    const at = [split.lat, split.lng];
    save([
      { start: armed.start, end: at, club: armed.club },
      { start: at, end: pos, club: clubFrom(at, armed.holeNumber) },
    ], split.id);
  };
  const noSplit = () => {
    if (!armed || !pos) return;
    save([{ start: armed.start, end: pos, club: armed.club }]);
  };

  // × : this shot isn't measured; everything saved before it stays.
  const stop = () => {
    setArmed(null);
    setConfirmOver(false);
    setSplit(null);
    setSaved(null);
    setNotice(tl('shots.measure.stopped'));
  };

  const undo = () => {
    if (!saved) return;
    for (const r of [...saved.parts].reverse()) {
      deleteShot(r.shotId);
      // Only drop the origin when the measure created it — a reused spot was
      // already on the hole before this measure: it stays, with its old club.
      if (r.originCreated) deleteShot(r.originId);
      else setShotClub(r.originId, r.prevClub ?? null);
    }
    haptic('selection');
    setArmed(saved.prev);
    setSplit(null);
    setConfirmOver(false);
    setSaved(null);
  };

  // "Shot N" on the card: the chain's next number on the armed hole.
  const shotN = (() => {
    if (!armed) return null;
    const hole = shotsForHole(roundId, roundIndex, armed.holeNumber);
    return chainEndNear(hole, armed.start) ? hole.length : hole.length + 1;
  })();

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
          <Feather name="check" size={14} color={theme.accent.primary} />
          <Text style={s.toastText}>{tl(saved.onGreen ? 'shots.measure.savedGreen' : 'shots.measure.saved', { label: saved.label, meters: fmt(saved.meters) })}</Text>
          <Pressable onPress={undo} hitSlop={8} accessibilityLabel={tl('shots.measure.undoA11y')}>
            <Text style={s.toastUndo}>{tl('shots.measure.undo')}</Text>
          </Pressable>
        </View>
      )}
      {!saved && notice && (
        <View style={s.toast} accessibilityLiveRegion="polite">
          <Text style={s.toastText}>{notice}</Text>
        </View>
      )}

      {armed ? (
        <Pressable
          onPress={finish}
          style={[s.card, dist < MIN_SAVE_M && s.cardDim]}
          accessibilityLabel={tl('shots.measure.saveA11y')}
        >
          <View style={s.cardTop}>
            <Pressable onPress={() => setWheelOpen(true)} hitSlop={6} style={s.cardClubWrap}>
              <Text style={s.cardClub} numberOfLines={1}>
                {armed.holeNumber !== holeNumber ? `${tl('map.hole', { hole: armed.holeNumber }).toUpperCase()} · ` : ''}
                {`${tl('shots.tracker.shotN', { n: shotN }).toUpperCase()} · `}
                {armed.club ? clubLabel(armed.club).toUpperCase() : tl('shots.measure.clubUnknown')}
                <Text style={s.cardChg}>  ⌄</Text>
              </Text>
            </Pressable>
            <Pressable
              onPress={stop}
              hitSlop={8} style={s.cardX} accessibilityLabel={tl('shots.measure.cancelA11y')}
            >
              <Feather name="x" size={14} color="rgba(255,255,255,0.6)" />
            </Pressable>
          </View>
          <Text style={s.cardNum}>
            {formatDistance(dist, units)}
            <Text style={s.cardUnit}>{` ${unitSuffix(units)}`}</Text>
          </Text>
          <Text style={s.cardSub}>
            {confirmOver ? (dist > MAX_PLAIN_M
              ? tl('shots.measure.over', { distance: `${formatDistance(MAX_PLAIN_M, units)}${unitSuffix(units)}` })
              : tl('shots.measure.gpsLoose', { meters: Math.round(fix?.accuracy ?? 0) }))
              : dist < MIN_SAVE_M ? tl('shots.measure.startMarked')
              : tl('shots.measure.atBall')}
          </Text>
          {fix?.accuracy != null && <Text style={s.cardAcc}>{tl('shots.measure.gps', { meters: Math.round(fix.accuracy) })}</Text>}
          {split && (
            <View style={s.split} accessibilityLiveRegion="polite">
              <Text style={s.splitText}>
                {tl('shots.measure.splitAsk', {
                  seconds: Math.max(1, Math.round((split.end - split.start) / 1000)),
                  time: formatTime(split.start),
                  distance: fmt(haversineMeters(armed.start, [split.lat, split.lng])),
                })}
              </Text>
              <View style={s.splitRow}>
                <Pressable onPress={splitAtStop} style={[s.splitBtn, s.splitBtnPrimary]} accessibilityRole="button">
                  <Text style={[s.splitBtnText, s.splitBtnTextPrimary]}>{tl('shots.measure.splitYes')}</Text>
                </Pressable>
                <Pressable onPress={noSplit} style={s.splitBtn} accessibilityRole="button">
                  <Text style={s.splitBtnText}>{tl('shots.measure.splitNo')}</Text>
                </Pressable>
              </View>
            </View>
          )}
        </Pressable>
      ) : (
        <View style={s.fabCol}>
          <PressableScale onPress={arm} style={s.fab} accessibilityLabel={tl('shots.measure.fabA11y')}>
            <ClubIcon size={25} color={theme.text.inverse} />
          </PressableScale>
        </View>
      )}

      <ClubWheel
        visible={wheelOpen}
        clubs={wheelClubs}
        value={armed?.club ?? null}
        units={units}
        seqLabel={tl('shots.wheel.club')}
        carryMeters={null}
        toPinMeters={targetMeters ?? null}
        onSelect={(club) => { if (club) setArmed((a) => (a ? { ...a, club } : a)); setWheelOpen(false); }}
        onClose={() => setWheelOpen(false)}
      />
    </View>
  );
}

// Theme-aware: the FAB floats over the themed scorecard (unlike the map
// overlays, which use the fixed `hud` chrome). The measuring card sits on
// bg.deep — the same value in both themes — so its white-alpha text stays
// static.
function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { position: 'absolute', right: 14, bottom: 18, alignItems: 'flex-end', gap: 8, zIndex: 40 },
    fabCol: { alignItems: 'center', gap: 6 },
    fab: {
      width: 52, height: 52, borderRadius: 26, backgroundColor: theme.accent.primary,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: theme.accent.primary, shadowOpacity: 0.4, shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 }, elevation: 6,
    },
    card: {
      width: 212, backgroundColor: theme.bg.deep, borderRadius: 18, padding: 14,
      shadowColor: theme.bg.deep, shadowOpacity: 0.45, shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 }, elevation: 8,
    },
    cardDim: { opacity: 0.92 },
    cardTop: { flexDirection: 'row', alignItems: 'center' },
    cardClubWrap: { flex: 1, minWidth: 0 },
    cardClub: { color: '#fff', fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, letterSpacing: 0.4 },
    cardChg: { color: 'rgba(255,255,255,0.6)', fontSize: 11 },
    cardX: { marginLeft: 'auto' },
    cardNum: {
      color: '#fff', fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 34,
      letterSpacing: -1, marginTop: 4, fontVariant: ['tabular-nums'],
    },
    cardUnit: { fontSize: 14, color: 'rgba(255,255,255,0.65)', letterSpacing: 0 },
    cardSub: {
      color: 'rgba(255,255,255,0.8)', fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 10, letterSpacing: 0.4, marginTop: 3, textTransform: 'uppercase',
    },
    cardAcc: {
      color: 'rgba(255,255,255,0.75)', fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 9.5, marginTop: 5, fontVariant: ['tabular-nums'],
    },
    split: {
      marginTop: 8, paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.3)',
    },
    splitText: { color: '#fff', fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11.5, lineHeight: 15 },
    splitRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
    splitBtn: {
      flex: 1, minHeight: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.14)',
    },
    splitBtnPrimary: { backgroundColor: '#fff' },
    splitBtnText: { color: '#fff', fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, textAlign: 'center' },
    splitBtnTextPrimary: { color: theme.bg.deep },
    toast: {
      flexDirection: 'row', alignItems: 'center', gap: 7, width: 212,
      backgroundColor: theme.isDark ? theme.bg.primary : theme.bg.elevated, borderWidth: 1, borderColor: theme.border.default,
      borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9,
      shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10,
      shadowOffset: { width: 0, height: 5 }, elevation: 5,
    },
    toastText: { color: theme.accent.primary, fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, fontVariant: ['tabular-nums'] },
    toastUndo: { marginLeft: 'auto', color: theme.text.secondary, fontFamily: 'PlusJakartaSans-Bold', fontSize: 11, textDecorationLine: 'underline' },
  });
}
