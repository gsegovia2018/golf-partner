import {
  defaultSeason, parseIsoDate, parsePointsTable, formatPointsTable, parseFeeCents,
  defaultMemberHandicap, parseMemberHandicap, buildCreateArgs, leagueJoinLink,
} from '../leagueDraft';
import { DEFAULT_POINTS_TABLE } from '../leagueStandings';

describe('defaultSeason', () => {
  test('runs from today to 31 December', () => {
    expect(defaultSeason(new Date(2026, 9, 4))).toEqual({ seasonStart: '2026-10-04', seasonEnd: '2026-12-31' });
  });
});

describe('parseIsoDate', () => {
  test('accepts real dates only', () => {
    expect(parseIsoDate('2026-12-31')).toBe('2026-12-31');
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('31/12/2026')).toBeNull();
  });
});

describe('points table', () => {
  test('round-trips the default table', () => {
    expect(parsePointsTable(formatPointsTable(DEFAULT_POINTS_TABLE))).toEqual(DEFAULT_POINTS_TABLE);
  });
  test('accepts spaces and middots, rejects junk', () => {
    expect(parsePointsTable('500 · 300 · 190')).toEqual([500, 300, 190]);
    expect(parsePointsTable('')).toBeNull();
    expect(parsePointsTable('500, x')).toBeNull();
    expect(parsePointsTable('-5')).toBeNull();
  });
});

describe('parseFeeCents', () => {
  test('euros to cents, empty is free, junk is null', () => {
    expect(parseFeeCents('30')).toBe(3000);
    expect(parseFeeCents('12,5')).toBe(1250);
    expect(parseFeeCents('')).toBe(0);
    expect(parseFeeCents('abc')).toBeNull();
  });
});

describe('member handicaps', () => {
  test('default comes from the profile, clamped to the cap', () => {
    expect(defaultMemberHandicap(21.8, 30)).toBe(21.8);
    expect(defaultMemberHandicap(36.4, 30)).toBe(30);
    expect(defaultMemberHandicap(null, 30)).toBeNull();
  });
  test('typed value is parsed, comma decimal included, and clamped', () => {
    expect(parseMemberHandicap('18,5', 30)).toBe(18.5);
    expect(parseMemberHandicap('45', 30)).toBe(30);
    expect(parseMemberHandicap('', 30)).toBeNull();
  });
});

describe('buildCreateArgs', () => {
  test('trims the name and keeps the creator first', () => {
    const args = buildCreateArgs({
      name: '  El Club ', seasonStart: '2026-10-04', seasonEnd: '2026-12-31', feeCents: 3000,
      members: [{ userId: 'me', handicap: 18 }, { userId: 'f1' }],
    });
    expect(args.name).toBe('El Club');
    expect(args.pointsTable).toEqual(DEFAULT_POINTS_TABLE);
    expect(args.cap).toBe(30);
    expect(args.members).toEqual([{ userId: 'me', handicap: 18 }, { userId: 'f1', handicap: null }]);
  });
});

test('leagueJoinLink', () => {
  expect(leagueJoinLink('https://x.app', 'MULL-7Q4')).toBe('https://x.app/league/MULL-7Q4');
});
