const baseConfig = require('./app.json');

function androidBuildArchs() {
  return (process.env.GOLF_ANDROID_BUILD_ARCHS || '')
    .split(',')
    .map((arch) => arch.trim())
    .filter(Boolean);
}

module.exports = () => {
  const archs = androidBuildArchs();
  const plugins = [...(baseConfig.expo.plugins || [])];

  if (archs.length > 0) {
    plugins.push([
      'expo-build-properties',
      {
        android: {
          buildArchs: archs,
        },
      },
    ]);
  }

  return {
    ...baseConfig.expo,
    plugins,
  };
};
