// Auth-gating tests for AppNavigator's pre-session link routing.
//
// These cover the branches in App.js that decide what a user sees BEFORE a
// Supabase session exists — the part of the app where getting it wrong either
// shows a sign-up wall to someone who should never see one, or leaks the app
// to someone who should. The three link shapes that must survive the gate:
//   /board/<token>           → public read-only board, no auth UI at all
//   /join/<token>            → official invite, guest/login choice
//   /join-tournament/<code>  → casual invite, guest/login choice
//
// App.js imports ~40 screens at module scope and several of them pull in
// native-only modules Jest can't parse, so every screen is stubbed. Each stub
// renders under `screen-<Name>`, which makes the assertions read as "which
// screen did the gate pick?".
const fs = require('fs');
const path = require('path');

const screensDir = path.join(__dirname, '..', 'src', 'screens');
fs.readdirSync(screensDir)
  .filter((file) => file.endsWith('.js'))
  .forEach((file) => {
    const screenName = file.replace(/\.js$/, '');
    // doMock, not mock: babel-plugin-jest-hoist would hoist a jest.mock() call
    // above `screenName` and register `../src/screens/undefined`. Everything
    // here is CommonJS, so the App require further down still sees these.
    jest.doMock(`../src/screens/${screenName}`, () => {
      const React = require('react');
      const { Text } = require('react-native');
      return function ScreenStub(props) {
        return React.createElement(
          Text,
          { testID: `screen-${screenName}` },
          String(props.token ?? ''),
        );
      };
    });
  });

jest.mock('../src/components/LoadingSplash', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return function SplashStub() {
    return React.createElement(Text, { testID: 'loading-splash' }, 'splash');
  };
});

// Captured so the tests can assert on the deep-link config that turns a URL
// into a route once a session exists (the post-sign-in half of the handoff).
const mockNavigationProps = { current: null };
jest.mock('@react-navigation/native', () => ({
  NavigationContainer: (props) => {
    mockNavigationProps.current = props;
    return props.children;
  },
  createNavigationContainerRef: () => ({ isReady: () => false, navigate: jest.fn() }),
}));

const mockRegisteredScreens = [];
jest.mock('@react-navigation/stack', () => ({
  createStackNavigator: () => ({
    Navigator: ({ children }) => children,
    Screen: ({ name }) => {
      if (!mockRegisteredScreens.includes(name)) mockRegisteredScreens.push(name);
      return null;
    },
  }),
  CardStyleInterpolators: {
    forFadeFromBottomAndroid: 'fadeFromBottomAndroid',
    forHorizontalIOS: 'horizontalIOS',
  },
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => ({
    Navigator: ({ children }) => children,
    Screen: () => null,
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }) => children,
  initialWindowMetrics: null,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn(() => Promise.resolve(null)),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));

// expo-font / expo-notifications resolve through Expo's own module graph at
// runtime but aren't resolvable from the repo root under Jest.
jest.mock('expo-font', () => ({ useFonts: () => [true] }), { virtual: true });
jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: () => ({ remove: jest.fn() }),
  setNotificationHandler: jest.fn(),
}), { virtual: true });
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
// The repo-wide __mocks__ stub returns undefined from lockAsync, which App.js
// chains .catch() onto.
jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn(() => Promise.resolve()),
  OrientationLock: { PORTRAIT_UP: 'PORTRAIT_UP' },
}));

jest.mock('../src/store/deviceId', () => ({
  initDeviceAuthorId: () => Promise.resolve('device-1'),
  getDeviceAuthorId: () => 'device-1',
}));
jest.mock('../src/store/profileStore', () => ({
  loadProfile: () => Promise.resolve({ username: 'marcos' }),
}));
jest.mock('../src/store/courseGeometryStore', () => ({ hydrateCourseGeometry: jest.fn() }));
jest.mock('../src/store/shotStore', () => ({ hydrateShots: jest.fn() }));
jest.mock('../src/store/settingsStore', () => ({ hydrateAppSettings: jest.fn() }));
jest.mock('../src/lib/uploadWorker', () => ({ startUploadWorker: jest.fn() }));
jest.mock('../src/lib/pushNotifications', () => ({
  registerPushToken: jest.fn(),
  configureNotificationHandler: jest.fn(),
}));
jest.mock('../src/lib/notificationContent', () => ({ normalizeDeepLink: (data) => data }));

const mockAuth = { session: null, loading: false, passwordRecovery: false };
jest.mock('../src/context/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => mockAuth,
}));

const React = require('react');
const { render, waitFor } = require('@testing-library/react-native');
const Linking = require('expo-linking');
const App = require('../App').default;

const SESSION = { user: { id: 'u1', is_anonymous: false } };

// Waits out font/device-id hydration and the async getInitialURL resolve, all
// of which the splash covers. Signed-in renders keep a splash on screen (the
// BootSplashOverlay), so those wait for the Stack to mount instead.
async function renderAtUrl(url, auth = {}) {
  Linking.getInitialURL.mockResolvedValue(url);
  Object.assign(mockAuth, { session: null, loading: false, passwordRecovery: false }, auth);
  const utils = render(React.createElement(App));
  if (auth.session) {
    await waitFor(() => expect(mockRegisteredScreens).toContain('Main'));
  } else {
    await waitFor(() => expect(utils.queryByTestId('loading-splash')).toBeNull());
  }
  return utils;
}

describe('App gating: public board links', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Linking.addEventListener.mockReturnValue({ remove: jest.fn() });
    mockRegisteredScreens.length = 0;
  });

  test('signed-out /board/<token> renders the board with the token and no auth UI', async () => {
    const { getByTestId, queryByTestId } = await renderAtUrl(
      'https://golf-partner.vercel.app/board/tok-123',
    );

    expect(getByTestId('screen-SharedBoardScreen').props.children).toBe('tok-123');
    expect(queryByTestId('screen-AuthScreen')).toBeNull();
    expect(queryByTestId('screen-JoinTournamentLinkScreen')).toBeNull();
  });

  test('signed-out golf://board/<token> deep link resolves the same way', async () => {
    const { getByTestId, queryByTestId } = await renderAtUrl('golf://board/tok-abc');

    expect(getByTestId('screen-SharedBoardScreen').props.children).toBe('tok-abc');
    expect(queryByTestId('screen-AuthScreen')).toBeNull();
  });

  test('web reads the board token synchronously from window.location', async () => {
    const original = window.location;
    window.location = { pathname: '/board/tok-web', origin: 'https://golf-partner.vercel.app' };
    try {
      // getInitialURL must not be what answers the question on web.
      Linking.getInitialURL.mockResolvedValue(null);
      Object.assign(mockAuth, { session: null, loading: false, passwordRecovery: false });
      const { getByTestId, queryByTestId } = render(React.createElement(App));
      await waitFor(() => expect(queryByTestId('loading-splash')).toBeNull());

      expect(getByTestId('screen-SharedBoardScreen').props.children).toBe('tok-web');
      expect(queryByTestId('screen-AuthScreen')).toBeNull();
    } finally {
      window.location = original;
    }
  });

  test('password recovery still wins over a board link', async () => {
    const { getByTestId, queryByTestId } = await renderAtUrl(
      'https://golf-partner.vercel.app/board/tok-123',
      { passwordRecovery: true },
    );

    expect(getByTestId('screen-SetNewPasswordScreen')).toBeTruthy();
    expect(queryByTestId('screen-SharedBoardScreen')).toBeNull();
  });

  test('a signed-in visitor gets the routed SharedBoard screen, not the bare render', async () => {
    const { queryByTestId } = await renderAtUrl(
      'https://golf-partner.vercel.app/board/tok-123',
      { session: SESSION },
    );

    // The Stack mounted (bare pre-session render did not happen)…
    expect(queryByTestId('screen-SharedBoardScreen')).toBeNull();
    // …and it can resolve the board URL to a route with a back stack.
    expect(mockRegisteredScreens).toContain('SharedBoard');
    expect(mockNavigationProps.current.linking.config.screens.SharedBoard).toBe('board/:token');
    expect(mockNavigationProps.current.linking.config.initialRouteName).toBe('Main');
  });
});

describe('App gating: invite links', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Linking.addEventListener.mockReturnValue({ remove: jest.fn() });
    mockRegisteredScreens.length = 0;
  });

  test('signed-out official invite /join/<token> reaches the pre-session join screen', async () => {
    const { getByTestId, queryByTestId } = await renderAtUrl(
      'https://golf-partner.vercel.app/join/9f1c-token',
    );

    expect(getByTestId('screen-JoinTournamentLinkScreen')).toBeTruthy();
    expect(queryByTestId('screen-AuthScreen')).toBeNull();
    expect(queryByTestId('screen-SharedBoardScreen')).toBeNull();
  });

  test('signed-out casual invite /join-tournament/<code> is unchanged', async () => {
    const { getByTestId, queryByTestId } = await renderAtUrl(
      'https://golf-partner.vercel.app/join-tournament/ABC123',
    );

    expect(getByTestId('screen-JoinTournamentLinkScreen')).toBeTruthy();
    expect(queryByTestId('screen-AuthScreen')).toBeNull();
  });

  test('golf://join/<token> and golf://join-tournament/<code> both match', async () => {
    let r = await renderAtUrl('golf://join/tok-1');
    expect(r.getByTestId('screen-JoinTournamentLinkScreen')).toBeTruthy();

    r = await renderAtUrl('golf://join-tournament/ABC123');
    expect(r.getByTestId('screen-JoinTournamentLinkScreen')).toBeTruthy();
  });

  test('once a session exists the invite URL resolves to a route, token included', async () => {
    // The pre-session screen establishes a session (guest or login) and then
    // gets out of the way; the URL is still current, and NavigationContainer's
    // stashed initial linking state is what carries the token to the redeem
    // screen. Both invite shapes must have a route to land on.
    await renderAtUrl('https://golf-partner.vercel.app/join/9f1c-token', { session: SESSION });

    const { screens } = mockNavigationProps.current.linking.config;
    expect(screens.JoinOfficial).toBe('join/:token');
    expect(screens.JoinTournament).toBe('join-tournament/:code');
    expect(mockRegisteredScreens).toEqual(
      expect.arrayContaining(['JoinOfficial', 'JoinTournament']),
    );
  });

  test('no link at all still shows the sign-up wall', async () => {
    const { getByTestId, queryByTestId } = await renderAtUrl(null);

    expect(getByTestId('screen-AuthScreen')).toBeTruthy();
    expect(queryByTestId('screen-JoinTournamentLinkScreen')).toBeNull();
    expect(queryByTestId('screen-SharedBoardScreen')).toBeNull();
  });

  test('an unrelated path is neither an invite nor a board', async () => {
    const { getByTestId, queryByTestId } = await renderAtUrl(
      'https://golf-partner.vercel.app/joined/nope',
    );

    expect(getByTestId('screen-AuthScreen')).toBeTruthy();
    expect(queryByTestId('screen-JoinTournamentLinkScreen')).toBeNull();
    expect(queryByTestId('screen-SharedBoardScreen')).toBeNull();
  });
});
