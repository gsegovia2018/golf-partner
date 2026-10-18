import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Alert, Linking, StatusBar, AppState, useWindowDimensions,
} from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle } from 'react-native-svg';
import { useCameraPermissions } from 'expo-camera';
import { VideoView, useVideoPlayer } from 'expo-video';
import { File, Paths } from 'expo-file-system';
import CaptureGuide from '../components/swing/CaptureGuide';
import { glass } from '../components/swing/swingStyles';
import { hud } from '../theme/tokens';
import { haptic } from '../lib/haptics';
import { captureSupport, getCameraView, listRecordingModes } from '../swing/native';
import {
  MAX_RECORD_MS, captureReducer, initialCaptureState, cameraMounted, fpsTier, needsFallback,
  playbackRateFor, formatElapsed, previewRect,
} from '../swing/capture';
import { createSwing, getSwingProfile } from '../store/swingStore';
import { pickSwingVideo } from '../swing/importVideo';
import { SWING_STRINGS } from '../swing/strings';
import { useT } from '../i18n';
import { formatNumber } from '../i18n/format';

const T = SWING_STRINGS.capture;
const GUIDE_KEY = 'golf_swing_capture_guide.v1';
const HUD_WARN = '#e0b24d';
const HUD_RED = '#f87171';
const REC_RED = '#f0453c';
const TIER = { green: hud.accent, yellow: HUD_WARN, red: HUD_RED };

function deleteFile(uri) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch { /* already gone */ }
}

function ReviewPlayer({ take }) {
  const player = useVideoPlayer(take.path, (p) => {
    p.loop = true;
    p.muted = true;
    p.playbackRate = playbackRateFor(take.fps);
    p.play();
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />;
}

function RecordButton({ recording, progress, disabled, onPress }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.rec, disabled && styles.dim]}
      accessibilityRole="button"
      accessibilityLabel={recording ? T.stop : T.record}
      accessibilityState={{ disabled: !!disabled }}
      testID="capture-record"
    >
      <Svg width={96} height={96} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Circle cx={48} cy={48} r={r} stroke={hud.line} strokeWidth={4} fill="none" />
        {recording ? (
          <Circle
            cx={48} cy={48} r={r} stroke={hud.accent} strokeWidth={4} fill="none"
            strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - Math.min(1, progress))}
            strokeLinecap="round" transform="rotate(-90 48 48)"
          />
        ) : null}
      </Svg>
      <View style={styles.recRing}>
        <View style={recording ? styles.recStop : styles.recDot} />
      </View>
    </Pressable>
  );
}

function HudButton({ label, icon, onPress, ghost, testID, disabled, style }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.hudBtn, ghost && styles.hudBtnGhost, disabled && styles.dim, style]}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      {icon ? <Feather name={icon} size={16} color={ghost ? hud.text : hud.onAccent} /> : null}
      <Text style={[styles.hudBtnText, ghost && styles.hudBtnGhostText]}>{label}</Text>
    </Pressable>
  );
}

export default function SwingCaptureScreen({ navigation }) {
  useT(); // the swing copy reads the language as it renders: re-render when it changes
  const insets = useSafeAreaInsets();
  const [state, dispatch] = useReducer(captureReducer, initialCaptureState);
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const support = useMemo(() => captureSupport(), []);
  const CameraView = useMemo(() => (support.supported ? getCameraView() : null), [support]);
  const left = getSwingProfile()?.handedness === 'left';
  const win = useWindowDimensions();
  const portrait = win.height >= win.width;

  const camRef = useRef(null);
  const phaseRef = useRef(state.phase);
  phaseRef.current = state.phase;
  const takeUri = useRef(null);
  const asked = useRef(false);
  const mounted = useRef(true);
  const [elapsed, setElapsed] = useState(0);
  const [guideOpen, setGuideOpen] = useState(false);
  const [box, setBox] = useState({ width: 0, height: 0 });

  // Set-up guide: open until the golfer has dismissed it once (remembered on this phone).
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(GUIDE_KEY)
      .then((v) => { if (alive && v !== 'seen') setGuideOpen(true); })
      .catch(() => { if (alive) setGuideOpen(true); });
    return () => { alive = false; };
  }, []);
  const dismissGuide = useCallback(() => {
    setGuideOpen(false);
    AsyncStorage.setItem(GUIDE_KEY, 'seen').catch(() => {});
  }, []);

  // Gate (S10) → permission → recording modes.
  useEffect(() => {
    if (!support.supported) dispatch({ type: 'blocked', reason: 'update' });
  }, [support]);
  useEffect(() => {
    if (!support.supported || !permission) return undefined;
    if (!permission.granted) {
      if (permission.canAskAgain !== false && !asked.current) {
        asked.current = true;
        requestPermission();
      } else {
        dispatch({ type: 'blocked', reason: 'permission' });
      }
      return undefined;
    }
    let alive = true;
    listRecordingModes()
      .then((modes) => { if (alive) dispatch({ type: 'modes', modes }); })
      .catch(() => { if (alive) dispatch({ type: 'blocked', reason: 'no_camera' }); });
    return () => { alive = false; };
  }, [support, permission, requestPermission]);
  // Back from the system settings with the camera allowed.
  useEffect(() => {
    if (state.blocked !== 'permission' || !getPermission) return undefined;
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') getPermission(); });
    return () => sub.remove();
  }, [state.blocked, getPermission]);

  // The take is ours until Analyse copies it into the swing store: never leave it behind.
  useEffect(() => () => {
    mounted.current = false;
    deleteFile(takeUri.current);
  }, []);

  // Portrait capture: the guide, the preview box and the file orientation all assume it. The app
  // is portrait-locked globally; lock again here in case a screen left it unlocked.
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  // Native closes the camera in the background; not ready until onCameraReady says so again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'background') dispatch({ type: 'closed' }); });
    return () => sub.remove();
  }, []);

  const stop = useCallback(() => {
    if (phaseRef.current !== 'recording' || !camRef.current) return;
    phaseRef.current = 'stopping';
    dispatch({ type: 'stop' });
    haptic('medium');
    camRef.current.stopRecording()
      .then((take) => {
        // Left the screen while the file was being finalised: nobody will review it.
        if (!mounted.current) { deleteFile(take.path); return; }
        takeUri.current = take.path;
        dispatch({ type: 'stopped', take });
      })
      .catch((e) => dispatch({ type: 'failed', error: e?.code === 'ERR_NO_FRAMES' ? 'short' : 'failed' }));
  }, []);

  const start = useCallback(() => {
    if (phaseRef.current !== 'live' || !state.ready || !camRef.current) return;
    phaseRef.current = 'starting';
    dispatch({ type: 'start' });
    haptic('medium');
    setGuideOpen(false);
    const outPath = new File(Paths.cache, `swing-take-${Date.now()}.mp4`).uri;
    camRef.current.startRecording({ outPath })
      .then(() => dispatch({ type: 'started' }))
      .catch(() => dispatch({ type: 'failed', error: 'failed' }));
  }, [state.ready]);

  // Elapsed time and the auto-stop (plan 4.1: 8 s).
  useEffect(() => {
    if (state.phase !== 'recording') return undefined;
    const t0 = Date.now();
    setElapsed(0);
    const id = setInterval(() => {
      const e = Date.now() - t0;
      setElapsed(e);
      if (e >= MAX_RECORD_MS) stop();
    }, 100);
    return () => clearInterval(id);
  }, [state.phase, stop]);

  const retake = useCallback(() => {
    deleteFile(takeUri.current);
    takeUri.current = null;
    dispatch({ type: 'retake' });
  }, []);

  // Analyse: the take enters the same pipeline as an imported clip (copy into the store,
  // then Results runs the analysis). Nothing was decoded before this tap.
  const analyse = useCallback(async () => {
    if (state.phase !== 'review' || !state.take) return;
    dispatch({ type: 'analyse' });
    try {
      const row = await createSwing({ videoUri: state.take.path, source: 'camera', createdAt: new Date() });
      deleteFile(takeUri.current);
      takeUri.current = null;
      navigation.replace('SwingResults', { swingId: row.id });
    } catch {
      dispatch({ type: 'saveFailed' });
    }
  }, [state.phase, state.take, navigation]);

  const importInstead = useCallback(async () => {
    try {
      const clip = await pickSwingVideo();
      if (!clip) return;
      const row = await createSwing({ videoUri: clip.uri, source: 'import', createdAt: new Date() });
      navigation.replace('SwingResults', { swingId: row.id });
    } catch {
      Alert.alert(SWING_STRINGS.home.importFailed);
    }
  }, [navigation]);

  const { phase, mode, blocked, take } = state;
  const live = cameraMounted(phase);
  const recording = phase === 'recording' || phase === 'stopping';
  const showFallback = phase === 'live' && needsFallback(mode) && !state.lowFpsOk;
  const tier = mode ? fpsTier(mode.fps) : 'red';
  const rect = previewRect(box, mode);
  const errorText = state.error ? T.errors[state.error] ?? T.errors.failed : null;

  let card = null;
  if (phase === 'blocked') {
    if (blocked === 'update') {
      card = (
        <View style={styles.card} testID="capture-update">
          <Text style={styles.cardTitle}>{T.updateTitle}</Text>
          <Text style={styles.cardBody}>{support.message}</Text>
          <HudButton label={T.importSlowMo} icon="download" onPress={importInstead} />
        </View>
      );
    } else if (blocked === 'permission') {
      card = (
        <View style={styles.card} testID="capture-permission">
          <Text style={styles.cardTitle}>{T.permissionTitle}</Text>
          <Text style={styles.cardBody}>{T.permissionBody}</Text>
          <HudButton
            label={permission?.canAskAgain === false ? T.openSettings : T.allow}
            onPress={() => (permission?.canAskAgain === false ? Linking.openSettings() : requestPermission())}
          />
        </View>
      );
    } else {
      card = (
        <View style={styles.card} testID="capture-fallback">
          <Text style={styles.cardTitle}>{T.fallbackNoCamera}</Text>
          <Text style={styles.cardBody}>{T.fallbackBody}</Text>
          <HudButton label={T.importSlowMo} icon="download" onPress={importInstead} />
        </View>
      );
    }
  } else if (showFallback) {
    card = (
      <View style={styles.card} testID="capture-fallback">
        <Text style={styles.cardTitle}>{T.fallbackTitle(mode.fps)}</Text>
        <Text style={styles.cardBody}>{T.fallbackBody}</Text>
        <HudButton label={T.importSlowMo} icon="download" onPress={importInstead} />
        <HudButton label={T.recordAnyway(mode.fps)} ghost onPress={() => dispatch({ type: 'acceptLowFps' })} testID="capture-record-anyway" />
      </View>
    );
  } else if (guideOpen && phase === 'live') {
    card = (
      <View style={styles.card} testID="capture-guide-card">
        <Text style={styles.cardTitle}>{T.guideTitle}</Text>
        {T.guideTips.map((tip) => (
          <View key={tip} style={styles.tipRow}>
            <View style={styles.tipDot} />
            <Text style={styles.cardBody}>{tip}</Text>
          </View>
        ))}
        <HudButton label={T.gotIt} onPress={dismissGuide} style={styles.alignStart} testID="capture-guide-dismiss" />
      </View>
    );
  }

  return (
    <View style={styles.screen} testID="swing-capture">
      <StatusBar barStyle="light-content" />
      <View style={StyleSheet.absoluteFill} onLayout={(e) => setBox(e.nativeEvent.layout)}>
        {live && CameraView && mode ? (
          <CameraView
            key={state.cameraKey}
            ref={camRef}
            style={StyleSheet.absoluteFill}
            mode={mode}
            onCameraReady={() => dispatch({ type: 'ready' })}
            onCameraError={() => dispatch({ type: 'cameraError' })}
            onRecordingInterrupted={() => dispatch({ type: 'interrupted' })}
          />
        ) : null}
        {phase === 'review' || phase === 'saving' ? <ReviewPlayer take={take} /> : null}
        {phase === 'live' && !showFallback && portrait ? (
          <CaptureGuide rect={rect} left={left} label={T.guideBox} />
        ) : null}
      </View>

      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Pressable
          style={styles.round}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={T.close}
          testID="capture-close"
        >
          <Feather name="x" size={22} color={hud.text} />
        </Pressable>
        {phase === 'live' && !showFallback ? (
          <Pressable
            style={[styles.pill, glass.pill]}
            onPress={() => (guideOpen ? dismissGuide() : setGuideOpen(true))}
            accessibilityRole="button"
            accessibilityLabel={T.guideToggle}
            accessibilityState={{ expanded: guideOpen }}
            testID="capture-guide-toggle"
          >
            <Feather name="info" size={13} color={hud.text} />
            <Text style={styles.pillText}>{T.guideToggle}</Text>
            <Feather name={guideOpen ? 'chevron-up' : 'chevron-down'} size={13} color={hud.text} />
          </Pressable>
        ) : null}
        <View style={styles.roundSpacer} />
      </View>

      {card ? <View style={[styles.cardWrap, { top: insets.top + 64 }]}>{card}</View> : null}

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 20 }]}>
        {errorText ? (
          <View style={styles.errorRow} accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>{errorText}</Text>
            {state.error === 'camera' ? (
              <Pressable onPress={() => dispatch({ type: 'retryCamera' })} accessibilityRole="button" accessibilityLabel={T.retry}>
                <Text style={styles.errorAction}>{T.retry}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {phase === 'review' || phase === 'saving' ? (
          <View style={[styles.card, styles.reviewCard]} testID="capture-review">
            <Text style={styles.cardTitle}>
              {T.review(formatNumber(take.durationMs / 1000, { decimals: 1 }), take.fps, playbackRateFor(take.fps))}
            </Text>
            <View style={styles.btnRow}>
              <HudButton label={T.retake} icon="refresh-cw" ghost onPress={retake} disabled={phase === 'saving'} style={styles.flex1} testID="capture-retake" />
              <HudButton
                label={phase === 'saving' ? T.saving : T.analyse}
                icon="check"
                onPress={analyse}
                disabled={phase === 'saving'}
                style={styles.flexWide}
                testID="capture-analyse"
              />
            </View>
            <Text style={styles.caption}>{T.reviewHint}</Text>
          </View>
        ) : null}

        {live && mode && !showFallback ? (
          // one row, like a camera: the frame rate | record | the clock, the button dead centre
          <View style={styles.recRow}>
            <View style={styles.side}>
              <View style={[styles.pill, glass.pill]} testID="capture-fps-pill" accessibilityLabel={T.fps(mode.fps)}>
                <View style={[styles.dot, { backgroundColor: TIER[tier] }]} />
                <Text style={styles.pillText} numberOfLines={1}>{T.fps(mode.fps)}</Text>
              </View>
            </View>
            <RecordButton
              recording={recording}
              progress={elapsed / MAX_RECORD_MS}
              disabled={phase === 'stopping' || phase === 'starting' || (phase === 'live' && !state.ready)}
              onPress={recording ? stop : start}
            />
            <View style={styles.side}>
              <View style={[styles.pill, glass.pill]}>
                <Text style={styles.elapsed} numberOfLines={1}>
                  {formatElapsed(recording ? elapsed : 0)}
                  <Text style={styles.elapsedMax}>{` ${T.autoStop(formatElapsed(MAX_RECORD_MS).replace(/\.0$/, ''))}`}</Text>
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {phase === 'loading' ? <Text style={styles.caption}>{T.loading}</Text> : null}

        <View style={[styles.privacy, glass.pill]}>
          <Feather name="lock" size={12} color={hud.textSoft} />
          <Text style={styles.privacyText}>{SWING_STRINGS.privacy}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: hud.bg },
  top: {
    position: 'absolute', left: 0, right: 0, top: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18,
  },
  round: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: hud.scrim,
    alignItems: 'center', justifyContent: 'center',
  },
  roundSpacer: { width: 40, height: 40 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 999,
    paddingVertical: 7, paddingHorizontal: 12, backgroundColor: hud.scrim, minHeight: 32,
  },
  pillText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12, color: hud.text },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cardWrap: { position: 'absolute', left: 18, right: 18 },
  card: {
    backgroundColor: 'rgba(10,13,16,0.82)', borderRadius: 16, padding: 16, gap: 8, // glass, a little denser: it carries reading
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', borderTopColor: 'rgba(255,255,255,0.22)',
  },
  reviewCard: { alignSelf: 'stretch' },
  cardTitle: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15, color: hud.text },
  cardBody: { flex: 1, fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, lineHeight: 19, color: hud.textSoft },
  tipRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  tipDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: hud.textSoft, marginTop: 7 },
  alignStart: { alignSelf: 'flex-start' },
  hudBtn: {
    minHeight: 44, borderRadius: 24, paddingHorizontal: 18, paddingVertical: 11,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: hud.accent,
  },
  hudBtnGhost: { backgroundColor: hud.fill, borderWidth: 1, borderColor: hud.line },
  hudBtnText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 14, color: hud.onAccent },
  hudBtnGhostText: { color: hud.text, fontFamily: 'PlusJakartaSans-Bold' },
  btnRow: { flexDirection: 'row', gap: 10 },
  flex1: { flex: 1 },
  flexWide: { flex: 1.4 },
  dim: { opacity: 0.5 },
  bottom: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 20, alignItems: 'center', gap: 12,
  },
  recRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  side: { flex: 1, alignItems: 'center' },
  rec: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  recRing: {
    width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: hud.text,
    alignItems: 'center', justifyContent: 'center',
  },
  recDot: { width: 58, height: 58, borderRadius: 29, backgroundColor: REC_RED },
  recStop: { width: 28, height: 28, borderRadius: 7, backgroundColor: REC_RED },
  elapsed: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 14, color: hud.text, fontVariant: ['tabular-nums'] },
  elapsedMax: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: hud.textMuted },
  caption: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: hud.textMuted, textAlign: 'center' },
  errorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: hud.scrim,
    borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12,
  },
  errorText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: hud.danger },
  errorAction: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12, color: hud.accent },
  privacy: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: hud.scrim,
    borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10,
  },
  privacyText: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: hud.textSoft },
});
