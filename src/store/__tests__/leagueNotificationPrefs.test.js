import {
  DEFAULT_LEAGUE_NOTIFICATIONS, LEAGUE_NOTIFICATION_ROWS, resolveLeaguePrefs, leaguePrefsPatch,
  LEAGUE_PREF_OF, leaguePrefKey,
} from '../leagueNotificationPrefs';

test('defaults: push on, email off, for every row', () => {
  const prefs = resolveLeaguePrefs({ notifications: { scores: true } });
  expect(prefs).toEqual(DEFAULT_LEAGUE_NOTIFICATIONS);
  LEAGUE_NOTIFICATION_ROWS.forEach((r) => {
    expect(prefs.push[r.type]).toBe(true);
    expect(prefs.email[r.type]).toBe(false);
  });
});

test('saved values win and unknown keys fall back to defaults', () => {
  const prefs = resolveLeaguePrefs({
    notifications: { league: { push: { league_tee_off: false }, email: { league_tee_off: true } } },
  });
  expect(prefs.push.league_tee_off).toBe(false);
  expect(prefs.push.league_card_announced).toBe(true);
  expect(prefs.email.league_tee_off).toBe(true);
});

test('the patch carries the whole league object so settingsStore does not drop other switches', () => {
  const current = { notifications: { league: { push: { league_tee_off: false } } } };
  const patch = leaguePrefsPatch(current, 'email', 'league_ranking_updated', true);
  expect(Object.keys(patch.notifications)).toEqual(['league']);
  expect(patch.notifications.league.push.league_tee_off).toBe(false);
  expect(patch.notifications.league.push.league_card_announced).toBe(true);
  expect(patch.notifications.league.email.league_ranking_updated).toBe(true);
});

test('20261016000000 types: admin actions, handicaps and membership have a row, the rest share one', () => {
  const rows = LEAGUE_NOTIFICATION_ROWS.map((r) => r.type);
  expect(rows).toEqual(expect.arrayContaining(['league_card_voided', 'league_handicap_changed', 'league_spot_claimed']));
  Object.values(LEAGUE_PREF_OF).forEach((t) => expect(rows).toContain(t));
  expect(leaguePrefKey('league_card_withdrawn')).toBe('league_card_announced');
  expect(leaguePrefKey('league_card_auto_withdrawn')).toBe('league_post_reminder');
  expect(leaguePrefKey('league_card_approved')).toBe('league_card_voided');
  expect(leaguePrefKey('league_tee_off')).toBe('league_tee_off');
  // Membership switch: removed (incl. the "you were removed" copy), released, role changes.
  ['league_member_removed', 'league_spot_released', 'league_role_changed']
    .forEach((t) => expect(leaguePrefKey(t)).toBe('league_spot_claimed'));
});

test('send-push mirrors the shared switches', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../../supabase/functions/send-push/index.ts'), 'utf8');
  Object.entries(LEAGUE_PREF_OF).forEach(([type, row]) => expect(src).toContain(`${type}: '${row}'`));
});
