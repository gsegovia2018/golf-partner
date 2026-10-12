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
// goes without it (no push). It also gets its own URL scheme and no
// intentFilters: two apps answering golf:// or the https join links would
// let the dev build catch the real app's OAuth redirect and invite links.
// Unset, the config is byte-for-byte what it was: EAS profiles and the
// runtime fingerprint don't move. Never set GOLF_APP_VARIANT for an EAS
// build or update (CLAUDE.md, "Shipping to Android").
function devVariant(expo) {
  const { googleServicesFile, intentFilters, ...android } = expo.android;
  return {
    ...expo,
    name: `${expo.name} Dev`,
    scheme: 'golf-dev',
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
