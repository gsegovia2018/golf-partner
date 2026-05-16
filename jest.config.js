// Jest config. The jest-expo preset wires up babel-preset-expo (so ESM/JSX in
// src/ transforms) and React Native module mapping.
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'src/store/scoring.js',
    'src/store/merge.js',
  ],
};
