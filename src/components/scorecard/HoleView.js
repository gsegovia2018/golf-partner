import React, { useEffect, useRef, useState, useCallback, useMemo, startTransition } from 'react';
import {
  View, Text, TouchableOpacity,
  ScrollView, Modal, Pressable, Platform, Animated,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { makeScorecardStyles } from './styles';
import { HolePage, MePicker } from './HolePage';
import { GpsDistancePanel } from './GpsDistancePanel';
import { HoleFlyover } from './HoleFlyover';
import { HoleGeoEditor } from './HoleGeoEditor';
import { useGpsDistances } from '../../hooks/useGpsDistances';
import { useAuth } from '../../context/AuthContext';
import { isAdminUser } from '../../lib/admin';
import { RoundSummary } from './RoundSummary';
import { roundTotals } from './scoreModel';
import { CELEBRATION_TIERS } from './constants';
import { isScrambleMode } from '../scoringModes';
import { scrambleUnits } from '../../store/tournamentStore';
import DiscrepancySheet from '../DiscrepancySheet';
import ScoreConflictSheet from '../ScoreConflictSheet';
import { deriveCell } from '../../store/scoreEntries';
import { getShotDetailCollapsed, setShotDetailCollapsed } from '../../lib/prefs';
import { prefetchCourseTiles } from '../../store/tileCache';

// Web-only CSS scroll-snap. On native, `pagingEnabled` is handled by the
// platform. On web, react-native-web 0.21's `pagingEnabled` only sets
// `scroll-snap-align: start` on its auto-wrapper — missing
// `scroll-snap-stop: always`, so a fast swipe can carry past one page.
// We disable the auto-wrapper on web (pagingEnabled={false}) and apply
// the snap properties directly on the ScrollView + each page.
const PAGER_SNAP_TYPE_STYLE = Platform.OS === 'web' ? { scrollSnapType: 'x mandatory', overflowX: 'auto' } : null;

// Belt-and-braces: inject the snap rules via a real <style> tag so they
// apply even if RNW's atomic-CSS pipeline ever filters an unknown CSS
// property. Targeted by a data attribute we set on each page.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const id = 'golf-partner-pager-snap-stop';
  if (!document.getElementById(id)) {
    const styleEl = document.createElement('style');
    styleEl.id = id;
    styleEl.textContent = '[data-pagerpage="1"]{scroll-snap-align:start !important;scroll-snap-stop:always !important;}';
    document.head.appendChild(styleEl);
  }
}

export function HoleView({ round, roundIndex, players, scores, shotDetails, meId, onSetShot, onPickMe, notes, currentHole, hole, isBestBall, bbResult, settings, onStep, onSetScore, editable, onNext, onGoToHole, onFinish, holeCount, showQuickFinish, finishBusy, showRunning, getScoreAnim, celebration, celebrationAnim, refreshing, onRefresh, official, officialDiscrepancy, officialEditableSource, officialSetScore, officialHasAttested, officialAttestBusy, officialAttestError, onAttest, onResolveConflict, focusConflict, onFocusConflictHandled, conflictHoles = new Set(), authorName }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);
  const [holePickerOpen, setHolePickerOpen] = useState(false);
  // True once the "which player are you?" modal is dismissed via "Not now",
  // so it stays closed for the rest of this scorecard session.
  const [mePickerSkipped, setMePickerSkipped] = useState(false);
  // Collapse state for the "me" card's Shot detail section. Shared across
  // holes so the choice persists while paging. Persisted via prefs.
  const [shotCollapsed, setShotCollapsed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getShotDetailCollapsed().then((v) => { if (!cancelled) setShotCollapsed(v); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const toggleShotDetail = useCallback(() => {
    setShotCollapsed((v) => { const next = !v; setShotDetailCollapsed(next).catch(() => {}); return next; });
  }, []);
  // Official mode: the hole + subject currently open in the resolve sheet.
  // { hole, subjectRosterId } or null. Casual mode never sets this.
  const [discrepancyTarget, setDiscrepancyTarget] = useState(null);
  // Stable identity so it does not defeat HolePage's memo comparator — an
  // inline arrow here re-rendered all 18 pages on every score edit.
  const openDiscrepancy = useCallback((subjectRosterId, holeNumber) => {
    setDiscrepancyTarget({ hole: holeNumber, subjectRosterId });
  }, []);
  // Casual-mode score conflict: which hole/player is open in the resolve sheet.
  const [conflictTarget, setConflictTarget] = useState(null);
  const openConflict = useCallback((playerId, holeNumber) => {
    setConflictTarget({ hole: holeNumber, playerId });
  }, []);

  // The finish gate (ScorecardScreen) sets `focusConflict` after deciding to
  // review a conflict: jump to its hole, open the sheet, then hand the signal
  // back so it fires once.
  useEffect(() => {
    if (focusConflict) {
      onGoToHole?.(focusConflict.hole);
      setConflictTarget({ hole: focusConflict.hole, playerId: focusConflict.playerId });
      onFocusConflictHandled?.();
    }
  }, [focusConflict, onGoToHole, onFocusConflictHandled]);

  const onLastHole = currentHole >= holeCount;
  const gps = useGpsDistances(round.courseName, currentHole);
  // Best-effort offline prep: when this round's course has geometry, prefetch
  // its satellite tiles once per course per session — Wi-Fi only. Failures are
  // silent; the flyover falls back to vectors.
  useEffect(() => {
    if (!gps.available) return undefined;
    let cancelled = false;
    NetInfo.fetch().then((state) => {
      if (cancelled || state.type !== 'wifi') return;
      prefetchCourseTiles(round.courseName).catch(() => {});
    });
    return () => { cancelled = true; };
  }, [gps.available, round.courseName]);
  const { user } = useAuth();
  // Admin allowlist gates the geometry editor. On the local dev server (__DEV__)
  // allow it without sign-in so geometry can be corrected during development;
  // installed/production builds still require an admin account.
  const isAdmin = isAdminUser(user?.id) || __DEV__;
  const [flyoverOpen, setFlyoverOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pagerSize, setPagerSize] = useState({ width: 0, height: 0 });
  const pagerRef = useRef(null);
  const holeScrollOffset = useRef(0);
  const isUserScrollingHole = useRef(false);
  const holePagerInitialized = useRef(false);
  // True while a programmatic scrollTo animation is in flight. Stops
  // onScroll from committing mid-animation; user drag and momentum
  // are NOT suppressed.
  const suppressHoleOnScroll = useRef(false);
  const suppressHoleTimer = useRef(null);
  // True when the latest currentHole prop change was driven by our own
  // scroll (onScroll / onMomentumScrollEnd). The sync effect uses this
  // to skip scrollTo — the pager is already where it needs to be, and
  // a scrollTo would cause a visible mini-scroll after the gesture.
  const currentHoleFromScroll = useRef(false);

  useEffect(() => {
    if (currentHoleFromScroll.current) {
      currentHoleFromScroll.current = false;
      return;
    }
    if (!pagerRef.current || pagerSize.width <= 0) return;
    if (isUserScrollingHole.current) return;
    const target = (currentHole - 1) * pagerSize.width;
    if (Math.abs(holeScrollOffset.current - target) < 1) return;
    // Suppress onScroll commits while the animation runs.
    suppressHoleOnScroll.current = true;
    clearTimeout(suppressHoleTimer.current);
    suppressHoleTimer.current = setTimeout(() => {
      suppressHoleOnScroll.current = false;
    }, 450);
    pagerRef.current.scrollTo({ x: target, animated: holePagerInitialized.current });
    holeScrollOffset.current = target;
    holePagerInitialized.current = true;
  }, [currentHole, pagerSize.width]);

  // Compute round totals once here so all HolePage instances share the same
  // result — avoids O(holes × players²) redundant work across the pager.
  // Scramble modes total the synthetic team "players" under team handicaps
  // so the totalsMap keys line up with the captain ids HolePage renders.
  // Effective mode for this round: per-round override wins, then the
  // tournament setting, then 'stableford'. No tournament object here (this
  // component only has round + settings props), so this mirrors
  // roundScoringMode inline rather than importing it.
  const rawMode = round?.scoringMode ?? settings?.scoringMode ?? 'stableford';
  const scorecardTotals = useMemo(() => {
    if (isScrambleMode(rawMode)) {
      const units = scrambleUnits(round, players);
      return roundTotals({
        mode: rawMode,
        round,
        players: units,
        scores,
        handicaps: Object.fromEntries(units.map((u) => [u.id, u.handicap])),
      });
    }
    return roundTotals({
      mode: rawMode,
      round,
      players,
      scores,
      handicaps: round?.playerHandicaps ?? {},
    });
  }, [rawMode, round, players, scores]);

  if (!hole) return null;

  return (
    <View style={s.flex}>
      {/* Shot tracking needs to know which player is "me". Solo rounds and
          the game creator are resolved automatically; a joined game prompts
          with a centered modal until answered or dismissed. */}
      {!meId && players.length > 1 && !mePickerSkipped && (
        <MePicker
          players={players}
          onPickMe={onPickMe}
          onSkip={() => setMePickerSkipped(true)}
          theme={theme}
          s={s}
        />
      )}

      {/* Live GPS front/center/back to the green — tap to open the aerial
          flyover. Renders nothing on courses without geometry data. */}
      <GpsDistancePanel gps={gps} onPress={() => setFlyoverOpen(true)} />
      <HoleFlyover
        visible={flyoverOpen}
        courseName={round.courseName}
        holeNumber={currentHole}
        position={gps.position}
        onClose={() => setFlyoverOpen(false)}
        onEdit={isAdmin ? () => { setFlyoverOpen(false); setEditorOpen(true); } : undefined}
      />
      {isAdmin && (
        <HoleGeoEditor
          visible={editorOpen}
          courseName={round.courseName}
          holeNumber={currentHole}
          onClose={() => setEditorOpen(false)}
        />
      )}

      {/* Horizontal pager: flex:1, one page per hole (swipe to change hole) */}
      <View
        style={s.pagerWrap}
        onLayout={(e) => {
          // Don't prefill holeScrollOffset from currentHole — on web the
          // ScrollView's contentOffset doesn't reliably position before
          // children lay out, and lying about the offset lets the sync
          // effect skip its scrollTo when auto-jumping to the first
          // unplayed hole. Leave the ref at its actual value so the
          // effect corrects it.
          const { width, height } = e.nativeEvent.layout;
          setPagerSize({ width, height });
        }}
      >
        {pagerSize.width > 0 && pagerSize.height > 0 && (
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled={Platform.OS !== 'web'}
            style={PAGER_SNAP_TYPE_STYLE}
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScrollBeginDrag={() => {
              isUserScrollingHole.current = true;
              suppressHoleOnScroll.current = false;
              clearTimeout(suppressHoleTimer.current);
            }}
            onScroll={(e) => {
              const x = e.nativeEvent.contentOffset.x;
              holeScrollOffset.current = x;
              // Skip only during a programmatic scrollTo animation; live
              // commit during user drag AND its momentum so the match
              // panel / totals / next-hole button update the whole swipe.
              if (suppressHoleOnScroll.current) return;
              const newHole = Math.round(x / pagerSize.width) + 1;
              if (newHole !== currentHole) {
                // Tag so the sync effect skips scrollTo — the pager is
                // already at `newHole`; a scrollTo would fight the scroll.
                currentHoleFromScroll.current = true;
                // Non-urgent: keep the native scroll running smoothly while
                // React reconciles match panel / totals / bottom button.
                startTransition(() => onGoToHole(newHole));
              }
            }}
            // Keep isUserScrollingHole true through the momentum phase so
            // the sync effect doesn't scrollTo on top of the inertia.
            onScrollEndDrag={() => {}}
            onMomentumScrollEnd={(e) => {
              const x = e.nativeEvent.contentOffset.x;
              holeScrollOffset.current = x;
              isUserScrollingHole.current = false;
              suppressHoleOnScroll.current = false;
              clearTimeout(suppressHoleTimer.current);
              const newHole = Math.round(x / pagerSize.width) + 1;
              if (newHole !== currentHole) {
                currentHoleFromScroll.current = true;
                onGoToHole(newHole);
              }
            }}
            contentOffset={{ x: (currentHole - 1) * pagerSize.width, y: 0 }}
          >
            {round.holes.map((pageHole) => (
              <HolePage
                key={pageHole.number}
                pageHole={pageHole}
                isActive={pageHole.number === currentHole}
                width={pagerSize.width}
                height={pagerSize.height}
                courseName={round.courseName}
                roundIndex={roundIndex}
                round={round}
                players={players}
                scores={scores}
                shotDetails={shotDetails}
                meId={meId}
                onSetShot={onSetShot}
                theme={theme}
                s={s}
                onStep={onStep}
                onSetScore={onSetScore}
                editable={editable}
                getScoreAnim={getScoreAnim}
                showRunning={showRunning}
                mode={rawMode === 'matchplay' ? 'matchplay'
                  : rawMode === 'sindicato' ? 'sindicato'
                  : rawMode === 'pairsmatchplay' ? 'pairsmatchplay'
                  : isScrambleMode(rawMode) ? rawMode
                  : isBestBall ? 'bestball' : 'stableford'}
                official={official}
                officialDiscrepancy={officialDiscrepancy}
                onOpenDiscrepancy={openDiscrepancy}
                onOpenConflict={openConflict}
                shotCollapsed={shotCollapsed}
                onToggleShotDetail={toggleShotDetail}
                totalsMap={scorecardTotals}
                conflictHoles={conflictHoles}
              />
            ))}
          </ScrollView>
        )}
      </View>

      {/* Unified round summary — pinned above the bottom controls. One panel
          renders every game mode (pairs / players / solo) from summaryState.
          Gated behind the showRunning eye toggle (mirrors old stableford/solo
          running-score visibility behaviour). */}
      {showRunning && (
        <RoundSummary
          mode={rawMode}
          round={round}
          players={players}
          scores={scores}
          settings={settings}
          currentHole={currentHole}
          meId={meId}
        />
      )}

      {/* Bottom controls: actions (finish / go-to-hole / next) */}
      <View style={s.bottomBar}>
        <View style={s.bottomActionsRow}>
          {showQuickFinish && !onLastHole && (
            <TouchableOpacity
              style={[s.quickFinishBtn, finishBusy && s.saveBtnDisabled]}
              onPress={onFinish}
              disabled={finishBusy}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Finish game"
            >
              <Feather name="flag" size={15} color={theme.text.inverse} />
              <Text style={s.quickFinishBtnText}>
                {finishBusy ? 'Finishing' : 'Finish'}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={s.notesPillBtn}
            onPress={() => setHolePickerOpen(true)}
            activeOpacity={0.7}
            accessibilityLabel="Jump to hole"
          >
            <Feather name="list" size={14} color={theme.text.muted} />
            <Text style={s.notesPillBtnText}>Go to hole</Text>
          </TouchableOpacity>
          {(() => {
            // Last-hole affordance. Official mode (Task 16) replaces the casual
            // "Finish" with "Attest my card": disabled while the holder has
            // open discrepancies or a request is in flight, hidden once done.
            if (official && onLastHole) {
              const hasDiscrepancies = (officialDiscrepancy?.myHoles?.length ?? 0) > 0;
              const attestDisabled = hasDiscrepancies || officialAttestBusy
                || officialHasAttested;
              const label = officialHasAttested
                ? 'Attested'
                : officialAttestBusy ? 'Attesting…' : 'Attest my card';
              return (
                <TouchableOpacity
                  style={[s.saveBtn, attestDisabled && s.saveBtnDisabled]}
                  onPress={onAttest}
                  disabled={attestDisabled}
                  activeOpacity={0.8}
                  accessibilityLabel="Attest my card"
                >
                  <Text style={s.saveBtnText}>{label}</Text>
                  <Feather
                    name={officialHasAttested ? 'check-circle' : 'flag'}
                    size={18}
                    color={theme.text.inverse}
                  />
                </TouchableOpacity>
              );
            }
            const primaryDisabled = onLastHole && finishBusy;
            return (
              <TouchableOpacity
                style={[s.saveBtn, primaryDisabled && s.saveBtnDisabled]}
                onPress={onLastHole ? onFinish : onNext}
                disabled={primaryDisabled}
                activeOpacity={0.8}
              >
                <Text style={s.saveBtnText}>
                  {primaryDisabled ? 'Finishing' : onLastHole ? 'Finish' : `Hole ${currentHole + 1}`}
                </Text>
                <Feather
                  name={onLastHole ? 'flag' : 'chevron-right'}
                  size={18}
                  color={theme.text.inverse}
                />
              </TouchableOpacity>
            );
          })()}
        </View>
        {official && currentHole >= holeCount && (officialHasAttested
          || (officialDiscrepancy?.myHoles?.length ?? 0) > 0 || officialAttestError) && (
          <Text style={s.attestHint}>
            {officialHasAttested
              ? 'Attested — waiting for your party'
              : officialAttestError
                ? officialAttestError
                : 'Resolve discrepancies before attesting'}
          </Text>
        )}
      </View>

      {/* Go-to-hole modal */}
      <Modal statusBarTranslucent hardwareAccelerated
        visible={holePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setHolePickerOpen(false)}
      >
        <Pressable style={s.notesBackdrop} onPress={() => setHolePickerOpen(false)}>
          <Pressable style={s.holePickerSheet} onPress={() => {}}>
            <Text style={s.notesTitle}>Jump to hole</Text>
            <View style={s.holePickerGrid}>
              {round.holes.map((h) => {
                const n = h.number;
                const hasAnyScore = players.some((p) => scores[p.id]?.[n] != null);
                const hasNote = !!(notes?.hole?.[n] ?? '').trim();
                // Official mode: red dot on holes where the token holder's
                // own self/marker entries disagree (their discrepancy holes).
                const hasDiscrepancy = official && officialDiscrepancy
                  ? officialDiscrepancy.myHoles.includes(n)
                  : false;
                const hasConflict = conflictHoles.has(n);
                return (
                  <TouchableOpacity
                    key={n}
                    style={[
                      s.holePickerBtn,
                      n === currentHole && s.holePickerBtnActive,
                      hasAnyScore && n !== currentHole && s.holePickerBtnDone,
                    ]}
                    onPress={() => { onGoToHole(n); setHolePickerOpen(false); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.holePickerBtnText, n === currentHole && s.holePickerBtnTextActive]}>{n}</Text>
                    {hasDiscrepancy ? (
                      // Discrepancy takes visual priority over a note dot.
                      <View
                        style={[s.holePickerNoteDot, { backgroundColor: theme.destructive }]}
                      />
                    ) : hasConflict ? (
                      <View
                        style={[s.holePickerNoteDot, { backgroundColor: '#c77a0a' }]}
                      />
                    ) : hasNote ? (
                      <View
                        style={[
                          s.holePickerNoteDot,
                          {
                            backgroundColor: n === currentHole
                              ? theme.text.inverse
                              : theme.accent.primary,
                          },
                        ]}
                      />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Official-mode discrepancy resolve sheet. Opened by tapping a hero
          card flagged 'discrepancy'. Casual mode never sets discrepancyTarget. */}
      {official && officialDiscrepancy && discrepancyTarget && (() => {
        const { hole: dHole, subjectRosterId } = discrepancyTarget;
        const { self, marker } = officialDiscrepancy.cellEntries(subjectRosterId, dHole);
        const subject = players.find((p) => p.id === subjectRosterId);
        const src = officialEditableSource ? officialEditableSource(subjectRosterId) : null;
        return (
          <DiscrepancySheet
            visible
            onClose={() => setDiscrepancyTarget(null)}
            hole={dHole}
            subjectName={subject?.name ?? 'Player'}
            selfStrokes={self}
            markerStrokes={marker}
            markerName={officialDiscrepancy.markerNameFor(subjectRosterId)}
            editableSource={src}
            onChange={(strokes) => {
              // Route the viewer's edit through the hook's setScore for the
              // entry they own. A pure read-only viewer (src === null) has no
              // editable side; onChange is then a no-op.
              if (src && officialSetScore) {
                officialSetScore(subjectRosterId, dHole, strokes, src);
              }
            }}
          />
        );
      })()}

      {/* Casual-mode score conflict resolve sheet. Opened by tapping a hero
          card flagged with a conflict marker. */}
      {conflictTarget && (() => {
        const { hole: cHole, playerId } = conflictTarget;
        const d = deriveCell(round, playerId, cHole);
        if (d.status !== 'conflict') return null;
        const subject = players.find((p) => p.id === playerId);
        return (
          <ScoreConflictSheet
            visible
            onClose={() => setConflictTarget(null)}
            hole={cHole}
            subjectName={subject?.name ?? 'Player'}
            candidates={d.candidates.map((c) => ({ value: c.value, ts: c.ts, authorId: c.authorId, authorName: authorName?.(c.authorId) ?? 'Someone' }))}
            blankAuthors={d.blankAuthors.map((a) => authorName?.(a) ?? 'Someone')}
            currentValue={d.effective}
            onResolve={(value) => {
              onResolveConflict?.(playerId, cHole, value);
              setConflictTarget(null);
            }}
          />
        );
      })()}

      <CelebrationOverlay celebration={celebration} celebrationAnim={celebrationAnim} players={players} />
    </View>
  );
}

function CelebrationOverlay({ celebration, celebrationAnim, players }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);

  if (!celebration?.label) return null;
  const tier = CELEBRATION_TIERS[celebration.label] ?? CELEBRATION_TIERS.BIRDIE;
  const player = players.find((p) => p.id === celebration.playerId);
  const firstName = player?.name?.split(' ')[0] ?? '';

  const scrimOpacity = celebrationAnim.interpolate({
    inputRange: [0, 1], outputRange: [0, 0.55],
  });
  const cardOpacity = celebrationAnim;
  const cardScale = celebrationAnim.interpolate({
    inputRange: [0, 1], outputRange: [0.75, 1],
  });
  const cardTranslate = celebrationAnim.interpolate({
    inputRange: [0, 1], outputRange: [16, 0],
  });
  const ringScale = celebrationAnim.interpolate({
    inputRange: [0, 1], outputRange: [0.6, 1.35],
  });
  const ringOpacity = celebrationAnim.interpolate({
    inputRange: [0, 0.5, 1], outputRange: [0, 0.6, 0],
  });

  return (
    <View pointerEvents="none" style={s.celebrationRoot}>
      <Animated.View style={[s.celebrationScrim, { opacity: scrimOpacity }]} />
      <Animated.View
        style={[
          s.celebrationRing,
          {
            borderColor: tier.glow,
            opacity: ringOpacity,
            transform: [{ scale: ringScale }],
          },
        ]}
      />
      <Animated.View
        style={[
          s.celebrationCard,
          {
            opacity: cardOpacity,
            borderColor: tier.accent,
            shadowColor: tier.accent,
            transform: [{ scale: cardScale }, { translateY: cardTranslate }],
          },
        ]}
      >
        <View style={[s.celebrationIconWrap, { borderColor: tier.accent }]}>
          <Feather name={tier.icon} size={22} color={tier.accent} />
        </View>
        <Text style={[s.celebrationEyebrow, { color: tier.accent }]}>{tier.eyebrow}</Text>
        <Text style={s.celebrationLabelBig}>{celebration.label}</Text>
        {!!firstName && (
          <Text style={s.celebrationSubtitle}>
            {firstName} · Hole {celebration.holeNumber}
          </Text>
        )}
      </Animated.View>
    </View>
  );
}
