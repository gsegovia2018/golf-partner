// Push title/body in the recipient's language. Plain JS with no imports from
// the app, so both Deno (send-push) and Jest can load it.
//
// The copy is NOTIFICATION_COPY (./notificationCopy.js), generated from the
// app catalogues (src/i18n/locales/*/notifications.js). The rendering below
// mirrors renderNotification in src/lib/notificationContent.js line for line;
// src/lib/__tests__/notificationPush.test.js renders every push type through
// both, in en and es, and fails on any difference. docs/i18n.md.
import { NOTIFICATION_COPY, NOTIFICATION_MONTHS } from './notificationCopy.js';

const SEP = { en: { decimal: '.', group: ',' }, es: { decimal: ',', group: '.' } };
const CASED_PARAMS = new Set(['month', 'otherMonth', 'weekday']);
const PARAM = /\{(\w+)\}/g;
const startsSentence = (whole, offset) => /(^|[.!?¿¡]\s+|\n\s*)$/.test(whole.slice(0, offset));

// 'es' | 'en' from a stored profiles.locale; anything else is English.
export function pushLocale(locale) {
  return locale === 'es' ? 'es' : 'en';
}

// Same contract as t() in src/i18n: missing key -> English -> the key; in
// Spanish a {month} that starts a sentence is capitalised.
function translate(key, params, lang) {
  let entry = NOTIFICATION_COPY[lang]?.[key];
  if (entry === undefined) entry = NOTIFICATION_COPY.en[key];
  if (entry === undefined) return key;
  return String(entry).replace(PARAM, (m, name, offset, whole) => {
    if (params?.[name] === undefined) return m;
    const value = String(params[name]);
    return CASED_PARAMS.has(name) && lang === 'es' && startsSentence(whole, offset)
      ? value.charAt(0).toUpperCase() + value.slice(1)
      : value;
  });
}

// formatNumber(v, { maxDecimals: 2 }, lang) from src/i18n/format.js.
function formatNumber(value, lang) {
  const n = Number(value);
  if (value == null || value === '' || !Number.isFinite(n)) return '';
  let fixed = Math.abs(n).toFixed(2);
  if (fixed.includes('.')) fixed = fixed.replace(/\.?0+$/, '');
  const [intPart, frac] = fixed.split('.');
  const { decimal, group } = SEP[lang] ?? SEP.en;
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const sign = n < 0 && Number(fixed) !== 0 ? '-' : '';
  return sign + grouped + (frac ? decimal + frac : '');
}

// 'YYYY-MM-DD' (league month, first day) -> 'October' / 'octubre'. '' when unparseable.
function monthName(month, lang) {
  const m = /^(\d{4})-(\d{2})/.exec(String(month ?? ''));
  const n = m ? Number(m[2]) : 0;
  if (n < 1 || n > 12) return '';
  return NOTIFICATION_MONTHS[lang][n - 1];
}

function pointsValue(points) {
  const n = Number(points);
  if (points == null || points === '' || !Number.isFinite(n)) return null;
  return n;
}

function fullCard(data, T, lang) {
  const month = monthName(data.month, lang);
  if (month && data.course_name) return T('notif.card.monthCourse', { month, course: data.course_name });
  if (month) return T('notif.card.month', { month });
  if (data.course_name) return T('notif.card.course', { course: data.course_name });
  return T('notif.card.plain');
}

function monthCard(data, T, lang) {
  const month = monthName(data.month, lang);
  return month ? T('notif.card.month', { month }) : T('notif.card.plain');
}

const localeTag = (lang) => (lang === 'es' ? 'es-ES' : 'en-GB');

// 'Sat 25 Oct, 09:00' in Europe/Madrid; '' when unparseable.
function teeTimeText(iso, lang) {
  if (!iso) return '';
  try {
    const d = new Date(String(iso));
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(localeTag(lang), {
      timeZone: 'Europe/Madrid', weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit',
    }).format(d);
  } catch (_e) {
    return '';
  }
}

// '09:00' in Europe/Madrid. The inbox uses the device's zone; a server has
// none, and the league runs on Madrid time.
function postByTime(iso, lang) {
  if (!iso) return '';
  try {
    const d = new Date(String(iso));
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(localeTag(lang), {
      timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit',
    }).format(d);
  } catch (_e) {
    return '';
  }
}

// type + data + recipient locale -> { title, body }; null for a type with no copy.
export function renderPushText(type, data = {}, locale = 'en') {
  const lang = pushLocale(locale);
  const d = data ?? {};
  const T = (key, params) => translate(key, params, lang);
  const fmt = (v) => ((typeof v === 'number' || typeof v === 'string') && Number.isFinite(Number(v)) && v !== ''
    ? formatNumber(v, lang)
    : String(v));
  const actorName = d.actor_name || T('notif.fallback.friend');
  const course = d.course_name || d.tournament_name;
  const admin = d.actor_name || T('notif.fallback.admin');
  const theLeague = d.league_name || T('notif.fallback.theLeague');
  switch (type) {
    case 'friend_request':
      return { title: T('notif.friendRequest.title'), body: T('notif.friendRequest.body', { actor: actorName }) };
    case 'friend_accepted':
      return { title: T('notif.friendAccepted.title'), body: T('notif.friendAccepted.body', { actor: actorName }) };
    case 'added_to_game':
      return {
        title: T('notif.addedToGame.title'),
        body: T('notif.addedToGame.body', { game: d.tournament_name || T('notif.fallback.game') }),
      };
    case 'round_finished':
      return {
        title: T('notif.roundFinished.title'),
        body: T('notif.roundFinished.body', { actor: actorName, course: course || T('notif.fallback.course') }),
      };
    case 'feed_reaction':
      return {
        title: T('notif.feedReaction.title'),
        body: T('notif.feedReaction.body', {
          actor: actorName, emoji: d.emoji || '', where: course || T('notif.fallback.round'),
        }),
      };
    case 'feed_comment':
      return {
        title: T('notif.feedComment.title'),
        body: T('notif.feedComment.body', { actor: actorName, where: course || T('notif.fallback.round') }),
      };
    case 'league_invite':
      return {
        title: T('notif.leagueInvite.title'),
        body: T('notif.leagueInvite.body', {
          inviter: d.inviter_name || actorName, league: d.league_name || T('notif.fallback.league'),
        }),
      };
    case 'league_card_announced':
      return {
        title: T('notif.cardAnnounced.title'),
        body: T('notif.cardAnnounced.body', { actor: actorName, card: fullCard(d, T, lang) }),
      };
    case 'league_tee_off':
      return {
        title: T('notif.teeOff.title'),
        body: d.course_name
          ? T('notif.teeOff.bodyCourse', { actor: actorName, course: d.course_name })
          : T('notif.teeOff.body', { actor: actorName }),
      };
    case 'league_card_confirmed': {
      const card = monthCard(d, T, lang);
      const pts = pointsValue(d.points);
      return {
        title: T('notif.cardConfirmed.title'),
        body: pts == null
          ? T('notif.cardConfirmed.body', { actor: actorName, card })
          : T('notif.cardConfirmed.bodyPoints', { actor: actorName, card, points: fmt(pts) }),
      };
    }
    case 'league_marker_issue': {
      const marker = d.marker_name || d.actor_name || T('notif.fallback.marker');
      let body;
      if (d.note && d.tournament_id && d.round_id) body = T('notif.markerIssue.note', { marker, note: d.note });
      else if (d.note) body = T('notif.markerIssue.flaggedNote', { marker, note: d.note });
      else body = T('notif.markerIssue.flagged', { marker });
      return { title: T('notif.markerIssue.title'), body };
    }
    case 'league_marker_request': {
      const card = fullCard(d, T, lang);
      return {
        title: T('notif.markerRequest.title', { actor: actorName }),
        body: d.league_name ? T('notif.markerRequest.bodyLeague', { card, league: d.league_name }) : card,
      };
    }
    case 'league_marker_confirmed':
      return {
        title: T('notif.markerConfirmed.title', { actor: actorName, card: monthCard(d, T, lang) }),
        body: T('notif.markerConfirmed.body', { league: d.league_name || T('notif.fallback.yourLeague') }),
      };
    case 'league_ranking_updated': {
      const month = monthName(d.month, lang);
      const league = d.league_name || T('notif.fallback.leagueCap');
      return {
        title: T('notif.rankingUpdated.title'),
        body: month
          ? T('notif.rankingUpdated.bodyMonth', { league, month })
          : T('notif.rankingUpdated.body', { league }),
      };
    }
    case 'league_month_reminder':
      return {
        title: T('notif.monthReminder.title'),
        body: T('notif.monthReminder.body', { league: d.league_name || T('notif.fallback.yourLeague') }),
      };
    case 'league_post_reminder': {
      const time = postByTime(d.post_by, lang);
      const card = d.course_name
        ? T('notif.postReminder.cardAt', { course: d.course_name })
        : T('notif.postReminder.card');
      const league = d.league_name || T('notif.fallback.yourLeague');
      return {
        title: T('notif.postReminder.title'),
        body: time
          ? T('notif.postReminder.bodyBy', { card, time, league })
          : T('notif.postReminder.body', { card, league }),
      };
    }
    case 'league_vote_opened': {
      const subject = d.subject_name || T('notif.fallback.member');
      return {
        title: T('notif.voteOpened.title'),
        body: d.old != null && d.proposed != null
          ? T('notif.voteOpened.bodyChange', { subject, old: fmt(d.old), proposed: fmt(d.proposed) })
          : T('notif.voteOpened.body', { subject }),
      };
    }
    case 'league_card_rescheduled': {
      const when = teeTimeText(d.tee_time, lang);
      const card = fullCard(d, T, lang);
      return {
        title: T('notif.rescheduled.title'),
        body: when
          ? T('notif.rescheduled.bodyWhen', { actor: actorName, card, when })
          : T('notif.rescheduled.body', { actor: actorName, card }),
      };
    }
    case 'league_card_withdrawn':
      return {
        title: T('notif.withdrawn.title'),
        body: T('notif.withdrawn.body', { actor: actorName, card: fullCard(d, T, lang) }),
      };
    case 'league_card_played_after_withdraw':
      return {
        title: T('notif.playedAfterWithdraw.title'),
        body: T('notif.playedAfterWithdraw.body', {
          owner: d.owner_name || T('notif.fallback.friend'), card: fullCard(d, T, lang),
        }),
      };
    case 'league_role_changed':
      return d.role === 'admin'
        ? {
          title: T('notif.roleChanged.adminTitle'),
          body: T('notif.roleChanged.madeAdmin', {
            actor: admin, subject: d.subject_name || T('notif.fallback.member'), league: theLeague,
          }),
        }
        : {
          title: T('notif.roleChanged.steppedDownTitle'),
          body: T('notif.roleChanged.steppedDown', {
            subject: d.subject_name || T('notif.fallback.memberCap'), league: theLeague,
          }),
        };
    case 'league_card_auto_withdrawn':
      return { title: T('notif.withdrawn.title'), body: T('notif.autoWithdrawn.body', { card: fullCard(d, T, lang) }) };
    case 'league_card_voided': {
      const card = fullCard(d, T, lang);
      const { owner_name: owner, reason } = d;
      let body;
      if (owner) {
        body = reason
          ? T('notif.voided.ownerReason', { actor: admin, owner, card, reason })
          : T('notif.voided.owner', { actor: admin, owner, card });
      } else {
        body = reason
          ? T('notif.voided.noOwnerReason', { actor: admin, card, reason })
          : T('notif.voided.noOwner', { actor: admin, card });
      }
      return { title: T('notif.voided.title'), body };
    }
    case 'league_card_reopened': {
      const card = fullCard(d, T, lang);
      return {
        title: T('notif.reopened.title'),
        body: d.owner_name
          ? T('notif.reopened.owner', { actor: admin, owner: d.owner_name, card })
          : T('notif.reopened.noOwner', { actor: admin, card }),
      };
    }
    case 'league_card_approved': {
      const card = fullCard(d, T, lang);
      return {
        title: T('notif.approved.title'),
        body: d.owner_name
          ? T('notif.approved.owner', { actor: admin, owner: d.owner_name, card })
          : T('notif.approved.noOwner', { actor: admin, card }),
      };
    }
    case 'league_handicap_changed': {
      const base = { actor: admin, subject: d.subject_name || T('notif.fallback.member') };
      const from = d.old != null ? fmt(d.old) : null;
      const to = d.new != null ? fmt(d.new) : null;
      let body;
      if (from != null && to != null) body = T('notif.handicap.fromTo', { ...base, from, to });
      else if (from != null) body = T('notif.handicap.from', { ...base, from });
      else if (to != null) body = T('notif.handicap.to', { ...base, to });
      else body = T('notif.handicap.body', base);
      return { title: T('notif.handicap.title'), body };
    }
    case 'league_member_removed':
      return d.you
        ? {
          title: T('notif.memberRemoved.youTitle'),
          body: T('notif.memberRemoved.you', { actor: admin, league: theLeague }),
        }
        : {
          title: T('notif.memberRemoved.title'),
          body: T('notif.memberRemoved.body', {
            actor: admin, subject: d.subject_name || T('notif.fallback.member'), league: theLeague,
          }),
        };
    case 'league_spot_claimed':
      return {
        title: T('notif.spotClaimed.title'),
        body: T('notif.spotClaimed.body', {
          actor: d.actor_name || T('notif.fallback.someone'),
          league: theLeague,
          spot: d.spot_name || T('notif.fallback.reservedSpot'),
        }),
      };
    case 'league_spot_released':
      if (d.you) {
        return {
          title: T('notif.spotReleased.title'),
          body: T('notif.spotReleased.you', { actor: admin, league: theLeague }),
        };
      }
      return {
        title: T('notif.spotReleased.title'),
        body: d.spot_name
          ? T('notif.spotReleased.spot', { actor: admin, spot: d.spot_name, league: theLeague })
          : T('notif.spotReleased.noSpot', { actor: admin, league: theLeague }),
      };
    default:
      return null;
  }
}
