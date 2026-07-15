import {
  parseOAuthError, getWebRedirectTo, getPasswordResetRedirectTo, stripRecoveryMarker,
} from '../oauth';

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

describe('getPasswordResetRedirectTo', () => {
  const originalWindow = global.window;
  afterEach(() => { global.window = originalWindow; });

  it('returns the web URL with our own recovery marker on web', () => {
    global.window = { location: { origin: 'https://app.example.com', pathname: '/' } };
    // The `type=recovery` marker is ours (survives detectSessionInUrl), not
    // something GoTrue populates — it's how the web load is recognised as a
    // recovery, since the PKCE auto-exchange never emits PASSWORD_RECOVERY.
    expect(getPasswordResetRedirectTo('web', 'golf://reset-password')).toBe('https://app.example.com/?type=recovery');
  });

  it('carries the marker for a sub-path web deploy too', () => {
    global.window = { location: { origin: 'https://example.com', pathname: '/golf/' } };
    expect(getPasswordResetRedirectTo('web', 'golf://reset-password')).toBe('https://example.com/golf/?type=recovery');
  });

  it('returns the native deep link off-web', () => {
    delete global.window;
    expect(getPasswordResetRedirectTo('android', 'golf://reset-password')).toBe('golf://reset-password');
    expect(getPasswordResetRedirectTo('ios', 'golf://reset-password')).toBe('golf://reset-password');
  });

  it('prefers the deep link over an incidentally-present window on native', () => {
    global.window = { location: { origin: 'https://app.example.com', pathname: '/' } };
    expect(getPasswordResetRedirectTo('android', 'golf://reset-password')).toBe('golf://reset-password');
  });
});

describe('stripRecoveryMarker', () => {
  it('removes the type=recovery marker, leaving a clean URL', () => {
    expect(stripRecoveryMarker('https://app.example.com/?type=recovery'))
      .toBe('https://app.example.com/');
  });

  it('keeps other query params while removing only the marker', () => {
    expect(stripRecoveryMarker('https://app.example.com/?foo=1&type=recovery&bar=2'))
      .toBe('https://app.example.com/?foo=1&bar=2');
  });

  it('preserves a sub-path deploy', () => {
    expect(stripRecoveryMarker('https://example.com/golf/?type=recovery'))
      .toBe('https://example.com/golf/');
  });

  it('leaves a URL without the marker unchanged', () => {
    expect(stripRecoveryMarker('https://app.example.com/?code=abc'))
      .toBe('https://app.example.com/?code=abc');
  });

  it('does not touch a non-recovery type value', () => {
    expect(stripRecoveryMarker('https://app.example.com/?type=signup'))
      .toBe('https://app.example.com/?type=signup');
  });

  it('returns the input as-is for empty / non-string values', () => {
    expect(stripRecoveryMarker('')).toBe('');
    expect(stripRecoveryMarker(undefined)).toBeUndefined();
    expect(stripRecoveryMarker(null)).toBeNull();
  });
});
