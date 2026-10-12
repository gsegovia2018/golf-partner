import React, {
  useCallback, useEffect, useMemo, useReducer, useRef, useState,
} from 'react';
import {
  View, Text, StyleSheet, Pressable, Alert, PanResponder, ScrollView, StatusBar, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import SwingOverlay, { fitRect } from '../components/swing/SwingOverlay';
import DragLoupe from '../components/swing/DragLoupe';
import MarkChapters from '../components/swing/MarkChapters';
import {
  MarkLayer, MarkDock, StopLine, FineStrip, Swatch, MARK_COLOR, FINE_REACH,
} from '../components/swing/MarkCanvasParts';
import { hud } from '../theme/tokens';
import {
  readAnalysis, readPose, readProbe, readMarks, saveAnalysis, saveMarks, getSwing, getSwingProfile,
  setSwingClub, setLastSwingClub,
} from '../store/swingStore';
import { getStill, ensureStills } from '../swing/frames';
import { cueFor } from '../swing/checkpoints';
import {
  buildDraft, recompute, draftToMarks, isDirty, patchCheckpoint, hitTest, clampPt,
  markStatus, placeMark, setHidden, confirmMark, confirmPosition, confirmMoves, restorePosition, skipPosition,
  pendingMoves, primaryAction,
} from '../swing/editMarks';
import {
  MARKED_KEYS, MARK_TOTAL, isMarkedKey, nextTodo, resumeKey, passCounts, positionStatus, markedFromMarks,
} from '../swing/markPass';
import { CLUBS, normClub } from '../swing/checks';
import { SWING_STRINGS } from '../swing/strings';

// The marking canvas (plan §6, D25, D26): design C with V2 stop guidance, fixed HUD chrome.
// Two modes. `pass`: the mark-first pass after the analysis (club sheet → six positions →
// finish sheet → Results), saved on every step and resumable. `edit`: opened from Results at a
// position, Save / Cancel. The automatic finish and the internal frames open in the same canvas
// with an "auto" pill and no chapter.

const T = SWING_STRINGS.mark;
const DRAG_FPS_MS = 50; // the live recompute follows a drag at ~20 Hz; the release always flushes
const NUDGE_COALESCE_MS = 700;
const HUD_WARN = '#e0b24d';

function histReducer(state, a) {
  switch (a.type) {
    case 'set': {
      if (a.draft === state.draft) return state;
      return { draft: a.draft, undo: a.push ? [...state.undo, state.draft].slice(-300) : state.undo };
    }
    case 'undo': {
      if (!state.undo.length) return state;
      return { draft: state.undo[state.undo.length - 1], undo: state.undo.slice(0, -1) };
    }
    default: return state;
  }
}

function HudButton({
  label, onPress, ghost, plain, icon, disabled, style, testID,
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[s.btn, ghost && s.btnGhost, plain && s.btnPlain, disabled && s.dim, style]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
    >
      {icon ? <Feather name={icon} size={16} color={ghost || plain ? hud.text : hud.onAccent} /> : null}
      <Text style={[s.btnText, (ghost || plain) && s.btnGhostText]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

// --- The canvas (props in) --------------------------------------------------------------------------

export function SwingMarkCanvas({
  analysis, pose, probe, marks, mode = 'edit', initialCp = 'impact', lastClub = 'iron',
  stillFor, needStills, onSave, onClub, closeRef, onClose, onResults, onDirtyChange,
}) {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const pass = mode === 'pass';

  const init = useRef(null);
  if (!init.current) init.current = buildDraft(analysis, pose, marks);
  const { base } = init.current;
  const startDraft = init.current.draft;
  const [hist, dispatch] = useReducer(histReducer, { draft: startDraft, undo: [] });
  const { draft } = hist;

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
  const [view, setView] = useState(startDraft.cps[firstCp].frame);
  const [active, setActive] = useState('hands');
  const [toast, setToast] = useState('');
  const [cueOpen, setCueOpen] = useState(false);
  const [dialog, setDialog] = useState(null); // { then(draft) } while the discard sheet is up
  const [fixFrom, setFixFrom] = useState(null); // 'finish': the finish frame opened from the finish sheet
  const [saving, setSaving] = useState(false);
  const [area, setArea] = useState(null);
  const [, setTick] = useState(0);
  const snap = useRef(startDraft); // the draft when the golfer arrived at this position
  const saved = useRef(startDraft); // the draft last written to disk

  const video = pose.video;
  const maxFrame = Math.max(1, (video.frameCount ?? 1) - 1);
  const handedness = analysis.handedness;
  const scored = useMemo(() => ({ ...analysis, club }), [analysis, club]);

  // --- the live analysis (hands follow the grip on a moved frame; saved with the marks) ----------
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
  const cue = cueFor(cp, handedness);
  const statusOf = (m) => markStatus(draft, base, cp, m);
  const statuses = { hands: statusOf('hands'), head: statusOf('head'), ball: cp === 'address' ? statusOf('ball') : null };
  const handsNow = d.hands ?? live.clubMarks[cp].hands;
  const headNow = d.hidden ? null : d.head;
  const ballNow = cp === 'address' ? draft.ball : null;

  // --- layout: the video takes what the strip leaves ----------------------------------------------
  const fallback = { w: Math.min(winW, 480), h: Math.round(winH * 0.42) };
  const box = area ?? fallback;
  const rect = fitRect(box.w, box.h, video.width, video.height);

  // --- stills: the shown frame and the fine strip around the position ----------------------------
  const center = snap.current.cps[cp]?.frame ?? d.frame;
  const [shown, setShown] = useState({ frame: null, uri: null });
  useEffect(() => {
    let alive = true;
    const have = stillFor(view);
    if (have) { setShown({ frame: view, uri: have }); return undefined; }
    const t = setTimeout(async () => {
      await needStills([view]);
      const uri = stillFor(view);
      if (alive && uri) setShown({ frame: view, uri });
    }, 90);
    return () => { alive = false; clearTimeout(t); };
  }, [view, stillFor, needStills]);
  useEffect(() => {
    if (phase !== 'canvas') return undefined;
    let alive = true;
    const want = [];
    for (let f = center - FINE_REACH; f <= center + FINE_REACH; f += 1) if (f >= 0 && f <= maxFrame && !stillFor(f)) want.push(f);
    if (!want.length) return undefined;
    needStills(want).then(() => { if (alive) setTick((t) => t + 1); });
    return () => { alive = false; };
  }, [phase, center, maxFrame, stillFor, needStills]);

  // --- editing --------------------------------------------------------------------------------------
  const latest = useRef({});
  latest.current = {
    cp, view, active, draft, rect, handsNow, headNow, ballNow,
  };
  const commit = useCallback((next, push = true) => dispatch({ type: 'set', draft: next, push }), []);

  /** A mark placed on a previewed frame adopts that frame (the rule the owner's lab bug taught us). */
  const adopt = (dr, key, frame) => (dr.cps[key].frame === frame ? dr : patchCheckpoint(dr, key, { frame }));

  const place = useCallback((m, pt, push) => {
    const L = latest.current;
    const from = m === 'ball' ? L.draft : adopt(L.draft, L.cp, L.view);
    commit(placeMark(from, L.cp, m, pt), push);
  }, [commit]);

  const lastDrag = useRef(0);
  const grab = useRef(null);
  const loupe = useRef(null); // D20: the magnifier follows the finger without re-rendering the canvas
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      const { locationX: x, locationY: y } = e.nativeEvent;
      const L = latest.current;
      const px = (p) => (p ? [p[0] * L.rect.w, p[1] * L.rect.h] : null);
      const hit = hitTest([x, y], { hands: px(L.handsNow), head: px(L.headNow), ball: px(L.ballNow) }, L.active);
      const norm = clampPt([x / L.rect.w, y / L.rect.h]);
      setToast('');
      if (hit) {
        setActive(hit);
        const o = hit === 'hands' ? L.handsNow : hit === 'head' ? L.headNow : L.ballNow;
        grab.current = { t: hit, o, started: false, f0: [x, y] };
        loupe.current?.show({ finger: [x, y], mark: o });
      } else if (L.active === 'ball' && L.cp !== 'address') {
        setToast(T.ballOnlyAddress);
        grab.current = null;
      } else {
        // Not on a mark: the tap places the active one there.
        place(L.active, norm, true);
        grab.current = { t: L.active, o: norm, started: true, f0: [x, y] };
        loupe.current?.show({ finger: [x, y], mark: norm });
      }
    },
    onPanResponderMove: (_e, g) => {
      const G = grab.current;
      if (!G) return;
      const { rect: r } = latest.current;
      const pt = clampPt([G.o[0] + g.dx / r.w, G.o[1] + g.dy / r.h]);
      loupe.current?.update({ finger: [G.f0[0] + g.dx, G.f0[1] + g.dy], mark: pt });
      const now = Date.now();
      if (now - lastDrag.current < DRAG_FPS_MS) return;
      lastDrag.current = now;
      place(G.t, pt, !G.started);
      G.started = true;
    },
    onPanResponderRelease: (_e, g) => {
      const G = grab.current;
      if (G && (Math.abs(g.dx) > 0 || Math.abs(g.dy) > 0)) {
        const { rect: r } = latest.current;
        place(G.t, clampPt([G.o[0] + g.dx / r.w, G.o[1] + g.dy / r.h]), !G.started);
      }
      grab.current = null;
      loupe.current?.hide();
    },
    onPanResponderTerminate: () => { grab.current = null; loupe.current?.hide(); },
  }), [place]);

  const lastNudge = useRef(0);
  const nudge = (dx, dy) => {
    const L = latest.current;
    const cur = L.active === 'hands' ? L.handsNow : L.active === 'head' ? L.headNow : L.ballNow;
    if (!cur) { setToast(L.active === 'head' ? T.placeHead : T.ballOnlyAddress); return; }
    const now = Date.now();
    const push = now - lastNudge.current > NUDGE_COALESCE_MS;
    lastNudge.current = now;
    const moved = clampPt([cur[0] + dx / video.width, cur[1] + dy / video.height]);
    place(L.active, moved, push);
    loupe.current?.flash({ mark: moved }); // a 1-px move is invisible under the finger: show it magnified
  };

  const selectMark = (m) => {
    if (m === 'ball' && cp !== 'address') { setToast(T.ballOnlyAddress); return; }
    setActive(m);
    setToast('');
  };
  const confirmActive = () => {
    commit(confirmMark(adopt(draft, cp, view), base, cp, active));
    setToast(T.confirmed(T.names[active], view));
  };
  const toggleHidden = () => {
    const on = !d.hidden;
    commit(setHidden(adopt(draft, cp, view), cp, on));
    if (!on && !d.head) { setActive('head'); setToast(T.placeHead); } else setToast(on ? T.hiddenToast : '');
  };
  const preview = (f) => setView(Math.min(maxFrame, Math.max(0, Math.round(f))));
  const undo = () => {
    const prev = hist.undo[hist.undo.length - 1];
    if (!prev) return;
    dispatch({ type: 'undo' });
    setView(prev.cps[cp].frame);
    setToast('');
  };

  // --- saving ---------------------------------------------------------------------------------------
  const passStateNow = useRef(markedFromMarks(marks).state);
  const persist = async (next, passState = passStateNow.current) => {
    const a = recompute({ pose, probe, analysis: scored, draft: next, base });
    if (a.error) return false;
    const m = draftToMarks({
      draft: next, base, live: a, swingId: analysis.swingId, video: { width: video.width, height: video.height, fps: video.containerFps },
      handedness, editedAt: new Date().toISOString(), passState,
    });
    setSaving(true);
    try {
      await onSave({ analysis: a, marks: m });
      saved.current = next;
      passStateNow.current = passState;
      return true;
    } catch {
      setToast(T.saveFailed);
      return false;
    } finally {
      setSaving(false);
    }
  };

  // --- moving between positions --------------------------------------------------------------------
  const enter = (key, from) => {
    snap.current = from;
    setCp(key);
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
  const goto = (key) => { if (key !== cp || fixFrom || !chapter) guard((dr) => { setFixFrom(null); enter(key, dr); }); };
  const answer = (choice) => {
    const { then } = dialog;
    setDialog(null);
    if (choice === 'keep') return;
    const next = choice === 'confirm' ? confirmMoves(draft, base, cp) : restorePosition(draft, snap.current, cp);
    commit(next);
    then(next);
  };

  const advance = (next) => {
    const key = nextTodo(next.status, cp);
    if (key) enter(key, next); else setPhase('finish');
  };
  const primary = async () => {
    const next = confirmPosition(adopt(draft, cp, view), base, cp);
    commit(next);
    if (pass && !fixFrom) {
      if (await persist(next, 'partial')) advance(next);
      return;
    }
    if (fixFrom) {
      if (await persist(next)) { setFixFrom(null); setPhase('finish'); }
      return;
    }
    if (!isDirty(next, startDraft) && club === normClub(analysis.club)) { onClose(); return; }
    if (await persist(next)) onClose();
  };
  const skip = async () => {
    const next = skipPosition(draft, snap.current, cp);
    commit(next);
    if (await persist(next, 'partial')) advance(next);
  };

  /** Close, Cancel and the hardware back. The pass keeps its progress; edit asks before dropping changes. */
  const requestClose = (proceed) => {
    if (dialog) { setDialog(null); return; }
    if (pass) {
      if (phase === 'club') { proceed(); return; }
      if (fixFrom) { guard(() => { setFixFrom(null); setPhase('finish'); }); return; }
      guard(async (dr) => {
        if (dr === saved.current || (await persist(dr))) proceed();
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
    if (await persist(draft, 'partial')) enter(resumeKey(draft.status) ?? MARKED_KEYS[0], draft);
  };
  const seeResults = async () => {
    if (await persist(draft, 'done')) onResults();
  };
  const fixFinish = () => { setFixFrom('finish'); enter('finish', draft); };

  // --- rendering ------------------------------------------------------------------------------------
  const counts = passCounts(draft.status);
  const idx = MARKED_KEYS.indexOf(cp);
  const editLike = !pass || !!fixFrom;
  const action = primaryAction(draft, base, cp, view);
  const willChange = isDirty(confirmPosition(adopt(draft, cp, view), base, cp), startDraft);
  const primaryLabel = editLike ? (willChange || fixFrom ? T.primary.editSave : T.primary.editDone)
    : action === 'use' ? T.primary.use(view) : T.primary[action];
  const pillSmall = !chapter ? T.auto : pass && !fixFrom ? `${idx + 1}/${MARK_TOTAL}` : T.edit;
  const countRight = !chapter ? T.automatic(cue?.p) : pass ? `${idx + 1} of ${MARK_TOTAL}` : T.editing;
  const bg = stillFor(draft.cps.address.frame);
  const markLine = statuses[active] === 'missing' ? T.line.missing(T.names[active]) : T.line[statuses[active]];
  const canConfirm = ['proposed', 'moved'].includes(statuses[active]);

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

  const stripW = Math.min(winW, 560) - 24;
  return (
    <View style={[s.screen, { paddingTop: insets.top }]} testID="mark-canvas">
      <StatusBar barStyle="light-content" />
      <View style={s.top}>
        <Pressable style={s.cbtn} onPress={() => requestClose(onClose)} accessibilityRole="button" accessibilityLabel={editLike ? T.cancel : T.close} testID="mark-close">
          <Feather name="x" size={22} color={hud.text} />
        </Pressable>
        <View style={[s.pill, s.flex]} accessible accessibilityLabel={`${cue?.p ? `${cue.p} ` : ''}${cue?.name ?? cp}, ${pillSmall}`}>
          <Text style={s.pillText} numberOfLines={1}>{`${cue?.p ? `${cue.p} · ` : ''}${cue?.name ?? cp}`}</Text>
          <Text style={s.pillSmall}>{pillSmall}</Text>
        </View>
        <Pressable style={[s.cbtn, !hist.undo.length && s.dim]} disabled={!hist.undo.length} onPress={undo} accessibilityRole="button" accessibilityLabel={hist.undo.length ? T.undoCount(hist.undo.length) : T.undo} testID="mark-undo">
          <Feather name="rotate-ccw" size={18} color={hud.text} />
        </Pressable>
        {pass && !fixFrom ? (
          <Pressable style={s.pill} onPress={skip} accessibilityRole="button" accessibilityLabel={T.skip} testID="mark-skip-top">
            <Text style={s.pillText}>{T.skip}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={s.video} onLayout={(e) => { const { width: w, height: h } = e.nativeEvent.layout; if (w && h) setArea({ w, h }); }}>
        <SwingOverlay width={box.w} height={box.h} video={video} uri={shown.uri} showPlanes={false} label={`${cue?.name ?? cp} still, frame ${shown.frame ?? view}`}>
          <MarkLayer
            rect={rect}
            active={active}
            marks={{
              hands: { pt: handsNow, status: statuses.hands },
              head: { pt: headNow, status: statuses.head, prior: live.clubMarks[cp].priorHead },
              ball: cp === 'address' && draft.ball ? { pt: draft.ball, status: statuses.ball } : null,
            }}
          />
          <View style={StyleSheet.absoluteFill} {...pan.panHandlers} testID="edit-touch-layer" accessibilityLabel={T.line.missing(T.names[active])} />
          <DragLoupe ref={loupe} rect={rect} uri={shown.uri} label={T.placing(T.names[active])} color={active === 'head' ? '#ffffff' : MARK_COLOR[active]} />
        </SwingOverlay>
        <MarkDock style={s.dock} active={active} statuses={statuses} ballOff={cp !== 'address'} onSelect={selectMark} />
      </View>

      <View style={[s.strip, { paddingBottom: 12 + insets.bottom }]}>
        <StopLine cue={cue} open={cueOpen} onToggle={() => setCueOpen((v) => !v)} />
        {!cueOpen ? (
          <FineStrip
            center={center}
            proposed={base.cps[cp].frame}
            frame={d.frame}
            view={view}
            maxFrame={maxFrame}
            stillFor={stillFor}
            onPreview={preview}
            before={cue?.stop?.before ?? ''}
            after={cue?.stop?.after ?? ''}
            width={stripW}
          />
        ) : null}
        <View style={s.markRow} testID="mark-row">
          <Swatch mark={active} size={14} />
          <Text style={s.markText} numberOfLines={1}>{`${T.names[active]} · ${markLine}`}</Text>
          {active === 'head' && statuses.head !== 'confirmed' ? (
            <Pressable style={[s.mini, s.miniGhost]} onPress={toggleHidden} accessibilityRole="button" accessibilityLabel={d.hidden ? T.unhide : T.hide} testID="mark-hidden">
              <Feather name="eye-off" size={13} color={hud.text} />
              <Text style={[s.miniText, s.white]}>{d.hidden ? T.unhide : T.hide}</Text>
            </Pressable>
          ) : null}
          {canConfirm ? (
            <Pressable style={s.mini} onPress={confirmActive} accessibilityRole="button" accessibilityLabel={`${T.confirm} ${T.names[active]}`} testID="mark-confirm">
              <Feather name="check" size={13} color={hud.onAccent} />
              <Text style={s.miniText}>{T.confirm}</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={s.tools}>
          {[['left', 'arrow-left', -1, 0], ['up', 'arrow-up', 0, -1], ['down', 'arrow-down', 0, 1], ['right', 'arrow-right', 1, 0]].map(([k, icon, dx, dy]) => (
            <Pressable key={k} style={s.nudge} onPress={() => nudge(dx, dy)} accessibilityRole="button" accessibilityLabel={T.nudge[k]}>
              <Feather name={icon} size={16} color={hud.textSoft} />
            </Pressable>
          ))}
          <Text style={s.toast} accessibilityLiveRegion="polite" numberOfLines={2}>{toast}</Text>
        </View>
        <MarkChapters status={draft.status} current={chapter && !fixFrom ? cp : null} onSelect={goto} right={countRight} />
        <View style={s.row}>
          {pass && !fixFrom ? (
            <HudButton ghost label={T.skip} onPress={skip} disabled={saving} style={s.btnSide} testID="mark-skip" />
          ) : (
            <HudButton ghost label={T.cancel} onPress={() => requestClose(onClose)} disabled={saving} style={s.btnSide} testID="mark-cancel" />
          )}
          <HudButton icon="check" label={saving ? T.saving : primaryLabel} onPress={primary} disabled={saving} style={s.flex} testID="mark-primary" />
        </View>
      </View>

      {dialog ? (
        <View style={StyleSheet.absoluteFill} testID="mark-discard-sheet">
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

  const stillFor = useCallback((f) => getStill(swingId, f), [swingId]);
  const needStills = useCallback(async (frames) => {
    const got = await ensureStills(swingId, frames);
    setTick((t) => t + 1);
    return got;
  }, [swingId]);

  const onSave = async ({ analysis, marks }) => {
    await saveAnalysis(swingId, analysis);
    await saveMarks(swingId, marks);
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

  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6 },
  cbtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: hud.scrim, alignItems: 'center', justifyContent: 'center' },
  pill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 36, borderRadius: 999,
    paddingHorizontal: 12, backgroundColor: hud.scrim,
  },
  pillText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12, color: hud.text, flexShrink: 1 },
  pillSmall: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: hud.textMuted },

  video: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dock: { position: 'absolute', right: 10, top: 8 },

  strip: { paddingHorizontal: 12, paddingTop: 8, gap: 8 },
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
  tools: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nudge: { width: 40, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: hud.fill },
  toast: { flex: 1, fontFamily: 'PlusJakartaSans-Bold', fontSize: 11, color: hud.accent, textAlign: 'center' },

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
  stcOk: { color: hud.accent, borderColor: 'rgba(79,174,138,0.4)' },
  stcSkip: { color: HUD_WARN, borderColor: 'rgba(224,178,77,0.4)' },
  autoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: hud.line },
  fixLink: { minHeight: 44, justifyContent: 'center', maxWidth: '50%' },
  fixText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12, color: hud.accent },
});
