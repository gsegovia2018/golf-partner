import { buildCourseLastUsed, buildPlayerLastUsed } from '../recentUse';

// The pickers sort by these, read from the local tournaments index rather
// than a full tournaments fetch (the reason the pickers opened slowly).
const rows = [
  { createdAt: '2026-10-01T00:00:00Z', playerIds: ['p1', 'p2'], courseIds: ['c1'] },
  { createdAt: '2026-10-15T00:00:00Z', playerIds: ['p2'], courseIds: ['c1', 'c2'] },
  { createdAt: null, playerIds: ['p3'] },
  // Written by a build before the index carried ids.
  { createdAt: '2026-10-20T00:00:00Z' },
];

test('buildPlayerLastUsed keeps the latest game per player (undated games count for nothing)', () => {
  expect(buildPlayerLastUsed(rows)).toEqual({
    p1: Date.parse('2026-10-01T00:00:00Z'),
    p2: Date.parse('2026-10-15T00:00:00Z'),
  });
});

test('buildCourseLastUsed keeps the latest game per course', () => {
  expect(buildCourseLastUsed(rows)).toEqual({
    c1: Date.parse('2026-10-15T00:00:00Z'),
    c2: Date.parse('2026-10-15T00:00:00Z'),
  });
});

test('no rows means no recent use', () => {
  expect(buildPlayerLastUsed(undefined)).toEqual({});
});
