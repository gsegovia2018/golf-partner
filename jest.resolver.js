// Composed Jest resolver.
//
// jest.config.js sets `resolver` at the project-config level, and Jest does
// NOT merge that with whatever resolver the preset chain (jest-expo ->
// react-native/jest-preset) already set — the project config's `resolver`
// key wins outright, replacing the preset's.
//
// react-native's jest-preset sets:
//   resolver: require.resolve('./jest/resolver.js')
// (jest-expo clones that preset via lodash cloneDeep and never touches
// `resolver`, so this IS "the preset's resolver" as far as our config is
// concerned). That resolver strips the `exports` field from react-native's
// own package.json so Jest can deep-import react-native internals — a
// workaround for RFC0894, which otherwise blocks subpath access into
// node_modules/react-native/...
//
// Separately, react-native-worklets ships platform-suffixed native modules
// and needs its own resolver (react-native-worklets/jest/resolver) that
// strips the `.native` extension so Jest resolves the non-native,
// test-safe implementation instead of touching the real native module.
//
// Pointing `resolver` directly at either one loses the other's behavior.
// This file composes them: worklets-related requests go through the
// worklets resolver, everything else goes through the react-native preset's
// original resolver — using the same "is this a worklets request" check the
// worklets resolver itself uses internally.
const workletsResolver = require('react-native-worklets/jest/resolver');
const reactNativeResolver = require('react-native/jest/resolver');

module.exports = (request, options) => {
  const isWorkletsRequest =
    options.basedir.includes('react-native-worklets') ||
    request.includes('react-native-worklets');

  return isWorkletsRequest
    ? workletsResolver(request, options)
    : reactNativeResolver(request, options);
};
