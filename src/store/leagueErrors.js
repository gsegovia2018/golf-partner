// Server refusals -> message descriptors (docs/i18n.md, "Pure store modules").
// The league RPCs raise English text with a HINT (supabase/migrations,
// 20261016000000_league_integrity.sql and later). A LeagueError keeps that text
// as `message`; `descriptor` is the same sentence as a catalogue key
// (locales/*/leagueErrors.js) so the UI can show it in the viewer's language
// (lib/leagueErrorText.js). Unknown text gets no descriptor: the UI shows the
// server's own message.
//
// Each entry matches the server text by `re` (one hint can carry several
// sentences); `params` reads the values the server interpolated. A hint with a
// single, parameterless entry also matches by hint alone, so a reworded server
// sentence still translates.

const EN_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// 'October' -> '2000-10'. Any year works: only the month name is rendered.
const monthKeyOf = (name) => {
  const i = EN_MONTHS.indexOf(String(name ?? '').trim());
  return i < 0 ? null : `2000-${String(i + 1).padStart(2, '0')}`;
};

const K = 'league.error.';

// [hint | null, regex, key suffix, params(match) | undefined]
const ENTRIES = [
  ['already_member', /^You are already in this league, so you can't take (.+)'s spot\.$/, 'alreadyMember', (m) => ({ name: m[1] })],
  ['already_void', /^This card is already void\.$/, 'alreadyVoid'],
  ['bad_format', /^Pick a league format: Stableford, medal play net or medal play gross\.$/, 'badFormat'],
  ['before_tee_time', /^You can post this card once your tee time has passed\.$/, 'beforeTeeTime'],
  ['card_exists', /^You already have your (\w+) card\.$/, 'cardExists', (m) => ({ monthKey: monthKeyOf(m[1]) })],
  ['card_exists', /^That player already has their (\w+) card\.$/, 'otherCardExists', (m) => ({ monthKey: monthKeyOf(m[1]) })],
  ['holes_mismatch', /^This card doesn't match your scores in the game on holes?: (.+?)\. Wait for every hole to sync/, 'holesMismatch',
    (m) => ({ holes: m[1].trim(), count: m[1].split(',').length })],
  ['format_locked', /^The format can't change once the league has a card\.$/, 'formatLocked'],
  ['implausible_tee', /^This tee's slope or course rating can't be right/, 'implausibleTee'],
  ['incomplete_card', /^A league card needs a score on every hole, 1 to 18\.$/, 'incompleteCard18'],
  ['incomplete_card', /^Every hole of a league card needs a score, a par and a stroke index\.$/, 'incompleteCard'],
  ['invalid_layout', /^This course layout can't be right/, 'invalidLayout'],
  ['invalid', /^Say whether the public board is on or off\.$/, 'boardOnOff'],
  ['last_admin', /^(.+) is the league's only admin\. Make someone else admin first\.$/, 'lastAdmin', (m) => ({ name: m[1] })],
  ['league_archived', /^This league has been archived\. You can still look at it, but not change it\.$/, 'archived'],
  ['month_change', /^This is your (\w+) card\. The new tee time has to stay in \w+\.$/, 'monthChange', (m) => ({ monthKey: monthKeyOf(m[1]) })],
  ['month_closed', /^(\w+) is closed: its cards can't change any more\.$/, 'monthClosed', (m) => ({ monthKey: monthKeyOf(m[1]) })],
  ['month_mismatch', /^This is your (\w+) card, but the date is in (\w+)\. Check the date\.$/, 'monthMismatchCard',
    (m) => ({ monthKey: monthKeyOf(m[1]), otherMonthKey: monthKeyOf(m[2]) })],
  ['month_mismatch', /^The tee time is in (\w+) but the date is in (\w+)\. Check the date\.$/, 'monthMismatchTee',
    (m) => ({ monthKey: monthKeyOf(m[1]), otherMonthKey: monthKeyOf(m[2]) })],
  ['no_request', /^Nobody has been asked to mark this card\.$/, 'noRequest'],
  ['not_app', /^Only cards played in the app can pick a marker\.$/, 'notApp'],
  ['not_claimed', /^Nobody has claimed that spot\.$/, 'notClaimed'],
  ['not_eligible', /^Pick a player who kept a card in this game\.$/, 'notEligible'],
  ['not_found', /^This league no longer exists\.$/, 'gone'],
  ['not_member', /^That player is not in this league\.$/, 'notMember'],
  ['not_missed', /^Only a card that wasn't posted in time can be reopened\.$/, 'notMissed'],
  ['not_needed', /^This card doesn't need approving\.$/, 'notNeeded'],
  ['not_offapp', /^Only a card played off the app can be rescheduled\.$/, 'notOffapp'],
  ['not_open', /^This card can no longer be rescheduled\.$/, 'notOpen'],
  ['not_submitted', /^Submit the card first\.$/, 'notSubmitted'],
  ['not_your_player', /^This card's player isn't yours in the game\.$/, 'notYourPlayer'],
  ['not_your_player', /^That player already has a league card for this round\.$/, 'playerHasCard'],
  ['not_your_player', /^You can only announce your own card, as your own player in this game\.$/, 'announceOwnOnly'],
  ['not_your_player', /^That player in the game is someone else\.$/, 'playerIsSomeoneElse'],
  ['not_creator', /^Only the game's creator can count another player's card\.$/, 'notCreator'],
  [null, /^Use announce_league_card for your own card\.$/, 'announceForSelf'],
  ['official_round', /^Official tournament rounds can't be league cards\.$/, 'officialRound'],
  ['outside_season', /^That date is outside the season \((\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})\)\.$/, 'outsideSeason',
    (m) => ({ fromDate: m[1], toDate: m[2] })],
  ['own_card', /^Another admin has to reopen your own card\.$/, 'ownCardReopen'],
  ['own_card', /^Another admin has to approve your own card\.$/, 'ownCardApprove'],
  ['own_card', /^Another admin has to void your own card\.$/, 'ownCardVoid'],
  ['own_card', /^You can't mark your own card\.$/, 'ownCardMark'],
  ['own_card', /^You can't confirm or send back your own card\. Ask your marker to scan it\.$/, 'ownCardConfirm'],
  ['own_handicap', /^Another admin has to set your own league handicap\.$/, 'ownHandicap'],
  ['participation_points', /^Points for playing can't be negative\.$/, 'participationPoints'],
  ['past_month', /^That month is over, so this card can't be reopened\.$/, 'pastMonthReopen'],
  ['past_month', /^That month is over\. Announce a card for this month or later\.$/, 'pastMonthAnnounce'],
  ['post_deadline_passed', /^The 8 hours to post this card are over\.$/, 'postDeadlinePassed'],
  ['remind_too_soon', /^You can remind once a day\.$/, 'remindTooSoon'],
  ['reschedule_closed', /^Your tee time is less than 2 hours away, so this card can't be moved any more\.$/, 'rescheduleClosed'],
  ['reschedule_limit', /^This card has been moved twice already, so it can't be moved again\.$/, 'rescheduleLimit'],
  ['resubmit_used', /^You already corrected this card once after a marker sent it back/, 'resubmitUsed'],
  ['round_started', /^This round has started for you\. A league card has to be announced before your first shot\.$/, 'roundStartedAnnounce'],
  ['round_started', /^This round has started for that player\. A league card has to be announced before their first shot\.$/, 'roundStartedOther'],
  ['round_started', /^This round has started for you, so the card can't be withdrawn\./, 'roundStartedWithdraw'],
  ['scramble_round', /^A scramble is played with one team ball, so it can't be a league card\.$/, 'scrambleRound'],
  ['short_notice', /^Announce a round at least 2 hours before its tee time\.$/, 'shortNoticeAnnounce'],
  ['short_notice', /^Pick a tee time at least 2 hours from now\.$/, 'shortNoticePick'],
  ['tee_time_passed', /^That tee time has passed\. If you already played, add it as a card you didn't announce\.$/, 'teeTimePassedAnnounce'],
  ['tee_time_passed', /^The tee time has passed, so this card can't be moved\.$/, 'teeTimePassedMove'],
  ['tee_time_passed', /^Pick a tee time that hasn't passed yet\.$/, 'teeTimePassedPick'],
  ['too_early', /^You can post this card from 3 hours after your tee time\.$/, 'tooEarly'],
  ['unknown_tee', /^That tee isn't one of this course's tees in the course library\. Pick one of its tees\.$/, 'unknownTee'],
  ['unrated_tee', /^This tee has no slope and course rating, so it can't count for the league\.$/, 'unratedTee'],
  ['use_leave', /^You can't remove yourself\. Leave the league instead\.$/, 'removeSelf'],
  ['use_leave', /^That spot is yours\. Leave the league instead\.$/, 'spotIsYours'],
  ['withdraw_closed', /^This card has been played, so it can't be withdrawn\. Only an admin can void it now\.$/, 'withdrawClosed'],
  // Raised without a hint.
  [null, /^A handicap is required\.$/, 'handicapRequired'],
  [null, /^A league needs a name\.$/, 'nameRequired'],
  [null, /^A league needs at least one admin\. Make someone else admin first\.$/, 'needsAdmin'],
  [null, /^A role is admin or member\.$/, 'roleInvalid'],
  [null, /^Add your name to join the league\.$/, 'addNameToJoin'],
  [null, /^Card not found\.$/, 'cardNotFound'],
  [null, /^Each player needs a name\.$/, 'eachPlayerName'],
  [null, /^Keep each name under 60 characters\.$/, 'eachNameTooLong'],
  [null, /^Keep your name under 60 characters\.$/, 'nameTooLong'],
  [null, /^Must be signed in$/, 'signedIn'],
  [null, /^Only a league admin can change the public board\.$/, 'boardAdminOnly'],
  [null, /^Only a league admin can make a new board link\.$/, 'boardLinkAdminOnly'],
  [null, /^Only cards played in the app can be confirmed by a partner\.$/, 'partnerAppOnly'],
  [null, /^Only league members can share the board\.$/, 'shareMembersOnly'],
  [null, /^Only the league admin can do that\.$/, 'adminOnly'],
  [null, /^Pick the course you are playing\.$/, 'pickCoursePlaying'],
  [null, /^Pick the course you played\.$/, 'pickCoursePlayed'],
  [null, /^Someone already joined as (.+)\.$/, 'someoneJoinedAs', (m) => ({ name: m[1] })],
  [null, /^That invite code is not valid\.$/, 'inviteInvalid'],
  [null, /^That player already joined\.$/, 'playerJoined'],
  [null, /^That spot is not in this league\.$/, 'spotNotInLeague'],
  [null, /^The proof must be uploaded for this card\.$/, 'proofRequired'],
  [null, /^The proof photo has not finished uploading\.$/, 'proofUploading'],
  [null, /^The season must end after it starts\.$/, 'seasonOrder'],
  [null, /^There is already an open vote on this player's handicap\.$/, 'openVote'],
  [null, /^This card can no longer be changed\.$/, 'cardLocked'],
  [null, /^This league has been archived\.$/, 'archivedShort'],
  [null, /^This vote is closed\.$/, 'voteClosed'],
  [null, /^Type your name to sign the card\.$/, 'signName'],
  [null, /^Vote not found\.$/, 'voteNotFound'],
  [null, /^Vote yes or no\.$/, 'voteYesNo'],
  [null, /^When did you play\?$/, 'whenPlayed'],
  [null, /^You already joined this league as (.+)\.$/, 'alreadyJoinedAs', (m) => ({ name: m[1] })],
  [null, /^You are not in this league\.$/, 'notInLeague'],
  [null, /^You are the only admin\. Make someone else admin first, then leave\.$/, 'onlyAdminLeave'],
  [null, /^You can only add friends to a league\.$/, 'friendsOnly'],
  // Client-side texts (leagueStore).
  [null, /^You need a connection to do this\.$/, 'offline'],
  [null, /^This league no longer exists\.$/, 'gone'],
  [null, /^Request failed$/, 'requestFailed'],
  [null, /^Could not load the photo\.$/, 'photoLoad'],
  [null, /^Failed to read photo \((\d+)\)$/, 'photoRead', (m) => ({ status: m[1] })],
];

// Hints the server raises with exactly one parameterless sentence.
const BY_HINT = (() => {
  const groups = {};
  for (const e of ENTRIES) if (e[0]) (groups[e[0]] = groups[e[0]] ?? []).push(e);
  const out = {};
  for (const [hint, list] of Object.entries(groups)) if (list.length === 1 && !list[0][3]) out[hint] = list[0];
  return out;
})();

// Every hint the client knows how to word (for tests and the docs).
export const KNOWN_HINTS = [...new Set(ENTRIES.map((e) => e[0]).filter(Boolean))];

// { key, params } for a server/client league error message, or null.
export function leagueErrorDescriptor(message, hint = null) {
  const text = String(message ?? '').trim();
  for (const [h, re, key, params] of ENTRIES) {
    if (h && hint && h !== hint) continue;
    const m = re.exec(text);
    if (m) return { key: K + key, params: params ? params(m) : {} };
  }
  const byHint = hint ? BY_HINT[hint] : null;
  return byHint ? { key: K + byHint[2], params: {} } : null;
}
