const baseConfig = require('./app.json');

function androidBuildArchs() {
  return (process.env.GOLF_ANDROID_BUILD_ARCHS || '')
    .split(',')
    .map((arch) => arch.trim())
    .filter(Boolean);
}

// GOLF_APP_VARIANT=dev: a local development build that installs NEXT TO the
// real app (own applicationId and name), so a dev build never replaces — or
// asks to uninstall — the preview APK and its offline data on a phone.
// google-services.json only knows com.golfpartner.app, so the dev variant
// goes without it (no push). Unset, the config is byte-for-byte what it was:
// EAS profiles and the runtime fingerprint don't move.
function devVariant(expo) {
  const { googleServicesFile, ...android } = expo.android;
  return {
    ...expo,
    name: `${expo.name} Dev`,
    android: { ...android, package: `${expo.android.package}.dev` },
  };
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

  const expo = { ...baseConfig.expo, plugins };
  return process.env.GOLF_APP_VARIANT === 'dev' ? devVariant(expo) : expo;
};
