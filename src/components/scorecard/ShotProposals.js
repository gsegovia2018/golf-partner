import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { hud } from '../../theme/tokens';
import { useT, formatNumber, formatTime } from '../../i18n';
import { useAppSettings } from '../../hooks/useAppSettings';
import { formatDistance, unitSuffix } from '../../lib/units';
import { clubLabel } from '../../lib/clubs';

// Review UIs for automatically detected shots (hooks/useShotProposals).
// shortcut: three competing designs live here until Marcos picks one
// (A: SeenBadge + SeenMapCard on the hole map, B: SeenCard on the hole page,
// C: SeenStrip under the hole header); the losers are deleted after the pick.

const seconds = (p) => formatNumber(Math.max(1, Math.round((p.end - p.start) / 1000)));

function useLabels() {
  const tl = useT();
  const { units } = useAppSettings();
  const dist = (m) => `${formatDistance(m, units)} ${unitSuffix(units)}`;
  return {
    tl,
    dist,
    // "Tee shot", "148 m to the green", or "Shot 2" without geometry.
    where: (p, i) => {
      if (p.fromTee) return tl('shots.seen.tee');
      if (p.toGreen != null) return tl('shots.seen.toGreen', { distance: dist(p.toGreen) });
      return tl('shots.seen.shotN', { n: formatNumber(i + 1) });
    },
    // Short chip label: "Tee", "148 m", "Shot 2".
    short: (p, i) => {
      if (p.fromTee) return tl('shots.seen.stripTee');
      if (p.toGreen != null) return dist(p.toGreen);
      return tl('shots.seen.shotN', { n: formatNumber(i + 1) });
    },
  };
}

// ---- A: badge on the map button, card on the map ---------------------------

export function SeenBadge({ count }) {
  const { theme } = useTheme();
  const tl = useT();
  if (!count) return null;
  return (
    <View
      pointerEvents="none"
      accessible
      accessibilityLabel={tl('shots.seen.badgeA11y', { count })}
      style={[a.badge, { backgroundColor: theme.accent.primary, borderColor: theme.bg.primary }]}
    >
      <Text style={[a.badgeTxt, { color: theme.text.inverse }]}>{tl('shots.seen.badge', { count: formatNumber(count) })}</Text>
    </View>
  );
}

// The HUD card over the map for one tapped "seen" pin.
export function SeenMapCard({ proposal, index, onAdd, onDismiss }) {
  const { tl, where } = useLabels();
  if (!proposal) return null;
  return (
    <View style={a.card} accessibilityRole="summary" testID="seen-map-card">
      <Text style={a.ask}>{tl('shots.seen.mapAsk').toUpperCase()}</Text>
      <Text style={a.where}>{where(proposal, index)}</Text>
      <Text style={a.when}>{tl('shots.seen.mapWhen', { seconds: seconds(proposal), time: formatTime(proposal.start) })}</Text>
      <View style={a.btns}>
        <Pressable style={a.btn2} onPress={onDismiss} accessibilityRole="button">
          <Text style={a.btn2Txt}>{tl('shots.seen.notAShot')}</Text>
        </Pressable>
        <Pressable style={a.btn1} onPress={onAdd} accessibilityRole="button">
          <Text style={a.btn1Txt} numberOfLines={1}>
            {proposal.club ? tl('shots.seen.addClub', { club: clubLabel(proposal.club) }) : tl('shots.seen.add')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const a = StyleSheet.create({
  badge: {
    position: 'absolute', top: -9, right: -8, borderRadius: 999, borderWidth: 2,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  badgeTxt: { fontSize: 11, fontFamily: 'PlusJakartaSans-ExtraBold' },
  card: {
    position: 'absolute', left: 12, right: 12, bottom: 100,
    backgroundColor: hud.card, borderWidth: 1, borderColor: hud.line, borderRadius: 16, padding: 14,
  },
  ask: { color: hud.textMuted, fontSize: 10, letterSpacing: 1.5, fontFamily: 'PlusJakartaSans-Bold' },
  where: { color: hud.text, fontSize: 17, fontFamily: 'PlusJakartaSans-Bold', marginTop: 4 },
  when: { color: hud.textSoft, fontSize: 13, fontFamily: 'PlusJakartaSans-Medium', marginTop: 2 },
  btns: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn2: {
    flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: hud.border,
    backgroundColor: hud.fill, alignItems: 'center', justifyContent: 'center',
  },
  btn2Txt: { color: hud.text, fontSize: 14, fontFamily: 'PlusJakartaSans-Bold' },
  btn1: {
    flex: 1.3, minHeight: 46, borderRadius: 14, backgroundColor: hud.accent,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8,
  },
  btn1Txt: { color: hud.onAccent, fontSize: 14, fontFamily: 'PlusJakartaSans-ExtraBold' },
});

// ---- B: review card on the hole page ---------------------------------------

// A tiny sketch of the walk: the proposals (and the green) fitted to the box.
function RouteSketch({ proposals, theme }) {
  const W = 40;
  const H = 64;
  const pts = proposals.map((p) => [p.lat, p.lng]);
  if (!pts.length) return null;
  const lats = pts.map((p) => p[0]);
  const lngs = pts.map((p) => p[1]);
  const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs), 1e-5);
  const xy = ([la, ln]) => [
    W / 2 + ((ln - (Math.max(...lngs) + Math.min(...lngs)) / 2) / span) * (W - 12),
    H - 18 - ((la - Math.min(...lats)) / span) * (H - 30),
  ];
  const pp = pts.map(xy);
  return (
    <Svg width={W} height={H} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Ellipse cx={pp[pp.length - 1][0]} cy={8} rx={10} ry={6} fill={theme.accent.light} stroke={theme.accent.primary} strokeWidth={1.5} />
      <Path
        d={`M${pp.map((p) => p.join(' ')).join(' L')} L${pp[pp.length - 1][0]} 10`}
        stroke={theme.text.secondary} strokeWidth={1.5} strokeDasharray="3 3" fill="none"
      />
      {pp.map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={3.5} fill={theme.accent.primary} />)}
    </Svg>
  );
}

export function SeenCard({ seen, holeNumber }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeCardStyles(theme), [theme]);
  const { tl, where } = useLabels();
  const [later, setLater] = useState(false); // "Not now" for this visit
  const [justAdded, setJustAdded] = useState(null); // ids added by "Add all"
  const { proposals, open } = seen;

  if (justAdded?.length) {
    return (
      <View style={s.done} accessibilityRole="summary">
        <Feather name="check" size={18} color={theme.accent.primary} />
        <Text style={s.doneTxt}>{tl('shots.seen.done', { count: justAdded.length, hole: formatNumber(holeNumber) })}</Text>
        <Pressable
          style={s.undo}
          accessibilityRole="button"
          onPress={async () => { for (const id of justAdded) await seen.undo(id); setJustAdded(null); }}
        >
          <Text style={s.undoTxt}>{tl('shots.seen.undo')}</Text>
        </Pressable>
      </View>
    );
  }
  if (later || !open.length) return null;
  const anyAdded = proposals.some((p) => p.status === 'added');

  return (
    <View style={s.card} testID="seen-card">
      <View style={s.head}>
        <RouteSketch proposals={proposals} theme={theme} />
        <View style={s.headTxt}>
          <Text style={s.label}>{tl('shots.seen.label')}</Text>
          <Text style={s.title}>{tl('shots.seen.title', { count: proposals.length })}</Text>
          <Text style={s.body}>{tl('shots.seen.body')}</Text>
        </View>
      </View>
      {proposals.map((p, i) => {
        const n = formatNumber(i + 1);
        const added = p.status === 'added';
        return (
          <View key={p.id} style={s.row}>
            <View style={[s.pin, added && s.pinOn]}><Text style={[s.pinTxt, added && s.pinTxtOn]}>{n}</Text></View>
            <View style={s.rowTxt}>
              <Text style={s.rowTitle} numberOfLines={2}>
                {p.club ? `${where(p, i)} · ${clubLabel(p.club)}` : where(p, i)}
              </Text>
              <Text style={s.rowSub}>
                {added ? tl('shots.seen.added') : tl('shots.seen.when', { time: formatTime(p.start), seconds: seconds(p) })}
              </Text>
            </View>
            {added ? (
              <Pressable style={s.undo} onPress={() => seen.undo(p.id)} accessibilityRole="button">
                <Text style={s.undoTxt}>{tl('shots.seen.undo')}</Text>
              </Pressable>
            ) : (
              <>
                <Pressable style={s.no} onPress={() => seen.dismiss(p.id)} accessibilityRole="button" accessibilityLabel={tl('shots.seen.notA11y', { n })}>
                  <Feather name="x" size={18} color={theme.text.secondary} />
                </Pressable>
                <Pressable style={s.yes} onPress={() => seen.confirm([p])} accessibilityRole="button" accessibilityLabel={tl('shots.seen.addA11y', { n })}>
                  <Feather name="check" size={20} color={theme.accent.primary} />
                </Pressable>
              </>
            )}
          </View>
        );
      })}
      <View style={s.foot}>
        <Pressable style={s.b2} onPress={() => setLater(true)} accessibilityRole="button">
          <Text style={s.b2Txt}>{tl('shots.seen.notNow')}</Text>
        </Pressable>
        <Pressable
          style={s.b1}
          accessibilityRole="button"
          onPress={async () => { const ids = open.map((p) => p.id); await seen.confirm(open); setJustAdded(ids); }}
        >
          <Text style={s.b1Txt}>
            {anyAdded ? tl('shots.seen.addRest', { count: open.length }) : tl('shots.seen.addAll', { count: open.length })}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeCardStyles(theme) {
  const border = theme.isDark ? theme.glass?.border ?? theme.border.default : theme.border.default;
  return StyleSheet.create({
    card: {
      marginHorizontal: 14, marginTop: 4, padding: 12, borderRadius: 14,
      backgroundColor: theme.bg.card, borderWidth: 1, borderColor: border,
    },
    head: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 6 },
    headTxt: { flex: 1, minWidth: 0 },
    label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: theme.text.secondary },
    title: { marginTop: 2, fontSize: 15, lineHeight: 20, fontWeight: '700', color: theme.text.primary },
    body: { marginTop: 2, fontSize: 13, lineHeight: 18, color: theme.text.secondary },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6,
      borderTopWidth: 1, borderTopColor: theme.border.subtle ?? theme.border.default,
    },
    pin: {
      width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderStyle: 'dashed',
      borderColor: theme.accent.primary, alignItems: 'center', justifyContent: 'center',
    },
    pinOn: { borderStyle: 'solid', backgroundColor: theme.accent.primary },
    pinTxt: { fontSize: 12, fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.accent.primary },
    pinTxtOn: { color: theme.text.inverse },
    rowTxt: { flex: 1, minWidth: 0 },
    rowTitle: { fontSize: 14, lineHeight: 19, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary },
    rowSub: { fontSize: 12, color: theme.text.secondary, fontFamily: 'PlusJakartaSans-Medium' },
    no: {
      width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: border,
      alignItems: 'center', justifyContent: 'center',
    },
    yes: {
      width: 44, height: 44, borderRadius: 12, backgroundColor: theme.accent.light,
      alignItems: 'center', justifyContent: 'center',
    },
    undo: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
    undoTxt: { color: theme.accent.primary, fontSize: 13, fontFamily: 'PlusJakartaSans-Bold' },
    foot: { flexDirection: 'row', gap: 10, marginTop: 10 },
    b2: {
      flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: border,
      backgroundColor: theme.bg.card, alignItems: 'center', justifyContent: 'center',
    },
    b2Txt: { color: theme.text.secondary, fontSize: 14, fontFamily: 'PlusJakartaSans-Bold' },
    b1: {
      flex: 1.4, minHeight: 46, borderRadius: 14, backgroundColor: theme.accent.primary,
      alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8,
    },
    b1Txt: { color: theme.text.inverse, fontSize: 14, fontFamily: 'PlusJakartaSans-ExtraBold' },
    done: {
      marginHorizontal: 14, marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: theme.accent.light, borderRadius: 14, paddingLeft: 14, paddingRight: 6,
    },
    doneTxt: { flex: 1, fontSize: 13, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary },
  });
}

// ---- C: strip under the hole header ----------------------------------------

// Detected shots shown as already in the chain. Scoring the hole keeps the
// open ones (`scored` flips true); × takes one out, with Undo.
export function SeenStrip({ seen, scored }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStripStyles(theme), [theme]);
  const { tl, short } = useLabels();
  const [removed, setRemoved] = useState(null); // { id, label } of the last ×
  const { proposals, open, confirm } = seen;

  useEffect(() => {
    if (scored && open.length) confirm(open);
  }, [scored, open, confirm]);

  if (!proposals.length && !removed) return null;
  return (
    <View style={s.wrap} testID="seen-strip">
      <View style={s.row}>
        {proposals.map((p, i) => {
          const label = short(p, i);
          const added = p.status === 'added';
          return (
            <React.Fragment key={p.id}>
              <View style={[s.chip, added && s.chipOn]}>
                <Text style={s.chipTxt}>{label}</Text>
                {!!p.club && <Text style={s.club}>{clubLabel(p.club)}</Text>}
                {!added && (
                  <Pressable
                    style={s.rm}
                    accessibilityRole="button"
                    accessibilityLabel={tl('shots.seen.removeA11y', { label })}
                    onPress={() => { seen.dismiss(p.id); setRemoved({ id: p.id, label }); }}
                  >
                    <Feather name="x" size={16} color={theme.text.secondary} />
                  </Pressable>
                )}
              </View>
              <Text style={s.arrow} accessibilityElementsHidden>›</Text>
            </React.Fragment>
          );
        })}
        {seen.hasGreen && <View style={s.green}><Text style={s.greenTxt}>{tl('shots.seen.green')}</Text></View>}
      </View>
      {removed ? (
        <View style={s.noteRow}>
          <Text style={s.note}><Text style={s.noteB}>{tl('shots.seen.removed', { label: removed.label })}</Text></Text>
          <Pressable
            style={s.undo}
            accessibilityRole="button"
            onPress={() => { seen.undo(removed.id); setRemoved(null); }}
          >
            <Text style={s.undoTxt}>{tl('shots.seen.undo')}</Text>
          </Pressable>
        </View>
      ) : open.length > 0 ? (
        <Text style={s.note}><Text style={s.noteB}>{tl('shots.seen.stripNote')}</Text> {tl('shots.seen.stripHint')}</Text>
      ) : null}
    </View>
  );
}

function makeStripStyles(theme) {
  return StyleSheet.create({
    wrap: { paddingHorizontal: 14, paddingTop: 2, paddingBottom: 4 },
    row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
    chip: {
      flexDirection: 'row', alignItems: 'center', minHeight: 44, borderRadius: 999,
      borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.accent.primary,
      backgroundColor: theme.bg.card, paddingLeft: 12,
    },
    chipOn: { borderStyle: 'solid', backgroundColor: theme.accent.light, paddingRight: 12 },
    chipTxt: { fontSize: 13, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary },
    club: { fontSize: 11, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, marginLeft: 5 },
    rm: { width: 40, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
    arrow: { color: theme.text.secondary, fontSize: 14, fontWeight: '700' },
    green: {
      minHeight: 44, borderRadius: 999, paddingHorizontal: 12, justifyContent: 'center',
      backgroundColor: theme.bg.secondary,
    },
    greenTxt: { fontSize: 13, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary },
    note: { fontSize: 12, color: theme.text.secondary, marginTop: 6, fontFamily: 'PlusJakartaSans-Medium' },
    noteB: { color: theme.text.primary, fontFamily: 'PlusJakartaSans-Bold' },
    noteRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    undo: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
    undoTxt: { color: theme.accent.primary, fontSize: 13, fontFamily: 'PlusJakartaSans-Bold' },
  });
}
