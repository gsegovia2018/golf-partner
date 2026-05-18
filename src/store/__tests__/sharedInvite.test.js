import { buildJoinLink } from '../tournamentStore';

describe('buildJoinLink', () => {
  test('builds a path URL from an origin and code', () => {
    expect(buildJoinLink('https://golf.example.com', 'ABC123'))
      .toBe('https://golf.example.com/join-tournament/ABC123');
  });

  test('strips a trailing slash from the origin', () => {
    expect(buildJoinLink('https://golf.example.com/', 'ABC123'))
      .toBe('https://golf.example.com/join-tournament/ABC123');
  });

  test('falls back to the production origin when none is given', () => {
    expect(buildJoinLink('', 'XYZ789'))
      .toBe('https://golf.app/join-tournament/XYZ789');
  });

  test('upper-cases the code', () => {
    expect(buildJoinLink('https://golf.app', 'abc123'))
      .toBe('https://golf.app/join-tournament/ABC123');
  });
});
