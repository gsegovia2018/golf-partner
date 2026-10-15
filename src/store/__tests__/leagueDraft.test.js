import {
  defaultSeason, parseIsoDate, parsePointsTable, formatPointsTable, parseFeeCents,
  defaultMemberHandicap, parseMemberHandicap, buildCreateArgs, leagueJoinLink,
  checkPointsDrafts, stepFeeText, seasonMonthKeys, LEAGUE_FORMATS, LEAGUE_FORMAT_SECTIONS,
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
    expect(args.participationPoints).toBe(10);
    expect(args.members).toEqual([{ userId: 'me', handicap: 18 }, { userId: 'f1', handicap: null }]);
  });
});

test('leagueJoinLink', () => {
  expect(leagueJoinLink('https://x.app', 'MULL-7Q4')).toBe('https://x.app/league/MULL-7Q4');
});

describe('checkPointsDrafts', () => {
  test('whole numbers pass and become the table', () => {
    expect(checkPointsDrafts(['500', ' 300 ', '0'])).toEqual({ table: [500, 300, 0], badIndex: -1 });
  });
  test('reports the first empty or invalid place', () => {
    expect(checkPointsDrafts(['500', '', '3']).badIndex).toBe(1);
    expect(checkPointsDrafts(['500', '3', '1.5', 'x']).badIndex).toBe(2);
    expect(checkPointsDrafts(['-1']).badIndex).toBe(0);
  });
  test('needs at least one and at most 40 places', () => {
    expect(checkPointsDrafts([])).toEqual({ table: null, badIndex: -1 });
    expect(checkPointsDrafts(Array(41).fill('1')).table).toBeNull();
    expect(checkPointsDrafts(Array(40).fill('1')).table).toHaveLength(40);
  });
  test('agrees with parsePointsTable', () => {
    expect(checkPointsDrafts(['500', '300']).table).toEqual(parsePointsTable('500, 300'));
  });
});

describe('stepFeeText', () => {
  test('steps by 5 euros, never below free', () => {
    expect(stepFeeText('', 1)).toBe('5');
    expect(stepFeeText('5', 1)).toBe('10');
    expect(stepFeeText('5', -1)).toBe('');
    expect(stepFeeText('', -1)).toBe('');
    expect(stepFeeText('3', -1)).toBe('');
  });
  test('stays parseFeeCents-compatible and rejects an invalid text', () => {
    expect(parseFeeCents(stepFeeText('25', 1))).toBe(3000);
    expect(stepFeeText('abc', 1)).toBeNull();
  });
});

describe('seasonMonthKeys', () => {
  test('lists each calendar month the season touches', () => {
    expect(seasonMonthKeys('2026-10-04', '2026-12-31')).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(seasonMonthKeys('2026-10-31', '2026-10-31')).toEqual(['2026-10']);
  });
  test('crosses a year end', () => {
    expect(seasonMonthKeys('2026-11-15', '2027-02-01')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
  test('is empty when a date is missing or the order is wrong', () => {
    expect(seasonMonthKeys(null, '2026-12-31')).toEqual([]);
    expect(seasonMonthKeys('2026-12-31', '2026-10-01')).toEqual([]);
  });
});

describe('LEAGUE_FORMATS', () => {
  test('every format sits in a known section', () => {
    const sections = LEAGUE_FORMAT_SECTIONS.map((x) => x.section);
    LEAGUE_FORMATS.forEach((f) => expect(sections).toContain(f.section));
    expect(LEAGUE_FORMATS.map((f) => f.key)).toContain('stableford');
  });
});
