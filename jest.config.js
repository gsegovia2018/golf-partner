// Jest config. The jest-expo preset wires up babel-preset-expo (so ESM/JSX in
// src/ transforms) and React Native module mapping.
module.exports = {
  preset: 'jest-expo',
  // react-native-worklets ships platform-suffixed native modules; this
  // resolver strips the `.native` extension when resolving worklets so
  // Jest picks up the non-native (test-safe) implementation instead of
  // trying to touch the real native module.
  resolver: 'react-native-worklets/jest/resolver',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'src/store/scoring.js',
    'src/store/merge.js',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/\\.worktrees/'],
  modulePathIgnorePatterns: ['<rootDir>/.worktrees/'],
  // Transform ESM packages from node_modules that Jest can't parse as-is.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(-.*)?|@expo(-.*)?|@unimodules|unimodules|sentry-expo|native-base|react-native-svg|react-native-url-polyfill|react-native-reanimated|react-native-worklets|uuid)/)',
  ],
  moduleNameMapper: {
    '@react-native-async-storage/async-storage':
      '@react-native-async-storage/async-storage/jest/async-storage-mock',
    '^@supabase/supabase-js$': '<rootDir>/__mocks__/@supabase/supabase-js.js',
    '^@react-native-community/netinfo$': '<rootDir>/__mocks__/@react-native-community/netinfo.js',
    '^@expo/vector-icons$': '<rootDir>/__mocks__/@expo/vector-icons.js',
    '^react-native-reanimated$': '<rootDir>/__mocks__/react-native-reanimated.js',
    '^react-native-webview$': '<rootDir>/__mocks__/react-native-webview.js',
    '^expo-haptics$': '<rootDir>/__mocks__/expo-haptics.js',
    '^expo-screen-orientation$': '<rootDir>/__mocks__/expo-screen-orientation.js',
    '^expo-video$': '<rootDir>/__mocks__/expo-video.js',
  },
};
