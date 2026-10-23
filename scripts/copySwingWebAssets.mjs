// Copies what the web swing analyzer loads at runtime into public/swing-web/ (git ignored), so
// `expo start --web` and `expo export` serve them from the app's own origin: the clip never leaves
// the browser and nothing is fetched from a third-party CDN.
//
//   pose_landmarker_full.task, club_yolox_tiny_v1.tflite   the Android module's own models
//   mediapipe/   @mediapipe/tasks-vision: its ESM bundle and wasm (SIMD + no-SIMD)
//   litert/      @litertjs/core wasm (single-threaded + compat; the threaded build needs COOP/COEP)
//
// Runs whenever Metro loads its config (metro.config.js: `expo start`, `expo export`); the folder
// ignores itself, so the root .gitignore (a fingerprint input) stays as it is.
import {
  copyFileSync, existsSync, mkdirSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'swing-web');
const assets = join(root, 'modules', 'golf-swing', 'android', 'src', 'main', 'assets');
const mediapipe = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const litert = join(root, 'node_modules', '@litertjs', 'core', 'wasm');

const files = [
  [join(assets, 'pose_landmarker_full.task'), join(out, 'pose_landmarker_full.task')],
  [join(assets, 'club_yolox_tiny_v1.tflite'), join(out, 'club_yolox_tiny_v1.tflite')],
  ...['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']
    .map((f) => [join(mediapipe, f), join(out, 'mediapipe', f)]),
  // the JS API itself, imported at run time (src/swing/web/pose.js; Metro can't bundle it). Served
  // as .js: not every static host gives .mjs a JavaScript type, and a module script needs one
  [join(mediapipe, '..', 'vision_bundle.mjs'), join(out, 'mediapipe', 'vision_bundle.js')],
  ...['litert_wasm_internal.js', 'litert_wasm_internal.wasm', 'litert_wasm_compat_internal.js', 'litert_wasm_compat_internal.wasm']
    .map((f) => [join(litert, f), join(out, 'litert', f)]),
];

mkdirSync(out, { recursive: true });
if (!existsSync(join(out, '.gitignore'))) writeFileSync(join(out, '.gitignore'), '# copied by scripts/copySwingWebAssets.mjs\n*\n');

let copied = 0;
for (const [from, to] of files) {
  if (!existsSync(from)) {
    console.warn(`swing-web: missing ${from} (the web swing analyzer will report itself unavailable)`);
    continue;
  }
  if (existsSync(to) && statSync(to).size === statSync(from).size && statSync(to).mtimeMs >= statSync(from).mtimeMs) continue;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied += 1;
}
if (copied) console.log(`swing-web: copied ${copied} file(s) to public/swing-web`);
