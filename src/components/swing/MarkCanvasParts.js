import React, { memo } from 'react';
import {
  View, Text, Pressable, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, {
  Rect, Circle, Polyline, Text as SvgText, G,
} from 'react-native-svg';
import { hud, semantic } from '../../theme/tokens';
import { withAlpha } from '../../theme/alpha';
import { SWING_STRINGS } from '../../swing/strings';
import { MARKED_KEYS, positionStatus } from '../../swing/markPass';
import Pictogram, { PICTOGRAM_KEYS } from './Pictogram';

// The pieces of the marking canvas (D26, laid out per D28 "Frame Then Marks"). Fixed HUD palette:
// the canvas is a video being annotated, the same case as the capture viewfinder. The cue card and
// the dock sit INSIDE the video, on the strong scrim, in the parts of a down-the-line frame that are
// empty at all six positions (above the head line, left of the body above the ball).

const T = SWING_STRINGS.mark;
const HUD_WARN = semantic.warning.dark; // the HUD amber, as on the capture screen
export const MARK_COLOR = { hands: hud.accent, head: hud.text, ball: semantic.info.dark };
const INK = hud.onAccent;
const CUE_PICT = 44; // the reference pictogram in the cue card (V3)
const CHIP_PICT = 24; // the pictogram in a chapter chip of the top row
const DIM = withAlpha(hud.bg, 0.78); // an inactive chip on the picture
const OUTLINE = withAlpha(hud.text, 0.35);
export const HANDS_FILL = withAlpha(hud.accent, 0.35);
const HEAD_PROPOSED_FILL = withAlpha(hud.text, 0.3);
const SWATCH_ON_FILL = withAlpha(INK, 0.2);

// --- The marks on the picture ------------------------------------------------------------------

const CHIP_H = 16;
export const chipWidth = (text) => text.length * 5.6 + 14;

function Chip({
  x, y, text, fill, ink, stroke,
}) {
  return (
    <G>
      <Rect x={x} y={y} width={chipWidth(text)} height={CHIP_H} rx={8} fill={fill} stroke={stroke} strokeWidth={stroke ? 1 : 0} />
      <SvgText x={x + 7} y={y + 11.5} fontSize={8.5} fontWeight="800" fontFamily="PlusJakartaSans-ExtraBold" fill={ink}>{text}</SvgText>
    </G>
  );
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Where each mark's chip goes, so no two chips and no chip and other mark overlap (D26: the
 * three marks sit close together at address). The active mark is placed first and always gets a
 * chip; another mark whose chip fits nowhere goes without one (its shape and the dock still say
 * what it is). `items`: [{ m, text, at: [x, y] px, on }], `shapes`: [{ m, at }] px.
 * @returns {{ [m]: { x, y } }}
 */
export function placeLabels(items, shapes, w, h) {
  const placed = [];
  const out = {};
  const blocks = (m) => shapes.filter((sh) => sh.m !== m).map((sh) => ({ x: sh.at[0] - 16, y: sh.at[1] - 16, w: 32, h: 32 }));
  [...items].sort((a, b) => Number(b.on) - Number(a.on)).forEach((it) => {
    const cw = chipWidth(it.text);
    const [x, y] = it.at;
    const spots = [[x + 16, y - 32], [x + 16, y + 18], [x - 16 - cw, y - 32], [x - 16 - cw, y + 18], [x - cw / 2, y + 22], [x - cw / 2, y - 40]]
      .map(([cx, cy]) => ({ x: Math.max(2, Math.min(cx, w - cw - 2)), y: Math.max(2, Math.min(cy, h - CHIP_H - 2)), w: cw, h: CHIP_H }));
    const free = spots.find((r) => ![...placed, ...blocks(it.m)].some((o) => overlaps(r, o)));
    const r = free ?? (it.on ? spots[0] : null);
    if (!r) return;
    placed.push(r);
    out[it.m] = { x: r.x, y: r.y };
  });
  return out;
}

/**
 * Hands (green square), clubhead (white disc) and ball (blue ring) on the still, each with its
 * status: dashed while proposed, solid once moved or confirmed (with a tick), a dotted target
 * when missing, a chip when the clubhead is hidden. The active mark is larger, haloed and its
 * label filled. Decorative: the dock and the mark row carry the meaning for screen readers.
 * `marks`: { hands: { pt, status }, head: { pt, status, prior }, ball: { pt, status } | null }.
 * `hidden`: the mark under the finger, left out here (DragLoupe draws it outside React meanwhile).
 */
function MarkLayerImpl({
  rect, marks, active, hidden = null,
}) {
  if (!rect?.w) return null;
  const X = (p) => [p[0] * rect.w, p[1] * rect.h];
  const order = ['ball', 'head', 'hands'].filter((m) => m !== active).concat(active);
  const handsPx = marks.hands?.pt ? X(marks.hands.pt) : null;
  const where = (m) => {
    const mk = marks[m];
    if (!mk) return null;
    if (mk.status === 'hidden') return handsPx; // its chip sits by the hands
    const at = mk.pt ?? (mk.status === 'missing' ? mk.prior : null);
    return at ? X(at) : null;
  };
  const items = [];
  const shapes = [];
  order.forEach((m) => {
    const at = where(m);
    if (!at) return;
    items.push({ m, at, on: m === active, text: `${T.names[m].toUpperCase()} · ${T.status[marks[m].status].toUpperCase()}` });
    if (marks[m].status !== 'hidden') shapes.push({ m, at });
  });
  const spots = placeLabels(items, shapes, rect.w, rect.h);

  const draw = (m) => {
    const mk = marks[m];
    const at = where(m);
    if (!mk || !at || m === hidden) return null; // `hidden`: being dragged, drawn above by DragLoupe
    const on = m === active;
    const C = MARK_COLOR[m];
    const it = items.find((x) => x.m === m);
    const chip = spots[m] ? (
      <Chip x={spots[m].x} y={spots[m].y} text={it.text} fill={on ? C : DIM} ink={on ? INK : C} stroke={on ? null : OUTLINE} />
    ) : null;
    if (mk.status === 'hidden') return <G key={m}>{chip}</G>;
    const [x, y] = at;
    const halo = on ? <Circle cx={x} cy={y} r={24} fill="none" stroke={hud.text} strokeWidth={1.5} strokeDasharray="4 3" /> : null;
    if (mk.status === 'missing') {
      return (
        <G key={m}>
          <Circle cx={x} cy={y} r={10} fill="none" stroke={C} strokeWidth={2} strokeDasharray="2 3" />
          {halo}
          {chip}
        </G>
      );
    }
    const dash = mk.status === 'proposed' ? '5 3' : undefined;
    let shape;
    if (m === 'hands') {
      const hh = on ? 14 : 9;
      shape = <Rect x={x - hh} y={y - hh} width={2 * hh} height={2 * hh} fill={HANDS_FILL} stroke={C} strokeWidth={on ? 3 : 2} strokeDasharray={dash} />;
    } else if (m === 'head') {
      const proposed = mk.status === 'proposed';
      shape = <Circle cx={x} cy={y} r={on ? 10 : 7} fill={proposed ? HEAD_PROPOSED_FILL : hud.text} stroke={proposed ? hud.text : INK} strokeWidth={on ? 2.5 : 1.5} strokeDasharray={dash} />;
    } else {
      shape = <Circle cx={x} cy={y} r={12} fill="none" stroke={C} strokeWidth={on ? 3 : 2} strokeDasharray={dash} />;
    }
    return (
      <G key={m}>
        {shape}
        {halo}
        {mk.status === 'confirmed' ? (
          <G>
            <Circle cx={x + 13} cy={y - 13} r={6} fill={C} stroke={INK} strokeWidth={0.8} />
            <Polyline points={`${x + 10},${y - 13} ${x + 12.3},${y - 10.7} ${x + 16},${y - 15.3}`} fill="none" stroke={INK} strokeWidth={1.6} />
          </G>
        ) : null}
        {chip}
      </G>
    );
  };
  // drawn in order with the active mark last; chips were placed clear of the other marks
  return (
    <Svg width={rect.w} height={rect.h} style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {order.map(draw)}
    </Svg>
  );
}

export const MarkLayer = memo(MarkLayerImpl);

// --- The dock: what you are moving (selector and legend in one), inside the video on the left ---

function MarkDockImpl({
  active, statuses, ballOff, onSelect, style,
}) {
  return (
    <View style={[styles.dock, style]} accessibilityRole="radiogroup" accessibilityLabel={T.dock}>
      {['hands', 'head', 'ball'].map((m) => {
        const off = m === 'ball' && ballOff;
        const on = m === active;
        const word = off ? T.addressOnly : T.status[statuses[m]] ?? '';
        return (
          <Pressable
            key={m}
            style={[styles.dk, on && styles.dkOn, on && { backgroundColor: MARK_COLOR[m], borderColor: MARK_COLOR[m] }, off && styles.dkOff]}
            onPress={() => onSelect(m)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: off }}
            accessibilityLabel={T.dockLabel(T.names[m], word)}
            testID={`dock-${m}`}
          >
            <Swatch mark={m} on={on} size={14} />
            <Text style={[styles.dkName, on && styles.dkInk]}>{T.names[m]}</Text>
            <Text style={[styles.dkWord, on && styles.dkInk]} numberOfLines={1}>{word}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const MarkDock = memo(MarkDockImpl);

export function Swatch({ mark, on = false, size = 16 }) {
  const ink = on ? INK : null;
  if (mark === 'hands') return <View style={{ width: size, height: size, borderRadius: 2, borderWidth: 2.5, borderColor: ink ?? MARK_COLOR.hands, backgroundColor: on ? SWATCH_ON_FILL : HANDS_FILL }} />;
  if (mark === 'head') return <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: ink ?? MARK_COLOR.head, backgroundColor: on ? 'transparent' : MARK_COLOR.head }} />;
  return <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2.5, borderColor: ink ?? MARK_COLOR.ball }} />;
}

// --- The cue, inside the video (step 1): pictogram, FIRST / LAST FRAME, stop phrase, "watch …" ----

/**
 * The compact card at the top-left of the video; a tap (or "More") expands the full cue over the
 * top of the video, and a tap on that closes it. Positions without a stop line (the internal
 * frames) show their `stopWhen` sentence.
 */
function CueCardImpl({
  cue, open, onToggle, mirror = false,
}) {
  if (!cue) return null;
  const stop = cue.stop;
  if (open) {
    return (
      <Pressable style={styles.cueFull} onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: true }} accessibilityLabel={T.less} testID="mark-cue">
        <Text style={styles.cueText}>
          <Text style={styles.cueBold}>{`${cue.name}${cue.p ? ` · ${cue.p}` : ''}`}</Text>
          {` — ${cue.what}`}
        </Text>
        <Text style={styles.cueText}><Text style={styles.cueBold}>{T.cueStop}</Text>{cue.stopWhen}</Text>
        <Text style={styles.cueText}><Text style={styles.cueBold}>{T.cueMark}</Text>{cue.markTips}</Text>
        <Text style={styles.moreText}>{T.less}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      style={styles.cue}
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: false }}
      accessibilityLabel={`${cue.name}. ${stop ? T.stopA11y(stop.kind, stop.short, stop.watch) : cue.stopWhen} ${T.more}`}
      accessibilityLiveRegion="polite"
      testID="mark-stop-line"
    >
      {PICTOGRAM_KEYS.includes(cue.key) ? (
        <View style={styles.pict}>
          <Pictogram swingKey={cue.key} size={CUE_PICT} color={hud.textSoft} accent={hud.accent} mirror={mirror} testID="mark-pictogram" />
        </View>
      ) : null}
      <View style={styles.cueTx}>
        <View style={styles.cueLine}>
          {stop ? (
            <View style={[styles.kind, stop.kind === 'last' && styles.kindLast]}>
              <Text style={styles.kindText}>{T.stopKind[stop.kind]}</Text>
            </View>
          ) : null}
          <Text style={styles.cueMain} numberOfLines={2}>{stop ? stop.short : cue.stopWhen}</Text>
        </View>
        {stop ? <Text style={styles.cueWatch} numberOfLines={1}>{T.watch(stop.watch)}</Text> : null}
      </View>
      <Text style={styles.moreText}>{T.more}</Text>
    </Pressable>
  );
}

export const CueCard = memo(CueCardImpl);

// --- The top row: close, the six positions as pictogram chips with a status dot, the count -------

/**
 * `current` is the open position (none for an automatic frame); `count` and `sub` are the two
 * lines at the right ("3/6", "2 ✓ · 1 skip"). Confirmed is a filled dot, skipped a filled square,
 * to do a ring: shape as well as colour.
 */
function MarkChipsImpl({
  status, current = null, onSelect, onClose, closeLabel, count, sub, mirror = false,
}) {
  return (
    <View style={styles.chrow} testID="mark-chapters">
      <Pressable style={styles.x} onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel} testID="mark-close">
        <Feather name="x" size={20} color={hud.text} />
      </Pressable>
      <View style={styles.chips} accessibilityRole="tablist">
        {MARKED_KEYS.map((k) => {
          const st = positionStatus(status, k);
          const on = k === current;
          return (
            <Pressable
              key={k}
              style={[styles.ch, on && styles.chOn]}
              onPress={() => onSelect(k)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={T.chapterA11y(SWING_STRINGS.checkpoint[k], st)}
              testID={`chapter-${k}`}
            >
              <Pictogram swingKey={k} size={CHIP_PICT} color={on ? hud.text : hud.textMuted} accent={hud.accent} mirror={mirror} />
              <View style={[styles.cd, st === 'confirmed' && styles.cdDone, st === 'skipped' && styles.cdSkip]} />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.cnt} accessible accessibilityLabel={`${count}, ${sub}`} testID="mark-count">
        <Text style={styles.cntMain} numberOfLines={1}>{count}</Text>
        <Text style={styles.cntSub} numberOfLines={1}>{sub}</Text>
      </View>
    </View>
  );
}

export const MarkChips = memo(MarkChipsImpl);

const styles = StyleSheet.create({
  dock: { gap: 6 },
  dk: {
    width: 56, minHeight: 54, borderRadius: 12, backgroundColor: hud.scrimStrong, borderWidth: 1.5, borderColor: hud.line,
    alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 5, paddingHorizontal: 2,
  },
  dkOn: { backgroundColor: hud.text, borderColor: hud.text },
  dkOff: { opacity: 0.4 },
  dkName: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 8.5, letterSpacing: 0.4, textTransform: 'uppercase', color: hud.textSoft },
  dkWord: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 7.5, color: hud.textSoft, opacity: 0.85 },
  dkInk: { color: INK },

  cue: {
    position: 'absolute', left: 8, top: 8, right: 60, maxHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: hud.scrimStrong, borderWidth: 1, borderColor: hud.line, borderRadius: 14, paddingVertical: 7, paddingLeft: 7, paddingRight: 10,
  },
  pict: { width: 48, height: 48, borderRadius: 10, backgroundColor: hud.fill, alignItems: 'center', justifyContent: 'center' },
  cueTx: { flex: 1 },
  cueLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  kind: { backgroundColor: hud.accent, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2, marginTop: 1 },
  kindLast: { backgroundColor: HUD_WARN },
  kindText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 8.5, letterSpacing: 0.8, color: hud.onAccent },
  cueMain: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, lineHeight: 16, color: hud.text },
  cueWatch: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10.5, color: hud.textSoft, marginTop: 2 },
  moreText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 11.5, color: hud.accent },
  cueFull: {
    position: 'absolute', left: 0, right: 0, top: 0, gap: 6, paddingTop: 10, paddingHorizontal: 12, paddingBottom: 14,
    backgroundColor: hud.scrimStrong,
  },
  cueText: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12.5, lineHeight: 18, color: hud.textSoft },
  cueBold: { fontFamily: 'PlusJakartaSans-Bold', color: hud.text },

  chrow: { height: 52, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4 },
  x: { width: 44, height: 44, borderRadius: 22, backgroundColor: hud.fill, alignItems: 'center', justifyContent: 'center' },
  chips: { flex: 1, flexDirection: 'row', gap: 3 },
  ch: {
    flex: 1, height: 44, borderRadius: 10, backgroundColor: hud.fill, borderWidth: 1.5, borderColor: 'transparent',
    alignItems: 'center', justifyContent: 'center', gap: 1,
  },
  chOn: { borderColor: hud.text, backgroundColor: withAlpha(hud.text, 0.14) },
  cd: { width: 6, height: 6, borderRadius: 3, borderWidth: 1.5, borderColor: hud.textMuted },
  cdDone: { backgroundColor: hud.accent, borderColor: hud.accent },
  cdSkip: { backgroundColor: HUD_WARN, borderColor: HUD_WARN, borderRadius: 1 },
  cnt: { width: 44, alignItems: 'center' },
  cntMain: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 10, color: hud.textSoft, fontVariant: ['tabular-nums'] },
  cntSub: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 9, color: hud.textMuted, fontVariant: ['tabular-nums'] },
});
