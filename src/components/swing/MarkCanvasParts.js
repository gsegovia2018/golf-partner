import React, { memo } from 'react';
import {
  View, Text, Pressable, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, {
  Rect, Circle, Line, Polyline, Text as SvgText, G,
} from 'react-native-svg';
import { hud, semantic } from '../../theme/tokens';
import { withAlpha } from '../../theme/alpha';
import { SWING_STRINGS } from '../../swing/strings';
import { MARKED_KEYS, positionStatus } from '../../swing/markPass';
import Pictogram, { PICTOGRAM_KEYS } from './Pictogram';
import { glass } from './swingStyles';

// The pieces of the marking canvas (D26, laid out per D28 "Frame Then Marks"). Fixed HUD palette:
// the canvas is a video being annotated, the same case as the capture viewfinder. The cue card and
// the dock sit INSIDE the video, on the strong scrim, in the parts of a down-the-line frame that are
// empty at all seven positions (above the head line, left of the body above the ball).

const T = SWING_STRINGS.mark;
const HUD_WARN = semantic.warning.dark; // the HUD amber, as on the capture screen
export const MARK_COLOR = { hands: hud.accent, head: hud.text, ball: semantic.info.dark };
const INK = hud.onAccent;
const CUE_PICT = 96; // the reference pictogram, in the expanded cue (behind "?")
const DIM = withAlpha(hud.bg, 0.78); // an inactive chip on the picture
const OUTLINE = withAlpha(hud.text, 0.35);
export const HANDS_FILL = withAlpha(hud.accent, 0.35);
const HEAD_PROPOSED_FILL = withAlpha(hud.text, 0.3);
const SWATCH_ON_FILL = withAlpha(INK, 0.2);
const RAIL_ON = withAlpha(hud.accent, 0.22); // the side of the change to stop on

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
 * The shaft (hands to clubhead) is drawn under the marks whenever both sit on the still, so a
 * mark on the wrong thing shows as a line off the club; dashed while either is still a proposal.
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

  const onStill = (m) => marks[m]?.pt && marks[m].status !== 'hidden' && marks[m].status !== 'missing' && m !== hidden;
  let shaft = null;
  if (onStill('hands') && onStill('head')) {
    const [x1, y1] = X(marks.hands.pt);
    const [x2, y2] = X(marks.head.pt);
    const dash = ['hands', 'head'].some((m) => marks[m].status === 'proposed' || marks[m].status === 'unsure') ? '6 4' : undefined;
    shaft = (
      <G key="shaft" testID="mark-shaft">
        <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={INK} strokeWidth={4} strokeLinecap="round" opacity={0.5} />
        <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={hud.text} strokeWidth={2} strokeLinecap="round" strokeDasharray={dash} />
      </G>
    );
  }

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
    const proposedLike = mk.status === 'proposed' || mk.status === 'unsure'; // an unsure head is a proposal too, drawn dashed
    const dash = proposedLike ? '5 3' : undefined;
    let shape;
    if (m === 'hands') {
      const hh = on ? 14 : 9;
      shape = <Rect x={x - hh} y={y - hh} width={2 * hh} height={2 * hh} fill={HANDS_FILL} stroke={C} strokeWidth={on ? 3 : 2} strokeDasharray={dash} />;
    } else if (m === 'head') {
      const proposed = proposedLike;
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
      {shaft}
      {order.map(draw)}
    </Svg>
  );
}

export const MarkLayer = memo(MarkLayerImpl);

// --- The dock: what you are moving (selector and legend in one), inside the video on the left ---

/** The tile's corner badge: ✓ confirmed, ? needs a look (proposed, unsure, moved), eye-off hidden, none when missing. */
function DockBadge({ mark, status }) {
  if (status === 'confirmed') {
    return <View style={[styles.badge, styles.badgeOk]} testID={`dock-badge-${mark}`}><Feather name="check" size={9} color={INK} /></View>;
  }
  if (status === 'proposed' || status === 'unsure' || status === 'moved') {
    return <View style={[styles.badge, styles.badgeLook]} testID={`dock-badge-${mark}`}><Text style={styles.badgeText}>?</Text></View>;
  }
  if (status === 'hidden') {
    return <View style={[styles.badge, styles.badgeHidden]} testID={`dock-badge-${mark}`}><Feather name="eye-off" size={9} color={hud.text} /></View>;
  }
  return null;
}

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
            style={[styles.dk, !on && glass.panel, on && styles.dkOn, on && { backgroundColor: MARK_COLOR[m], borderColor: MARK_COLOR[m] }, off && styles.dkOff]}
            onPress={() => onSelect(m)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: off }}
            accessibilityLabel={T.dockLabel(T.names[m], word)}
            testID={`dock-${m}`}
          >
            {off ? null : <DockBadge mark={m} status={statuses[m]} />}
            <Swatch mark={m} on={on} size={14} />
            <Text style={[styles.dkName, on && styles.dkInk]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{T.dockName[m]}</Text>
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

// --- The cue, inside the video (step 1): "P1 Address" + the moment, the before | after rail, "?" ------

/**
 * Which side of the change to stop on: the before | after words, the accent on the side the frame is
 * on, a white tick between them and "this frame" under its end of the tick. For a LAST cue the frame is
 * the end of "before"; for a FIRST cue the start of "after".
 */
export function CueRail({ stop }) {
  const last = stop.kind === 'last';
  return (
    <View testID="mark-cue-rail">
      <View style={styles.rail}>
        <View style={[styles.seg, styles.segL, last && styles.segOn]} testID={last ? 'mark-rail-on' : undefined}>
          <Text style={[styles.segText, styles.segTextL, last && styles.segTextOn]} numberOfLines={1}>{stop.before}</Text>
        </View>
        <View style={styles.tick} />
        <View style={[styles.seg, styles.segR, !last && styles.segOn]} testID={last ? undefined : 'mark-rail-on'}>
          <Text style={[styles.segText, !last && styles.segTextOn]} numberOfLines={1}>{stop.after}</Text>
        </View>
      </View>
      <View style={styles.railLabels}>
        <View style={[styles.railLabel, styles.railLabelL]} testID="mark-rail-under-before">{last ? <Text style={styles.thisFrame}>{T.thisFrame}</Text> : null}</View>
        <View style={styles.tickGap} />
        <View style={styles.railLabel} testID="mark-rail-under-after">{last ? null : <Text style={styles.thisFrame}>{T.thisFrame}</Text>}</View>
      </View>
    </View>
  );
}

/**
 * The panel at the top of the video: `title` ("P1 Address") in bold and the moment in one plain
 * sentence, the before | after rail under it, and "?" which opens the full cue (what / stop when / mark
 * tips) with the pictogram drawn large; a tap on that closes it. Positions without a stop line (the
 * internal frames) show their `stopWhen` sentence and no rail.
 */
function CueCardImpl({
  cue, title, open, onToggle, mirror = false,
}) {
  if (!cue) return null;
  const stop = cue.stop;
  if (open) {
    return (
      <Pressable style={[styles.cueFull, glass.panel]} onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: true }} accessibilityLabel={T.less} testID="mark-cue">
        <View style={styles.cueHead}>
          {PICTOGRAM_KEYS.includes(cue.key) ? (
            <View style={styles.pict}>
              <Pictogram swingKey={cue.key} size={CUE_PICT} color={hud.textSoft} accent={hud.accent} mirror={mirror} testID="mark-pictogram" />
            </View>
          ) : null}
          <Text style={[styles.cueText, styles.flex]}>
            <Text style={styles.cueBold}>{title}</Text>
            {` — ${cue.what}`}
          </Text>
        </View>
        <Text style={styles.cueText}><Text style={styles.cueBold}>{T.cueStop}</Text>{cue.stopWhen}</Text>
        <Text style={styles.cueText}><Text style={styles.cueBold}>{T.cueMark}</Text>{cue.markTips}</Text>
        <Text style={styles.moreText}>{T.less}</Text>
      </Pressable>
    );
  }
  const line = stop ? stop.line : cue.stopWhen;
  return (
    <View style={[styles.cue, glass.panel]}>
      <View
        style={styles.flex}
        accessible
        accessibilityLabel={stop ? T.cueA11y(stop.kind, title, stop.line, stop.before, stop.after) : `${title}. ${cue.stopWhen}`}
        accessibilityLiveRegion="polite"
        testID="mark-stop-line"
      >
        <Text style={styles.cueLine} numberOfLines={2}>
          <Text style={styles.cueTitle}>{title}</Text>
          {`  ${line}`}
        </Text>
        {stop ? <CueRail stop={stop} /> : null}
      </View>
      <Pressable
        style={styles.help}
        onPress={onToggle}
        hitSlop={11}
        accessibilityRole="button"
        accessibilityState={{ expanded: false }}
        accessibilityLabel={T.cueHelp}
        testID="mark-cue-help"
      >
        <Text style={styles.helpText}>?</Text>
      </Pressable>
    </View>
  );
}

export const CueCard = memo(CueCardImpl);

// --- The top row: close and the seven positions as chips (status dot, short name) ---------------------

/**
 * `current` is the open position (none for an automatic frame). The dots are the progress: there is no
 * count anywhere else. Confirmed is a filled dot, skipped a filled square, to do a ring: shape as well as
 * colour. The P-number is on the video's position pill and the cue, not here.
 */
function MarkChipsImpl({
  status, current = null, onSelect, onClose, closeLabel,
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
              <View style={[styles.cd, st === 'confirmed' && styles.cdDone, st === 'skipped' && styles.cdSkip]} />
              <Text style={[styles.chName, on && styles.chOnText]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{SWING_STRINGS.position.short[k]}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const MarkChips = memo(MarkChipsImpl);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dock: { gap: 6 },
  dk: {
    width: 56, minHeight: 46, borderRadius: 12, backgroundColor: hud.scrimStrong, borderWidth: 1.5, borderColor: hud.line,
    alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 2,
  },
  dkOn: { backgroundColor: hud.text, borderColor: hud.text },
  dkOff: { opacity: 0.4 },
  dkName: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 10, color: hud.textSoft },
  dkInk: { color: INK },
  badge: {
    position: 'absolute', top: -4, right: -4, width: 14, height: 14, borderRadius: 7, alignItems: 'center', justifyContent: 'center',
  },
  badgeOk: { backgroundColor: hud.accent },
  badgeLook: { backgroundColor: HUD_WARN },
  badgeHidden: { backgroundColor: hud.inset, borderWidth: 1, borderColor: hud.line },
  badgeText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 10, lineHeight: 12, color: INK },

  cue: {
    position: 'absolute', left: 8, top: 8, right: 8, flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    paddingTop: 9, paddingBottom: 6, paddingLeft: 11, paddingRight: 9,
  },
  cueLine: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, lineHeight: 18, color: hud.text },
  cueTitle: { fontFamily: 'PlusJakartaSans-ExtraBold' },
  help: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: hud.line, alignItems: 'center', justifyContent: 'center',
  },
  helpText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12, color: hud.textSoft },
  rail: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  seg: { flex: 1, paddingVertical: 4, paddingHorizontal: 8, backgroundColor: hud.fill },
  segL: { borderTopLeftRadius: 99, borderBottomLeftRadius: 99 },
  segR: { borderTopRightRadius: 99, borderBottomRightRadius: 99 },
  segOn: { backgroundColor: RAIL_ON },
  segText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 11, color: hud.textMuted },
  segTextL: { textAlign: 'right' },
  segTextOn: { color: hud.accent },
  tick: { width: 3, height: 26, borderRadius: 2, backgroundColor: hud.text },
  tickGap: { width: 3 },
  railLabels: { flexDirection: 'row', marginTop: 1 },
  railLabel: { flex: 1, paddingHorizontal: 2 },
  railLabelL: { alignItems: 'flex-end' },
  thisFrame: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, color: hud.text },
  moreText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 11, color: hud.accent },
  cueFull: {
    position: 'absolute', left: 8, right: 8, top: 8, gap: 6, paddingTop: 10, paddingHorizontal: 12, paddingBottom: 12,
  },
  cueHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pict: { width: CUE_PICT + 8, height: CUE_PICT + 8, borderRadius: 12, backgroundColor: hud.fill, alignItems: 'center', justifyContent: 'center' },
  cueText: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, lineHeight: 18, color: hud.textSoft },
  cueBold: { fontFamily: 'PlusJakartaSans-Bold', color: hud.text },

  chrow: { height: 52, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4 },
  x: { width: 44, height: 44, borderRadius: 22, backgroundColor: hud.fill, alignItems: 'center', justifyContent: 'center' },
  chips: { flex: 1, flexDirection: 'row', gap: 3 },
  ch: {
    flex: 1, height: 44, borderRadius: 10, backgroundColor: hud.fill, borderWidth: 1.5, borderColor: 'transparent',
    alignItems: 'center', justifyContent: 'center', gap: 3,
  },
  chOn: { borderColor: hud.text, backgroundColor: withAlpha(hud.text, 0.14) },
  cd: { width: 6, height: 6, borderRadius: 3, borderWidth: 1.5, borderColor: hud.textMuted },
  cdDone: { backgroundColor: hud.accent, borderColor: hud.accent },
  cdSkip: { backgroundColor: HUD_WARN, borderColor: HUD_WARN, borderRadius: 1 },
  chName: { maxWidth: '100%', fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 10.5, color: hud.textMuted },
  chOnText: { color: hud.text },
});
