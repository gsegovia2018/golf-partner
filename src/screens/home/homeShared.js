import { Platform, Alert } from 'react-native';
import { isScrambleMode } from '../../components/scoringModes';
import { isRoundComplete } from '../../store/tournamentStore';
import { t } from '../../i18n';

// Pick the round to land on when entering the tournament view.
// currentRound is an unreliable, often-stale cross-device pointer (it can lag
// at 0 while later rounds are fully scored), so derive the landing round from
// the scores themselves: go to the furthest round play has actually reached
// (the last round with any scores). If that round is complete and a later
// round exists, jump to the next one — that's where play is headed.
export function chooseInitialRound(tournament) {
  const rounds = tournament?.rounds ?? [];
  if (rounds.length === 0) return 0;
  const players = tournament?.players ?? [];
  let last = -1;
  for (let i = 0; i < rounds.length; i++) {
    const scores = rounds[i]?.scores;
    if (scores && Object.keys(scores).length > 0) last = i;
  }
  if (last < 0) return Math.min(tournament?.currentRound ?? 0, rounds.length - 1);
  if (last < rounds.length - 1 && isRoundComplete(rounds[last], players)) return last + 1;
  return last;
}

export function showError(message, title = t('home.common.error')) {
  if (Platform.OS === 'web') window.alert(message);
  else Alert.alert(title, message);
}

export function currentOrigin() {
  return Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.location.origin
    : '';
}

// Short label for a leaderboard's native scoring mode, used in the LEADERBOARD
// card header ("R2 · Match Play"). Mirrors scoringModes.js's fuller labels but
// stays local since this card only ever needs the short form.
const ROUND_MODE_LABEL_KEYS = {
  stableford: 'home.roundMode.stableford',
  matchplay: 'home.roundMode.matchplay',
  sindicato: 'home.roundMode.sindicato',
  bestball: 'home.roundMode.bestball',
  pairsmatchplay: 'home.roundMode.pairsmatchplay',
};
export function roundModeLabel(mode, tx) {
  if (mode?.startsWith?.('scramble')) return tx('home.roundMode.scramble');
  return tx(ROUND_MODE_LABEL_KEYS[mode] ?? 'home.roundMode.stableford');
}

// True "Stroke Play" alt-view modes: the alt toggle re-sorts by gross
// strokes. Other modes (matchplay/sindicato/bestball/pairsmatchplay) label
// their alt toggle "Stableford" instead, so their alt view stays in points
// order rather than being strokes-sorted.
export function isStrokePlayAlt(m) {
  return m === 'stableford' || m === 'individual' || isScrambleMode(m);
}

// "Marcos + Noé vs Guille + Alex" — the tournament's fixed pairs, first
// names only, read from round 1 (fixedTeams keeps them identical everywhere).
export function pairsPreviewText(tournament) {
  const pairs = tournament?.rounds?.[0]?.pairs ?? [];
  if (pairs.length !== 2) return '';
  const firstName = (p) => {
    const live = tournament.players?.find((x) => x.id === p.id);
    return ((live ?? p)?.name ?? '').split(' ')[0];
  };
  return pairs.map((pr) => pr.map(firstName).join(' + ')).join(' vs ');
}
