// ESLint 9 flat config. Wraps the Expo shared config and layers on the
// runtime globals for test, Node-script, and mock files.
import expoConfig from 'eslint-config-expo/flat.js';
import globals from 'globals';

export default [
  ...expoConfig,
  {
    ignores: [
      'dist/*',
      'web-build/*',
      '.expo/*',
      '.worktrees/**',
      'coverage/*',
      // Deno runtime — not part of the React Native lint scope.
      'supabase/functions/*',
    ],
  },
  {
    // Jest test suites and the manual mocks they rely on.
    files: [
      '**/__tests__/**/*.{js,mjs}',
      '**/*.test.{js,mjs}',
      '__mocks__/**/*.js',
      'jest.config.js',
    ],
    languageOptions: {
      globals: { ...globals.jest, ...globals.node },
    },
  },
  {
    // Node scripts (scrapers, importers, seeders) and config files.
    files: ['scripts/**/*.{js,mjs}', '*.config.{js,mjs}', 'index.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    rules: {
      // @expo/vector-icons / expo-font ship nested under the `expo` package
      // (not hoisted), so Metro resolves them but the ESLint resolver cannot.
      'import/no-unresolved': [
        'error',
        { ignore: ['^@expo/vector-icons', '^expo-font$'] },
      ],
      // Cosmetic (raw apostrophes/quotes in JSX text) — track, don't block.
      'react/no-unescaped-entities': 'warn',
    },
  },
];
