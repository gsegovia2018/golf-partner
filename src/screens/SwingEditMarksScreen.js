import React, {
  useCallback, useEffect, useMemo, useReducer, useRef, useState,
} from 'react';
import {
  View, Text, StyleSheet, ScrollView, Switch, Alert, PanResponder, useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import PressableScale from '../components/ui/PressableScale';
import SwingOverlay, { fitRect } from '../components/swing/SwingOverlay';
import SwingTimeline from '../components/swing/SwingTimeline';
import SwingCheckRow from '../components/swing/SwingCheckRow';
import FrameScrubber from '../components/swing/FrameScrubber';
import DragLoupe from '../components/swing/DragLoupe';
import { useSwingTone } from '../components/swing/swingTone';
import { useTheme } from '../theme/ThemeContext';
import {
  readAnalysis, readPose, readProbe, readMarks, saveAnalysis, saveMarks,
} from '../store/swingStore';
import { getStill, ensureStills } from '../swing/frames';
import { poseAtFrame } from '../swing/poseAt';
import { highlightFor, valueText } from '../swing/highlights';
import { worstByCheckpoint, unplacedCheckpoint, CHECK_KEY } from '../swing/checkpointChecks';
import { CHECKPOINT_KEYS } from '../swing/phases';
import { cueFor, HOW_TO_MARK, timelineStep } from '../swing/checkpoints';
import {
  buildDraft, recompute, draftToMarks, isDirty, resetCheckpoint, patchCheckpoint, hitTest, clampPt,
  liveChecks, pillCheck, frameOfKey,
} from '../swing/editMarks';
import { SWING_STRINGS } from '../swing/strings';

const T = SWING_STRINGS.edit;
const R = SWING_STRINGS.results;
const DRAG_FPS_MS = 50; // the live recompute follows a drag at ~20 Hz; the release always flushes
const NUDGE_COALESCE_MS = 700;
const BALL_R = 0.012;

// --- Undoable draft ----------------------------------------------------------------------------

function histReducer(state, a) {
  switch (a.type) {
    case 'edit': {
      const draft = a.fn(state.draft);
      if (draft === state.draft) return state;
      return { draft, undo: a.push ? [...state.undo, state.draft].slice(-300) : state.undo };
    }
    case 'undo': {
      if (!state.undo.length) return state;
      return { draft: state.undo[state.undo.length - 1], undo: state.undo.slice(0, -1) };
    }
    default: return state;
  }
}

// --- The editor (props in) -----------------------------------------------------------------------

export function SwingEditMarksEditor({
  analysis, pose, probe, marks, initialCp = 'impact', stillFor, ensureStill, onDirtyChange, onBack, onSave, saving = false,
}) {
  const { theme } = useTheme();
  const tone = useSwingTone();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { width: winW, height: winH } = useWindowDimensions();

  const init = useRef(null);
  if (!init.current) init.current = buildDraft(analysis, pose, marks);
  const { base } = init.current;
  const [hist, dispatch] = useReducer(histReducer, { draft: init.current.draft, undo: [] });
  const { draft } = hist;
  const startDraft = init.current.draft;

  const video = pose.video;
  const maxFrame = Math.max(1, (video.frameCount ?? 1) - 1);
  const [cp, setCp] = useState(initialCp);
  const [view, setView] = useState(draft.cps[initialCp].frame);
  const [target, setTarget] = useState('hands');
  const [toast, setToast] = useState('');
  const [howTo, setHowTo] = useState(true);
  const [scrollOn, setScrollOn] = useState(true);
  const [shown, setShown] = useState({ frame: null, uri: null });

  // --- the live analysis -------------------------------------------------------------------------
  const lastGood = useRef(null);
  const live = useMemo(() => {
    const a = recompute({ pose, probe, analysis, draft, base });
    if (a.error) return lastGood.current ?? analysis;
    lastGood.current = a;
    return a;
  }, [pose, probe, analysis, draft, base]);

  const d = draft.cps[cp];
  const liveCp = live.clubMarks[cp];
  const frameNow = d.frame;
  const handsNow = d.hands ?? liveCp.hands;
  const headNow = d.hidden ? null : d.head;
  const touchedHead = d.hidden !== base.cps[cp].hidden || JSON.stringify(d.head) !== JSON.stringify(base.cps[cp].head);
  const club = {
    hands: handsNow,
    head: headNow,
    hidden: d.hidden,
    source: touchedHead ? 'user' : liveCp.source,
    priorHead: !headNow && !d.hidden ? liveCp.priorHead : undefined,
  };
  const cue = cueFor(cp, analysis.handedness);
  const name = cue?.name ?? cp;
  const dirty = isDirty(draft, startDraft);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- layout --------------------------------------------------------------------------------------
  const boxW = Math.min(winW, 480) - 40;
  const boxH = Math.min(boxW * (video.height / video.width), winH * 0.5);
  const rect = fitRect(boxW, boxH, video.width, video.height);

  // --- the picture on screen -----------------------------------------------------------------------
  // Keep the last still while the next one is extracted: no blank flash while scrubbing.
  useEffect(() => {
    let alive = true;
    const have = stillFor(view);
    if (have) { setShown({ frame: view, uri: have }); return undefined; }
    const t = setTimeout(async () => {
      const uri = await ensureStill?.(view);
      if (alive && uri) setShown({ frame: view, uri });
    }, 90);
    return () => { alive = false; clearTimeout(t); };
  }, [view, stillFor, ensureStill]);

  // --- editing -------------------------------------------------------------------------------------
  const latest = useRef({});
  latest.current = { cp, view, target, draft, rect, handsNow, headNow, ballOk: cp === 'address' };

  const edit = useCallback((fn, push = true) => dispatch({ type: 'edit', fn, push }), []);

  /** A mark placed on a previewed frame adopts that frame (the rule the owner's lab bug taught us). */
  const adopt = useCallback((dr, key, frame) => {
    if (dr.cps[key].frame === frame) return dr;
    setToast(T.frameSet(cueFor(key, analysis.handedness)?.name ?? key, frame));
    return patchCheckpoint(dr, key, { frame });
  }, [analysis.handedness]);

  const place = useCallback((t, n, push) => {
    const { cp: key, view: f } = latest.current;
    edit((dr) => {
      if (t === 'ball') return { ...dr, ball: [n[0], n[1], dr.ball?.[2] ?? BALL_R] };
      const a = adopt(dr, key, f);
      return patchCheckpoint(a, key, t === 'hands' ? { hands: n } : { head: n, hidden: false });
    }, push);
  }, [edit, adopt]);

  const lastDrag = useRef(0);
  const grab = useRef(null);
  const loupe = useRef(null); // D20: the magnifier follows the finger without re-rendering the editor
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      const { locationX: x, locationY: y } = e.nativeEvent;
      const L = latest.current;
      const px = (p) => (p ? [p[0] * L.rect.w, p[1] * L.rect.h] : null);
      const ball = L.ballOk && L.draft.ball ? L.draft.ball : null;
      const hit = hitTest([x, y], { hands: px(L.handsNow), head: px(L.headNow), ball: px(ball) }, L.target);
      const norm = [x / L.rect.w, y / L.rect.h];
      setScrollOn(false);
      if (hit) {
        setTarget(hit);
        const o = hit === 'hands' ? L.handsNow : hit === 'head' ? L.headNow : ball;
        grab.current = { t: hit, o, started: false, f0: [x, y] };
        loupe.current?.show({ finger: [x, y], mark: o });
      } else if (L.target === 'ball' && !L.ballOk) {
        setToast(T.ballOnlyAddress);
        grab.current = null;
      } else {
        // Not on a handle: the tap places the active target there.
        place(L.target, clampPt(norm), true);
        grab.current = { t: L.target, o: clampPt(norm), started: true, f0: [x, y] };
        loupe.current?.show({ finger: [x, y], mark: clampPt(norm) });
      }
    },
    onPanResponderMove: (_e, g) => {
      const G = grab.current;
      if (!G) return;
      const { rect: lr } = latest.current;
      loupe.current?.update({
        finger: [G.f0[0] + g.dx, G.f0[1] + g.dy],
        mark: clampPt([G.o[0] + g.dx / lr.w, G.o[1] + g.dy / lr.h]),
      });
      const now = Date.now();
      if (now - lastDrag.current < DRAG_FPS_MS) return;
      lastDrag.current = now;
      const { rect: r } = latest.current;
      place(G.t, clampPt([G.o[0] + g.dx / r.w, G.o[1] + g.dy / r.h]), !G.started);
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
      setScrollOn(true);
    },
    onPanResponderTerminate: () => { grab.current = null; loupe.current?.hide(); setScrollOn(true); },
  }), [place]);

  const lastNudge = useRef(0);
  const nudge = (dx, dy) => {
    const L = latest.current;
    const cur = L.target === 'hands' ? L.handsNow : L.target === 'head' ? L.headNow : (L.ballOk ? L.draft.ball : null);
    if (!cur) { setToast(L.target === 'head' ? T.placeFirst : T.ballOnlyAddress); return; }
    const now = Date.now();
    const push = now - lastNudge.current > NUDGE_COALESCE_MS;
    lastNudge.current = now;
    const moved = clampPt([cur[0] + dx / video.width, cur[1] + dy / video.height]);
    place(L.target, moved, push);
    loupe.current?.flash({ mark: moved }); // a 1-px move is invisible under the finger: show it magnified

  };

  const selectCp = (k) => {
    setCp(k);
    setView(draft.cps[k].frame);
    if (target === 'ball' && k !== 'address') setTarget('hands');
    setToast('');
  };
  const preview = (f) => setView(Math.min(maxFrame, Math.max(0, Math.round(f))));
  const setFrame = () => { edit((dr) => patchCheckpoint(dr, cp, { frame: view })); setToast(T.frameSet(name, view)); };
  const toggleHidden = (on) => {
    edit((dr) => patchCheckpoint(adopt(dr, cp, view), cp, { hidden: on }));
    if (!on && !d.head) { setTarget('head'); setToast(T.placeFirst); }
  };
  const undo = () => {
    const prev = hist.undo[hist.undo.length - 1];
    if (!prev) return;
    dispatch({ type: 'undo' });
    setView(prev.cps[cp].frame);
    setToast('');
  };
  const reset = () => {
    edit((dr) => resetCheckpoint(dr, base, cp));
    setView(base.cps[cp].frame);
    setToast('');
  };
  const save = () => {
    const marksOut = draftToMarks({
      draft, base, live, swingId: analysis.swingId, video: { width: video.width, height: video.height, fps: video.containerFps },
      handedness: analysis.handedness, editedAt: new Date().toISOString(),
    });
    onSave?.({ analysis: live, marks: marksOut });
  };

  // --- derived for rendering --------------------------------------------------------------------
  const poseNow = poseAtFrame(pose, view);
  const pill = pillCheck(cp, live.checks);
  const rows = liveChecks(live.checks);
  const ballShown = CHECKPOINT_KEYS.indexOf(timelineStep(cp)) <= CHECKPOINT_KEYS.indexOf('impact') && draft.ball ? draft.ball : null;
  const selectedCheck = pill && (target === 'head' || cp !== 'address') ? pill : null;
  const highlight = useMemo(() => (selectedCheck ? highlightFor(selectedCheck, {
    analysis: live, poseAt: (f) => poseAtFrame(pose, f), frameOf: (k) => frameOfKey(live, k),
  }) : []), [selectedCheck, live, pose]);
  const ticks = [];
  CHECKPOINT_KEYS.forEach((k, i) => {
    const moved = draft.cps[k].frame !== base.cps[k].frame;
    if (moved) ticks.push({ frame: base.cps[k].frame, n: i + 1, ghost: true });
    ticks.push({ frame: draft.cps[k].frame, n: i + 1, selected: timelineStep(cp) === k });
  });
  const tSec = (view / live.fps.capture).toFixed(3);
  const frameLine = `frame ${view} · ${tSec} s${view !== frameNow ? ' (preview)' : ''}`;
  const segs = [['hands', T.hands], ['head', T.clubhead], ['ball', T.ball]];
  const pad = [['left', 'arrow-left', -1, 0], ['up', 'arrow-up', 0, -1], ['down', 'arrow-down', 0, 1], ['right', 'arrow-right', 1, 0]];

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton icon="chevron-left" accessibilityLabel={R.back} onPress={onBack} />
        <Text style={s.headerTitle}>{T.title}</Text>
        <View style={s.headerRight}>
          <IconButton icon="rotate-ccw" accessibilityLabel={hist.undo.length ? T.undoCount(hist.undo.length) : T.undo} disabled={!hist.undo.length} onPress={undo} style={!hist.undo.length && s.off} />
          <PressableScale style={[s.saveBtn, (!dirty || saving) && s.off]} disabled={!dirty || saving} onPress={save} accessibilityRole="button" accessibilityLabel={T.save}>
            <Text style={s.saveText}>{saving ? T.saving : T.save}</Text>
          </PressableScale>
        </View>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content} scrollEnabled={scrollOn}>
        <View style={s.stillWrap}>
          <SwingOverlay
            width={boxW}
            height={boxH}
            video={video}
            uri={shown.uri}
            pose={poseNow}
            club={club}
            ball={ballShown}
            reference={live.reference}
            highlight={highlight}
            edit
            label={`${name} still, frame ${shown.frame ?? view}`}
          >
            <View style={StyleSheet.absoluteFill} {...pan.panHandlers} testID="edit-touch-layer" />
            <DragLoupe ref={loupe} rect={rect} uri={shown.uri} />
          </SwingOverlay>
          {pill ? (
            <View style={s.pill} pointerEvents="none" accessibilityLiveRegion="polite">
              <View style={[s.pillDot, { backgroundColor: tone[pill.status] }]} />
              <Text style={s.pillText}>
                {pill.status === 'unknown' ? pill.text : `${pill.label} ${valueText(pill)}`}
              </Text>
            </View>
          ) : null}
        </View>
        {toast ? <Text style={s.toast} accessibilityLiveRegion="polite">{toast}</Text> : null}

        <SwingTimeline
          current={timelineStep(cp)}
          title={name}
          worst={worstByCheckpoint(live.checks)}
          onSelect={selectCp}
          frameLine={frameLine}
          onPrev={() => preview(view - 1)}
          onNext={() => preview(view + 1)}
          canPrev={view > 0}
          canNext={view < maxFrame}
        />

        <View style={s.card}>
          <FrameScrubber
            value={view}
            max={maxFrame}
            onChange={preview}
            ticks={ticks}
            onSetFrame={setFrame}
            setLabel={view === frameNow ? T.onThisFrame(name) : T.setFrame(name, view)}
            setDisabled={view === frameNow}
          />
        </View>

        {cue ? (
          <View style={s.card} accessibilityLabel={`${cue.name} ${cue.p}`}>
            <View style={s.cueHead}>
              <Text style={s.cueTitle}>{cue.name}</Text>
              {cue.p ? <Text style={s.cueP}>{cue.p}</Text> : null}
            </View>
            <Text style={s.cueText}>{cue.what}</Text>
            <Text style={s.cueText}><Text style={s.bold}>{T.cueStop}</Text>{cue.stopWhen}</Text>
            <Text style={s.cueText}><Text style={s.bold}>{T.cueMark}</Text>{cue.markTips}</Text>
          </View>
        ) : null}

        <View style={s.card}>
          <Text style={s.overline}>{T.whatToMove}</Text>
          <View style={s.segs}>
            {segs.map(([k, label]) => {
              const off = k === 'ball' && cp !== 'address';
              return (
                <PressableScale
                  key={k}
                  style={[s.seg, target === k && s.segOn, off && s.segOff]}
                  disabled={off}
                  onPress={() => setTarget(k)}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: target === k, disabled: off }}
                >
                  <Text style={[s.segText, target === k && s.segTextOn]}>{label}</Text>
                </PressableScale>
              );
            })}
          </View>
          <Text style={s.hint}>{target === 'ball' && cp !== 'address' ? T.ballOnlyAddress : T.dragHint}</Text>
          <View style={s.pad}>
            {pad.map(([k, icon, dx, dy]) => (
              <PressableScale key={k} style={s.padBtn} onPress={() => nudge(dx, dy)} accessibilityRole="button" accessibilityLabel={T.nudge[k]}>
                <Feather name={icon} size={20} color={theme.text.primary} />
              </PressableScale>
            ))}
          </View>
          <View style={s.hiddenRow}>
            <View style={s.hiddenText}>
              <Text style={s.hiddenTitle}>{T.hiddenTitle}</Text>
              <Text style={s.hint}>{d.hidden ? T.hiddenOn : T.hiddenOff}</Text>
            </View>
            <Switch
              value={d.hidden}
              onValueChange={toggleHidden}
              accessibilityLabel={T.hiddenTitle}
              trackColor={{ true: theme.accent.primary, false: theme.border.default }}
            />
          </View>
          <PressableScale style={s.resetBtn} onPress={reset} accessibilityRole="button" accessibilityLabel={T.reset}>
            <Text style={s.resetText}>{T.reset}</Text>
          </PressableScale>
        </View>

        <View style={s.card} accessibilityLiveRegion="polite">
          <Text style={s.overline}>{T.live}</Text>
          {rows.map((c) => (
            <SwingCheckRow
              key={CHECK_KEY(c)}
              check={c}
              showText={false}
              onPlace={selectCp}
              placeAt={unplacedCheckpoint(c, live.clubMarks)}
            />
          ))}
        </View>

        <View style={s.card}>
          <PressableScale onPress={() => setHowTo((v) => !v)} style={s.howHead} accessibilityRole="button" accessibilityLabel={T.howTo} accessibilityState={{ expanded: howTo }}>
            <Text style={s.overline}>{T.howTo}</Text>
            <Feather name={howTo ? 'chevron-up' : 'chevron-down'} size={18} color={theme.text.secondary} />
          </PressableScale>
          {howTo ? HOW_TO_MARK.map(([k, v]) => (
            <Text key={k} style={s.cueText}><Text style={s.bold}>{`${k}: `}</Text>{v}</Text>
          )) : null}
        </View>
        <Text style={s.hint}>{T.liveHint}</Text>
      </ScrollView>
    </ScreenContainer>
  );
}

// --- The screen (store, navigation guard) ---------------------------------------------------------

export default function SwingEditMarksScreen({ navigation, route }) {
  const { swingId, checkpoint } = route.params ?? {};
  const [data, setData] = useState(null); // { analysis, pose, probe, marks } | 'missing'
  const [saving, setSaving] = useState(false);
  const dirty = useRef(false);
  const saved = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [analysis, pose, probe, marks] = await Promise.all([readAnalysis(swingId), readPose(swingId), readProbe(swingId), readMarks(swingId)]);
      if (!alive) return;
      setData(analysis && pose ? { analysis, pose, probe, marks } : 'missing');
    })();
    return () => { alive = false; };
  }, [swingId]);

  // Unsaved changes: ask before leaving (header back, hardware back, swipe back).
  useEffect(() => navigation.addListener?.('beforeRemove', (e) => {
    if (!dirty.current || saved.current) return;
    e.preventDefault();
    Alert.alert(T.discardTitle, T.discardBody, [
      { text: T.keep, style: 'cancel' },
      { text: T.discard, style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
    ]);
  }), [navigation]);

  const stillFor = useCallback((f) => getStill(swingId, f), [swingId]);
  const ensureStill = useCallback(async (f) => {
    const got = await ensureStills(swingId, [f]);
    return got[Math.round(f)] ?? null;
  }, [swingId]);

  const onSave = async ({ analysis, marks }) => {
    setSaving(true);
    try {
      await saveAnalysis(swingId, analysis);
      await saveMarks(swingId, marks);
      saved.current = true;
      navigation.goBack();
    } catch {
      setSaving(false);
      Alert.alert(T.saveFailed);
    }
  };

  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (!data) return <ScreenContainer style={s.screen} edges={['top', 'bottom']} />;
  if (data === 'missing') {
    return (
      <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
        <View style={s.header}>
          <IconButton icon="chevron-left" accessibilityLabel={R.back} onPress={() => navigation.goBack()} />
          <Text style={s.headerTitle}>{T.title}</Text>
          <View style={s.headerSpacer} />
        </View>
        <Text style={[s.hint, s.pad20]}>{T.loadFailed}</Text>
      </ScreenContainer>
    );
  }
  return (
    <SwingEditMarksEditor
      {...data}
      initialCp={checkpoint}
      stillFor={stillFor}
      ensureStill={ensureStill}
      onDirtyChange={(v) => { dirty.current = v; }}
      onBack={() => navigation.goBack()}
      onSave={onSave}
      saving={saving}
    />
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, gap: 8 },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerSpacer: { width: 36, height: 36 },
  saveBtn: { minHeight: 44, minWidth: 56, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 22, backgroundColor: theme.accent.primary },
  saveText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.inverse },
  off: { opacity: 0.4 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 28, gap: 12 },
  pad20: { paddingHorizontal: 20 },

  stillWrap: { borderRadius: theme.radius.lg, overflow: 'hidden', alignItems: 'center', backgroundColor: '#0a0d10' },
  pill: {
    position: 'absolute', left: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '86%',
    backgroundColor: 'rgba(10,13,16,0.82)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 11, color: '#ffffff', flexShrink: 1 },
  toast: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12.5, color: theme.accent.primary },

  card: {
    backgroundColor: theme.bg.card, borderRadius: theme.radius.lg, padding: 12, gap: 8,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
  },
  overline: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: theme.text.secondary },
  hint: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11.5, lineHeight: 16, color: theme.text.secondary },
  bold: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary },
  cueHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cueTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 18, color: theme.text.primary },
  cueP: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 11, color: theme.accent.primary, borderWidth: 1, borderColor: theme.accent.primary, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  cueText: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12.5, lineHeight: 18, color: theme.text.secondary },
  howHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },

  segs: { flexDirection: 'row', gap: 8 },
  seg: { flex: 1, minHeight: 44, borderRadius: 999, borderWidth: 1.5, borderColor: theme.border.default, backgroundColor: theme.bg.card, alignItems: 'center', justifyContent: 'center' },
  segOn: { borderColor: theme.accent.primary, backgroundColor: theme.accent.light },
  segOff: { opacity: 0.45 },
  segText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: theme.text.secondary },
  segTextOn: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary },
  pad: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  padBtn: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg.secondary, borderWidth: 1, borderColor: theme.border.default },
  hiddenRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border.default, paddingTop: 8 },
  hiddenText: { flex: 1, gap: 2 },
  hiddenTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13.5, color: theme.text.primary },
  resetBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  resetText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13.5, color: theme.accent.primary },
});
