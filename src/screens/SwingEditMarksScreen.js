import React, {
  memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react';
import {
  View, Text, StyleSheet, Pressable, Alert, ScrollView, StatusBar, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import {
  useSharedValue, withTiming, runOnJS, useReducedMotion,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import SwingOverlay, { fitRect } from '../components/swing/SwingOverlay';
import DragLoupe, { useLoupeValues, LOUPE_FADE_MS, KIND_NAMES } from '../components/swing/DragLoupe';
import FrameScrubber from '../components/swing/FrameScrubber';
import {
  MarkLayer, MarkDock, MarkChips, CueCard, Swatch, MARK_COLOR,
} from '../components/swing/MarkCanvasParts';
import { hud, semantic } from '../theme/tokens';
import { withAlpha } from '../theme/alpha';
import {
  readAnalysis, readPose, readProbe, readMarks, saveAnalysis, saveMarks, getSwing, getSwingProfile,
  setSwingClub, setLastSwingClub,
} from '../store/swingStore';
import { getStill, ensureStills, getProxy } from '../swing/frames';
import { cueFor } from '../swing/checkpoints';
import {
  buildDraft, recompute, draftToMarks, isDirty, hitTest, clampPt, hasMarks,
  markStatus, placeMark, setHidden, confirmMark, chooseFrame, confirmPosition, confirmMoves, restorePosition, skipPosition,
  pendingMoves, primaryAction,
} from '../swing/editMarks';
import {
  MARKED_KEYS, MARK_TOTAL, isMarkedKey, nextTodo, resumeKey, passCounts, positionStatus, markedFromMarks,
} from '../swing/markPass';
import { LOUPE_SIZE, loupeSide } from '../swing/loupe';
import {
  createScrub, scrubSource, thumbSource, ZOOM_REACH,
} from '../swing/scrub';
import { CLUBS, normClub } from '../swing/checks';
import { SWING_STRINGS } from '../swing/strings';

// The marking canvas (plan §6, D26, laid out per D28 "Frame Then Marks"). Two steps per position:
// step 1 "Find the frame" (the cue inside the video, the whole-clip track with the six position
// ticks, a zoomed row of ±4 frames, ‹ › for ±1) and step 2 "Place the marks" (the chosen frame
// frozen, the Hands / Clubhead / Ball dock inside the video, the loupe in the corner opposite the
// mark, per-mark Confirm, Hidden, the 1 px nudge). The video is edge to edge and the same size in
// both steps: a 52 px top row (close, the six chapters, the count) and one fixed panel below.
//
// Two modes. `pass`: the mark-first pass after the analysis (club sheet → six positions →
// finish sheet → Results), saved on every position and resumable; a position opens at step 1
// unless it is already confirmed. `edit`: opened from Results at a position, at step 2 on the saved
// frame, Save / Cancel. The automatic finish and the internal frames open in the same canvas with
// an "auto" count and no chapter.
//
// Smoothness (D28): nothing re-renders the canvas while a finger is down. The track and the mark
// drag are gesture-handler Pans whose worklets write shared values on the UI thread (the playhead;
// the loupe and the dragged mark); JS hears about a scrub only when the frame changes (a tiny store
// read by the picture and the scrubber, not the canvas) and about a mark drag only when it starts
// and when it ends, where the draft is committed once and the analysis runs once.

const T = SWING_STRINGS.mark;
const HUD_WARN = semantic.warning.dark; // the HUD amber, as on the capture screen
const TOP_H = 52;
export const PANEL_H = 188; // the bottom panel, the same in both steps so the video never jumps
const noProxy = () => null;

const HudButton = memo(function HudButton({
  label, a11y, onPress, ghost, plain, icon, iconRight, disabled, style, testID,
}) {
  const ink = ghost || plain ? hud.text : hud.onAccent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[s.btn, ghost && s.btnGhost, plain && s.btnPlain, disabled && s.dim, style]}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
    >
      {icon ? <Feather name={icon} size={16} color={ink} /> : null}
      <Text style={[s.btnText, (ghost || plain) && s.btnGhostText]} numberOfLines={1}>{label}</Text>
      {iconRight ? <Feather name={iconRight} size={16} color={ink} /> : null}
    </Pressable>
  );
});

/** A callback with a stable identity that always runs the latest closure: memoised children never see it change. */
function useStable(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args) => ref.current(...args), []);
}

/**
 * Step 1's picture: the frame under the finger while the track is dragged (its still if on disk,
 * else the nearest proxy, else the last still), the committed frame otherwise. It reads the scrub
 * store itself, so a drag re-renders this and the scrubber, never the canvas.
 */
const ScrubPicture = memo(function ScrubPicture({
  scrub, view, shown, stillFor, proxyFor, box, video, name,
}) {
  const drag = useSyncExternalStore(scrub.subscribe, scrub.get);
  const frame = drag ?? view;
  const src = scrubSource({
    frame, dragging: drag != null, still: stillFor(frame), proxy: proxyFor(frame), last: shown,
  });
  // not the exact frame yet: SCRUBBING under the finger, LOADING after the release until the still lands
  const note = src.exact ? '' : drag != null ? T.scrubbing : T.loadingTag;
  return (
    <>
      <SwingOverlay width={box.w} height={box.h} video={video} uri={src.uri} showPlanes={false} resizeMethod="scale" label={`${name} still, frame ${frame}`} />
      <View style={s.tag} pointerEvents="none">
        <Text style={s.tagText} testID="mark-frame-tag">{`${T.frameTag(frame)}${note ? ` · ${note}` : ''}`}</Text>
      </View>
    </>
  );
});

/**
 * The mark drag on the UI thread (D28). On touch-down the worklet hit-tests the marks in `ctx` (kept
 * current by the canvas after each render), shows the loupe and the dragged mark from the shared
 * values `lv`, and tells JS once (onGrab: the SVG layer hides that mark). Each move only writes `lv`.
 * On release JS gets the point once (onDrop), which commits the draft: one render, one analysis.
 * A touch that is not on a mark places the active mark there, on release, like a drag.
 */
function useMarkPan({
  ctx, lv, onGrab, onRefuse, onDrop,
}) {
  const kind = useSharedValue(0);
  const ox = useSharedValue(0);
  const oy = useSharedValue(0);
  const x0 = useSharedValue(0);
  const y0 = useSharedValue(0);
  const moved = useSharedValue(0);
  return useMemo(() => Gesture.Pan()
    .minDistance(0)
    .maxPointers(1)
    .shouldCancelWhenOutside(false)
    .onBegin((e) => {
      'worklet';
      kind.value = 0;
      const c = ctx.value;
      if (!c || !c.w) return;
      if (c.loading) { runOnJS(onRefuse)('loading'); return; }
      const px = (p) => (p ? [p[0] * c.w, p[1] * c.h] : null);
      const hit = hitTest([e.x, e.y], { hands: px(c.hands), head: px(c.head), ball: px(c.ball) }, c.active);
      let t = hit;
      let o;
      if (hit) o = hit === 'hands' ? c.hands : hit === 'head' ? c.head : c.ball;
      else if (c.active === 'ball' && !c.ballOk) { runOnJS(onRefuse)('ball'); return; } else {
        t = c.active;
        o = clampPt([e.x / c.w, e.y / c.h]);
      }
      const k = t === 'hands' ? 1 : t === 'head' ? 2 : 3;
      kind.value = k;
      ox.value = o[0];
      oy.value = o[1];
      x0.value = e.x;
      y0.value = e.y;
      moved.value = hit ? 0 : 1;
      lv.fx.value = e.x;
      lv.fy.value = e.y;
      lv.mx.value = o[0];
      lv.my.value = o[1];
      lv.side.value = loupeSide([o[0] * c.w, o[1] * c.h], c, LOUPE_SIZE, -1);
      lv.kind.value = k;
      lv.opacity.value = c.reduced ? 1 : withTiming(1, { duration: LOUPE_FADE_MS });
      runOnJS(onGrab)(k, hit ? 1 : 0);
    })
    .onUpdate((e) => {
      'worklet';
      if (!kind.value) return;
      const c = ctx.value;
      const p = clampPt([ox.value + (e.x - x0.value) / c.w, oy.value + (e.y - y0.value) / c.h]);
      lv.fx.value = e.x;
      lv.fy.value = e.y;
      lv.mx.value = p[0];
      lv.my.value = p[1];
      lv.side.value = loupeSide([p[0] * c.w, p[1] * c.h], c, LOUPE_SIZE, lv.side.value);
      if (e.x !== x0.value || e.y !== y0.value) moved.value = 1;
    })
    .onFinalize((_e, success) => {
      'worklet';
      const k = kind.value;
      if (!k) return;
      kind.value = 0;
      lv.opacity.value = 0;
      // a drag the system cancelled (another gesture, the app backgrounded) commits nothing
      if (success) runOnJS(onDrop)(k, lv.mx.value, lv.my.value, moved.value);
      else runOnJS(onDrop)(k, 0, 0, 0);
    })
    .withTestId('mark-pan'), [ctx, lv, onGrab, onRefuse, onDrop, kind, ox, oy, x0, y0, moved]);
}

// --- The canvas (props in) --------------------------------------------------------------------------

export function SwingMarkCanvas({
  analysis, pose, probe, marks, mode = 'edit', initialCp = 'impact', lastClub = 'iron',
  stillFor, proxyFor = noProxy, needStills, onSave, onClub, closeRef, onClose, onResults, onDirtyChange,
}) {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const reduced = useReducedMotion();
  const pass = mode === 'pass';

  const init = useRef(null);
  if (!init.current) init.current = buildDraft(analysis, pose, marks);
  const { base } = init.current;
  const startDraft = init.current.draft;
  const [draft, commit] = useState(startDraft);

  // A position opens at step 1 in the pass (the frame first), at step 2 once it is confirmed and
  // always in edit mode (Results' "Edit marks" opens the saved frame, "‹ Frame" is one tap away).
  const stepFor = (key, status) => (!pass || status[key] === 'confirmed' ? 2 : 1);
  const startPhase = () => {
    if (!pass) return 'canvas';
    const marked = markedFromMarks(marks);
    if (marked.state === 'none') return 'club';
    return resumeKey(startDraft.status) ? 'canvas' : 'finish';
  };
  const firstCp = pass ? resumeKey(startDraft.status) ?? MARKED_KEYS[0] : initialCp;
  const [phase, setPhase] = useState(startPhase); // club | canvas | finish
  const [club, setClub] = useState(normClub(pass && markedFromMarks(marks).state === 'none' ? lastClub : analysis.club));
  const [cp, setCp] = useState(firstCp);
  const [step, setStep] = useState(() => stepFor(firstCp, startDraft.status));
  const [view, setView] = useState(startDraft.cps[firstCp].frame); // step 1's cursor; the frozen frame in step 2
  const [active, setActive] = useState('hands');
  const [toast, setToast] = useState('');
  const [cueOpen, setCueOpen] = useState(false);
  const [dialog, setDialog] = useState(null); // { then(draft) } while the discard sheet is up
  const [fixFrom, setFixFrom] = useState(null); // 'finish': the finish frame opened from the finish sheet
  const [saving, setSaving] = useState(false);
  const [area, setArea] = useState(null);
  const [dragging, setDragging] = useState(null); // the mark under the finger: DragLoupe draws it, the SVG layer skips it
  const snap = useRef(startDraft); // the draft when the golfer arrived at this position
  const scrub = useRef(null);
  if (!scrub.current) scrub.current = createScrub();

  const video = pose.video;
  const maxFrame = Math.max(1, (video.frameCount ?? 1) - 1);
  const fps = analysis.fps?.capture || video.containerFps || 30;
  const handedness = analysis.handedness;
  const scored = useMemo(() => ({ ...analysis, club }), [analysis, club]);

  // --- the live analysis (hands follow the grip on a chosen frame; saved with the marks) ----------
  // `draft` only changes when a gesture ends (release, nudge, confirm, a frame chosen...): a drag
  // lives in shared values on the UI thread, so the analysis runs once per drag, on release.
  const lastGood = useRef(null);
  const live = useMemo(() => {
    const a = recompute({ pose, probe, analysis: scored, draft, base });
    if (a.error) return lastGood.current ?? scored;
    lastGood.current = a;
    return a;
  }, [pose, probe, scored, draft, base]);

  const dirty = isDirty(draft, startDraft) || club !== normClub(analysis.club);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const d = draft.cps[cp];
  const chapter = isMarkedKey(cp);
  const cue = useMemo(() => cueFor(cp, handedness), [cp, handedness]);
  const statuses = useMemo(() => ({
    hands: markStatus(draft, base, cp, 'hands'),
    head: markStatus(draft, base, cp, 'head'),
    ball: cp === 'address' ? markStatus(draft, base, cp, 'ball') : null,
  }), [draft, base, cp]);
  const handsNow = d.hands ?? live.clubMarks[cp].hands;
  const headNow = d.hidden ? null : d.head;
  const ballNow = cp === 'address' ? draft.ball : null;

  // --- layout: the video takes everything between the top row and the panel ----------------------
  const fallback = { w: Math.min(winW, 480), h: Math.max(240, winH - insets.top - insets.bottom - TOP_H - PANEL_H) };
  const box = area ?? fallback;
  const rect = useMemo(() => fitRect(box.w, box.h, video.width, video.height), [box.w, box.h, video.width, video.height]);

  // --- stills: the frame on screen, and step 1's zoomed neighbours ----------------------------------
  const [shown, setShown] = useState({ frame: null, uri: null });
  useEffect(() => {
    let alive = true;
    const have = stillFor(view);
    if (have) { setShown({ frame: view, uri: have }); return undefined; }
    const t = setTimeout(async () => {
      await needStills([view]);
      // No still even after extracting: say so on the picture instead of waiting forever.
      if (alive) setShown({ frame: view, uri: stillFor(view) });
    }, 90);
    return () => { alive = false; clearTimeout(t); };
  }, [view, stillFor, needStills]);
  // Once the cursor's still is on screen, its ±4 for the zoomed row (one sequential decode, after a
  // pause so a run of ‹ › taps asks once). Step 2 fetches nothing: nothing changes under a drag.
  const arrived = shown.frame === view;
  useEffect(() => {
    if (phase !== 'canvas' || step !== 1 || !arrived) return undefined;
    const want = [];
    for (let f = view - ZOOM_REACH; f <= view + ZOOM_REACH; f += 1) if (f >= 0 && f <= maxFrame && !stillFor(f)) want.push(f);
    if (!want.length) return undefined;
    const t = setTimeout(() => { needStills(want); }, 200);
    return () => clearTimeout(t);
  }, [phase, step, arrived, view, maxFrame, stillFor, needStills]);
  // The picture is still the previous frame until the new still arrives: nothing is placed on it meanwhile.
  const loading = !arrived;

  // --- editing (step 2) -------------------------------------------------------------------------------
  const latest = useRef({});
  latest.current = {
    cp, view, active, draft, handsNow, headNow, ballNow, loading,
  };
  const place = useCallback((m, pt) => {
    const L = latest.current;
    commit(placeMark(L.draft, L.cp, m, pt));
  }, []);

  const loupe = useRef(null); // D20: the magnifier, drawn from shared values
  const lv = useLoupeValues();
  const ctx = useSharedValue(null);
  // what the drag worklet reads on touch-down: written as each render commits (before any touch can
  // reach the new tree), never during a drag
  useLayoutEffect(() => {
    ctx.value = {
      w: rect.w, h: rect.h, loading, active, ballOk: cp === 'address', reduced, hands: handsNow, head: headNow, ball: ballNow ? [ballNow[0], ballNow[1]] : null,
    };
  });
  const grabbed = useRef(null); // the position and frame a drag started on
  const onGrab = useStable((k, hit) => {
    grabbed.current = { cp: latest.current.cp, view: latest.current.view };
    setToast('');
    if (hit) setActive(KIND_NAMES[k]);
    setDragging(KIND_NAMES[k]);
  });
  const onRefuse = useStable((why) => setToast(why === 'loading' ? T.loadingFrame(latest.current.view) : T.ballOnlyAddress));
  const onDrop = useStable((k, x, y, moved) => {
    // one commit per gesture; a touch that did not move a grabbed mark commits nothing, and neither
    // does one whose frame went away under it (loading, or another position or frame meanwhile)
    const L = latest.current;
    const G = grabbed.current;
    grabbed.current = null;
    const same = !!G && G.cp === L.cp && G.view === L.view;
    if (moved && same && !L.loading) place(KIND_NAMES[k], clampPt([x, y]));
    setDragging(null); // the committed mark is drawn by the SVG layer from here; the effect below drops the overlay
    setDrops((n) => n + 1); // a grab and a drop in one batch leave `dragging` unchanged: this still runs the effect
  });
  const [drops, setDrops] = useState(0);
  useEffect(() => { if (!dragging) lv.kind.value = 0; }, [dragging, drops, lv]);
  const markPan = useMarkPan({
    ctx, lv, onGrab, onRefuse, onDrop,
  });

  const nudge = (dx, dy) => {
    const L = latest.current;
    if (L.loading) return;
    const cur = L.active === 'hands' ? L.handsNow : L.active === 'head' ? L.headNow : L.ballNow;
    if (!cur) { setToast(L.active === 'head' ? T.placeHead : T.ballOnlyAddress); return; }
    const moved = clampPt([cur[0] + dx / video.width, cur[1] + dy / video.height]);
    place(L.active, moved);
    loupe.current?.flash({ mark: moved }); // a 1-px move is invisible under the finger: show it magnified
  };

  const selectMark = useStable((m) => {
    if (m === 'ball' && cp !== 'address') { setToast(T.ballOnlyAddress); return; }
    setActive(m);
    setToast('');
  });
  const confirmActive = () => {
    commit(confirmMark(draft, base, cp, active));
    setToast(T.confirmed(T.names[active], d.frame));
  };
  const toggleHidden = () => {
    const on = !d.hidden;
    commit(setHidden(draft, cp, on));
    if (!on && !d.head) { setActive('head'); setToast(T.placeHead); } else setToast(on ? T.hiddenToast : '');
  };

  // --- step 1 → step 2 and back ---------------------------------------------------------------------
  const pick = useCallback((f) => {
    setView(Math.min(maxFrame, Math.max(0, Math.round(f))));
    setCueOpen(false);
  }, [maxFrame]);
  /** "Proposed frame looks right" / "Use frame N": the position takes the cursor's frame (D28). */
  const takeFrame = () => {
    if (loading) return;
    const { draft: next, reset } = chooseFrame(draft, base, cp, view);
    commit(next);
    setToast(reset && hasMarks(draft, base, cp) ? T.framesReset : '');
    setActive('hands');
    setCueOpen(false);
    setStep(2);
  };
  /** "‹ Frame": back to step 1 at this frame. Nothing is lost until another frame is chosen. */
  const changeFrame = () => {
    setStep(1);
    setView(d.frame);
    setToast('');
  };

  // --- saving ---------------------------------------------------------------------------------------
  const passStateNow = useRef(markedFromMarks(marks).state);
  const write = async (next, passState) => {
    try {
      const a = recompute({ pose, probe, analysis: scored, draft: next, base });
      if (a.error) throw new Error(a.error);
      const m = draftToMarks({
        draft: next, base, live: a, swingId: analysis.swingId, video: { width: video.width, height: video.height, fps: video.containerFps },
        handedness, editedAt: new Date().toISOString(), passState,
      });
      await onSave({ analysis: a, marks: m });
      passStateNow.current = passState;
      return true;
    } catch {
      setToast(T.saveFailed);
      return false;
    }
  };
  // Saves run one after another in the background, so a pass step moves on at once (the canvas
  // must not keep taking touches for a position the golfer has already left).
  const queue = useRef(Promise.resolve(true));
  const persist = (next, passState = passStateNow.current) => {
    // one failed save must never stop the ones after it
    queue.current = queue.current.catch(() => false).then(() => write(next, passState));
    return queue.current;
  };
  /** A save the next screen depends on: wait for it, with the buttons off meanwhile. */
  const persistNow = async (next, passState) => {
    setSaving(true);
    try { return await persist(next, passState); } finally { setSaving(false); }
  };

  // --- moving between positions --------------------------------------------------------------------
  const enter = (key, from, st = stepFor(key, from.status)) => {
    snap.current = from;
    setCp(key);
    setStep(st);
    setView(from.cps[key].frame);
    setActive('hands');
    setCueOpen(false);
    setToast('');
    setPhase('canvas');
  };
  /** Run `then(draft)` once the position has nothing unconfirmed to lose (the discard sheet asks). */
  const guard = (then) => {
    if (phase === 'canvas' && pendingMoves(draft, base, snap.current, cp)) setDialog({ then });
    else then(draft);
  };
  const goto = useStable((key) => { if (key !== cp || fixFrom || !chapter) guard((dr) => { setFixFrom(null); enter(key, dr); }); });
  const answer = (choice) => {
    const { then } = dialog;
    setDialog(null);
    if (choice === 'keep') return;
    const next = choice === 'confirm' ? confirmMoves(draft, base, cp) : restorePosition(draft, snap.current, cp);
    commit(next);
    then(next);
  };

  // One press, one step: a second tap before the canvas has moved on is ignored.
  const busy = useRef(false);
  useEffect(() => { busy.current = false; }, [cp, phase, draft, step]);
  const once = (fn) => {
    if (busy.current) return;
    busy.current = true;
    fn();
  };

  const advance = (next) => {
    const key = nextTodo(next.status, cp);
    if (key) enter(key, next); else setPhase('finish');
  };
  const primary = async () => {
    if (loading) return;
    const next = confirmPosition(draft, base, cp);
    commit(next);
    if (pass && !fixFrom) {
      advance(next);
      persist(next, 'partial');
      return;
    }
    if (fixFrom) {
      setFixFrom(null);
      setPhase('finish');
      persist(next);
      return;
    }
    if (!isDirty(next, startDraft) && club === normClub(analysis.club)) { onClose(); return; }
    if (await persistNow(next)) onClose();
  };
  const skip = () => {
    const next = skipPosition(draft, snap.current, cp);
    commit(next);
    advance(next);
    persist(next, 'partial');
  };

  /** Close, Cancel and the hardware back. The pass keeps its progress; edit asks before dropping changes. */
  const requestClose = (proceed) => {
    if (dialog) { setDialog(null); return; }
    if (pass) {
      if (phase === 'club') { proceed(); return; }
      if (fixFrom) { guard(() => { setFixFrom(null); setPhase('finish'); }); return; }
      guard(async (dr) => {
        if (await persistNow(dr)) { proceed(); return; }
        // A save that fails must not trap the golfer on the canvas.
        Alert.alert(T.saveFailed, T.saveFailedBody, [
          { text: T.keepEditing, style: 'cancel' },
          { text: T.leaveUnsaved, style: 'destructive', onPress: proceed },
        ]);
      });
      return;
    }
    if (!dirty) { proceed(); return; }
    Alert.alert(T.leaveTitle, T.leaveBody, [
      { text: T.keepEditing, style: 'cancel' },
      { text: T.discard, style: 'destructive', onPress: proceed },
    ]);
  };
  if (closeRef) closeRef.current = requestClose;

  // --- the club sheet and the finish sheet (the pass) ----------------------------------------------
  const startMarking = async () => {
    onClub?.(club);
    if (await persistNow(draft, 'partial')) enter(resumeKey(draft.status) ?? MARKED_KEYS[0], draft);
  };
  const seeResults = async () => {
    if (await persistNow(draft, 'done')) onResults();
  };
  const fixFinish = () => { setFixFrom('finish'); enter('finish', draft, 1); };

  // --- rendering ------------------------------------------------------------------------------------
  const counts = passCounts(draft.status);
  const idx = MARKED_KEYS.indexOf(cp);
  const editLike = !pass || !!fixFrom;
  const action = useMemo(() => primaryAction(draft, base, cp), [draft, base, cp]);
  const willChange = useMemo(() => isDirty(confirmPosition(draft, base, cp), startDraft), [draft, base, cp, startDraft]);
  const primaryLabel = editLike ? (willChange || fixFrom ? T.primary.editSave : T.primary.editDone) : T.primary[action];
  const proposed = base.cps[cp].frame;
  const resets = view !== d.frame && hasMarks(draft, base, cp);
  const frameLabel = resets ? T.primary.useReset(view) : view === proposed ? T.primary.proposedOk : T.primary.useFrame(view);
  const countMain = !chapter ? T.auto : pass && !fixFrom ? T.position(idx + 1, MARK_TOTAL) : T.edit;
  const bg = stillFor(draft.cps.address.frame);
  const markLine = statuses[active] === 'missing' ? T.line.missing(T.names[active]) : T.line[statuses[active]];
  const canConfirm = ['proposed', 'moved'].includes(statuses[active]);
  const short = T.short[cp] ?? cue?.name ?? cp;

  // Hooks below stay above the sheets' early returns. Handlers have a stable identity (useStable) so the
  // memoised chrome (chips, dock, scrubber, buttons) does not re-render with every canvas render.
  const onPrimary = useStable(() => once(primary));
  const onUseFrame = useStable(() => once(takeFrame));
  const onChangeFrame = useStable(changeFrame);
  const onSkip = useStable(() => once(skip));
  const onCancel = useStable(() => requestClose(onClose));
  const onCloseTap = useStable(() => requestClose(onClose));
  const toggleCue = useCallback(() => setCueOpen((v) => !v), []);
  const thumbFor = useCallback((f) => thumbSource(stillFor(f), proxyFor(f)), [stillFor, proxyFor]);
  const priorHead = live.clubMarks[cp].priorHead;
  const marksNow = useMemo(() => ({
    hands: { pt: handsNow, status: statuses.hands },
    head: { pt: headNow, status: statuses.head, prior: priorHead },
    ball: ballNow ? { pt: ballNow, status: statuses.ball } : null,
  }), [handsNow, headNow, priorHead, ballNow, statuses]);
  const tickKey = MARKED_KEYS.map((k) => `${draft.cps[k].frame}${positionStatus(draft.status, k)[0]}`).join(',');
  const ticks = useMemo(() => MARKED_KEYS.map((k) => ({
    key: k, p: cueFor(k).p, frame: draft.cps[k].frame, done: positionStatus(draft.status, k) === 'confirmed', cur: k === cp,
  })), [tickKey, cp]); // eslint-disable-line react-hooks/exhaustive-deps
  // the zoomed row's stills: `stillFor` is stable, so the row is told when one of its frames has arrived
  const loaded = [];
  for (let f = view - ZOOM_REACH; f <= view + ZOOM_REACH; f += 1) loaded.push(stillFor(f) ? 1 : 0);

  const sheetStill = (
    <View style={StyleSheet.absoluteFill}>
      <SwingOverlay width={winW} height={winH} video={video} uri={bg} showPlanes={false} label={cueFor('address').name} />
      <View style={s.scrim} />
    </View>
  );

  if (phase === 'club') {
    return (
      <View style={s.screen} testID="mark-club-sheet">
        <StatusBar barStyle="light-content" />
        {sheetStill}
        <View style={[s.sheet, { paddingBottom: 24 + insets.bottom }]}>
          <View style={s.handle} />
          <Text style={s.sheetTitle}>{T.clubTitle}</Text>
          <Text style={s.sheetSub}>{T.clubSub}</Text>
          <View style={s.row} accessibilityRole="radiogroup" accessibilityLabel={SWING_STRINGS.club.label}>
            {CLUBS.map((k) => (
              <Pressable
                key={k}
                style={[s.btn, s.flex, club !== k && s.btnGhost]}
                onPress={() => setClub(k)}
                accessibilityRole="radio"
                accessibilityState={{ selected: club === k }}
                accessibilityLabel={SWING_STRINGS.club[k]}
              >
                <Text style={[s.btnText, club !== k && s.btnGhostText]}>{SWING_STRINGS.club[k]}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.sheetSub}>{T.clubNext}</Text>
          <HudButton label={T.start} onPress={startMarking} disabled={saving} testID="mark-start" />
          <Text style={[s.sheetSub, s.center]}>{SWING_STRINGS.privacy}</Text>
        </View>
      </View>
    );
  }

  if (phase === 'finish') {
    const missing = MARKED_KEYS.filter((k) => markStatus(draft, base, k, 'head') === 'missing').map((k) => SWING_STRINGS.checkpoint[k]);
    const skipped = MARKED_KEYS.filter((k) => positionStatus(draft.status, k) === 'skipped').map((k) => SWING_STRINGS.checkpoint[k]);
    return (
      <View style={s.screen} testID="mark-finish-sheet">
        <StatusBar barStyle="light-content" />
        {sheetStill}
        <View style={[s.sheet, s.sheetTall, { paddingBottom: 24 + insets.bottom }]}>
          <View style={s.handle} />
          <ScrollView contentContainerStyle={s.sheetBody}>
            <Text style={s.sheetTitle}>{T.finishTitle(counts.confirmed, MARK_TOTAL)}</Text>
            {missing.length ? (
              <Text style={[s.sheetSub, s.warn]}><Text style={s.bold}>{T.noClubhead(missing)}</Text>{T.noClubheadBody}</Text>
            ) : null}
            {skipped.length ? (
              <Text style={s.sheetSub}><Text style={[s.bold, s.white]}>{T.skippedLine(skipped)}</Text>{T.skippedBody}</Text>
            ) : null}
            {MARKED_KEYS.map((k) => {
              const st = positionStatus(draft.status, k);
              const head = markStatus(draft, base, k, 'head');
              const sub = T.rowSub[head];
              return (
                <Pressable key={k} style={s.finRow} onPress={() => enter(k, draft)} accessibilityRole="button" accessibilityLabel={`${cueFor(k).name}, ${T.chip[st]}${sub ? `, ${sub}` : ''}`} testID={`finish-row-${k}`}>
                  <Text style={s.finP}>{cueFor(k).p}</Text>
                  <View style={s.flex}>
                    <Text style={s.finName}>{cueFor(k).name}</Text>
                    {sub ? <Text style={s.finSub}>{sub}</Text> : null}
                  </View>
                  <Text style={[s.stc, st === 'confirmed' && s.stcOk, st === 'skipped' && s.stcSkip]}>{T.chip[st]}</Text>
                </Pressable>
              );
            })}
            <View style={s.autoRow}>
              <Text style={[s.finSub, s.flex]}>{T.autoLine}</Text>
              <Pressable onPress={fixFinish} style={s.fixLink} accessibilityRole="button" accessibilityLabel={T.fixFinish} testID="mark-fix-finish">
                <Text style={s.fixText}>{T.fixFinish}</Text>
              </Pressable>
            </View>
          </ScrollView>
          <HudButton label={T.seeResults} onPress={seeResults} disabled={saving} testID="mark-see-results" />
        </View>
      </View>
    );
  }


  const step1 = step === 1;
  return (
    <View style={[s.screen, { paddingTop: insets.top }]} testID="mark-canvas">
      <StatusBar barStyle="light-content" />
      {/* the discard sheet is modal: TalkBack must not wander behind it */}
      <View style={s.flex} importantForAccessibility={dialog ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={!!dialog} testID="mark-canvas-body">
        <MarkChips
          status={draft.status}
          current={chapter && !fixFrom ? cp : null}
          onSelect={goto}
          onClose={onCloseTap}
          closeLabel={editLike ? T.cancel : T.close}
          count={countMain}
          sub={T.tally(counts.confirmed, counts.skipped)}
          mirror={handedness === 'left'}
        />

        <View style={s.video} onLayout={(e) => { const { width: w, height: h } = e.nativeEvent.layout; if (w && h) setArea({ w, h }); }} testID="mark-video">
          {step1 ? (
            <>
              <ScrubPicture scrub={scrub.current} view={view} shown={shown} stillFor={stillFor} proxyFor={proxyFor} box={box} video={video} name={cue?.name ?? cp} />
              <CueCard cue={cue} open={cueOpen} onToggle={toggleCue} mirror={handedness === 'left'} />
              {toast ? (
                <View style={s.loadingPill} pointerEvents="none" accessibilityLiveRegion="polite" testID="mark-toast">
                  <Text style={[s.loadingText, s.toast]}>{toast}</Text>
                </View>
              ) : null}
            </>
          ) : (
            <>
              <SwingOverlay width={box.w} height={box.h} video={video} uri={shown.uri} showPlanes={false} resizeMethod="scale" label={`${cue?.name ?? cp} still, frame ${shown.frame ?? view}`}>
                <MarkLayer rect={rect} active={active} marks={marksNow} hidden={dragging} />
                <GestureDetector gesture={markPan}>
                  <View style={StyleSheet.absoluteFill} testID="edit-touch-layer" accessible accessibilityLabel={`${T.names[active]} · ${markLine}`} accessibilityHint={T.touchHint} />
                </GestureDetector>
                <DragLoupe ref={loupe} values={lv} placement="corner" rect={rect} uri={shown.uri} label={T.placing(T.names[active])} color={MARK_COLOR[active]} />
              </SwingOverlay>
              <View style={s.pospill} accessible accessibilityLabel={T.posPill(cue?.p, short, d.frame, d.frame !== proposed)} testID="mark-pospill">
                <Text style={s.pospillText} numberOfLines={1}>
                  {`${cue?.p ? `${cue.p} · ` : ''}${short}`}
                  <Text style={s.pospillSmall}>{` · frame ${d.frame}${d.frame !== proposed ? ' (chosen)' : ''}`}</Text>
                </Text>
              </View>
              <MarkDock style={s.dock} active={active} statuses={statuses} ballOff={cp !== 'address'} onSelect={selectMark} />
              <View style={s.tag} pointerEvents="none">
                <Text style={s.tagText} testID="mark-frame-tag">{T.frameTag(d.frame)}</Text>
              </View>
              {loading ? (
                <View style={s.loadingPill} pointerEvents="none" accessibilityLiveRegion="polite" testID="mark-loading">
                  <Text style={s.loadingText}>{T.loadingFrame(view)}</Text>
                </View>
              ) : null}
            </>
          )}
        </View>

        <View style={[s.panel, { height: PANEL_H + insets.bottom, paddingBottom: 12 + insets.bottom }]} testID={`mark-step-${step}`}>
          <View style={s.steph}>
            <Text style={s.stephText}>
              <Text style={s.white}>{T.stepOf(step)}</Text>
              {` · ${step1 ? T.findFrame : T.placeMarks}`}
            </Text>
            <View style={s.dots}>
              <View style={[s.dot, s.dotOn]} />
              <View style={[s.dot, !step1 && s.dotOn]} />
            </View>
          </View>
          {step1 ? (
            <>
              <FrameScrubber
                view={view}
                proposed={proposed}
                maxFrame={maxFrame}
                fps={fps}
                ticks={ticks}
                thumbFor={thumbFor}
                onPick={pick}
                scrub={scrub.current}
                loaded={loaded.join('')}
              />
              <View style={[s.row, s.act]}>
                {pass && !fixFrom ? (
                  <HudButton ghost label={T.skip} onPress={onSkip} disabled={saving} style={s.btnSide} testID="mark-skip" />
                ) : (
                  <HudButton ghost label={T.cancel} onPress={onCancel} disabled={saving} style={s.btnSide} testID="mark-cancel" />
                )}
                {/* off until the picture is this exact frame: "Use frame N" must take what the golfer sees */}
                <HudButton iconRight="chevron-right" label={frameLabel} onPress={onUseFrame} disabled={saving || loading} style={s.flex} testID="mark-use-frame" />
              </View>
            </>
          ) : (
            <>
              <View style={s.markRow} testID="mark-row">
                <Swatch mark={active} size={14} />
                <Text style={s.markText} numberOfLines={1}>{`${T.names[active]} · ${markLine}`}</Text>
                {active === 'head' && statuses.head !== 'confirmed' ? (
                  <Pressable style={[s.mini, s.miniGhost, loading && s.dim]} disabled={loading} onPress={toggleHidden} accessibilityRole="button" accessibilityLabel={d.hidden ? T.unhide : T.hide} testID="mark-hidden">
                    <Feather name="eye-off" size={13} color={hud.text} />
                    <Text style={[s.miniText, s.white]}>{d.hidden ? T.unhide : T.hide}</Text>
                  </Pressable>
                ) : null}
                {canConfirm ? (
                  <Pressable style={[s.mini, loading && s.dim]} disabled={loading} onPress={confirmActive} accessibilityRole="button" accessibilityLabel={`${T.confirm} ${T.names[active]}`} testID="mark-confirm">
                    <Feather name="check" size={13} color={hud.onAccent} />
                    <Text style={s.miniText}>{T.confirm}</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={s.tools}>
                <Text style={[s.hint, toast && s.toast]} accessibilityLiveRegion="polite" numberOfLines={2}>{toast || T.nudgeHint}</Text>
                {[['left', 'arrow-left', -1, 0], ['up', 'arrow-up', 0, -1], ['down', 'arrow-down', 0, 1], ['right', 'arrow-right', 1, 0]].map(([k, icon, dx, dy]) => (
                  <Pressable key={k} style={s.nudge} onPress={() => nudge(dx, dy)} disabled={loading} accessibilityRole="button" accessibilityLabel={T.nudge[k]}>
                    <Feather name={icon} size={16} color={hud.textSoft} />
                  </Pressable>
                ))}
              </View>
              <View style={[s.row, s.act]}>
                <HudButton ghost icon="chevron-left" label={T.changeFrame} a11y={T.changeFrameA11y} onPress={onChangeFrame} disabled={saving} style={s.btnSide} testID="mark-change-frame" />
                <HudButton icon="check" label={saving ? T.saving : primaryLabel} onPress={onPrimary} disabled={saving || loading} style={s.flex} testID="mark-primary" />
              </View>
            </>
          )}
        </View>
      </View>

      {dialog ? (
        <View style={StyleSheet.absoluteFill} testID="mark-discard-sheet" accessibilityViewIsModal>
          <Pressable style={s.scrim} onPress={() => answer('keep')} accessible={false} />
          <View style={[s.sheet, { paddingBottom: 24 + insets.bottom }]}>
            <View style={s.handle} />
            <Text style={s.sheetTitle}>{T.discardTitle}</Text>
            <Text style={s.sheetSub}>{T.discardBody}</Text>
            <HudButton label={T.confirmLeave} onPress={() => answer('confirm')} />
            <HudButton ghost label={T.discardMove} onPress={() => answer('discard')} />
            <HudButton plain label={T.keepEditing} onPress={() => answer('keep')} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

// --- The screen (store, navigation guard) -------------------------------------------------------------

export default function SwingEditMarksScreen({ navigation, route }) {
  const { swingId, checkpoint = 'impact', mode = 'edit' } = route.params ?? {};
  const [data, setData] = useState(null); // { analysis, pose, probe, marks } | 'missing'
  const [, setTick] = useState(0);
  const leaving = useRef(false);
  const closeRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [analysis, pose, probe, marks] = await Promise.all([readAnalysis(swingId), readPose(swingId), readProbe(swingId), readMarks(swingId)]);
      if (!alive) return;
      setData(analysis && pose ? {
        analysis, pose, probe, marks,
      } : 'missing');
    })();
    return () => { alive = false; };
  }, [swingId]);

  // Hardware back and swipe go through the same door as Close: the pass saves, edit asks.
  useEffect(() => navigation.addListener?.('beforeRemove', (e) => {
    if (leaving.current || !closeRef.current) return;
    e.preventDefault();
    closeRef.current(() => { leaving.current = true; navigation.dispatch(e.data.action); });
  }), [navigation]);

  // Which stills are on disk, per frame, asked once (a scrub reads it for every frame under the finger):
  // an extraction drops what it asked for so those frames are looked at again. Proxies need no disk at
  // all: pass 2 recorded which it wrote (pose.pass2.proxies).
  const known = useRef(new Map());
  useEffect(() => { known.current = new Map(); }, [swingId]);
  const stillFor = useCallback((f) => {
    const k = Math.round(f);
    if (!known.current.has(k)) known.current.set(k, getStill(swingId, k));
    return known.current.get(k);
  }, [swingId]);
  const proxies = data && data !== 'missing' ? data.pose?.pass2?.proxies ?? null : null;
  const proxyFor = useCallback((f) => getProxy(swingId, f, proxies), [swingId, proxies]);
  const needStills = useCallback(async (frames) => {
    const got = await ensureStills(swingId, frames);
    frames.forEach((f) => known.current.delete(Math.round(f)));
    setTick((t) => t + 1);
    return got;
  }, [swingId]);

  // marks.json is the source of truth (the analysis is re-derived from it): it is written first.
  const onSave = async ({ analysis, marks }) => {
    await saveMarks(swingId, marks);
    await saveAnalysis(swingId, analysis);
  };
  const onClub = (club) => { setSwingClub(swingId, club); setLastSwingClub(club); };
  const leave = (fn) => { leaving.current = true; fn(); };

  if (!data) return <View style={s.screen} />;
  if (data === 'missing') {
    return (
      <View style={[s.screen, s.missing]}>
        <Text style={s.sheetSub}>{T.loadFailed}</Text>
        <HudButton ghost label={T.close} onPress={() => leave(() => navigation.goBack())} />
      </View>
    );
  }
  return (
    <SwingMarkCanvas
      {...data}
      mode={mode}
      initialCp={checkpoint}
      lastClub={getSwingProfile()?.lastClub ?? getSwing(swingId)?.club}
      stillFor={stillFor}
      proxyFor={proxyFor}
      needStills={needStills}
      onSave={onSave}
      onClub={onClub}
      closeRef={closeRef}
      onClose={() => leave(() => navigation.goBack())}
      onResults={() => leave(() => navigation.replace('SwingResults', { swingId }))}
    />
  );
}

const s = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: hud.bg },
  missing: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  center: { textAlign: 'center' },
  bold: { fontFamily: 'PlusJakartaSans-Bold' },
  white: { color: hud.text },
  warn: { color: HUD_WARN },
  dim: { opacity: 0.4 },

  // the video: edge to edge between the top row and the panel; overlays on the strong scrim
  video: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  dock: { position: 'absolute', left: 8, top: 64 },
  pospill: {
    position: 'absolute', left: 8, top: 8, maxWidth: '80%', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: hud.scrimStrong,
  },
  pospillText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 11, color: hud.text, fontVariant: ['tabular-nums'] },
  pospillSmall: { fontFamily: 'PlusJakartaSans-SemiBold', color: hud.textMuted },
  tag: {
    position: 'absolute', right: 10, bottom: 10, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: hud.scrimStrong,
  },
  tagText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 9, letterSpacing: 0.8, color: hud.textSoft, fontVariant: ['tabular-nums'] },
  loadingPill: {
    position: 'absolute', bottom: 10, left: 10, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: hud.scrimStrong,
  },
  loadingText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 11.5, color: hud.textSoft },

  // the panel: one fixed band in both steps
  panel: { paddingHorizontal: 12, paddingTop: 8, gap: 5, backgroundColor: hud.bg },
  steph: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stephText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 10.5, letterSpacing: 0.8, textTransform: 'uppercase', color: hud.textMuted },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 16, height: 4, borderRadius: 2, backgroundColor: hud.line },
  dotOn: { backgroundColor: hud.accent },
  act: { marginTop: 'auto' },
  markRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: hud.inset, borderWidth: 1, borderColor: hud.border,
  },
  markText: { flex: 1, fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, color: hud.text },
  mini: {
    flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 34, borderRadius: 999, paddingHorizontal: 10, backgroundColor: hud.accent,
  },
  miniGhost: { backgroundColor: hud.fill },
  miniText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12, color: hud.onAccent },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  nudge: {
    width: 40, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: hud.fill, borderWidth: 1, borderColor: hud.line,
  },
  hint: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11, color: hud.textMuted },
  toast: { fontFamily: 'PlusJakartaSans-Bold', color: hud.accent },

  btn: {
    minHeight: 48, borderRadius: 24, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: hud.accent,
  },
  btnGhost: { backgroundColor: hud.fill, borderWidth: 1, borderColor: hud.line },
  btnPlain: { backgroundColor: 'transparent' },
  btnSide: { flexGrow: 0 },
  btnText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 14, color: hud.onAccent, flexShrink: 1 },
  btnGhostText: { fontFamily: 'PlusJakartaSans-Bold', color: hud.text },

  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: hud.scrim },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: hud.card, borderTopWidth: 1, borderTopColor: hud.line,
    borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 8, gap: 10,
  },
  sheetTall: { maxHeight: '88%' },
  sheetBody: { gap: 10, paddingBottom: 8 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: hud.textDim, alignSelf: 'center', marginBottom: 4 },
  sheetTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, color: hud.text },
  sheetSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12.5, lineHeight: 18, color: hud.textSoft },
  finRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingVertical: 6, borderTopWidth: 1, borderTopColor: hud.line,
  },
  finP: { width: 30, fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 11, color: hud.textMuted },
  finName: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: hud.text },
  finSub: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11.5, lineHeight: 16, color: hud.textMuted },
  stc: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 9.5, letterSpacing: 0.6, textTransform: 'uppercase', color: hud.textSoft,
    borderWidth: 1, borderColor: hud.line, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, overflow: 'hidden',
  },
  stcOk: { color: hud.accent, borderColor: withAlpha(hud.accent, 0.4) },
  stcSkip: { color: HUD_WARN, borderColor: withAlpha(HUD_WARN, 0.4) },
  autoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: hud.line },
  fixLink: { minHeight: 44, justifyContent: 'center', maxWidth: '50%' },
  fixText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12, color: hud.accent },
});
