import { leagueCodeFromPath, leagueCodeFromUrl } from '../leagueInviteLink';

describe('leagueInviteLink', () => {
  test('reads the code from App Link URLs and golf:// deep links', () => {
    expect(leagueCodeFromUrl('https://golf-partner.vercel.app/league/MULL7Q4K')).toBe('MULL7Q4K');
    expect(leagueCodeFromUrl('https://golf-partner.vercel.app/league/MULL7Q4K?x=1')).toBe('MULL7Q4K');
    expect(leagueCodeFromUrl('golf://league/MULL7Q4K')).toBe('MULL7Q4K');
    expect(leagueCodeFromPath('/league/AB%20CD')).toBe('AB CD');
  });

  test('anything else is not a league invite', () => {
    expect(leagueCodeFromUrl(null)).toBeNull();
    expect(leagueCodeFromUrl('https://golf-partner.vercel.app/leagues/x')).toBeNull();
    expect(leagueCodeFromUrl('https://golf-partner.vercel.app/join-tournament/ABC')).toBeNull();
    expect(leagueCodeFromUrl('golf://join/abc')).toBeNull();
    expect(leagueCodeFromUrl('not a url')).toBeNull();
    expect(leagueCodeFromPath('/league/')).toBeNull();
  });
});
