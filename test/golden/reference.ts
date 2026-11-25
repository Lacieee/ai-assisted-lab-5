// Loads the game code exactly as it shipped in the original single-file index.html
// (test/reference/original-index.html, a verbatim copy of commit bda2868), so it can be
// compared against the refactored modules in src/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Names pulled out of the original bundle. Same names are exported from src/. */
const EXPORTS = [
  "LEVELS",
  "World",
  "PlayerController",
  "TimeScaleDriver",
  "Time",
  "FIXED_STEP",
  "WALK_SPEED",
  "ReplayRecorder",
  "ReplayPlayer",
  "buildLevelMesh",
  "buildMeshLibrary",
  "computePose",
  "createPose",
  "FxSystem",
  "Viewmodel",
  "SYNTHS",
  ...["common", "scene", "shadow", "glass", "fx", "post", "outline", "bloom", "final"].map((s) => `${s}_default`),
];

export async function loadReference(): Promise<Record<string, any>> {
  const html = fs.readFileSync(path.join(here, "../reference/original-index.html"), "utf8");
  const lines = html.split("\n");
  const start = lines.findIndex((l) => l.startsWith('<script type="module">')) + 1;
  const end = lines.findIndex((l) => l.startsWith("async function boot()"));
  if (start <= 0 || end < 0) throw new Error("original bundle layout not recognised");
  let js = lines.slice(start, end).join("\n");
  // The only change: the CDN import becomes the npm package of the same version.
  js = js.replace(/from "https:\/\/cdn\.jsdelivr\.net\/npm\/wgpu-matrix@[^"]+"/, 'from "wgpu-matrix"');
  js += `\nexport { ${EXPORTS.join(", ")} };\n`;
  const outDir = path.join(here, "../../node_modules/.cache/golden");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, "original-bundle.mjs");
  fs.writeFileSync(file, js);
  return import(/* @vite-ignore */ pathToFileURL(file).href);
}
