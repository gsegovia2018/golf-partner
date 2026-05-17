// Jest config. The jest-expo preset wires up babel-preset-expo (so ESM/JSX in
// src/ transforms) and React Native module mapping.
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'src/store/scoring.js',
    'src/store/merge.js',
  ],
  moduleNameMapper: {
    '@react-native-async-storage/async-storage':
      '@react-native-async-storage/async-storage/jest/async-storage-mock',
    '^@supabase/supabase-js$': '<rootDir>/__mocks__/@supabase/supabase-js.js',
    '^@react-native-community/netinfo$': '<rootDir>/__mocks__/@react-native-community/netinfo.js',
  },
};
