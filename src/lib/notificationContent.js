// Pure rendering + routing for notifications. The send-push edge function
// (Deno) cannot import React Native code, so renderPushText in
// supabase/functions/_shared/notificationRender.js mirrors renderNotification
// over a generated copy of the notif.* keys; notificationPush.test.js fails
// when the two disagree. The copy below is the in-app inbox: English by
// default, Spanish when `lang` is 'es' (docs/i18n.md).
import { t, getLanguage, formatDate, formatNumber } from '../i18n';

// 'YYYY-MM-DD' (league month, first day) -> 'October' / 'octubre'. '' when unparseable.
function monthName(month, lang) {
  const m = /^(\d{4})-(\d{2})/.exec(String(month ?? ''));
  const n = m ? Number(m[2]) : 0;
  if (n < 1 || n > 12) return '';
  return formatDate(new Date(Number(m[1]), n - 1, 1), 'monthName', lang);
}

// The Stableford points the league ranks by; null when the payload has none.
function pointsValue(points) {
  const n = Number(points);
  if (points == null || points === '' || !Number.isFinite(n)) return null;
  return n;
}

// 'October card at Golf Olivar' / 'card' (the full card phrase).
function fullCard(data, T, lang) {
  const month = monthName(data.month, lang);
  if (month && data.course_name) return T('notif.card.monthCourse', { month, course: data.course_name });
  if (month) return T('notif.card.month', { month });
  if (data.course_name) return T('notif.card.course', { course: data.course_name });
  return T('notif.card.plain');
}

// 'October card' / 'card' (the card phrase without the course).
function monthCard(data, T, lang) {
  const month = monthName(data.month, lang);
  return month ? T('notif.card.month', { month }) : T('notif.card.plain');
}

// 'Sat 25 Oct, 09:00' in Europe/Madrid, like send-push; '' when unparseable.
function teeTimeText(iso, lang) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(lang === 'es' ? 'es-ES' : 'en-GB', {
      timeZone: 'Europe/Madrid', weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit',
    }).format(d);
  } catch (_e) {
    return '';
  }
}

// notification type + data -> { icon, title, body } for the in-app inbox.
// `icon` values are Feather icon names.
export function renderNotification(type, data = {}, lang = getLanguage()) {
  const T = (key, params) => t(key, params, lang);
  // Numbers from the payload; anything else is shown as it arrived.
  const fmt = (v) => (typeof v === 'number' || typeof v === 'string') && Number.isFinite(Number(v)) && v !== ''
    ? formatNumber(v, { maxDecimals: 2 }, lang)
    : String(v);
  const actorName = data.actor_name || T('notif.fallback.friend');
  const course = data.course_name || data.tournament_name;
  switch (type) {
    case 'friend_request':
      return {
        icon: 'user-plus',
        title: T('notif.friendRequest.title'),
        body: T('notif.friendRequest.body', { actor: actorName }),
      };
    case 'friend_accepted':
      return {
        icon: 'user-check',
        title: T('notif.friendAccepted.title'),
        body: T('notif.friendAccepted.body', { actor: actorName }),
      };
    case 'added_to_game':
      return {
        icon: 'flag',
        title: T('notif.addedToGame.title'),
        body: T('notif.addedToGame.body', { game: data.tournament_name || T('notif.fallback.game') }),
      };
    case 'round_finished':
      return {
        icon: 'check-circle',
        title: T('notif.roundFinished.title'),
        body: T('notif.roundFinished.body', {
          actor: actorName,
          course: course || T('notif.fallback.course'),
        }),
      };
    case 'feed_reaction':
      return {
        icon: 'smile',
        title: T('notif.feedReaction.title'),
        body: T('notif.feedReaction.body', {
          actor: actorName,
          emoji: data.emoji || '',
          where: course || T('notif.fallback.round'),
        }),
      };
    case 'feed_comment':
      return {
        icon: 'message-circle',
        title: T('notif.feedComment.title'),
        body: T('notif.feedComment.body', { actor: actorName, where: course || T('notif.fallback.round') }),
      };
    case 'league_invite':
      return {
        icon: 'award',
        title: T('notif.leagueInvite.title'),
        body: T('notif.leagueInvite.body', {
          inviter: data.inviter_name || actorName,
          league: data.league_name || T('notif.fallback.league'),
        }),
      };
    case 'league_card_announced':
      return {
        icon: 'calendar',
        title: T('notif.cardAnnounced.title'),
        body: T('notif.cardAnnounced.body', { actor: actorName, card: fullCard(data, T, lang) }),
      };
    case 'league_tee_off':
      return {
        icon: 'play-circle',
        title: T('notif.teeOff.title'),
        body: data.course_name
          ? T('notif.teeOff.bodyCourse', { actor: actorName, course: data.course_name })
          : T('notif.teeOff.body', { actor: actorName }),
      };
    case 'league_card_confirmed': {
      // The league ranks by Stableford points (the server scores the card).
      const card = monthCard(data, T, lang);
      const pts = pointsValue(data.points);
      return {
        icon: 'check-circle',
        title: T('notif.cardConfirmed.title'),
        body: pts == null
          ? T('notif.cardConfirmed.body', { actor: actorName, card })
          : T('notif.cardConfirmed.bodyPoints', { actor: actorName, card, points: fmt(pts) }),
      };
    }
    case 'league_marker_issue': {
      // A request sent in the app carries the round ids and a note that
      // already names the hole: "Javi: Hole 12: should be 5 (card says 4)".
      const marker = data.marker_name || data.actor_name || T('notif.fallback.marker');
      let body;
      if (data.note && data.tournament_id && data.round_id) {
        body = T('notif.markerIssue.note', { marker, note: data.note });
      } else if (data.note) {
        body = T('notif.markerIssue.flaggedNote', { marker, note: data.note });
      } else {
        body = T('notif.markerIssue.flagged', { marker });
      }
      return {
        icon: 'alert-circle',
        title: T('notif.markerIssue.title'),
        body,
      };
    }
    case 'league_marker_request': {
      const card = fullCard(data, T, lang);
      return {
        icon: 'edit-3',
        title: T('notif.markerRequest.title', { actor: actorName }),
        body: data.league_name
          ? T('notif.markerRequest.bodyLeague', { card, league: data.league_name })
          : card,
      };
    }
    case 'league_marker_confirmed':
      return {
        icon: 'check-circle',
        title: T('notif.markerConfirmed.title', { actor: actorName, card: monthCard(data, T, lang) }),
        body: T('notif.markerConfirmed.body', { league: data.league_name || T('notif.fallback.yourLeague') }),
      };
    case 'league_ranking_updated': {
      const month = monthName(data.month, lang);
      const league = data.league_name || T('notif.fallback.leagueCap');
      return {
        icon: 'bar-chart-2',
        title: T('notif.rankingUpdated.title'),
        body: month
          ? T('notif.rankingUpdated.bodyMonth', { league, month })
          : T('notif.rankingUpdated.body', { league }),
      };
    }
    case 'league_month_reminder':
      return {
        icon: 'clock',
        title: T('notif.monthReminder.title'),
        body: T('notif.monthReminder.body', { league: data.league_name || T('notif.fallback.yourLeague') }),
      };
    case 'league_post_reminder': {
      let time = '';
      if (data.post_by) {
        try {
          const d = new Date(data.post_by);
          if (!Number.isNaN(d.getTime())) {
            time = d.toLocaleTimeString(lang === 'es' ? 'es-ES' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
          }
        } catch (_e) {
          // Unparseable — omit time
        }
      }
      const card = data.course_name
        ? T('notif.postReminder.cardAt', { course: data.course_name })
        : T('notif.postReminder.card');
      const league = data.league_name || T('notif.fallback.yourLeague');
      return {
        icon: 'clock',
        title: T('notif.postReminder.title'),
        body: time
          ? T('notif.postReminder.bodyBy', { card, time, league })
          : T('notif.postReminder.body', { card, league }),
      };
    }
    case 'league_vote_opened': {
      const subject = data.subject_name || T('notif.fallback.member');
      return {
        icon: 'check-square',
        title: T('notif.voteOpened.title'),
        body: data.old != null && data.proposed != null
          ? T('notif.voteOpened.bodyChange', { subject, old: fmt(data.old), proposed: fmt(data.proposed) })
          : T('notif.voteOpened.body', { subject }),
      };
    }
    // 20261016000000 (league integrity). Copy mirrors send-push.
    case 'league_card_rescheduled': {
      const when = teeTimeText(data.tee_time, lang);
      const card = fullCard(data, T, lang);
      return {
        icon: 'calendar',
        title: T('notif.rescheduled.title'),
        body: when
          ? T('notif.rescheduled.bodyWhen', { actor: actorName, card, when })
          : T('notif.rescheduled.body', { actor: actorName, card }),
      };
    }
    case 'league_card_withdrawn':
      return {
        icon: 'x-circle',
        title: T('notif.withdrawn.title'),
        body: T('notif.withdrawn.body', { actor: actorName, card: fullCard(data, T, lang) }),
      };
    case 'league_card_played_after_withdraw':
      return {
        icon: 'alert-circle',
        title: T('notif.playedAfterWithdraw.title'),
        body: T('notif.playedAfterWithdraw.body', {
          owner: data.owner_name || T('notif.fallback.friend'),
          card: fullCard(data, T, lang),
        }),
      };
    case 'league_role_changed': {
      const league = data.league_name || T('notif.fallback.theLeague');
      if (data.role === 'admin') {
        return {
          icon: 'shield',
          title: T('notif.roleChanged.adminTitle'),
          body: T('notif.roleChanged.madeAdmin', {
            actor: data.actor_name || T('notif.fallback.admin'),
            subject: data.subject_name || T('notif.fallback.member'),
            league,
          }),
        };
      }
      return {
        icon: 'shield',
        title: T('notif.roleChanged.steppedDownTitle'),
        body: T('notif.roleChanged.steppedDown', {
          subject: data.subject_name || T('notif.fallback.memberCap'),
          league,
        }),
      };
    }
    case 'league_card_auto_withdrawn':
      return {
        icon: 'x-circle',
        title: T('notif.withdrawn.title'),
        body: T('notif.autoWithdrawn.body', { card: fullCard(data, T, lang) }),
      };
    case 'league_card_voided': {
      const actor = data.actor_name || T('notif.fallback.admin');
      const card = fullCard(data, T, lang);
      const { owner_name: owner, reason } = data;
      if (owner) {
        return {
          icon: 'slash',
          title: T('notif.voided.title'),
          body: reason
            ? T('notif.voided.ownerReason', { actor, owner, card, reason })
            : T('notif.voided.owner', { actor, owner, card }),
        };
      }
      return {
        icon: 'slash',
        title: T('notif.voided.title'),
        body: reason
          ? T('notif.voided.noOwnerReason', { actor, card, reason })
          : T('notif.voided.noOwner', { actor, card }),
      };
    }
    case 'league_card_reopened': {
      const actor = data.actor_name || T('notif.fallback.admin');
      const card = fullCard(data, T, lang);
      return {
        icon: 'rotate-ccw',
        title: T('notif.reopened.title'),
        body: data.owner_name
          ? T('notif.reopened.owner', { actor, owner: data.owner_name, card })
          : T('notif.reopened.noOwner', { actor, card }),
      };
    }
    case 'league_card_approved': {
      const actor = data.actor_name || T('notif.fallback.admin');
      const card = fullCard(data, T, lang);
      return {
        icon: 'check-circle',
        title: T('notif.approved.title'),
        body: data.owner_name
          ? T('notif.approved.owner', { actor, owner: data.owner_name, card })
          : T('notif.approved.noOwner', { actor, card }),
      };
    }
    case 'league_handicap_changed': {
      const base = {
        actor: data.actor_name || T('notif.fallback.admin'),
        subject: data.subject_name || T('notif.fallback.member'),
      };
      const from = data.old != null ? fmt(data.old) : null;
      const to = data.new != null ? fmt(data.new) : null;
      let body;
      if (from != null && to != null) body = T('notif.handicap.fromTo', { ...base, from, to });
      else if (from != null) body = T('notif.handicap.from', { ...base, from });
      else if (to != null) body = T('notif.handicap.to', { ...base, to });
      else body = T('notif.handicap.body', base);
      return {
        icon: 'sliders',
        title: T('notif.handicap.title'),
        body,
      };
    }
    case 'league_member_removed':
      return data.you
        ? {
          icon: 'user-x',
          title: T('notif.memberRemoved.youTitle'),
          body: T('notif.memberRemoved.you', {
            actor: data.actor_name || T('notif.fallback.admin'),
            league: data.league_name || T('notif.fallback.theLeague'),
          }),
        }
        : {
          icon: 'user-x',
          title: T('notif.memberRemoved.title'),
          body: T('notif.memberRemoved.body', {
            actor: data.actor_name || T('notif.fallback.admin'),
            subject: data.subject_name || T('notif.fallback.member'),
            league: data.league_name || T('notif.fallback.theLeague'),
          }),
        };
    case 'league_spot_claimed':
      return {
        icon: 'user-plus',
        title: T('notif.spotClaimed.title'),
        body: T('notif.spotClaimed.body', {
          actor: data.actor_name || T('notif.fallback.someone'),
          league: data.league_name || T('notif.fallback.theLeague'),
          spot: data.spot_name || T('notif.fallback.reservedSpot'),
        }),
      };
    case 'league_spot_released':
      return data.you
        ? {
          icon: 'user-x',
          title: T('notif.spotReleased.title'),
          body: T('notif.spotReleased.you', {
            actor: data.actor_name || T('notif.fallback.admin'),
            league: data.league_name || T('notif.fallback.theLeague'),
          }),
        }
        : {
          icon: 'user-x',
          title: T('notif.spotReleased.title'),
          body: data.spot_name
            ? T('notif.spotReleased.spot', {
              actor: data.actor_name || T('notif.fallback.admin'),
              spot: data.spot_name,
              league: data.league_name || T('notif.fallback.theLeague'),
            })
            : T('notif.spotReleased.noSpot', {
              actor: data.actor_name || T('notif.fallback.admin'),
              league: data.league_name || T('notif.fallback.theLeague'),
            }),
        };
    default:
      return { icon: 'bell', title: T('notif.default.title'), body: '' };
  }
}

// notification type + data -> { screen, params? } for navigation. Used by
// both the inbox (row tap) and App.js (push tap).
export function notificationLink(type, data = {}) {
  switch (type) {
    case 'friend_request':
    case 'friend_accepted':
      return { screen: 'Friends' };
    case 'added_to_game':
      // 'Home' lives inside the 'Main' bottom-tab navigator, so the link
      // must use React Navigation's nested form — a bare navigate('Home')
      // from the root stack is silently dropped.
      return {
        screen: 'Main',
        params: { screen: 'Home', params: { openTournamentId: data.tournament_id } },
      };
    case 'round_finished':
    case 'feed_reaction':
    case 'feed_comment':
      return {
        screen: 'RoundSummary',
        params: { tournamentId: data.tournament_id, roundId: data.round_id },
      };
    case 'league_invite':
      return { screen: 'JoinLeague', params: { code: data.invite_code } };
    case 'league_marker_issue':
      if (data.league_id && data.card_id && data.tournament_id && data.round_id) {
        return {
          screen: 'LeagueValidate',
          params: {
            leagueId: data.league_id,
            cardId: data.card_id,
            tournamentId: data.tournament_id,
            roundId: data.round_id,
            submitted: true,
          },
        };
      }
      return { screen: 'LeagueBoard', params: { leagueId: data.league_id } };
    case 'league_marker_request':
      return data.token ? { screen: 'LeagueMarkerConfirm', params: { token: data.token } }
        : { screen: 'Notifications' };
    // The board opens on that month's "is final" banner (Share the results).
    case 'league_ranking_updated': {
      const m = /^\d{4}-\d{2}/.exec(String(data.month ?? ''));
      return { screen: 'LeagueBoard', params: { leagueId: data.league_id, ...(m ? { finalMonth: m[0] } : {}) } };
    }
    case 'league_card_announced':
    case 'league_tee_off':
    case 'league_card_confirmed':
    case 'league_marker_confirmed':
    case 'league_month_reminder':
    case 'league_post_reminder':
    case 'league_vote_opened':
    case 'league_card_rescheduled':
    case 'league_card_withdrawn':
    case 'league_card_auto_withdrawn':
    case 'league_card_voided':
    case 'league_card_reopened':
    case 'league_card_approved':
    case 'league_handicap_changed':
    case 'league_spot_claimed':
    case 'league_role_changed':
    case 'league_card_played_after_withdraw':
      return { screen: 'LeagueBoard', params: { leagueId: data.league_id } };
    // The removed / released member can't open the board any more.
    case 'league_member_removed':
    case 'league_spot_released':
      return data.you ? { screen: 'Notifications' } : { screen: 'LeagueBoard', params: { leagueId: data.league_id } };
    default:
      return { screen: 'Notifications' };
  }
}

// Older send-push deployments (and pushes already delivered before an app
// update) carry the bare `{ screen: 'Home' }` deep link, which the root
// navigator cannot resolve. Rewrite it to the nested Main → Home form;
// every other link passes through untouched.
export function normalizeDeepLink(link = {}) {
  if (link.screen === 'Home') {
    return { screen: 'Main', params: { screen: 'Home', params: link.params } };
  }
  return link;
}
