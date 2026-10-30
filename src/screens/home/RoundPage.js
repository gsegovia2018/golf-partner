import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import RoundScoreboard from '../../components/RoundScoreboard';
import { resolveScorecardRows } from '../../components/scorecard/GridView';
import ShotScorecard from '../../components/scorecard/ShotScorecard';
import { ModeToggle } from '../../components/gamestats/ui';
import Reveal from '../../components/ui/Reveal';
import { duration } from '../../theme/motion';
import { scorecardModel } from '../../store/scorecardView';
import { useT } from '../../i18n';

// Web-only CSS scroll-snap. See ScorecardScreen.js for the rationale:
// RNW 0.21's `pagingEnabled` omits `scroll-snap-stop: always`, so a
// fast swipe can skip past one page. On web we drive snap ourselves.
export const PAGER_SNAP_TYPE_STYLE = Platform.OS === 'web' ? { scrollSnapType: 'x mandatory', overflowX: 'auto' } : null;
const PAGER_PAGE_SNAP_STYLE = Platform.OS === 'web' ? { scrollSnapAlign: 'start', scrollSnapStop: 'always' } : null;

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

// Memoized round pager page. Extracted so changing selectedRound during
// a swipe only re-renders the outside leaderboard / tab bar — the 3
// round pages stay memoized with stable refs.
const RoundPage = React.memo(function RoundPage({
  round, index, width, hasPrev, hasNext, revealed,
  players, meId, theme, s,
  onGoToRound, onOpenEdit, isSingleRound, showRunning = true, scoringMode = null,
  scorecardSettings = null,
}) {
  const t = useT();
  const hasScores = round.scores && Object.keys(round.scores).length > 0;
  return (
    <View
      style={[{ width }, PAGER_PAGE_SNAP_STYLE]}
      dataSet={Platform.OS === 'web' ? { pagerpage: '1' } : undefined}
    >
      {/* Single-round games render course + gear in the card title row, so
          this ROUND N / prev-next row is redundant and we skip it entirely. */}
      {!isSingleRound && (
        <View style={s.pagerTitleRow}>
          <TouchableOpacity
            style={[s.pagerArrow, !hasPrev && s.pagerArrowHidden]}
            onPress={() => hasPrev && onGoToRound(index - 1)}
            disabled={!hasPrev}
            activeOpacity={0.7}
            accessibilityLabel={t('home.round.prevA11y')}
          >
            <Feather name="chevron-left" size={18} color={theme.accent.primary} />
          </TouchableOpacity>
          <Text style={s.tabRoundTitle}>{t('home.round.title', { n: index + 1, course: round.courseName || '—' })}</Text>
          {onOpenEdit && (
            <TouchableOpacity
              onPress={() => onOpenEdit(index)}
              style={s.roundEditBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={t('home.round.optionsA11y')}
            >
              <Feather name="settings" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[s.pagerArrow, !hasNext && s.pagerArrowHidden]}
            onPress={() => hasNext && onGoToRound(index + 1)}
            disabled={!hasNext}
            activeOpacity={0.7}
            accessibilityLabel={t('home.round.nextA11y')}
          >
            <Feather name="chevron-right" size={18} color={theme.accent.primary} />
          </TouchableOpacity>
        </View>
      )}
      {scorecardSettings && hasScores ? (
        <PastRoundScorecard round={round} settings={scorecardSettings} players={players} meId={meId} s={s} />
      ) : hasScores || revealed ? (
        <RoundScoreboard round={round} players={players} meId={meId} showRunning={showRunning} scoringMode={scoringMode} />
      ) : (
        <Text style={s.emptyRoundHint}>{t('home.round.noScores')}</Text>
      )}
    </View>
  );
});
export default RoundPage;

// Hole-by-hole card of a played round, with the shots players logged — read
// only, no totals card (the leaderboard above already carries them). Points
// follow the round's mode; scramble rounds show one row per team. `title`
// sits left of the card's own Strokes | Points switch.
export function PastRoundScorecard({ round, settings, players, meId, s, title = null }) {
  const [mode, setMode] = useState('strokes');
  const card = useMemo(() => {
    const rows = resolveScorecardRows({ round, settings, players, meId });
    return scorecardModel({
      round, players: rows.rowPlayers, meId: rows.effectiveMeId, mode: rows.mode, handicaps: rows.rowHandicaps,
    });
  }, [round, settings, players, meId]);
  return (
    <View testID="past-round-scorecard">
      <View style={s.cardTitleRow}>
        {title ?? <View style={s.cardTitleLeft} />}
        <ModeToggle value={mode} onChange={setMode} testID="past-round-mode" />
      </View>
      <Reveal replay={mode} dy={4} duration={duration.state}>
        <ShotScorecard card={card} mode={mode} />
      </Reveal>
    </View>
  );
}
