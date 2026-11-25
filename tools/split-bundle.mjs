// Kept for review: this script produced the first module split (commit 82063d1) from the
// bundled index.html. It is not part of the build. See PART2.md, "How the split was made".
// One-off: split the bundled index.html back into ES modules.
// usage: node split.mjs <original.html> <projectDir>
import fs from "node:fs";
import path from "node:path";

const [, , src, outDir] = process.argv;
const L = fs.readFileSync(src, "utf8").split("\n");
const lines = (a, b) => L.slice(a - 1, b).join("\n");

// [file, start, end] — 1-based inclusive line ranges of the original bundle
const MODULES = [
  ["engine/gfx.ts", 507, 631],
  ["render/mesh.ts", 632, 665],
  ["render/renderer.ts", 1135, 1835],
  ["render/camera.ts", 1836, 1875],
  ["engine/input.ts", 1876, 2055],
  ["engine/time.ts", 2056, 2119],
  ["engine/loop.ts", 2120, 2157],
  ["engine/vec3.ts", 2158, 2232],
  ["audio/audio-engine.ts", 2233, 2400],
  ["audio/synths.ts", 2401, 2508],
  ["levels/level-builder.ts", 2509, 2610],
  ["levels/act1-transit.ts", 2611, 2838],
  ["levels/act2-office.ts", 2839, 3063],
  ["levels/act3-rooftops.ts", 3064, 3387],
  ["levels/index.ts", 3388, 3394],
  ["ui/ui.ts", 3395, 3734],
  ["app/save.ts", 3735, 3778],
  ["ui/debug-overlay.ts", 3779, 3815],
  ["render/mesh-builder.ts", 3816, 3923],
  ["render/themes.ts", 3924, 3996],
  ["physics/static-world.ts", 3997, 4304],
  ["physics/nav-grid.ts", 4305, 4582],
  ["app/level-loader.ts", 4583, 4613],
  ["engine/rng.ts", 4614, 4639],
  ["visuals/mesh-library.ts", 4640, 4791],
  ["gameplay/items.ts", 4792, 4825],
  ["gameplay/enemy.ts", 4826, 5197],
  ["gameplay/world.ts", 5198, 6063],
  ["gameplay/player-controller.ts", 6064, 6160],
  ["gameplay/time-scale-driver.ts", 6161, 6191],
  ["visuals/fx-system.ts", 6192, 6454],
  ["visuals/viewmodel.ts", 6455, 6570],
  ["gameplay/replay.ts", 6571, 6622],
  ["visuals/pose.ts", 6623, 6695],
  ["app/game.ts", 6696, 7393],
  ["main.ts", 7394, 7418],
];

// level() lives at 2606-2610 inside the act-1 chunk in the bundle; it belongs to the builder.
// (handled by the ranges above: level-builder ends at 2610, act1 starts at 2611)

const SHADERS = { common: 666, scene: 718, shadow: 787, glass: 798, fx: 859, post: 937, outline: 963, bloom: 1019, final: 1069 };
const srcRoot = path.join(outDir, "src");
fs.mkdirSync(path.join(srcRoot, "render/shaders"), { recursive: true });
for (const [name, start] of Object.entries(SHADERS)) {
  let end = start + 1;
  while (L[end - 1] !== "`;") end++;
  fs.writeFileSync(path.join(srcRoot, `render/shaders/${name}.wgsl`), lines(start + 1, end - 1).replace(/^\n+/, "") + "\n");
}

// --- pass 1: top-level declarations per module
const decls = new Map(); // name -> module
const bodies = {};
for (const [file, a, b] of MODULES) {
  let text = lines(a, b).replace(/^\n+|\n+$/g, "");
  // esbuild's `var X = class _X {` -> `class X {`, and self-references `_X` -> `X`
  text = text.replace(/^var (\w+) = class(?: (_\w+))?( extends [\w.]+)? \{/gm, (m, n, inner, ext) => {
    if (inner) text = text; // handled below
    return `class ${n}${ext ?? ""} {`;
  });
  for (const m of lines(a, b).matchAll(/^var (\w+) = class (_\w+)/gm)) text = text.replace(new RegExp(`\\b${m[2]}\\b`, "g"), m[1]);
  // classes ended with `};` -> `}`
  bodies[file] = text;
  for (const m of text.matchAll(/^(?:async )?(?:function|class|var) (\w+)/gm)) decls.set(m[1], file);
}

// --- pass 2: var -> const/let, exports, imports
const used = new Map(); // name -> Set(files using it)
const refs = {};
for (const [file] of MODULES) {
  const text = bodies[file];
  refs[file] = [];
  for (const [name, owner] of decls) {
    if (owner === file) continue;
    if (new RegExp(`(?<![\\w$])(?<!(?:^|[^.])\\.)${name}\\b`).test(text)) {
      refs[file].push(name);
      if (!used.has(name)) used.set(name, new Set());
      used.get(name).add(file);
    }
  }
}

const rel = (from, to) => {
  let r = path.relative(path.dirname(from), to).replace(/\.ts$/, "");
  if (!r.startsWith(".")) r = "./" + r;
  return r;
};

for (const [file] of MODULES) {
  let text = bodies[file];
  text = text.replace(/^var (\w+) =/gm, (m, n) => {
    const reassigned = new RegExp(`(?<![.\\w$])${n}(\\s*([-+*/]?=(?!=))|\\+\\+|--)`, "g");
    const count = [...text.matchAll(reassigned)].length;
    return `${count > 1 ? "let" : "const"} ${n} =`;
  });
  // class bodies: `};` closing a top-level class -> `}`
  text = text.replace(/^(class [^\n]*\{[\s\S]*?)^\};$/gm, "$1}");
  // exports for names used elsewhere
  text = text.replace(/^((?:async )?(?:function|class|const|let)) (\w+)/gm, (m, kw, n) => (used.has(n) ? `export ${kw} ${n}` : m));

  const byFile = new Map();
  for (const n of refs[file]) {
    const f = decls.get(n);
    if (!byFile.has(f)) byFile.set(f, []);
    byFile.get(f).push(n);
  }
  const imports = [];
  const wm = ["mat4", "vec3"].filter((n) => new RegExp(`(?<![.\\w$])${n}\\.`).test(text));
  if (wm.length) imports.push(`import { ${wm.join(", ")} } from "wgpu-matrix";`);
  if (file === "render/renderer.ts") {
    for (const s of Object.keys(SHADERS)) {
      imports.push(`import ${s}Wgsl from "./shaders/${s}.wgsl?raw";`);
      text = text.replace(new RegExp(`\\b${s}_default\\b`, "g"), `${s}Wgsl`);
    }
  }
  for (const [f, names] of [...byFile].sort((x, y) => x[0].localeCompare(y[0]))) {
    imports.push(`import { ${names.sort().join(", ")} } from "${rel(file, f)}";`);
  }
  const out = (imports.length ? imports.join("\n") + "\n\n" : "") + text + "\n";
  fs.mkdirSync(path.dirname(path.join(srcRoot, file)), { recursive: true });
  fs.writeFileSync(path.join(srcRoot, file), out);
}

// CSS and HTML shell
const styleStart = L.indexOf("<style>") + 1;
const styleEnd = L.indexOf("</style>") + 1;
fs.writeFileSync(path.join(srcRoot, "styles.css"), lines(styleStart + 1, styleEnd - 1) + "\n");
const bodyStart = L.indexOf("<body>") + 1;
const scriptStart = L.findIndex((l) => l.startsWith('<script type="module">')) + 1;
const html = [...L.slice(0, styleStart - 1), ...L.slice(styleEnd, bodyStart), ...L.slice(bodyStart, scriptStart - 1), '<script type="module" src="/src/main.ts"></script>', "</body>", "</html>", ""].join("\n");
fs.writeFileSync(path.join(outDir, "index.html"), html);
console.log("modules:", MODULES.length, "decls:", decls.size);
