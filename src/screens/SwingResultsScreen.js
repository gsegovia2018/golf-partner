import React, {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Modal, Alert, useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import PressableScale from '../components/ui/PressableScale';
import BottomSheet from '../components/BottomSheet';
import SwingOverlay from '../components/swing/SwingOverlay';
import SwingTimeline from '../components/swing/SwingTimeline';
import SwingCheckRow from '../components/swing/SwingCheckRow';
import { useSwingTone } from '../components/swing/swingTone';
import { useTheme } from '../theme/ThemeContext';
import {
  subscribeSwings, getSwingsVersion, getSwing, hydrateSwings, renameSwing, readAnalysis, readPose,
  markSwingFailed, swingVideoUri,
} from '../store/swingStore';
import { runAnalysis } from '../swing/runAnalysis';
import { shareSwingExport } from '../swing/shareExport';
import { nativeApi, getStill, ensureStills } from '../swing/frames';
import { poseAtFrame } from '../swing/poseAt';
import { highlightFor } from '../swing/highlights';
import {
  checksAt, worstByCheckpoint, unplacedCheckpoint, CHECK_KEY, homeOf, frameOfKey,
} from '../swing/checkpointChecks';
import { CHECKPOINT_KEYS } from '../swing/phases';
import { drillsForFault } from '../swing/drills';
import { SWING_STRINGS } from '../swing/strings';

const T = SWING_STRINGS.results;
const MAX_NUDGE = 2; // stills exist for the checkpoint frame +-2 (D4)

// --- Sections --------------------------------------------------------------------------------

function Hero({ s, analysis, row, loading }) {
  const main = analysis?.main;
  const c = analysis?.counts;
  return (
    <View style={s.hero}>
      <Text style={s.overline}>{T.mainTitle}</Text>
      {loading ? <View style={s.skelHero} /> : (
        <>
          <Text style={s.verdict}>{main ? `${main.label}.` : `${T.noFaultTitle}.`}</Text>
          <Text style={s.why}>{main ? main.evidence.slice(0, 2).map((e) => e.text).join(' · ') : T.noFaultWhy}</Text>
        </>
      )}
      <View style={s.chips}>
        {loading ? <View style={s.chip}><Text style={s.chipText}>reading…</Text></View> : (
          <>
            <View style={s.chip}><Text style={s.chipText}>{T.good(c.green)}</Text></View>
            <View style={s.chip}><Text style={s.chipText}>{T.watch(c.yellow)}</Text></View>
            <View style={s.chip}><Text style={s.chipText}>{T.fix(c.red)}</Text></View>
            <View style={s.chip}><Text style={s.chipText}>{T.fpsChip(analysis.fps.effective)}</Text></View>
            {analysis.approximate ? <View style={s.chip}><Text style={s.chipText}>{T.approxChip}</Text></View> : null}
            <View style={s.chip}><Text style={s.chipText}>{row.name}</Text></View>
          </>
        )}
      </View>
    </View>
  );
}

function Processing({ s, tone, progress, width }) {
  const stage = progress?.stage ?? 'reading';
  const order = ['reading', 'pose', 'planes'];
  const at = order.indexOf(stage);
  const frac = stage === 'reading' ? 0.1
    : stage === 'pose' ? 0.1 + 0.75 * (progress.total ? Math.min(1, progress.done / progress.total) : 0)
      : 0.92;
  return (
    <View style={[s.processing, { width, minHeight: Math.min(width * 1.1, 360) }]} accessibilityLiveRegion="polite">
      <View style={s.shutter}><View style={s.shutterDot} /></View>
      <View style={s.stages}>
        {order.map((k, i) => {
          const done = i < at;
          const active = i === at;
          return (
            <View key={k} style={s.stage}>
              <View style={[s.stageIc, done && { backgroundColor: tone.green, borderColor: tone.green }, active && s.stageActive]}>
                {done ? <Feather name="check" size={11} color="#0a0d10" /> : null}
              </View>
              <Text style={[s.stageText, !done && !active && s.stageTodo]}>{T.stages[k]}</Text>
              {active && progress?.total ? <Text style={s.stageSub}>{`${progress.done} / ${progress.total}`}</Text> : null}
            </View>
          );
        })}
      </View>
      <View style={s.bar}><View style={[s.barFill, { width: `${Math.round(frac * 100)}%` }]} /></View>
      <Text style={s.procMeta}>
        {progress?.probe ? `${T.clipLine(progress.probe)}\n` : ''}
        {T.notUploaded}
      </Text>
    </View>
  );
}

function ErrorSlot({ s, error, width, onPrimary, primaryLabel, onSecondary, secondaryLabel }) {
  return (
    <>
      <View style={[s.errorSlot, { width }]} accessibilityRole="alert" accessible accessibilityLabel={SWING_STRINGS.errors[error] ?? SWING_STRINGS.errors.failed}>
        <Feather name="alert-circle" size={28} color="#f87171" />
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

export function SwingResultsView({
  row, phase, analysis, pose, progress, error, pass2Pending = false, stillTick = 0, stillFor,
  onBack, onCancel, onRetry, onRecord, onEditMarks, onRename, onPlay, onNeedStills, onExport,
}) {
  const { theme } = useTheme();
  const tone = useSwingTone();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { width: winW, height: winH } = useWindowDimensions();
  const boxW = Math.min(winW, 480) - 40;
  const ready = phase === 'ready' && analysis;

  const [cp, setCp] = useState('impact');
  const [off, setOff] = useState(0);
  const [selKey, setSelKey] = useState(null);
  const [allDrills, setAllDrills] = useState(false);
  const [sheet, setSheet] = useState(null); // null | 'menu' | 'rename'
  const [nameDraft, setNameDraft] = useState('');
  const scroll = useRef(null);

  const checks = useMemo(() => analysis?.checks ?? [], [analysis]);
  const here = ready ? checksAt(checks, cp) : [];
  const selected = here.find((c) => CHECK_KEY(c) === selKey) ?? checks.find((c) => CHECK_KEY(c) === selKey) ?? here[0] ?? null;

  const baseFrame = ready ? frameOfKey(analysis, cp) : 0;
  const frame = baseFrame + off;
  const uri = ready ? stillFor?.(frame) ?? null : null;
  void stillTick;
  useEffect(() => { if (ready && !uri) onNeedStills?.(frame); }, [ready, uri, frame]); // eslint-disable-line react-hooks/exhaustive-deps

  const video = pose?.video ?? null;
  const boxH = video ? Math.min(boxW * (video.height / video.width), winH * 0.55) : boxW * 1.2;
  const club = ready && off === 0 ? analysis.clubMarks[cp] : null;
  const ballOn = ready && CHECKPOINT_KEYS.indexOf(cp) <= CHECKPOINT_KEYS.indexOf('impact') && analysis.reference?.ball;
  const ball = ballOn ? [...analysis.reference.ball, pose?.ball?.r ?? 0.012] : null;
  const highlight = useMemo(() => (ready && selected ? highlightFor(selected, {
    analysis, poseAt: (f) => poseAtFrame(pose, f), frameOf: (k) => frameOfKey(analysis, k),
  }) : []), [ready, selected, analysis, pose]);
  const worst = useMemo(() => (ready ? worstByCheckpoint(checks) : {}), [ready, checks]);

  const pickCp = useCallback((k) => { setCp(k); setOff(0); setSelKey(null); }, []);
  const jumpToCheck = (c) => { pickCp(homeOf(c)); setSelKey(CHECK_KEY(c)); scroll.current?.scrollTo?.({ y: 0, animated: true }); };
  const tSec = ready ? (frame / analysis.fps.capture).toFixed(3) : '';
  const drills = ready && analysis.main ? drillsForFault(analysis.main.fault) : [];
  const shownDrills = allDrills ? drills : drills.slice(0, 2);
  const openEdit = (k) => onEditMarks?.(k);

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
              width={boxW}
              onPrimary={error === 'cancelled' || error === 'failed' ? onRetry : error === 'update' ? null : onRecord}
              primaryLabel={error === 'cancelled' || error === 'failed' ? T.retry : T.recordAgain}
              onSecondary={onBack}
              secondaryLabel={T.backToSwings}
            />
          </>
        ) : null}

        {phase === 'processing' || phase === 'loading' ? (
          <>
            <Hero s={s} row={row} loading />
            <View style={{ height: 12 }} />
            <Processing s={s} tone={tone} progress={progress} width={boxW} />
            <View style={{ height: 12 }} />
            <SwingTimeline current="impact" skeleton />
          </>
        ) : null}

        {ready ? (
          <>
            <Hero s={s} analysis={analysis} row={row} />
            {analysis.approximate ? (
              <View style={s.banner}>
                <Feather name="alert-triangle" size={16} color={tone.yellow} />
                <Text style={s.bannerText}>{T.approxBanner}</Text>
              </View>
            ) : null}
            {analysis.scale?.approx ? <Text style={s.hint}>{T.approxHeightBanner}</Text> : null}

            <View style={s.stillWrap}>
              <SwingOverlay
                width={boxW}
                height={boxH}
                video={video}
                uri={uri}
                pose={poseAtFrame(pose, frame)}
                club={club}
                ball={ball}
                reference={analysis.reference}
                highlight={highlight}
                label={`${SWING_STRINGS.checkpoint[cp]} still, frame ${frame}`}
              />
            </View>

            <SwingTimeline
              current={cp}
              worst={worst}
              onSelect={pickCp}
              frameLine={T.frameLine(frame, tSec, off)}
              onPrev={() => setOff((o) => Math.max(-MAX_NUDGE, o - 1))}
              onNext={() => setOff((o) => Math.min(MAX_NUDGE, o + 1))}
              canPrev={off > -MAX_NUDGE}
              canNext={off < MAX_NUDGE}
            />

            <View style={s.card}>
              <View style={s.cardHead}>
                <Text style={s.overlineDark}>{T.atCheckpoint(SWING_STRINGS.checkpoint[cp])}</Text>
                {here.length ? <Text style={s.hintInline}>{T.tapToDraw}</Text> : null}
              </View>
              {here.length ? here.map((c) => (
                <SwingCheckRow
                  key={CHECK_KEY(c)}
                  check={c}
                  selected={selected && CHECK_KEY(selected) === CHECK_KEY(c)}
                  onPress={() => setSelKey(CHECK_KEY(c))}
                  onPlace={openEdit}
                  placeAt={unplacedCheckpoint(c, analysis.clubMarks)}
                  pending={pass2Pending}
                />
              )) : <Text style={s.hint}>{T.noChecksAt}</Text>}
            </View>

            {drills.length ? (
              <View style={s.card}>
                <Text style={s.overlineDark}>{T.drillsTitle(analysis.main.label)}</Text>
                {shownDrills.map((d) => (
                  <View key={d.id} style={s.drill}>
                    <Text style={s.drillTitle}>{d.title}</Text>
                    <Text style={s.drillBody}>{d.instruction}</Text>
                    <Text style={s.drillPass}>{T.passTarget(d.passTarget)}</Text>
                  </View>
                ))}
                {drills.length > 2 ? (
                  <PressableScale onPress={() => setAllDrills((v) => !v)} accessibilityRole="button" accessibilityLabel={allDrills ? T.lessDrills : T.moreDrills(drills.length - 2)}>
                    <Text style={s.link}>{allDrills ? T.lessDrills : T.moreDrills(drills.length - 2)}</Text>
                  </PressableScale>
                ) : null}
              </View>
            ) : null}

            <View style={s.card}>
              <Text style={s.overlineDark}>{T.allChecks}</Text>
              {checks.map((c) => (
                <SwingCheckRow
                  key={CHECK_KEY(c)}
                  check={c}
                  onPress={jumpToCheck}
                  onPlace={openEdit}
                  placeAt={unplacedCheckpoint(c, analysis.clubMarks)}
                  pending={pass2Pending}
                />
              ))}
            </View>

            <View style={s.btnRow}>
              <PressableScale style={[s.btn, s.btnSecondary, s.flex]} onPress={() => openEdit(cp)} accessibilityRole="button" accessibilityLabel={T.editMarks}>
                <Feather name="edit-2" size={16} color={theme.text.primary} />
                <Text style={s.btnSecondaryText}>{T.editMarks}</Text>
              </PressableScale>
              <PressableScale style={[s.btn, s.btnSecondary, s.flex]} onPress={onPlay} accessibilityRole="button" accessibilityLabel={T.play}>
                <Feather name="play" size={16} color={theme.text.primary} />
                <Text style={s.btnSecondaryText}>{T.play}</Text>
              </PressableScale>
            </View>
          </>
        ) : null}
      </ScrollView>

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
            <PressableScale style={s.menuRow} onPress={() => { setSheet(null); openEdit(cp); }} accessibilityRole="button" accessibilityLabel={`${T.editMarks} (menu)`}>
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
          </>
        )}
      </BottomSheet>
    </ScreenContainer>
  );
}

// --- The screen (store, analysis run, navigation) -----------------------------------------------

export default function SwingResultsScreen({ navigation, route }) {
  const swingId = route.params?.swingId;
  useSyncExternalStore(subscribeSwings, getSwingsVersion);
  const row = getSwing(swingId);

  const [phase, setPhase] = useState('loading'); // loading | processing | ready | error
  const [data, setData] = useState({ analysis: null, pose: null });
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [pass2Pending, setPass2Pending] = useState(false);
  const [stillTick, setStillTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const alive = useRef(true);
  const cancelled = useRef(false);
  const started = useRef(false);
  const poseRef = useRef(null);

  const load = useCallback(async () => {
    const analysis = await readAnalysis(swingId);
    if (!analysis) return false;
    if (!poseRef.current) poseRef.current = await readPose(swingId);
    if (alive.current) setData({ analysis, pose: poseRef.current });
    return true;
  }, [swingId]);

  const start = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    cancelled.current = false;
    setError(null);
    setProgress({ stage: 'reading' });
    setPhase('processing');
    const res = await runAnalysis(swingId, {
      onProgress: (p) => { if (alive.current) setProgress(p); },
      onPartial: async () => {
        if (!(await load())) return;
        if (alive.current) { setPass2Pending(true); setPhase('ready'); }
      },
      isCancelled: () => cancelled.current,
    });
    started.current = false;
    if (res.cancelled) {
      await markSwingFailed(swingId, 'cancelled');
      if (alive.current) { setError('cancelled'); setPhase('error'); }
    } else if (res.error) {
      if (alive.current) { setError(res.error); setPhase('error'); }
    } else {
      poseRef.current = null; // pass 2 saved pose.json again (it carries the club seeds)
      await load();
      if (alive.current) { setPass2Pending(false); setPhase('ready'); setStillTick((t) => t + 1); }
    }
  }, [swingId, load]);

  useEffect(() => {
    alive.current = true;
    (async () => {
      if (!getSwing(swingId)) await hydrateSwings();
      const r = getSwing(swingId);
      if (!r) { setError('failed'); setPhase('error'); return; }
      if (r.status === 'ready') {
        if (await load()) { if (alive.current) setPhase('ready'); } else { setError('failed'); setPhase('error'); }
      } else if (r.status === 'error') {
        setError(r.error || 'failed');
        setPhase('error');
      } else {
        start();
      }
    })();
    return () => { alive.current = false; cancelled.current = true; };
  }, [swingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Coming back from Edit marks: the analysis was recomputed there.
  useEffect(() => navigation.addListener?.('focus', () => {
    if (phase === 'ready' && !started.current) { poseRef.current = null; load(); }
  }), [navigation, phase, load]);

  const onNeedStills = useCallback(async (frame) => {
    const got = await ensureStills(swingId, [frame - 2, frame - 1, frame, frame + 1, frame + 2]);
    if (alive.current && Object.values(got).some(Boolean)) setStillTick((t) => t + 1);
  }, [swingId]);

  const onCancel = () => {
    cancelled.current = true;
    try { nativeApi()?.cancelAnalysis?.(); } catch { /* best effort */ }
    navigation.goBack();
  };
  const onRetry = () => { started.current = false; start(); };
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
        pass2Pending={pass2Pending}
        stillTick={stillTick}
        onBack={() => navigation.goBack()}
        onCancel={onCancel}
        onRetry={onRetry}
        onRecord={() => navigation.navigate('SwingCapture')}
        onEditMarks={(checkpoint) => navigation.navigate('SwingEditMarks', { swingId, checkpoint })}
        onRename={(name) => renameSwing(swingId, name)}
        onExport={onExport}
        onPlay={() => setPlaying(true)}
        onNeedStills={onNeedStills}
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

  hero: { backgroundColor: theme.bg.deep, borderRadius: theme.radius.lg, padding: 16, gap: 4 },
  overline: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)' },
  verdict: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 26, lineHeight: 32, color: '#ffffff' },
  why: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12.5, lineHeight: 18, color: 'rgba(255,255,255,0.88)' },
  skelHero: { height: 26, width: '60%', borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.18)', marginVertical: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11.5, color: '#ffffff' },

  banner: {
    flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: theme.bg.card, borderRadius: theme.radius.lg, padding: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
  },
  bannerText: { flex: 1, fontFamily: 'PlusJakartaSans-Medium', fontSize: 12.5, color: theme.text.primary, lineHeight: 18 },
  hint: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11.5, color: theme.text.secondary, lineHeight: 16 },
  hintInline: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11, color: theme.text.secondary },

  stillWrap: { borderRadius: theme.radius.lg, overflow: 'hidden', alignItems: 'center', backgroundColor: '#0a0d10' },

  card: {
    backgroundColor: theme.bg.card, borderRadius: theme.radius.lg, padding: 12, gap: 2,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4, paddingBottom: 4 },
  overlineDark: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: theme.text.secondary, paddingHorizontal: 4, paddingBottom: 4 },
  drill: { paddingVertical: 8, paddingHorizontal: 4, gap: 2 },
  drillTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.primary },
  drillBody: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12.5, lineHeight: 18, color: theme.text.secondary },
  drillPass: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11.5, color: theme.accent.primary },
  link: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.accent.primary, paddingVertical: 12, paddingHorizontal: 4 },

  btnRow: { flexDirection: 'row', gap: 10 },
  btn: { minHeight: 48, borderRadius: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnPrimary: { backgroundColor: theme.accent.primary },
  btnPrimaryText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, color: theme.text.inverse },
  btnSecondary: { backgroundColor: theme.bg.secondary, borderWidth: 1, borderColor: theme.border.default },
  btnSecondaryText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.primary },
  btnOff: { opacity: 0.5 },

  processing: {
    alignSelf: 'center', backgroundColor: '#1b2420', borderRadius: theme.radius.lg, padding: 24, gap: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  shutter: { width: 52, height: 52, borderRadius: 26, borderWidth: 1.5, borderColor: '#ffd700', alignItems: 'center', justifyContent: 'center' },
  shutterDot: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fefefe' },
  stages: { width: '100%', maxWidth: 260, gap: 10 },
  stage: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stageIc: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  stageActive: { borderColor: '#ffffff' },
  stageText: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: '#ffffff' },
  stageTodo: { color: 'rgba(255,255,255,0.5)' },
  stageSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11.5, color: 'rgba(255,255,255,0.7)', fontVariant: ['tabular-nums'] },
  bar: { width: '100%', maxWidth: 260, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: '#4fae8a' },
  procMeta: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11.5, lineHeight: 17, color: 'rgba(255,255,255,0.7)', textAlign: 'center' },

  errorSlot: { alignSelf: 'center', backgroundColor: '#12171c', borderRadius: theme.radius.lg, padding: 24, gap: 8, alignItems: 'center', minHeight: 220, justifyContent: 'center' },
  errorTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, color: '#ffffff', textAlign: 'center' },
  errorBody: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, lineHeight: 19, color: '#cfe3d5', textAlign: 'center' },

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
