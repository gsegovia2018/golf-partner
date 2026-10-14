// The text to show for a league error, in the viewer's language. A LeagueError
// (store/leagueStore.js) carries `descriptor` when its sentence is in the
// catalogue (store/leagueErrors.js); anything else shows its own message, and
// '' when there is none, so `leagueErrorText(e) || fallback` still works.
import { tr, formatDate } from '../i18n';
import { leagueErrorDescriptor } from '../store/leagueErrors';

export function leagueErrorText(error) {
  if (!error) return '';
  const msg = error.descriptor ?? leagueErrorDescriptor(error.message, error.hint);
  if (!msg) return error.message || '';
  const p = { ...msg.params };
  if (p.otherMonthKey) p.otherMonth = formatDate(`${p.otherMonthKey}-01`, 'monthName');
  if (p.fromDate) p.from = formatDate(p.fromDate, 'day');
  if (p.toDate) p.to = formatDate(p.toDate, 'day');
  return tr({ key: msg.key, params: p });
}
