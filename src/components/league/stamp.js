import { formatDate } from '../../i18n';
import { timeLabel } from '../../store/leagueOffApp';

// 'Sat 17 Oct 07:20' / 'sáb 17 oct 07:20' for an instant (Date or ISO); '' if invalid.
export function stamp(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${formatDate(d, 'short')} ${timeLabel(d)}`;
}
