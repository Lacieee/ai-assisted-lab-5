// Regression tests for bugs that made the game broken, unfair or unplayable (see BUGS.md).
// Each test was written to fail before its fix.
import { describe, expect, it } from "vitest";
import { Ui } from "../src/ui/ui";
import { LEVELS } from "../src/levels/index";

const isUnlocked = (index: number, cleared: string[] = []) =>
  Ui.prototype.isUnlocked.call({ levels: LEVELS, save: { levels: Object.fromEntries(cleared.map((id) => [id, { cleared: true }])) } }, index);

describe("BUGS.md #1: level unlocking", () => {
  it("the first level is playable on a fresh save", () => expect(isUnlocked(0)).toBe(true));
  it("the second level is locked until the first is cleared", () => {
    expect(isUnlocked(1)).toBe(false);
    expect(isUnlocked(1, ["1-1"])).toBe(true);
  });
});

import { World } from "../src/gameplay/world";
import { PlayerController } from "../src/gameplay/player-controller";
import { TimeScaleDriver } from "../src/gameplay/time-scale-driver";
import { ReplayRecorder } from "../src/gameplay/replay";
import { runPlayerFrame, type PlayerInput } from "../src/gameplay/player-frame";

/** Sets up level `index` the way Game does and returns a function that plays one 60 fps frame. */
export function playing(index: number) {
  const def = LEVELS[index];
  const ctx = { player: new PlayerController(), world: new World(def), driver: new TimeScaleDriver(), recorder: new ReplayRecorder() };
  ctx.player.reset(def.player.pos, def.player.yaw);
  const look = { sensitivity: 22e-4, invertY: false };
  const frame = (input: Partial<PlayerInput> = {}) =>
    runPlayerFrame(ctx, { mouseDx: 0, mouseDy: 0, moveAxes: () => ({ x: 0, y: 0 }), wasPressed: () => false, ...input }, 1 / 60, look);
  return { ctx, frame };
}

describe("BUGS.md #2: time moves only when you move", () => {
  it("standing still freezes time", () => {
    const { frame } = playing(0);
    let ts = 1;
    for (let i = 0; i < 120; i++) ts = frame();
    expect(ts).toBeLessThan(0.05);
  });
  it("walking runs time at full speed", () => {
    const { frame } = playing(0);
    let ts = 0;
    for (let i = 0; i < 120; i++) ts = frame({ moveAxes: () => ({ x: 0, y: 1 }) });
    expect(ts).toBeGreaterThan(0.95);
  });
});

import { StaticWorld } from "../src/physics/static-world";

/** Where a body of the given radius/height standing at pos overlaps solid level geometry. */
function blockedAt(world: StaticWorld, pos: number[], r: number, h: number) {
  return world.overlapsAabb([pos[0] - r, pos[1] + 0.05, pos[2] - r], [pos[0] + r, pos[1] + h, pos[2] + r]);
}

describe("BUGS.md #15: nobody starts inside level geometry", () => {
  for (const def of LEVELS) {
    it(`level ${def.id}: player start is free`, () => {
      const st = new StaticWorld(def.boxes.filter((b) => b.collide).map((b) => ({ min: [...b.min], max: [...b.max] })));
      expect(blockedAt(st, def.player.pos, 0.3, 1.75)).toBe(false);
    });
    it(`level ${def.id}: every enemy spawns standing at its spawn height, free of geometry`, () => {
      // force every wave to fire at once so all spawns happen
      const all = { ...def, maxActive: 99, waves: def.waves.map((w) => ({ ...w, when: { type: "start" as const }, delay: 0 })) };
      const world = new World(all);
      world.player.invulnerable = true;
      for (let i = 0; i < 60; i++) world.step(1 / 120); // spawn-in takes 0.6 s; enemies don't move yet
      const spawns = all.waves.flatMap((w) => w.spawns);
      expect(world.enemies.length).toBe(spawns.length);
      const bad = world.enemies.flatMap((e, k) => {
        const s = spawns[k];
        const y = s.pos.length === 2 ? 0 : s.pos[1];
        return Math.abs(e.pos[1] - y) > 0.1 || blockedAt(world.static, e.pos, 0.3, 1.8) ? [`${e.kind} spawned at ${s.pos} ended at ${e.pos.map((v) => v.toFixed(2))}`] : [];
      });
      expect(bad).toEqual([]);
    });
  }
});
