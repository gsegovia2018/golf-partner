import React, { useEffect, useRef } from 'react';
import {
  View, Text, Image, Pressable, ScrollView, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, {
  Rect, Circle, Polyline, Text as SvgText, G,
} from 'react-native-svg';
import { hud, semantic } from '../../theme/tokens';
import { withAlpha } from '../../theme/alpha';
import { SWING_STRINGS } from '../../swing/strings';

// The pieces of the marking canvas (D26, design C with V2 stop guidance). Fixed HUD palette:
// the canvas is a video being annotated, the same case as the capture viewfinder.

const T = SWING_STRINGS.mark;
const HUD_WARN = semantic.warning.dark; // the HUD amber, as on the capture screen
export const MARK_COLOR = { hands: hud.accent, head: hud.text, ball: semantic.info.dark };
const INK = hud.onAccent;
const DIM = withAlpha(hud.bg, 0.78); // an inactive chip on the picture
const OUTLINE = withAlpha(hud.text, 0.35);
const HANDS_FILL = withAlpha(hud.accent, 0.35);
export const FINE_REACH = 8; // the fine strip holds the proposal +-8 frames, +-4 in view

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
 */
export function MarkLayer({ rect, marks, active }) {
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
    if (!mk || !at) return null;
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
      shape = <Circle cx={x} cy={y} r={on ? 10 : 7} fill={proposed ? withAlpha(hud.text, 0.3) : hud.text} stroke={proposed ? hud.text : INK} strokeWidth={on ? 2.5 : 1.5} strokeDasharray={dash} />;
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

// --- The dock: what you are moving (selector and legend in one) -------------------------------

export function MarkDock({
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
            <Swatch mark={m} on={on} />
            <Text style={[styles.dkName, on && styles.dkInk]}>{T.names[m]}</Text>
            <Text style={[styles.dkWord, on && styles.dkInk]} numberOfLines={1}>{word}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Swatch({ mark, on = false, size = 16 }) {
  const ink = on ? INK : null;
  if (mark === 'hands') return <View style={{ width: size, height: size, borderRadius: 2, borderWidth: 2.5, borderColor: ink ?? MARK_COLOR.hands, backgroundColor: on ? withAlpha(INK, 0.2) : HANDS_FILL }} />;
  if (mark === 'head') return <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: ink ?? MARK_COLOR.head, backgroundColor: on ? 'transparent' : MARK_COLOR.head }} />;
  return <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2.5, borderColor: ink ?? MARK_COLOR.ball }} />;
}

// --- The stop line (V1, always visible) and its cue panel ---------------------------------------

export function StopLine({ cue, open, onToggle }) {
  if (!cue) return null;
  const stop = cue.stop;
  return (
    <>
      <View style={styles.stop} accessibilityLiveRegion="polite" testID="mark-stop-line">
        {stop ? (
          <View style={[styles.kind, stop.kind === 'last' && styles.kindLast]} accessibilityLabel={stop.kind === 'first' ? 'First frame' : 'Last frame'}>
            <Text style={styles.kindText}>{T.stopKind[stop.kind]}</Text>
          </View>
        ) : null}
        <View style={styles.stopTxt} accessible accessibilityLabel={stop ? T.stopA11y(stop.kind, stop.short, stop.watch) : cue.stopWhen}>
          <Text style={styles.stopMain}>
            <Text style={styles.bold}>{`${cue.name}: `}</Text>
            {stop ? stop.short : cue.stopWhen}
          </Text>
          {stop ? <Text style={styles.stopWatch}>{T.watch(stop.watch)}</Text> : null}
        </View>
        <Pressable onPress={onToggle} style={styles.more} hitSlop={{ top: 6, bottom: 6, left: 4 }} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={open ? T.less : T.more}>
          <Text style={styles.moreText}>{open ? T.less : T.more}</Text>
        </Pressable>
      </View>
      {open ? (
        <View style={styles.cue} testID="mark-cue">
          <Text style={styles.cueText}>
            <Text style={styles.cueBold}>{`${cue.name}${cue.p ? ` · ${cue.p}` : ''}`}</Text>
            {` — ${cue.what}`}
          </Text>
          <Text style={styles.cueText}><Text style={styles.cueBold}>{T.cueStop}</Text>{cue.stopWhen}</Text>
          <Text style={styles.cueText}><Text style={styles.cueBold}>{T.cueMark}</Text>{cue.markTips}</Text>
        </View>
      ) : null}
    </>
  );
}

// --- The fine strip (V2): the neighbours of the position's frame --------------------------------

/**
 * Frames `center` +-8 (+-4 in view, the rest by dragging), the proposal flagged, the condition
 * as before / after captions at the ends, a tap previews a frame, ‹ › step one frame.
 * `frame` is the position's frame now (it moves when the golfer adopts another one).
 */
export function FineStrip({
  center, proposed, frame, view, maxFrame, stillFor, onPreview, before, after, width,
}) {
  const scroll = useRef(null);
  const gap = 4;
  const thumbW = Math.max(44, Math.floor((width - gap * 8) / 9)); // a 44 dp target; narrow phones scroll more
  const frames = [];
  for (let off = -FINE_REACH; off <= FINE_REACH; off += 1) {
    const f = center + off;
    if (f >= 0 && f <= maxFrame) frames.push(f);
  }
  const startX = Math.max(0, (frames.indexOf(center) - 4) * (thumbW + gap));
  useEffect(() => { scroll.current?.scrollTo?.({ x: startX, animated: false }); }, [center, startX]);
  const off = view - proposed;
  const flag = view !== frame ? T.previewFlag(view, off) : frame === proposed ? T.proposedFlag(frame) : T.currentFlag(frame, off);
  return (
    <View style={styles.fine} testID="mark-fine-strip">
      <View style={styles.fcap}>
        <Pressable style={styles.step} onPress={() => onPreview(view - 1)} disabled={view <= 0} accessibilityRole="button" accessibilityLabel={T.prevFrame}>
          <Feather name="chevron-left" size={18} color={hud.textSoft} />
        </Pressable>
        <Text style={styles.fcapText} numberOfLines={1}>{before ? `← ${before}` : ''}</Text>
        <View style={[styles.flag, view !== proposed && styles.flagOff]}>
          <Text style={[styles.flagText, view !== proposed && styles.flagTextOff]} numberOfLines={1}>{flag}</Text>
        </View>
        <Text style={[styles.fcapText, styles.right]} numberOfLines={1}>{after ? `${after} →` : ''}</Text>
        <Pressable style={styles.step} onPress={() => onPreview(view + 1)} disabled={view >= maxFrame} accessibilityRole="button" accessibilityLabel={T.nextFrame}>
          <Feather name="chevron-right" size={18} color={hud.textSoft} />
        </Pressable>
      </View>
      <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap }}>
        {frames.map((f) => {
          const uri = stillFor(f);
          const isProp = f === proposed;
          const isOn = f === view;
          return (
            <Pressable
              key={f}
              style={[styles.thumb, { width: thumbW }]}
              onPress={() => onPreview(f)}
              accessibilityRole="button"
              accessibilityState={{ selected: isOn }}
              accessibilityLabel={T.thumbLabel(f, f - proposed)}
              testID={`fine-${f}`}
            >
              <View style={[styles.ft, { width: thumbW, height: Math.round(thumbW * 1.35) }, isProp && styles.ftProp, isOn && styles.ftOn, Math.abs(f - center) > 3 && !isOn && styles.ftSide]}>
                {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : (
                  <Text style={styles.ftWait} accessibilityElementsHidden importantForAccessibility="no">…</Text>
                )}
                {isProp ? <View style={styles.pf} /> : null}
              </View>
              <Text style={[styles.fn, isProp && styles.fnProp, isOn && styles.fnOn]}>{f}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bold: { fontFamily: 'PlusJakartaSans-ExtraBold' },
  dock: { gap: 8 },
  dk: {
    width: 62, minHeight: 60, borderRadius: 16, backgroundColor: hud.scrim, borderWidth: 1.5, borderColor: hud.line,
    alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 6, paddingHorizontal: 2,
  },
  dkOn: { backgroundColor: hud.text, borderColor: hud.text },
  dkOff: { opacity: 0.4 },
  dkName: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase', color: hud.textSoft },
  dkWord: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 8, color: hud.textSoft, opacity: 0.9 },
  dkInk: { color: INK },

  stop: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: hud.inset, borderWidth: 1, borderColor: hud.border,
    borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10,
  },
  kind: { backgroundColor: hud.accent, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginTop: 1 },
  kindLast: { backgroundColor: HUD_WARN },
  kindText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 9, letterSpacing: 0.8, color: hud.onAccent },
  stopTxt: { flex: 1 },
  stopMain: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12.5, lineHeight: 17, color: hud.text },
  stopWatch: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11, color: hud.textMuted, marginTop: 1 },
  more: { minWidth: 44, minHeight: 32, alignItems: 'center', justifyContent: 'center', marginVertical: -4, marginRight: -6 },
  moreText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12, color: hud.accent },
  cue: { backgroundColor: hud.inset, borderWidth: 1, borderColor: hud.border, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, gap: 4 },
  cueText: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, lineHeight: 17, color: hud.textSoft },
  cueBold: { fontFamily: 'PlusJakartaSans-Bold', color: hud.text },

  fine: { gap: 4 },
  fcap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  step: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: hud.fill },
  fcapText: { flex: 1, fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, color: hud.textMuted },
  right: { textAlign: 'right' },
  flag: { borderRadius: 999, borderWidth: 1, borderColor: hud.line, backgroundColor: hud.fill, paddingHorizontal: 8, paddingVertical: 2, maxWidth: '50%' },
  flagOff: { borderColor: HUD_WARN },
  flagText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, color: hud.text, fontVariant: ['tabular-nums'] },
  flagTextOff: { color: HUD_WARN },
  thumb: { alignItems: 'center', gap: 2, minHeight: 44 },
  ft: {
    borderRadius: 5, overflow: 'hidden', backgroundColor: hud.inset, borderWidth: 1.5, borderColor: 'transparent', opacity: 0.75,
    alignItems: 'center', justifyContent: 'center',
  },
  ftProp: { opacity: 1, borderColor: hud.accent },
  ftOn: { opacity: 1, borderColor: hud.text },
  ftSide: { opacity: 0.55 },
  pf: {
    position: 'absolute', top: -1, alignSelf: 'center', width: 0, height: 0,
    borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: hud.accent,
  },
  ftWait: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, color: hud.textMuted }, // still being extracted
  fn: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 8, color: hud.textMuted, fontVariant: ['tabular-nums'] },
  fnProp: { color: hud.accent },
  fnOn: { color: hud.text },
});
