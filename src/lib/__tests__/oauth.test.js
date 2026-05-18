import { parseOAuthError, getWebRedirectTo } from '../oauth';

describe('parseOAuthError', () => {
  it('returns null when the URL carries no error', () => {
    expect(parseOAuthError('https://app.example.com/?code=abc123')).toBeNull();
    expect(parseOAuthError('https://app.example.com/')).toBeNull();
  });

  it('returns null for empty or non-string input', () => {
    expect(parseOAuthError('')).toBeNull();
    expect(parseOAuthError(undefined)).toBeNull();
    expect(parseOAuthError(null)).toBeNull();
  });

  it('reads the error from the query string', () => {
    const url = 'https://app.example.com/?error=server_error&error_description=Provider%20is%20not%20enabled';
    expect(parseOAuthError(url)).toBe('Provider is not enabled');
  });

  it('reads the error from the hash fragment', () => {
    const url = 'https://app.example.com/#error=access_denied&error_description=User%20denied%20access';
    expect(parseOAuthError(url)).toBe('User denied access');
  });

  it('prefers error_description but falls back to the short code', () => {
    expect(parseOAuthError('https://app.example.com/?error=access_denied')).toBe('access_denied');
  });

  it('parses errors from a sub-path deploy URL', () => {
    const url = 'https://example.com/golf/?error=server_error&error_description=redirect%20mismatch';
    expect(parseOAuthError(url)).toBe('redirect mismatch');
  });
});

describe('getWebRedirectTo', () => {
  const originalWindow = global.window;
  afterEach(() => { global.window = originalWindow; });

  it('returns undefined when there is no window (native)', () => {
    delete global.window;
    expect(getWebRedirectTo()).toBeUndefined();
  });

  it('includes the pathname so sub-path deploys are not dropped', () => {
    global.window = { location: { origin: 'https://example.com', pathname: '/golf/' } };
    expect(getWebRedirectTo()).toBe('https://example.com/golf/');
  });

  it('works for a root deploy', () => {
    global.window = { location: { origin: 'https://app.example.com', pathname: '/' } };
    expect(getWebRedirectTo()).toBe('https://app.example.com/');
  });
});
