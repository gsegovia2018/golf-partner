// Member names and handicap history lines for the league screens, in the
// viewer's language ("You" / "Tú"). They return finished text, so call them at
// render time (never cache the result); stores take a `nameOf` from the screen.
import { t, formatNumber, formatDate } from '../i18n';

export function memberLabel(member, meId) {
  if (member.userId === meId) return t('league.view.you');
  return member.displayName || member.username || t('league.view.golfer');
}

export function memberName(members, userId, meId) {
  const m = (members ?? []).find((x) => x.userId === userId);
  return m ? memberLabel(m, meId) : t('league.view.formerMember');
}

const REASONS = new Set(['set', 'proposed', 'vote']);
const hcp = (n) => formatNumber(n, { decimals: 1 });

// One handicap history line: "Nacho 24.0 → 21.0 · by vote · 12 Jun".
export function handicapEventLine(event, members, meId) {
  const name = memberName(members, event.userId, meId);
  const move = event.old == null
    ? t('league.view.hcpEvent.set', { name, value: hcp(event.new) })
    : t('league.view.hcpEvent.move', { name, old: hcp(event.old), new: hcp(event.new) });
  const reason = REASONS.has(event.reason) ? t(`league.view.hcpReason.${event.reason}`) : event.reason;
  const day = formatDate(new Date(event.at), 'day');
  return [move, reason, day].filter(Boolean).join(' · ');
}
