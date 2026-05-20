module.exports = function (api) {
  const isTest = api.cache.using(() => process.env.NODE_ENV === 'test');
  return {
    presets: [
      [
        // babel-preset-expo is nested inside the expo package; reference it
        // by its internal path so it resolves correctly in this project.
        require.resolve('expo/internal/babel-preset'),
        // Disable the reanimated Babel plugin in test — it requires native
        // worklets that aren't available in the Jest environment.
        isTest ? { reanimated: false } : {},
      ],
    ],
  };
};
