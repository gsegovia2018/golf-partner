// League notification preferences, stored in the app settings blob at
// `notifications.league = { push: { <type>: bool }, email: { <type>: bool } }`
// (plan section 3.4). A missing key means its default, like every other setting.
//
// P9 (push) and P10 (email) make send-push / send-email read these keys; until
// then the switches only save the choice.

// Order and wording follow the League settings design. `type` is the
// notifications.type value the server inserts.
export const LEAGUE_NOTIFICATION_ROWS = [
  { type: 'league_card_announced', label: 'Someone declares a card' },
  { type: 'league_tee_off', label: 'Someone tees off' },
  { type: 'league_card_confirmed', label: 'A card is confirmed' },
  { type: 'league_ranking_updated', label: 'Ranking updated' },
  { type: 'league_month_reminder', label: '3 days left, no card yet' },
  { type: 'league_vote_opened', label: 'A handicap vote opens' },
];

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
