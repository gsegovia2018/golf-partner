// Expo's default Metro config, plus one side effect: the web swing analyzer's runtime files
// (scripts/copySwingWebAssets.mjs) are copied into public/swing-web before Metro serves or exports
// the web build. It lives here, not in an npm script, because package.json scripts and .gitignore
// are inputs of the Android runtime fingerprint: changing them would strand OTA updates.
const { execFileSync } = require('child_process');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

try {
  execFileSync(process.execPath, [path.join(__dirname, 'scripts', 'copySwingWebAssets.mjs')], { stdio: 'inherit' });
} catch (e) {
  console.warn(`swing-web: could not copy the runtime files (${e.message})`);
}

module.exports = getDefaultConfig(__dirname);
