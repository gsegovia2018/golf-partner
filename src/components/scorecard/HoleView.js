import React, { useEffect, useRef, useState, useCallback, useMemo, startTransition } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, Modal, Pressable, KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { makeScorecardStyles } from './styles';
import { HolePage, MePicker } from './HolePage';
import { RoundSummary } from './RoundSummary';
import { roundTotals } from './scoreModel';
import { CELEBRATION_TIERS } from './constants';
import DiscrepancySheet from '../DiscrepancySheet';
import { getShotDetailCollapsed, setShotDetailCollapsed } from '../../lib/prefs';

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

export function HoleView({ round, roundIndex, players, scores, shotDetails, meId, onSetShot, onPickMe, notes, currentHole, hole, isBestBall, bbResult, settings, onStep, onSetScore, editable, onRoundNoteChange, onHoleNoteChange, onPrev, onNext, onGoToHole, onGoBack, onFinish, holeCount, playerTotals, showRunning, getScoreAnim, celebration, celebrationAnim, refreshing, onRefresh, official, officialDiscrepancy, officialEditableSource, officialSetScore, officialHasAttested, officialAttestBusy, officialAttestError, onAttest }) {
  const { theme } = useTheme();
  const isSindicato = settings?.scoringMode === 'sindicato';
  // Notes split: the current hole's note plus the shared round-level note.
  const holeNote = notes?.hole?.[currentHole] ?? '';
  const roundNote = notes?.round ?? '';
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [holePickerOpen, setHolePickerOpen] = useState(false);
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
  const scorecardTotals = useMemo(
    () => roundTotals({
      mode: settings?.scoringMode ?? 'stableford',
      round,
      players,
      scores,
      handicaps: round?.playerHandicaps ?? {},
    }),
    [settings?.scoringMode, round, players, scores],
  );

  if (!hole) return null;

  return (
    <View style={s.flex}>
      {/* Shot tracking needs to know which player is "me". Solo rounds and
          signed-in users are resolved automatically; otherwise prompt. */}
      {!meId && players.length > 1 && (
        <MePicker players={players} onPickMe={onPickMe} theme={theme} s={s} />
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
                mode={settings?.scoringMode === 'matchplay' ? 'matchplay'
                  : settings?.scoringMode === 'sindicato' ? 'sindicato'
                  : isBestBall ? 'bestball' : 'stableford'}
                official={official}
                officialDiscrepancy={officialDiscrepancy}
                onOpenDiscrepancy={(subjectRosterId, holeNumber) =>
                  setDiscrepancyTarget({ hole: holeNumber, subjectRosterId })}
                shotCollapsed={shotCollapsed}
                onToggleShotDetail={toggleShotDetail}
                totalsMap={scorecardTotals}
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
          mode={settings?.scoringMode ?? 'stableford'}
          round={round}
          players={players}
          scores={scores}
          settings={settings}
          currentHole={currentHole}
          meId={meId}
        />
      )}

      {/* Bottom controls: actions (notes / go-to-hole / next) */}
      <View style={s.bottomBar}>
        <View style={s.bottomActionsRow}>
          <TouchableOpacity
            style={s.notesPillBtn}
            onPress={() => setNotesOpen(true)}
            activeOpacity={0.7}
          >
            <Feather
              name={holeNote.trim() ? 'edit-3' : 'edit-2'}
              size={14}
              color={holeNote.trim() ? theme.accent.primary : theme.text.muted}
            />
            <Text style={[s.notesPillBtnText, holeNote.trim() && s.notesPillBtnTextActive]}>
              Notes
            </Text>
          </TouchableOpacity>
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
            const onLastHole = currentHole >= holeCount;
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
            return (
              <TouchableOpacity
                style={s.saveBtn}
                onPress={onLastHole ? onFinish : onNext}
                activeOpacity={0.8}
              >
                <Text style={s.saveBtnText}>
                  {onLastHole ? 'Finish' : `Hole ${currentHole + 1}`}
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

      {/* Notes modal — per-hole note + shared round note */}
      <Modal
        visible={notesOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setNotesOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={s.notesModalKav}
        >
          <Pressable style={s.notesBackdrop} onPress={() => setNotesOpen(false)}>
            <Pressable style={s.notesSheet} onPress={() => {}}>
              <View style={s.notesHandle} />
              <View style={s.notesHeader}>
                <Text style={s.notesTitle}>Notes</Text>
                <TouchableOpacity onPress={() => setNotesOpen(false)} style={s.notesCloseBtn}>
                  <Feather name="x" size={18} color={theme.text.secondary} />
                </TouchableOpacity>
              </View>
              <Text style={s.notesFieldLabel}>{`Hole ${currentHole}`}</Text>
              <TextInput
                style={s.notesModalInputCompact}
                placeholder={`Notes for hole ${currentHole}`}
                placeholderTextColor={theme.text.muted}
                keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                selectionColor={theme.accent.primary}
                multiline
                value={holeNote}
                onChangeText={(text) => onHoleNoteChange(currentHole, text)}
              />
              <Text style={[s.notesFieldLabel, s.notesFieldLabelSpaced]}>Round</Text>
              <TextInput
                style={s.notesModalInputCompact}
                placeholder="What happened this round?"
                placeholderTextColor={theme.text.muted}
                keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                selectionColor={theme.accent.primary}
                multiline
                value={roundNote}
                onChangeText={onRoundNoteChange}
              />
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Go-to-hole modal */}
      <Modal
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
