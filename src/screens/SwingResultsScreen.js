import React, {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Modal, Alert, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import PressableScale from '../components/ui/PressableScale';
import BottomSheet from '../components/BottomSheet';
import SwingSummary from '../components/swing/SwingSummary';
import PositionBar from '../components/swing/PositionBar';
import StepStill from '../components/swing/StepStill';
import PlacedBanner from '../components/swing/PlacedBanner';
import SwingCheckRow from '../components/swing/SwingCheckRow';
import SwingFixPeek from '../components/swing/SwingFixPeek';
import SwingFixSheet from '../components/swing/SwingFixSheet';
import SwingProcessing from '../components/swing/SwingProcessing';
import { useSwingTone, focusTone } from '../components/swing/swingTone';
import { useTheme } from '../theme/ThemeContext';
import {
  subscribeSwings, getSwingsVersion, getSwing, hydrateSwings, renameSwing, readAnalysis, readPose,
  markSwingFailed, deleteSwing, swingVideoUri, readMarks, readProbe, saveMarks, saveAnalysis, getSwingProfile, setPracticeOpen,
} from '../store/swingStore';
import { runAnalysis } from '../swing/runAnalysis';
import { MARK_TOTAL, markedFromMarks, passDone } from '../swing/markPass';
import { shareSwingExport } from '../swing/shareExport';
import { nativeApi, getStill, ensureStills } from '../swing/frames';
import { poseAtFrame } from '../swing/poseAt';
import { highlightFor, keyLinesAt } from '../swing/highlights';
import { unplacedCheckpoint, CHECK_KEY, frameOfKey } from '../swing/checkpointChecks';
import {
  EXTRAS, stepRows, stepStatuses, pendingSteps, mainSoFar, openingStep, tagOf, neighbour, defaultRow, clubheadOpen,
} from '../swing/resultsSteps';
import { placeHead } from '../swing/placeHead';
import { CHECKPOINT_KEYS } from '../swing/phases';
import { drillsForMain, progression } from '../swing/drills';
import { fixesFor, fixCopy, drillForCheck } from '../swing/fixes';
import { SWING_STRINGS } from '../swing/strings';
import { useT } from '../i18n';

const T = SWING_STRINGS.results;
const H = SWING_STRINGS.home; // the delete confirm is shared with the swings list
const MAX_NUDGE = 2; // stills exist for the checkpoint frame +-2 (D4)

// --- Sections --------------------------------------------------------------------------------

/** D24: a 60-minute range session, collapsible; the main fault's first drill fills the Block slot. */
function PracticePlan({
  s, theme, open, onToggle, drill,
}) {
  const P = T.practice;
  return (
    <View style={s.plan} testID="results-practice">
      <PressableScale
        style={s.practiceHead}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={open ? P.hide : P.show}
        accessibilityState={{ expanded: open }}
      >
        <Text style={[s.overlineDark, s.flex]}>{P.title}</Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={theme.text.secondary} />
      </PressableScale>
      {open ? P.blocks.map((b) => (
        <View key={b.key} style={s.practiceRow}>
          <Text style={s.practiceTime}>{b.time}</Text>
          <View style={s.flex}>
            <Text style={s.drillTitle}>{b.name}</Text>
            <Text style={s.drillBody}>{b.body}</Text>
            {b.key === 'block' ? <Text style={s.drillPass}>{drill ? P.drillIn(drill.title) : P.noDrill}</Text> : null}
          </View>
        </View>
      )) : null}
    </View>
  );
}

function DeleteLink({ s, onPress }) {
  return (
    <PressableScale style={s.deleteLink} onPress={onPress} accessibilityRole="button" accessibilityLabel={T.deleteSwing} testID="results-delete-link">
      <Text style={s.deleteLinkText}>{T.deleteSwing}</Text>
    </PressableScale>
  );
}

function ErrorSlot({ s, error, onPrimary, primaryLabel, onSecondary, secondaryLabel }) {
  const tone = useSwingTone();
  return (
    <>
      <View style={s.errorSlot} accessibilityRole="alert" accessible accessibilityLabel={SWING_STRINGS.errors[error] ?? SWING_STRINGS.errors.failed}>
        <Feather name="alert-circle" size={26} color={tone.red} />
        <Text style={s.errorTitle}>{T.errorTitle[error] ?? T.errorTitle.failed}</Text>
        <Text style={s.errorBody}>{T.errorBody[error] ?? T.errorBody.failed}</Text>
      </View>
      <View style={s.btnRow}>
        {onPrimary ? (
          <PressableScale style={[s.btn, s.btnPrimary, s.flex]} onPress={onPrimary} accessibilityRole="button" accessibilityLabel={primaryLabel}>
            <Text style={s.btnPrimaryText}>{primaryLabel}</Text>
          </PressableScale>
        ) : null}
        <PressableScale style={[s.btn, s.btnSecondary, s.flex]} onPress={onSecondary} accessibilityRole="button" accessibilityLabel={secondaryLabel}>
          <Text style={s.btnSecondaryText}>{secondaryLabel}</Text>
        </PressableScale>
      </View>
    </>
  );
}

function Player({ visible, uri, onClose, s }) {
  // The player is created only while the modal is open, so a results screen costs no decoder.
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} transparent={false}>
      {visible ? <PlayerBody uri={uri} onClose={onClose} s={s} /> : null}
    </Modal>
  );
}
function PlayerBody({ uri, onClose, s }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.playbackRate = 0.125; p.play(); });
  return (
    <View style={s.playerWrap}>
      <VideoView player={player} style={s.player} contentFit="contain" nativeControls />
      <PressableScale style={s.playerClose} onPress={onClose} accessibilityRole="button" accessibilityLabel={T.close}>
        <Feather name="x" size={22} color="#ffffff" />
      </PressableScale>
    </View>
  );
}

// --- The view (props in, pixels out) ----------------------------------------------------------

/** The ± frame nudge under the still (stills exist for the checkpoint frame ±2, D4). */
function FrameNudge({
  s, theme, frameLine, canPrev, canNext, onPrev, onNext,
}) {
  return (
    <View style={s.nudgeRow} testID="results-nudge">
      <PressableScale style={[s.nudge, !canPrev && s.nudgeOff]} disabled={!canPrev} onPress={onPrev} accessibilityRole="button" accessibilityLabel={T.prevFrame}>
        <Feather name="chevron-left" size={18} color={theme.text.primary} />
      </PressableScale>
      <Text style={s.nudgeText} numberOfLines={1}>{frameLine}</Text>
      <PressableScale style={[s.nudge, !canNext && s.nudgeOff]} disabled={!canNext} onPress={onNext} accessibilityRole="button" accessibilityLabel={T.nextFrame}>
        <Feather name="chevron-right" size={18} color={theme.text.primary} />
      </PressableScale>
    </View>
  );
}

export function SwingResultsView({
  row, phase, analysis, pose, progress, error, stillTick = 0, stillFor, placed = null,
  onBack, onCancel, onDelete, onRetry, onRecord, onEditMarks, onRename, onPlay, onNeedStills, onExport,
  onPlaceHead, onUndoPlace,
  practiceOpen = false, onPracticeToggle,
}) {
  const { theme } = useTheme();
  const tone = useSwingTone();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { width: winW, height: winH } = useWindowDimensions();
  const boxW = Math.min(winW, 480) - 40;
  const ready = phase === 'ready' && analysis;

  const [stepState, setStepState] = useState(null); // null until the golfer moves: the screen is on its opening step
  const [placeState, setPlaceState] = useState(null); // place mode: a tap on the still puts the clubhead there
  const [off, setOff] = useState(0);
  const [selKey, setSelKey] = useState(null);
  const [allDrills, setAllDrills] = useState(false);
  const [showPlaced, setShowPlaced] = useState(true);
  const [sheet, setSheet] = useState(null); // null | 'menu' | 'rename'
  const [fixSheet, setFixSheet] = useState({ list: [], index: 0, open: false });
  const [nameDraft, setNameDraft] = useState('');
  const scroll = useRef(null);

  // Open where the owner picked: the Downswing in place mode when its clubhead is unplaced, else the main fault.
  const opening = useMemo(() => (ready ? openingStep(analysis) : null), [ready, analysis]);
  const step = stepState ?? opening?.step ?? 'address';
  const place = placeState ?? opening?.place ?? false;

  const checks = useMemo(() => analysis?.checks ?? [], [analysis]);
  const main = analysis?.main ?? null;
  const cp = step === EXTRAS ? 'finish' : step; // the frame the step shows
  const rows = useMemo(() => stepRows(checks, step), [checks, step]);
  const selected = rows.find((c) => CHECK_KEY(c) === selKey) ?? (ready ? defaultRow(checks, step, main) : null);
  const statuses = useMemo(() => (ready ? stepStatuses(analysis) : {}), [ready, analysis]);
  const pending = useMemo(() => (ready ? pendingSteps(analysis) : {}), [ready, analysis]);
  const soFar = ready ? mainSoFar(analysis) : false;

  useEffect(() => { setShowPlaced(true); }, [placed]);

  const baseFrame = ready ? frameOfKey(analysis, cp) : 0;
  const frame = baseFrame + off;
  const uri = ready ? stillFor?.(frame) ?? null : null;
  void stillTick;
  useEffect(() => { if (ready && !uri) onNeedStills?.(frame); }, [ready, uri, frame]); // eslint-disable-line react-hooks/exhaustive-deps

  const video = pose?.video ?? null;
  const boxH = video ? Math.min(boxW * (video.height / video.width), winH * 0.55) : boxW * 1.2;
  const club = ready && off === 0 ? analysis.clubMarks[cp] : null;
  const placing = place && ready && step !== EXTRAS && clubheadOpen(analysis.clubMarks, cp);
  const proposal = placing && club?.head && club.source !== 'prior' ? club.head : null;
  const ballOn = ready && CHECKPOINT_KEYS.indexOf(cp) <= CHECKPOINT_KEYS.indexOf('impact') && analysis.reference?.ball;
  const ball = ballOn ? [...analysis.reference.ball, pose?.ball?.r ?? 0.012] : null;
  const highlight = useMemo(() => (ready && selected && step !== EXTRAS ? highlightFor(selected, {
    analysis, cp, poseAt: (f) => poseAtFrame(pose, f), frameOf: (k) => frameOfKey(analysis, k),
  }) : []), [ready, selected, step, analysis, cp, pose]);
  const keyLines = useMemo(() => (ready ? keyLinesAt(cp, {
    analysis, poseAt: (f) => poseAtFrame(pose, f), frameOf: (k) => frameOfKey(analysis, k),
  }) : null), [ready, cp, analysis, pose]);
  const fixes = useMemo(() => (ready ? fixesFor(analysis) : []), [ready, analysis]);
  const focusOn = !!selected && step !== EXTRAS && (selected.status === 'red' || selected.status === 'yellow');
  const selFix = selected && (selected.status === 'red' || selected.status === 'yellow') ? fixCopy(selected) : null;
  const openFixes = (list, index) => setFixSheet({ list, index, open: true });
  const openFixFor = (check) => {
    const i = fixes.findIndex((f) => CHECK_KEY(f.check) === CHECK_KEY(check));
    if (i >= 0) openFixes(fixes, i);
    else openFixes([{ check, copy: fixCopy(check), drill: drillForCheck(check) }], 0);
  };

  const goTo = useCallback((k, { placing: p = false, row: key = null } = {}) => {
    setStepState(k); setPlaceState(p); setOff(0); setSelKey(key); setShowPlaced(false);
  }, []);
  const startPlace = (k) => goTo(k, { placing: true });
  const stepBy = (dir) => { const k = neighbour(step, dir); if (k) goTo(k); };
  const seeOnSwing = (c) => goTo(c.extra ? EXTRAS : c.position, { row: CHECK_KEY(c) });
  const tSec = ready ? (frame / analysis.fps.capture).toFixed(3) : '';
  const mainStep = main ? main.position ?? EXTRAS : null;
  const groupDrills = ready && main ? drillsForMain(main) : [];
  const shownDrills = allDrills ? groupDrills : groupDrills.slice(0, 1);
  const showPractise = ready && (!main || step === mainStep);
  const openEdit = (k, opts) => onEditMarks?.(k, opts);
  const place_ = async (pt) => {
    const ok = await onPlaceHead?.(cp, pt);
    if (ok) { setStepState(cp); setPlaceState(false); setSelKey(null); } // the same screen, re-read
  };

  // A neutral loader while a stored swing is read: no results chrome until it is ready.
  if (phase === 'loading') {
    return (
      <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
        <View style={s.header}>
          <IconButton icon="chevron-left" accessibilityLabel={T.back} onPress={onBack} />
          <View style={s.flex} />
          <View style={s.headerSpacer} />
        </View>
        <View style={s.loader} testID="results-loading" accessibilityRole="progressbar" accessibilityLabel={T.loading}>
          <ActivityIndicator color={theme.accent.primary} />
        </View>
      </ScreenContainer>
    );
  }

  const header = (
    <View style={s.header}>
      <IconButton icon="chevron-left" accessibilityLabel={T.back} onPress={onBack} />
      <Text style={s.headerTitle} numberOfLines={1}>{row?.name ?? ''}</Text>
      {phase === 'processing' ? (
        <PressableScale style={s.headerAction} onPress={onCancel} accessibilityRole="button" accessibilityLabel={T.cancelAnalysis}>
          <Text style={s.headerActionText}>{T.cancelAnalysis}</Text>
        </PressableScale>
      ) : ready ? (
        <IconButton icon="more-horizontal" accessibilityLabel={T.menu} onPress={() => setSheet('menu')} />
      ) : <View style={s.headerSpacer} />}
    </View>
  );

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      {header}
      <ScrollView ref={scroll} style={s.scroll} contentContainerStyle={s.content}>
        {phase === 'error' ? (
          <>
            <ErrorSlot
              s={s}
              error={error}
              onPrimary={error === 'cancelled' || error === 'failed' ? onRetry : error === 'update' ? null : onRecord}
              primaryLabel={error === 'cancelled' || error === 'failed' ? T.retry : T.recordAgain}
              onSecondary={onBack}
              secondaryLabel={T.backToSwings}
            />
            <DeleteLink s={s} onPress={onDelete} />
          </>
        ) : null}

        {phase === 'processing' ? (
          <>
            <SwingProcessing progress={progress} />
            <DeleteLink s={s} onPress={onDelete} />
          </>
        ) : null}

        {ready ? (
          <>
            <SwingSummary
              statuses={statuses}
              pending={pending}
              main={main}
              soFar={soFar}
              current={step}
              onSelect={(k) => goTo(k)}
              onPlace={startPlace}
              unconfirmed={MARK_TOTAL - (row?.marked?.count ?? MARK_TOTAL)}
            />
            {analysis.approximate ? (
              <View style={s.banner}>
                <Feather name="alert-triangle" size={16} color={tone.yellow} />
                <Text style={s.bannerText}>{T.approxBanner}</Text>
              </View>
            ) : null}
            {analysis.scale?.approx ? <Text style={s.hint}>{T.approxHeightBanner}</Text> : null}

            <PositionBar
              step={step}
              status={statuses[step]}
              tag={tagOf(step, main)}
              waiting={!!pending[step]}
              onPrev={() => stepBy(-1)}
              onNext={() => stepBy(1)}
            />

            <StepStill
              overlay={{
                width: boxW,
                height: boxH,
                video,
                uri,
                pose: poseAtFrame(pose, frame),
                club,
                ball,
                reference: analysis.reference,
                highlight,
                keyLines: off === 0 ? keyLines : (keyLines && { ...keyLines, extra: [] }),
                keyTone: statuses[cp] === 'red' || statuses[cp] === 'yellow' ? focusTone(statuses[cp]) : '#4fae8a',
                focus: focusOn,
                tone: focusTone(selected?.status),
                label: T.stillA11y(SWING_STRINGS.checkpoint[cp], frame),
              }}
              placing={placing}
              proposal={proposal}
              stepLabel={SWING_STRINGS.checkpoint[cp]}
              frame={frame}
              onSwipe={stepBy}
              onPlacePoint={place_}
              onConfirmProposal={() => place_(null)}
              onOpenEdit={() => openEdit(cp, { active: 'head' })}
            />
            {!placing ? (
              <FrameNudge
                s={s}
                theme={theme}
                frameLine={T.frameLine(frame, tSec, off)}
                canPrev={off > -MAX_NUDGE}
                canNext={off < MAX_NUDGE}
                onPrev={() => setOff((o) => Math.max(-MAX_NUDGE, o - 1))}
                onNext={() => setOff((o) => Math.min(MAX_NUDGE, o + 1))}
              />
            ) : null}

            {placed && showPlaced ? (
              <PlacedBanner
                name={SWING_STRINGS.checkpoint[placed.cp ?? cp]}
                mainChange={placed.mainAfter && placed.mainAfter !== placed.mainBefore ? SWING_STRINGS.fault[placed.mainAfter] ?? placed.mainAfter : null}
                failed={!!placed.failed}
                onUndo={() => { setShowPlaced(false); onUndoPlace?.(); }}
              />
            ) : null}

            <View style={s.card} testID="results-rows">
              {rows.map((c) => (
                <SwingCheckRow
                  key={CHECK_KEY(c)}
                  check={c}
                  selected={!!selected && CHECK_KEY(selected) === CHECK_KEY(c)}
                  expanded={fixCopy(c) ? !!selected && CHECK_KEY(selected) === CHECK_KEY(c) : undefined}
                  onPress={() => setSelKey(CHECK_KEY(c))}
                  onPlace={startPlace}
                  placeAt={unplacedCheckpoint(c, analysis.clubMarks)}
                />
              ))}
              {step === EXTRAS ? <Text style={s.hint}>{T.extrasHint}</Text> : null}
              {pending[step] ? <Text style={[s.hint, s.hintPad]}>{T.readWithout(SWING_STRINGS.checkpoint[step])}</Text> : null}
            </View>

            {selFix ? <View style={s.card}><SwingFixPeek copy={selFix} onOpen={() => openFixFor(selected)} /></View> : null}

            {showPractise ? (
              <View style={s.card} testID="results-practise">
                <Text style={s.overlineDark}>{T.practiseTitle}</Text>
                {groupDrills.length ? (
                  <>
                    {shownDrills.map((d) => (
                      <View key={d.id} style={s.drill}>
                        <Text style={s.drillTitle}>{d.title}</Text>
                        <Text style={s.drillBody}>{d.instruction}</Text>
                        <Text style={s.drillPass}>{T.passTarget(d.passTarget)}</Text>
                        <Text style={s.drillProgress}>{progression()}</Text>
                      </View>
                    ))}
                    {groupDrills.length > 1 ? (
                      <PressableScale onPress={() => setAllDrills((v) => !v)} accessibilityRole="button" accessibilityLabel={allDrills ? T.lessDrills : T.moreDrills(groupDrills.length - 1)}>
                        <Text style={s.link}>{allDrills ? T.lessDrills : T.moreDrills(groupDrills.length - 1)}</Text>
                      </PressableScale>
                    ) : null}
                  </>
                ) : !main && !analysis.counts.red && !analysis.counts.yellow ? (
                  <View style={s.drill}>
                    <Text style={s.drillTitle}>{T.fixes.emptyTitle}</Text>
                    <Text style={s.drillBody}>{T.fixes.emptyBody}</Text>
                  </View>
                ) : null}
                <PracticePlan s={s} theme={theme} open={practiceOpen} onToggle={onPracticeToggle} drill={groupDrills[0] ?? null} />
              </View>
            ) : null}

            <View style={s.btnStack}>
              <PressableScale style={[s.btn, s.btnPrimary]} onPress={onPlay} accessibilityRole="button" accessibilityLabel={T.play}>
                <Feather name="play" size={16} color={theme.text.inverse} />
                <Text style={s.btnPrimaryText}>{T.play}</Text>
              </PressableScale>
              <PressableScale style={[s.btn, s.btnSecondary]} onPress={() => openEdit(cp)} accessibilityRole="button" accessibilityLabel={T.editMarks}>
                <Feather name="edit-2" size={16} color={theme.text.primary} />
                <Text style={s.btnSecondaryText}>{T.editMarks}</Text>
              </PressableScale>
            </View>
          </>
        ) : null}
      </ScrollView>

      {ready ? (
        <SwingFixSheet
          visible={fixSheet.open}
          fixes={fixSheet.list}
          index={fixSheet.index}
          onIndex={(i) => setFixSheet((f) => ({ ...f, index: i }))}
          onClose={() => setFixSheet((f) => ({ ...f, open: false }))}
          onSeeOnSwing={(c) => { setFixSheet((f) => ({ ...f, open: false })); seeOnSwing(c); scroll.current?.scrollTo?.({ y: 0, animated: true }); }}
          stillFor={stillFor}
          onNeedStills={onNeedStills}
          analysis={analysis}
          pose={pose}
          width={Math.min(winW, 480) - 40}
        />
      ) : null}

      <BottomSheet visible={sheet !== null} onClose={() => setSheet(null)} sheetStyle={s.sheet}>
        {sheet === 'rename' ? (
          <>
            <Text style={s.sheetTitle}>{T.renameTitle}</Text>
            <TextInput
              style={s.input}
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder={T.renamePlaceholder}
              placeholderTextColor={theme.text.muted}
              accessibilityLabel={T.rename}
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              selectionColor={theme.accent.primary}
              maxLength={60}
              autoFocus
            />
            <PressableScale
              style={[s.btn, s.btnPrimary, !nameDraft.trim() && s.btnOff]}
              disabled={!nameDraft.trim()}
              onPress={() => { onRename?.(nameDraft); setSheet(null); }}
              accessibilityRole="button"
              accessibilityLabel={T.save}
            >
              <Text style={s.btnPrimaryText}>{T.save}</Text>
            </PressableScale>
          </>
        ) : (
          <>
            <PressableScale style={s.menuRow} onPress={() => { setNameDraft(row?.name ?? ''); setSheet('rename'); }} accessibilityRole="button" accessibilityLabel={T.rename}>
              <Feather name="type" size={18} color={theme.text.primary} />
              <Text style={s.menuText}>{T.rename}</Text>
            </PressableScale>
            <PressableScale style={s.menuRow} onPress={() => { setSheet(null); openEdit(cp); }} accessibilityRole="button" accessibilityLabel={T.editMarksMenu(T.editMarks)}>
              <Feather name="edit-2" size={18} color={theme.text.primary} />
              <Text style={s.menuText}>{T.editMarks}</Text>
            </PressableScale>
            <PressableScale style={s.menuRow} onPress={() => { setSheet(null); onExport?.(); }} accessibilityRole="button" accessibilityLabel={SWING_STRINGS.exportSwing.menu}>
              <Feather name="share" size={18} color={theme.text.primary} />
              <View style={s.flex}>
                <Text style={s.menuText}>{SWING_STRINGS.exportSwing.menu}</Text>
                <Text style={s.hint}>{SWING_STRINGS.exportSwing.hint}</Text>
              </View>
            </PressableScale>
            <PressableScale style={s.menuRow} onPress={() => { setSheet(null); onDelete?.(); }} accessibilityRole="button" accessibilityLabel={T.deleteSwing} testID="results-menu-delete">
              <Feather name="trash-2" size={18} color={tone.red} />
              <Text style={[s.menuText, { color: tone.red }]}>{T.deleteSwing}</Text>
            </PressableScale>
          </>
        )}
      </BottomSheet>
    </ScreenContainer>
  );
}


// --- The screen (store, analysis run, navigation) -----------------------------------------------

export default function SwingResultsScreen({ navigation, route }) {
  useT(); // the swing copy reads the language as it renders: re-render when it changes
  const swingId = route.params?.swingId;
  useSyncExternalStore(subscribeSwings, getSwingsVersion);
  const row = getSwing(swingId);

  const [phase, setPhase] = useState('loading'); // loading | processing | ready | error
  const [data, setData] = useState({ analysis: null, pose: null, marks: null });
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [stillTick, setStillTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [practiceOpen, setPracticeOpenState] = useState(() => !!getSwingProfile()?.practiceOpen);
  const [placed, setPlaced] = useState(null); // the last head placed here: { cp, mainBefore, mainAfter, prev } | { failed }
  const dataRef = useRef(data);
  dataRef.current = data;
  const alive = useRef(true);
  const cancelled = useRef(false);
  const started = useRef(false);
  const poseRef = useRef(null);

  const load = useCallback(async () => {
    const analysis = await readAnalysis(swingId);
    if (!analysis) return false;
    if (!poseRef.current) poseRef.current = await readPose(swingId);
    const marks = await readMarks(swingId);
    if (alive.current) setData({ analysis, pose: poseRef.current, marks });
    return true;
  }, [swingId]);

  // D26: Results come after the marking pass, never before. An unfinished pass resumes there.
  const toMarking = useCallback(() => navigation.replace('SwingEditMarks', { swingId, mode: 'pass' }), [navigation, swingId]);

  const start = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    cancelled.current = false;
    setError(null);
    setProgress({ stage: 'reading' });
    setPhase('processing');
    const res = await runAnalysis(swingId, {
      onProgress: (p) => { if (alive.current) setProgress(p); },
      isCancelled: () => cancelled.current,
    });
    started.current = false;
    if (res.cancelled) {
      await markSwingFailed(swingId, 'cancelled');
      if (alive.current) { setError('cancelled'); setPhase('error'); }
    } else if (res.error) {
      if (alive.current) { setError(res.error); setPhase('error'); }
    } else if (alive.current) {
      toMarking(); // the stills and the address / impact seeds are in: the golfer marks next
    }
  }, [swingId, toMarking]);

  useEffect(() => {
    alive.current = true;
    (async () => {
      if (!getSwing(swingId)) await hydrateSwings();
      const r = getSwing(swingId);
      if (!r) { setError('failed'); setPhase('error'); return; }
      if (r.status === 'ready') {
        if (!passDone(r.marked ?? markedFromMarks(await readMarks(swingId)))) { if (alive.current) toMarking(); return; }
        if (await load()) { if (alive.current) setPhase('ready'); } else { setError('failed'); setPhase('error'); }
      } else if (r.status === 'error') {
        setError(r.error || 'failed');
        setPhase('error');
      } else {
        start();
      }
    })();
    return () => {
      alive.current = false;
      cancelled.current = true;
      // Leaving mid-run stops pass 2 too: a late save must never land after the golfer moved on.
      if (started.current) { try { nativeApi()?.cancelAnalysis?.(); } catch { /* best effort */ } }
    };
  }, [swingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Coming back from Edit marks: the analysis was recomputed there.
  useEffect(() => navigation.addListener?.('focus', () => {
    if (phase === 'ready' && !started.current) { poseRef.current = null; load(); }
  }), [navigation, phase, load]);

  const onNeedStills = useCallback(async (frame) => {
    const got = await ensureStills(swingId, [frame - 2, frame - 1, frame, frame + 1, frame + 2]);
    if (alive.current && Object.values(got).some(Boolean)) setStillTick((t) => t + 1);
  }, [swingId]);

  // Design D: a tap on the still places (or confirms) the clubhead with the canvas's own model, saves the marks
  // and the analysis, and the screen re-reads; Undo writes back what was there.
  const onPlaceHead = useCallback(async (cp, pt) => {
    const cur = dataRef.current;
    try {
      const out = placeHead({
        analysis: cur.analysis, pose: cur.pose, probe: await readProbe(swingId), marks: cur.marks,
      }, cp, pt);
      if (!out) throw new Error('place');
      await saveMarks(swingId, out.marks);
      await saveAnalysis(swingId, out.analysis);
      if (!alive.current) return true;
      setData({ analysis: out.analysis, pose: cur.pose, marks: out.marks });
      setPlaced({
        cp, mainBefore: cur.analysis.main?.fault ?? null, mainAfter: out.analysis.main?.fault ?? null, prev: { analysis: cur.analysis, marks: cur.marks },
      });
      return true;
    } catch {
      if (alive.current) setPlaced({ failed: true });
      return false;
    }
  }, [swingId]);
  const onUndoPlace = useCallback(async () => {
    const prev = placed?.prev;
    setPlaced(null);
    if (!prev) return;
    try {
      if (prev.marks) await saveMarks(swingId, prev.marks);
      await saveAnalysis(swingId, prev.analysis);
      if (alive.current) setData({ analysis: prev.analysis, pose: dataRef.current.pose, marks: prev.marks });
    } catch { /* the golfer still has the placed head */ }
  }, [swingId, placed]);

  const onCancel = () => {
    cancelled.current = true;
    try { nativeApi()?.cancelAnalysis?.(); } catch { /* best effort */ }
    navigation.goBack();
  };
  const onRetry = () => { started.current = false; start(); };
  // Same confirm as the swings list. A run in flight is stopped (JS and pass 2) before the files go.
  const onDelete = () => {
    Alert.alert(H.deleteTitle, H.deleteBody, [
      { text: H.cancel, style: 'cancel' },
      {
        text: H.delete,
        style: 'destructive',
        onPress: async () => {
          cancelled.current = true;
          try { nativeApi()?.cancelAnalysis?.(); } catch { /* best effort */ }
          await deleteSwing(swingId);
          navigation.goBack();
        },
      },
    ]);
  };
  const onExport = async () => {
    try {
      if ((await shareSwingExport(swingId)) === 'unavailable') Alert.alert(SWING_STRINGS.exportSwing.unavailable);
    } catch {
      Alert.alert(SWING_STRINGS.exportSwing.failed);
    }
  };

  return (
    <>
      <SwingResultsView
        stillFor={(f) => getStill(swingId, f)}
        row={row}
        phase={phase}
        analysis={data.analysis}
        pose={data.pose}
        progress={progress}
        error={error}
        stillTick={stillTick}
        placed={placed}
        onPlaceHead={onPlaceHead}
        onUndoPlace={onUndoPlace}
        onBack={() => navigation.goBack()}
        onCancel={onCancel}
        onDelete={onDelete}
        onRetry={onRetry}
        onRecord={() => navigation.navigate('SwingCapture')}
        onEditMarks={(checkpoint, opts) => navigation.navigate('SwingEditMarks', { swingId, checkpoint, ...opts })}
        onRename={(name) => renameSwing(swingId, name)}
        onExport={onExport}
        onPlay={() => setPlaying(true)}
        onNeedStills={onNeedStills}
        practiceOpen={practiceOpen}
        onPracticeToggle={() => { const next = !practiceOpen; setPracticeOpenState(next); setPracticeOpen(next); }}
      />
      <PlayerHost visible={playing} uri={swingVideoUri(swingId)} onClose={() => setPlaying(false)} />
    </>
  );
}

function PlayerHost({ visible, uri, onClose }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  return <Player visible={visible} uri={uri} onClose={onClose} s={s} />;
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, gap: 8 },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  headerSpacer: { width: 36, height: 36 },
  headerAction: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  headerActionText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: theme.text.secondary },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 28, gap: 12 },
  flex: { flex: 1 },

  banner: {
    flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: theme.bg.card, borderRadius: theme.radius.lg, padding: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
  },
  bannerText: { flex: 1, fontFamily: 'PlusJakartaSans-Medium', fontSize: 12.5, color: theme.text.primary, lineHeight: 18 },
  hint: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11.5, color: theme.text.secondary, lineHeight: 16 },
  hintPad: { paddingHorizontal: 8, paddingTop: 6 },

  nudgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nudge: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  nudgeOff: { opacity: 0.3 },
  nudgeText: { flex: 1, textAlign: 'center', fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: theme.text.secondary },

  card: {
    backgroundColor: theme.bg.card, borderRadius: theme.radius.lg, padding: 12, gap: 2,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
  },
  overlineDark: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: theme.text.secondary, paddingHorizontal: 4, paddingBottom: 4 },
  drill: { paddingVertical: 8, paddingHorizontal: 4, gap: 2 },
  drillTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.primary },
  drillBody: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12.5, lineHeight: 18, color: theme.text.secondary },
  drillPass: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11.5, color: theme.accent.primary },
  drillProgress: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11.5, lineHeight: 16, color: theme.text.secondary, fontStyle: 'italic' },
  plan: { marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border.subtle },
  practiceHead: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingRight: 4 },
  practiceRow: { flexDirection: 'row', gap: 12, paddingVertical: 8, paddingHorizontal: 4 },
  practiceTime: { width: 64, fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, color: theme.text.secondary, fontVariant: ['tabular-nums'], paddingTop: 2 },
  link: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.accent.primary, paddingVertical: 12, paddingHorizontal: 4 },

  btnRow: { flexDirection: 'row', gap: 10 },
  btnStack: { gap: 10 },
  btn: { minHeight: 48, borderRadius: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnPrimary: { backgroundColor: theme.accent.primary },
  btnPrimaryText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, color: theme.text.inverse },
  btnSecondary: { backgroundColor: theme.bg.secondary, borderWidth: 1, borderColor: theme.border.default },
  btnSecondaryText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.primary },
  btnOff: { opacity: 0.5 },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  deleteLink: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  deleteLinkText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: theme.text.secondary },

  errorSlot: { gap: 8, paddingTop: 12, paddingBottom: 8 },
  errorTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 26, lineHeight: 32, color: theme.text.primary },
  errorBody: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 13.5, lineHeight: 20, color: theme.text.secondary },

  sheet: { backgroundColor: theme.bg.primary, padding: 20, paddingBottom: 32, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: 8 },
  sheetTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary, marginBottom: 6 },
  menuRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 4 },
  menuText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 15, color: theme.text.primary },
  input: {
    minHeight: 48, borderRadius: 12, borderWidth: 1.5, borderColor: theme.border.default, backgroundColor: theme.bg.card,
    paddingHorizontal: 14, fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: theme.text.primary, marginBottom: 8,
  },

  playerWrap: { flex: 1, backgroundColor: '#000000', justifyContent: 'center' },
  player: { width: '100%', height: '100%' },
  playerClose: { position: 'absolute', top: 48, right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
});
