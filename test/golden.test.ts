// Golden-master test: the refactored code in src/ must behave exactly like the original
// single-file game (test/reference/original-index.html). Run after every refactoring step:
//   npm test
import { beforeAll, describe, expect, it } from "vitest";
import { loadReference } from "./golden/reference";
import * as current from "./golden/current";
import { type Impl, buildAllMeshes, levelData, playLevel, runFx, runSynths } from "./golden/scenarios";

// WebGPU enum the mesh code reads; the values only need to match between the two runs.
(globalThis as any).GPUBufferUsage ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128 };

const FRAMES_PER_LEVEL = 2400; // 40 s of play at 60 fps
let reference: Impl;
const cur = current as Impl;

beforeAll(async () => {
  reference = await loadReference();
});

describe("non-gameplay output identical to the original index.html", () => {
  // GPU buffer contents (lines with "|"); collision/nav results are pinned by snapshot below
  const uploads = (M: Impl) => buildAllMeshes(M).filter((l) => l.includes("|"));
  it("meshes", () => expect(uploads(cur)).toEqual(uploads(reference)));
  it("particle effects", () => expect(runFx(cur)).toEqual(runFx(reference)));
  it("sound synthesis", () => expect(runSynths(cur)).toEqual(runSynths(reference)));
});

// Platform note: these snapshots are bit-exact and were recorded on ARM64 (Apple Silicon) with Node 24.14.1.
// V8's transcendental Math functions can round differently on x64, so run them on the same platform
// They run on ARM64 only; elsewhere they are skipped.
// Gameplay is allowed to change now that bugs are being fixed (see BUGS.md), so the simulation is
// pinned by snapshots instead of by the original. The snapshots were first recorded from code that
// matched the original exactly (commit 13def86 passed the side-by-side comparison). Every behaviour
// change must update them in the same commit (`npx vitest run -u`) and explain the difference;
// the snapshot diff shows the first frame where play diverges.
// Skipped elsewhere (e.g. Linux x64 CI): the last-bit differences would fail them without a real change.
describe.skipIf(process.arch !== "arm64")("simulation snapshots", () => {
  it("level definitions", () => expect(levelData(cur)).toMatchSnapshot());
  it("collision and navigation", () => expect(buildAllMeshes(cur).filter((l) => !l.includes("|"))).toMatchSnapshot());
  for (let i = 0; i < 15; i++) {
    it(`simulation of level ${i}`, () => {
      const got = playLevel(cur, i, FRAMES_PER_LEVEL);
      expect(got.length).toBeGreaterThan(FRAMES_PER_LEVEL / 10);
      expect(got).toMatchSnapshot();
    });
  }
});

describe("assets moved out of index.html are unchanged", () => {
  const shaders = import.meta.glob("../src/render/shaders/*.wgsl", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  // Shaders changed on purpose since the original, with the bug they fix. Everything else must match.
  const CHANGED: Record<string, string> = { final: "BUGS.md #18 (screen went black under fire)" };
  for (const name of ["common", "scene", "shadow", "glass", "fx", "post", "outline", "bloom", "final"]) {
    if (CHANGED[name]) {
      it.skip(`shader ${name}.wgsl — changed on purpose: ${CHANGED[name]}`, () => {});
      continue;
    }
    it(`shader ${name}.wgsl`, () => {
      // The bundle kept a leading newline after the opening backtick; the .wgsl file doesn't.
      expect(shaders[`../src/render/shaders/${name}.wgsl`]).toBe(reference[`${name}_default`].replace(/^\n/, ""));
    });
  }
  it("styles.css and the HTML shell", async () => {
    const fs = await import("node:fs");
    const original = fs.readFileSync("test/reference/original-index.html", "utf8");
    const css = original.slice(original.indexOf("<style>\n") + 8, original.indexOf("</style>"));
    expect(fs.readFileSync("src/styles.css", "utf8")).toBe(css);
    const body = (html: string) => html.slice(html.indexOf("<body>"), html.indexOf("<script"));
    expect(body(fs.readFileSync("index.html", "utf8"))).toBe(body(original));
  });
});
