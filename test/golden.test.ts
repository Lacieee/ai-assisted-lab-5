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

describe("refactor keeps behaviour identical to the original index.html", () => {
  it("level definitions", () => expect(levelData(cur)).toEqual(levelData(reference)));
  it("meshes, collision and navigation", () => expect(buildAllMeshes(cur)).toEqual(buildAllMeshes(reference)));
  it("particle effects", () => expect(runFx(cur)).toEqual(runFx(reference)));
  it("sound synthesis", () => expect(runSynths(cur)).toEqual(runSynths(reference)));
  for (let i = 0; i < 15; i++) {
    it(`simulation of level ${i}`, () => {
      const got = playLevel(cur, i, FRAMES_PER_LEVEL);
      const want = playLevel(reference, i, FRAMES_PER_LEVEL);
      expect(got.length).toBeGreaterThan(FRAMES_PER_LEVEL / 10);
      expect(got).toEqual(want);
    });
  }
});

describe("assets moved out of index.html are unchanged", () => {
  const shaders = import.meta.glob("../src/render/shaders/*.wgsl", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  for (const name of ["common", "scene", "shadow", "glass", "fx", "post", "outline", "bloom", "final"]) {
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
