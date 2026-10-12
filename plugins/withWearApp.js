// Expo config plugin: generate the Wear OS companion into the native project.
//
// At prebuild it copies the repo's `wear/` module to `android/wear` and adds
// `include ':wear'` to android/settings.gradle. Both steps are idempotent:
// the copy replaces android/wear wholesale (so deleted sources don't linger)
// and the include is only added once.
//
// The phone build is unaffected: `:app:assembleRelease` never depends on
// :wear. The watch APK is built with `./gradlew :wear:assembleRelease` (the
// `wear-preview` EAS profile). See CLAUDE.md → "Wear OS companion".
const fs = require('fs');
const path = require('path');
const { withDangerousMod, withSettingsGradle } = require('@expo/config-plugins');

const MODULE = 'wear';
const INCLUDE = `include ':${MODULE}'`;
// Local build output and IDE state — never copy these into the native project.
const SKIP = new Set(['build', '.gradle', '.cxx', '.idea', '.kotlin', 'local.properties']);

function copyModule(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (from) => !SKIP.has(path.basename(from)),
  });
}

function withWearSettings(config) {
  return withSettingsGradle(config, (cfg) => {
    const { contents } = cfg.modResults;
    if (!new RegExp(`^\\s*include\\s*\\(?\\s*['"]:${MODULE}['"]`, 'm').test(contents)) {
      cfg.modResults.contents = `${contents.trimEnd()}\n${INCLUDE}\n`;
    }
    return cfg;
  });
}

function withWearSources(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const src = path.join(cfg.modRequest.projectRoot, MODULE);
      if (!fs.existsSync(src)) {
        throw new Error(`withWearApp: ${src} not found`);
      }
      copyModule(src, path.join(cfg.modRequest.platformProjectRoot, MODULE));
      return cfg;
    },
  ]);
}

module.exports = function withWearApp(config) {
  return withWearSources(withWearSettings(config));
};
