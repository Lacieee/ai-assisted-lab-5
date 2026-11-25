// Deterministic scenarios that drive one implementation of the game (the original bundle or
// the refactored src/) and record everything observable as a list of hashed checkpoints.
// Both implementations get the same scripted input, so any difference in the recorded
// checkpoints means the refactor changed behaviour.
import { createHash } from "node:crypto";

export type Impl = Record<string, any>;

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

/** JSON that is stable for our objects: meshes become a short tag, typed arrays become plain arrays. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === "object" && "vertexBuffer" in v && "indexCount" in v) return `mesh:${v.indexCount}`;
    if (ArrayBuffer.isView(v)) return Array.from(v as Float32Array);
    if (typeof v === "number" && !Number.isFinite(v)) return String(v);
    return v;
  });
}

/** Seeded replacement for Math.random, so code that uses it (the sound synths) is repeatable. */
export function withSeededRandom<T>(seed: number, fn: () => T): T {
  const original = Math.random;
  let s = seed >>> 0;
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

/** Minimal stand-in for a GPUDevice: records the bytes of every buffer the mesh code uploads. */
export function recordingDevice() {
  const uploads: string[] = [];
  const device = {
    createBuffer(desc: { label: string; size: number; usage: number }) {
      const data = new ArrayBuffer(desc.size);
      return {
        getMappedRange: () => data,
        unmap: () => uploads.push(`${desc.label}|${desc.usage}|${hash(Buffer.from(data).toString("base64"))}`),
        destroy: () => {},
      };
    },
  };
  return { device, uploads };
}

/** Stand-in for the Renderer: records every draw call it receives. */
export function recordingRenderer() {
  const calls: string[] = [];
  return {
    calls,
    drawMesh: (...args: unknown[]) => calls.push("mesh " + stable(args)),
    drawSegment: (...args: unknown[]) => calls.push("seg " + stable(args)),
  };
}

/** Scripted player input for frame i. Moves, strafes, looks around, fires, throws, picks up, jumps. */
function scriptedInput(i: number) {
  const sx = Math.sin(i * 0.013);
  const pressed = new Set<string>();
  if (i % 41 === 0) pressed.add("fire");
  if (i % 173 === 0) pressed.add("throw");
  if (i % 67 === 0) pressed.add("interact");
  if (i % 151 === 0) pressed.add("jump");
  // stand still now and then so the time-scale driver goes through its whole range
  const idle = i % 300 > 240;
  return {
    mouseDx: idle ? 0 : 40 * Math.sin(i * 0.021),
    mouseDy: idle ? 0 : 10 * Math.sin(i * 0.017),
    moveAxes: () => (idle ? { x: 0, y: 0 } : { x: sx > 0.5 ? 1 : sx < -0.5 ? -1 : 0, y: Math.cos(i * 0.007) > -0.3 ? 1 : -1 }),
    wasPressed: (a: string) => pressed.has(a),
  };
}

function worldSnapshot(world: any) {
  return stable({
    player: world.player,
    enemies: world.enemies,
    props: world.props,
    projectiles: world.projectiles,
    events: world.events,
    stats: world.stats,
    simTime: world.simTime,
    cleared: world.cleared,
    failed: world.failed,
    remaining: world.remainingEnemies,
    aimProp: world.aimProp?.id ?? null,
    lasers: world.activeLasers(),
  });
}

/**
 * Plays one level the way Game.frame() does in the "playing" state, frame by frame at 60 fps,
 * restarting the level when the player dies or clears it. Also replays each finished attempt
 * and draws the viewmodel and enemy poses, so those modules are covered too.
 */
export function playLevel(M: Impl, levelIndex: number, frames: number): string[] {
  const def = M.LEVELS[levelIndex];
  const { device } = recordingDevice();
  const meshes = M.buildMeshLibrary(device);
  const { shared } = M.buildLevelMesh(device, def);
  const look = { sensitivity: 22e-4, invertY: false };
  const checkpoints: string[] = [];

  let world = new M.World(def, shared);
  const player = new M.PlayerController();
  const driver = new M.TimeScaleDriver();
  const recorder = new M.ReplayRecorder();
  const viewmodel = new M.Viewmodel();
  const pose = M.createPose();
  const time = new M.Time();
  player.reset(def.player.pos, def.player.yaw);
  let now = 1000;

  const finishAttempt = (why: string, i: number) => {
    const replay = new M.ReplayPlayer(def, recorder.frames, shared);
    let guard = 0;
    while (!replay.done && guard++ < 10000) replay.update(1 / 60);
    checkpoints.push(`${i} ${why} replay ${hash(worldSnapshot(replay.world))}`);
    world = new M.World(def, shared);
    player.reset(def.player.pos, def.player.yaw);
    driver.reset();
    recorder.reset();
    time.clearAccumulator();
  };

  for (let i = 0; i < frames; i++) {
    const input = scriptedInput(i);
    now += 1000 / 60;
    time.beginFrame(now);
    const dt = time.realDt;
    // --- Game.frame(), "playing" state
    player.update(input, dt, world, look, true);
    const f = player.toFrame(input.wasPressed("fire"), input.wasPressed("throw"), input.wasPressed("interact"));
    const acted = world.applyPlayerFrame(f);
    recorder.push(f);
    if (acted) driver.actionKick();
    const busy = world.player.burstLeft > 0;
    // Same argument order as src/app/game.ts (see BUGS.md #2) — the harness mirrors the game, bugs included.
    time.timeScale = driver.update(dt, M.WALK_SPEED, player.planarSpeed, player.lookSpeed, !player.grounded, busy);
    // --- Loop: fixed steps
    time.advanceSim();
    while (time.consumeStep()) world.step(M.FIXED_STEP);
    time.endSteps();
    // --- Game.render() parts that don't need a GPU
    recorder.setLastSteps(time.stepsThisFrame);
    const r = recordingRenderer();
    viewmodel.update(dt, player.mouseDx, player.mouseDy, player.planarSpeed, player.grounded);
    const eye = [player.pos[0], player.pos[1] + 1.6, player.pos[2]];
    viewmodel.draw(r, meshes, eye, player.yaw, player.pitch, world.player, player.stride, i % 2 === 0);
    for (const e of world.enemies) {
      M.computePose({ pos: e.pos, yaw: e.yaw, walkPhase: e.walkPhase, moveBlend: e.moveBlend, aimBlend: e.aimBlend, aimPitch: e.aimPitch, attackT: e.meleeT, stun: e.state === "stunned" ? 1 : 0, spawnT: e.spawnT, twoHanded: !!e.weapon && e.weapon.kind !== "pistol" && e.weapon.kind !== "blade", kind: e.kind }, pose);
      r.calls.push(stable(pose));
    }
    if (i % 10 === 0 || world.events.length > 0) {
      checkpoints.push(`${i} ts=${time.timeScale} steps=${time.stepsThisFrame} world=${hash(worldSnapshot(world))} draw=${hash(r.calls.join("\n"))}`);
    }
    world.events.length = 0;
    if (world.failed) finishAttempt("dead", i);
    else if (world.cleared) finishAttempt("cleared", i);
  }
  return checkpoints;
}

/** Level geometry, collision and nav data, plus the shared mesh library, as uploaded to the GPU. */
export function buildAllMeshes(M: Impl): string[] {
  const { device, uploads } = recordingDevice();
  M.buildMeshLibrary(device);
  const out: string[] = [];
  for (const def of M.LEVELS) {
    const { scene, shared } = M.buildLevelMesh(device, def);
    const path = shared.nav.findPath(def.player.pos, [def.player.pos[0] + 6, 0, def.player.pos[2] - 8]);
    out.push(`${def.id} min=${scene.min} max=${scene.max} boxes=${shared.static.boxes.length} path=${hash(stable(path))}`);
  }
  return [...uploads, ...out];
}

/** Particle system driven through every emitter and drawn each frame. */
export function runFx(M: Impl): string[] {
  const { device } = recordingDevice();
  const meshes = M.buildMeshLibrary(device);
  const { shared } = M.buildLevelMesh(device, M.LEVELS[0]);
  const fx = new M.FxSystem();
  const pose = M.createPose();
  M.computePose({ pos: [0, 0, -3], yaw: 0.4, walkPhase: 1, moveBlend: 0.5, aimBlend: 1, aimPitch: 0.1, attackT: 0, stun: 0, spawnT: 1, twoHanded: true, kind: "walker" }, pose);
  const out: string[] = [];
  for (let i = 0; i < 400; i++) {
    if (i % 50 === 0) {
      fx.muzzleFlash([0, 1.5, 0], [0, 0, -1], i % 100 === 0);
      fx.sparks([1, 1, -2], [0, 1, 0], 8);
      fx.dust([1, 0, -2], [0, 1, 0], 3);
      fx.glints([0, 1.3, -3], 10, [0.9, 0.6, 1], 2);
      fx.spawnShimmer([2, 0, -4], [0.8, 0.4, 1]);
      fx.smallShatter([0, 1, -1], [0.9, 0.95, 1], meshes.shards.length);
    }
    if (i === 20) fx.shatter(pose, [0, 0, -1], [0, 1.2, -3], [0.8, 0.32, 1], meshes.shards.length);
    fx.update(i % 3 === 0 ? 1 / 60 : 1 / 240, shared.static);
    const r = recordingRenderer();
    fx.draw(r, meshes);
    out.push(`${i} ${hash(r.calls.join("\n"))}`);
  }
  return out;
}

/** Every procedural sound effect, with Math.random seeded. */
export function runSynths(M: Impl): string[] {
  return Object.keys(M.SYNTHS).map((name) =>
    withSeededRandom(1234, () => `${name} ${hash(Buffer.from(M.SYNTHS[name](8000).buffer).toString("base64"))}`),
  );
}

/** The level definitions themselves (geometry boxes, spawns, waves). */
export function levelData(M: Impl): string[] {
  return M.LEVELS.map((d: unknown) => hash(stable(d)));
}
