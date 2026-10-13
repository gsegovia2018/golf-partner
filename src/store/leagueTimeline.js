// A league card's timeline (league_card_events, R13): pure helpers that turn a
// stored event into what the card screen draws. No I/O, no React, no strings:
// messages are { key, params } descriptors rendered with tr() (docs/i18n.md).
import { postByFor } from './leagueRules';

export const COLLAPSED_EVENTS = 3;

// 'Wrong tee: The club's tee sheet has him on the yellows.' -> reason + note.
// Without a ': ' a short text is just the reason, a long one is the note.
export function splitVoidReason(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { reason: null, note: null };
  const i = raw.indexOf(': ');
  if (i > 0 && i <= 40) return { reason: raw.slice(0, i), note: raw.slice(i + 2).trim() || null };
  return raw.length <= 40 ? { reason: raw, note: null } : { reason: null, note: raw };
}

const CHIP = {
  qr: 'league.timeline.how.qr',
  partner: 'league.timeline.how.partner',
  photo: 'league.timeline.how.photo',
  official: 'league.timeline.how.official',
  marker_request: 'league.timeline.how.marker',
};

// One event as a row: { id, icon (Feather), tone ('good' | 'warn' | 'bad' | null),
// title, detail (message | null), how (message | null: the who-and-how chip),
// note (quoted text | null), at }.
// opts: meId; fmt(isoOrDate) -> 'Sat 10 Oct 13:41' (a stand-in is used in tests);
// someone: the word for an actor with no known name; monthKey: the card's month.
export function describeCardEvent(ev, opts = {}) {
  const {
    meId = null, fmt = (d) => new Date(d).toISOString(), someone = 'Someone', monthKey = null,
  } = opts;
  const data = ev?.data ?? {};
  const name = ev?.actorName || someone;
  const you = !!meId && ev?.actorUserId === meId;
  // 'league.timeline.x' / 'league.timeline.xYou' (the viewer did it themselves).
  const by = (key) => ({ key: you ? `${key}You` : key, params: { name } });
  const row = (icon, tone, title, extra = {}) => ({
    id: ev.id, icon, tone, title, detail: null, how: null, note: ev.note ?? null, at: ev.at, ...extra,
  });
  const how = ev?.how && CHIP[ev.how] ? { key: CHIP[ev.how] } : null;
  const course = data.course_name ?? null;

  switch (ev?.kind) {
    case 'announced': {
      const offApp = data.source === 'offapp';
      let detail = null;
      if (offApp) {
        detail = course && data.tee_time
          ? { key: 'league.timeline.announcedOffDetail', params: { course, tee: fmt(data.tee_time) } }
          : null;
      } else if (course) detail = { key: 'league.timeline.announcedAppDetail', params: { course } };
      return row(offApp ? 'calendar' : 'flag', null, { key: offApp ? 'league.timeline.announcedOff' : 'league.timeline.announcedApp' }, { detail });
    }
    case 'rescheduled':
      return row('refresh-cw', null, { key: 'league.timeline.rescheduled', params: { to: fmt(data.to) } }, {
        detail: data.from ? { key: 'league.timeline.rescheduledDetail', params: { from: fmt(data.from) } } : null,
      });
    case 'first_shot': {
      const postBy = postByFor(ev.at);
      return row('play', null, { key: 'league.timeline.firstShot' }, {
        detail: postBy ? { key: 'league.timeline.postBy', params: { at: fmt(postBy) } } : null,
      });
    }
    case 'submitted': {
      const resubmit = !!data.resubmit;
      const hasPts = data.points != null;
      const key = resubmit ? (hasPts ? 'league.timeline.resubmittedPts' : 'league.timeline.resubmitted')
        : (hasPts ? 'league.timeline.submittedPts' : 'league.timeline.submitted');
      return row('send', null, { key, params: { points: data.points } }, {
        detail: data.after_return ? { key: 'league.timeline.afterReturn' } : null,
      });
    }
    case 'added':
      return row('send', null, {
        key: data.points != null ? 'league.timeline.addedPts' : 'league.timeline.added', params: { points: data.points },
      });
    case 'sent_to_marker':
      return row('user-check', null, {
        key: data.marker_name ? 'league.timeline.sentTo' : 'league.timeline.sent', params: { name: data.marker_name },
      });
    case 'returned':
      return row('corner-up-left', 'warn', { key: 'league.timeline.returned', params: { name } }, { how });
    case 'confirmed': {
      if (ev.how === 'photo') {
        return row('camera', 'good', { key: 'league.timeline.confirmedPhoto' }, {
          how, detail: ev.actorName ? { key: 'league.timeline.signedBy', params: { name: ev.actorName } } : null,
        });
      }
      if (ev.how === 'official') return row('check', 'good', { key: 'league.timeline.confirmedOfficial' }, { how });
      if (ev.how === 'partner') {
        return row('check', 'good', {
          key: ev.actorName ? 'league.timeline.confirmedPartner' : 'league.timeline.confirmedPartnerAnon', params: { name },
        }, { how });
      }
      // A QR marker signs with a typed name and no account: say so.
      const noAccount = ev.how === 'qr' && (data.marker_account === false || ev.actorUserId == null);
      if (noAccount) return row('check', 'good', { key: 'league.timeline.confirmedQrNoAccount', params: { name } }, { how });
      return row('check', 'good', {
        key: ev.actorName ? 'league.timeline.confirmedBy' : 'league.timeline.confirmed', params: { name },
      }, { how });
    }
    case 'approved': {
      let detail = null;
      if (data.not_announced) detail = { key: 'league.timeline.approvedNotAnnounced' };
      else if (data.tee_verified === false) detail = { key: 'league.timeline.approvedHandTee' };
      return row('user-check', 'good', by('league.timeline.approved'), { detail });
    }
    case 'reopened':
      return row('rotate-ccw', null, by('league.timeline.reopened'), {
        detail: data.post_by ? { key: 'league.timeline.reopenedDetail', params: { at: fmt(data.post_by) } } : null,
      });
    case 'missed':
      return row('clock', 'warn', { key: 'league.timeline.missed' });
    case 'withdrawn':
      return row('log-out', 'bad', by('league.timeline.withdrawn'), {
        detail: monthKey ? { key: 'league.timeline.withdrawnDetail', params: { monthKey } } : null,
      });
    case 'auto_withdrawn':
      return row('log-out', 'bad', { key: 'league.timeline.autoWithdrawn' }, { detail: { key: 'league.timeline.autoWithdrawnDetail' } });
    case 'played_after_withdraw':
      return row('alert-circle', 'warn', { key: 'league.timeline.playedAfter' }, {
        detail: monthKey
          ? { key: data.month_taken ? 'league.timeline.playedAfterTaken' : 'league.timeline.playedAfterFree', params: { monthKey } }
          : null,
      });
    case 'voided': {
      const { reason, note } = splitVoidReason(ev.note);
      return row('slash', 'bad', {
        key: reason ? (you ? 'league.timeline.voidedReasonYou' : 'league.timeline.voidedReason') : (you ? 'league.timeline.voidedYou' : 'league.timeline.voided'),
        params: { name, reason },
      }, { note });
    }
    default:
      return row('circle', null, { key: 'league.timeline.unknown', params: { kind: ev?.kind ?? '' } });
  }
}

// What the card shows: the newest COLLAPSED_EVENTS, or all of them once
// expanded. hidden = how many "Show all" would reveal.
export function visibleEvents(events, expanded = false) {
  const list = events ?? [];
  if (expanded || list.length <= COLLAPSED_EVENTS) return { shown: list, hidden: 0 };
  return { shown: list.slice(-COLLAPSED_EVENTS), hidden: list.length - COLLAPSED_EVENTS };
}
