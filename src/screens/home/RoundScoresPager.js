import React, { useEffect, useState, useRef, startTransition } from 'react';
import { View, ScrollView, Platform } from 'react-native';
import { roundScoringMode } from '../../store/scoring';
import RoundPage, { PAGER_SNAP_TYPE_STYLE } from './RoundPage';

// Horizontal pager — swipe to change round, stays in sync with the tabs.
// `onSwipe(idx, { transition })` commits a round the user scrolled to.
export default function RoundScoresPager({
  tournament, isGame, isPast, isViewer, showRunning, theme, s,
  selectedRound, onSwipe, onGoToRound, onOpenEdit,
}) {
  const [roundPagerWidth, setRoundPagerWidth] = useState(0);
  const roundPagerRef = useRef(null);
  const roundScrollOffset = useRef(0);
  const isUserScrollingRound = useRef(false);
  const roundPagerInitialized = useRef(false);
  // True while a programmatic scrollTo animation is in flight. Used to
  // stop onScroll from committing mid-animation (which would make the
  // pager fight its own scroll). User drags/momentum are NOT suppressed.
  const suppressRoundOnScroll = useRef(false);
  const suppressRoundTimer = useRef(null);
  // True when the latest selectedRound change came from a scroll commit
  // (onScroll / onMomentumScrollEnd). The sync effect uses this to skip
  // the scrollTo — the scroll is already at the right place. Without
  // this guard, a transition commit lagging behind the scroll settle can
  // trigger a visible mini-scroll back to an intermediate page.
  const selectedRoundFromScroll = useRef(false);

  // Keep round pager in sync with selectedRound (tab taps, arrow buttons).
  // Skip while the user is dragging, and skip if this commit came from a
  // scroll (the pager is already at the right place). Animate so taps
  // slide smoothly instead of snapping.
  useEffect(() => {
    if (selectedRoundFromScroll.current) {
      selectedRoundFromScroll.current = false;
      return;
    }
    if (!roundPagerRef.current || roundPagerWidth <= 0) return;
    if (isUserScrollingRound.current) return;
    const target = selectedRound * roundPagerWidth;
    if (Math.abs(roundScrollOffset.current - target) < 1) return;
    // Suppress onScroll commits while the animation runs, so intermediate
    // offsets don't reset selectedRound and make the pager fight itself.
    suppressRoundOnScroll.current = true;
    clearTimeout(suppressRoundTimer.current);
    suppressRoundTimer.current = setTimeout(() => {
      suppressRoundOnScroll.current = false;
    }, 450);
    roundPagerRef.current.scrollTo({ x: target, animated: roundPagerInitialized.current });
    roundScrollOffset.current = target;
    roundPagerInitialized.current = true;
  }, [selectedRound, roundPagerWidth]);

  return (
    <View
      testID="round-pager-wrap"
      style={s.roundPagerWrap}
      onLayout={(e) => {
        // Don't prefill roundScrollOffset from selectedRound — on web
        // the ScrollView's contentOffset can't position before the
        // children lay out, and if we lie that we're already there the
        // sync effect below skips its scrollTo. Leave the ref at its
        // actual value (0 on first mount) so the effect corrects it.
        setRoundPagerWidth(e.nativeEvent.layout.width);
      }}
    >
      {roundPagerWidth > 0 && (isGame ? (
        <RoundPage
          round={tournament.rounds[0]}
          index={0}
          width={roundPagerWidth}
          hasPrev={false}
          hasNext={false}
          revealed
          players={tournament.players}
          meId={tournament.meId}
          theme={theme}
          s={s}
          onGoToRound={onGoToRound}
          isSingleRound
          showRunning={showRunning}
          scoringMode={roundScoringMode(tournament, tournament.rounds[0])}
        />
      ) : (
        <ScrollView
          testID="round-pager"
          ref={roundPagerRef}
          horizontal
          pagingEnabled={Platform.OS !== 'web'}
          style={PAGER_SNAP_TYPE_STYLE}
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onLayout={() => {
            // Never scroll out from under the user's finger — e.g. a
            // viewport reflow firing layout mid-swipe on web.
            if (isUserScrollingRound.current) return;
            // A remount (list ↔ tournament switch, or a modal-driven
            // re-layout) resets the ScrollView's real offset to 0 on web
            // while roundScrollOffset still holds the last position, so
            // the sync effect thinks nothing moved. Re-assert the
            // selected page — a no-op when already there.
            const target = selectedRound * roundPagerWidth;
            roundPagerRef.current?.scrollTo({ x: target, animated: false });
            roundScrollOffset.current = target;
          }}
          onScrollBeginDrag={() => {
            isUserScrollingRound.current = true;
            // User gesture overrides any in-flight programmatic scroll.
            suppressRoundOnScroll.current = false;
            clearTimeout(suppressRoundTimer.current);
          }}
          onScroll={(e) => {
            const x = e.nativeEvent.contentOffset.x;
            roundScrollOffset.current = x;
            // Skip only during a programmatic scrollTo animation.
            // Live-commit throughout the user's drag AND its momentum
            // so the leaderboard / bubbles update during the whole
            // swipe, not just the drag phase.
            if (suppressRoundOnScroll.current) return;
            const idx = Math.round(x / roundPagerWidth);
            if (idx !== selectedRound) {
              // Tag so the sync effect skips scrollTo — the pager is
              // already at `idx`; a scrollTo would fight the scroll.
              selectedRoundFromScroll.current = true;
              // Non-urgent: let the native scroll keep running smoothly
              // while React reconciles leaderboard / tabs / round card.
              startTransition(() => onSwipe(idx));
            }
          }}
          // Keep isUserScrollingRound true through the momentum phase
          // so the sync effect doesn't scrollTo on top of the inertia.
          onScrollEndDrag={() => {}}
          onMomentumScrollEnd={(e) => {
            const x = e.nativeEvent.contentOffset.x;
            roundScrollOffset.current = x;
            isUserScrollingRound.current = false;
            suppressRoundOnScroll.current = false;
            clearTimeout(suppressRoundTimer.current);
            const idx = Math.round(x / roundPagerWidth);
            if (idx !== selectedRound) {
              selectedRoundFromScroll.current = true;
              onSwipe(idx);
            }
          }}
          contentOffset={{ x: selectedRound * roundPagerWidth, y: 0 }}
        >
          {tournament.rounds.map((round, i) => (
            <RoundPage
              key={round.id}
              round={round}
              index={i}
              width={roundPagerWidth}
              hasPrev={i > 0}
              hasNext={i < tournament.rounds.length - 1}
              revealed={!!round.revealed || i <= tournament.currentRound}
              players={tournament.players}
              meId={tournament.meId}
              theme={theme}
              s={s}
              onGoToRound={onGoToRound}
              onOpenEdit={isViewer ? null : onOpenEdit}
              isSingleRound={tournament.rounds.length === 1}
              showRunning={showRunning}
              scoringMode={roundScoringMode(tournament, round)}
              scorecardSettings={isPast ? tournament.settings : null}
            />
          ))}
        </ScrollView>
      ))}
    </View>
  );
}
