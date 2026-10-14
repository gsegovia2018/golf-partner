// League notification preferences, stored in the app settings blob at
// `notifications.league = { push: { <type>: bool }, email: { <type>: bool } }`
// (plan section 3.4). A missing key means its default, like every other setting.
//
// send-push reads the push keys (P9); send-email will read the email keys
// (P10), until then those switches only save the choice.

// Order follows the League settings design; `labelKey` is the catalogue key
// of the row's text. `type` is the
// notifications.type value the server inserts.
export const LEAGUE_NOTIFICATION_ROWS = [
  { type: 'league_card_announced', labelKey: 'league.notifPrefs.cardAnnounced' },
  { type: 'league_tee_off', labelKey: 'league.notifPrefs.teeOff' },
  { type: 'league_card_confirmed', labelKey: 'league.notifPrefs.cardConfirmed' },
  { type: 'league_ranking_updated', labelKey: 'league.notifPrefs.rankingUpdated' },
  { type: 'league_month_reminder', labelKey: 'league.notifPrefs.monthReminder' },
  { type: 'league_post_reminder', labelKey: 'league.notifPrefs.postReminder' },
  { type: 'league_vote_opened', labelKey: 'league.notifPrefs.voteOpened' },
  // 20261016000000 (R10, R15).
  { type: 'league_card_voided', labelKey: 'league.notifPrefs.cardVoided' },
  { type: 'league_handicap_changed', labelKey: 'league.notifPrefs.handicapChanged' },
  { type: 'league_spot_claimed', labelKey: 'league.notifPrefs.spotClaimed' },
];

// Types with no switch of their own share a row's: the row's choice applies
// to them too. send-push/index.ts mirrors this map (LEAGUE_PUSH_PREF_OF).
export const LEAGUE_PREF_OF = {
  league_card_rescheduled: 'league_card_announced',
  league_card_withdrawn: 'league_card_announced',
  league_card_auto_withdrawn: 'league_post_reminder',
  league_card_reopened: 'league_card_voided',
  league_card_approved: 'league_card_voided',
  league_member_removed: 'league_spot_claimed',
  league_spot_released: 'league_spot_claimed',
  league_role_changed: 'league_spot_claimed',
  league_card_played_after_withdraw: 'league_card_announced',
};

// The preference key (a LEAGUE_NOTIFICATION_ROWS type) a notification type is
// switched by.
export function leaguePrefKey(type) {
  return LEAGUE_PREF_OF[type] ?? type;
}

// Push on, email off: nobody gets email they did not ask for.
export const DEFAULT_LEAGUE_NOTIFICATIONS = {
  push: Object.fromEntries(LEAGUE_NOTIFICATION_ROWS.map((r) => [r.type, true])),
  email: Object.fromEntries(LEAGUE_NOTIFICATION_ROWS.map((r) => [r.type, false])),
};

// Full prefs (defaults filled in) from the app settings object.
export function resolveLeaguePrefs(appSettings) {
  const saved = appSettings?.notifications?.league ?? {};
  return {
    push: { ...DEFAULT_LEAGUE_NOTIFICATIONS.push, ...(saved.push ?? {}) },
    email: { ...DEFAULT_LEAGUE_NOTIFICATIONS.email, ...(saved.email ?? {}) },
  };
}

// Patch for updateAppSettings. settingsStore merges one level deep
// (`notifications` key-wise, `league` replaced), so the whole league object
// is sent, not just the one switch.
export function leaguePrefsPatch(appSettings, channel, type, value) {
  const current = resolveLeaguePrefs(appSettings);
  return {
    notifications: {
      league: { ...current, [channel]: { ...current[channel], [type]: value } },
    },
  };
}
