import {
  DEFAULT_LEAGUE_NOTIFICATIONS, LEAGUE_NOTIFICATION_ROWS, resolveLeaguePrefs, leaguePrefsPatch,
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
