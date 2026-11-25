// A scripted player for headless playtesting. It plays through the same code path as a human:
// runPlayerFrame with mouse deltas and key presses, one 60 fps frame at a time, and the fixed-step
// clock decides how much simulation runs. It only acts on what a player could see on screen.
import { LEVELS } from "../../src/levels/index";
import { World } from "../../src/gameplay/world";
import { PlayerController, WALK_SPEED } from "../../src/gameplay/player-controller";
import { TimeScaleDriver } from "../../src/gameplay/time-scale-driver";
import { ReplayRecorder } from "../../src/gameplay/replay";
import { runPlayerFrame, type PlayerInput } from "../../src/gameplay/player-frame";
import { Time, FIXED_STEP } from "../../src/engine/time";
import { isGun } from "../../src/gameplay/items";
import { EYE_HEIGHT } from "../../src/gameplay/world";

const SENS = 22e-4; // default mouse sensitivity, radians per pixel
const MAX_PX_PER_FRAME = 60; // ≈ 8 rad/s: a fast but human flick
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export interface Attempt {
  result: "cleared" | "dead" | "timeout";
  realSeconds: number;
  simSeconds: number;
  kills: number;
  shots: number;
  death?: string;
}

/** Plays one attempt at level `index`. */
export function playAttempt(index: number, maxRealSeconds = 90, seed = 1): Attempt {
  const def = LEVELS[index];
  const world = new World(def);
  const player = new PlayerController();
  const driver = new TimeScaleDriver();
  const recorder = new ReplayRecorder();
  const time = new Time();
  player.reset(def.player.pos, def.player.yaw);
  const ctx = { player, world, driver, recorder };
  const look = { sensitivity: SENS, invertY: false };
  let now = 0;
  let strafeDir = seed % 2 ? 1 : -1;
  let strafeTimer = (seed * 0.37) % 0.8; // seeds vary the strafe rhythm
  let lastKill = "";

  for (let frame = 0; frame < maxRealSeconds * 60; frame++) {
    const eye = [player.pos[0], player.pos[1] + EYE_HEIGHT, player.pos[2]];
    const held = world.player.held;
    const visible = world.enemies.filter((e) => e.alive && e.spawnT >= 1 && world.static.lineClear(eye, [e.pos[0], e.pos[1] + 1.3, e.pos[2]]));
    const all = world.enemies.filter((e) => e.alive);
    const dist = (p: number[]) => Math.hypot(p[0] - player.pos[0], p[2] - player.pos[2]);
    const nearest = (list: typeof all) => list.slice().sort((a, b) => dist(a.pos) - dist(b.pos))[0];
    // a melee enemy closing in is the most urgent threat, then the nearest visible one
    const rushing = visible.filter((e) => !e.weapon && dist(e.pos) < 6);
    const target = nearest(rushing) ?? nearest(visible) ?? nearest(all);

    // ---- decide where to look and what to press
    let lookAt: number[] | null = null;
    let fire = false, interact = false, jump = false;
    let moveX = 0, moveY = 0; // strafe right, forward

    const hasGun = held && isGun(held.kind) && held.ammo > 0;
    const throwable = held && !isGun(held.kind) && held.kind !== "blade";
    const wantPickup = !held || (isGun(held.kind) && held.ammo === 0);

    // pick-up target: guns first, then anything, only if reasonably close
    const pickups = world.props.filter((p) => p.alive && !p.thrown && Math.hypot(...p.vel) < 1 && dist(p.pos) < 14 && Math.abs(p.pos[1] - player.pos[1]) < 1.5);
    const gunProp = pickups.filter((p) => isGun(p.item.kind) && p.item.ammo > 0).sort((a, b) => dist(a.pos) - dist(b.pos))[0];
    const anyProp = pickups.sort((a, b) => dist(a.pos) - dist(b.pos))[0];
    const enemyNear = target ? dist(target.pos) : Infinity;
    const goFor = wantPickup ? (gunProp ?? (enemyNear > 3 ? anyProp : undefined)) : undefined;

    if (goFor) {
      lookAt = goFor.pos;
      moveY = dist(goFor.pos) > 0.9 ? 1 : 0;
      if (world.aimProp === goFor || dist(goFor.pos) < 1.3) interact = frame % 2 === 0;
    } else if (target) {
      const d = dist(target.pos);
      const chest = [target.pos[0], target.pos[1] + 1.25, target.pos[2]];
      if (hasGun) {
        // small lead for a moving target
        const tLead = d / 25;
        lookAt = [chest[0] + target.vel[0] * tLead, chest[1], chest[2] + target.vel[2] * tLead];
      } else if (throwable) {
        lookAt = throwAim(eye, [target.pos[0], target.pos[1] + 1.7, target.pos[2]]);
      } else {
        lookAt = chest; // fists
      }
      const yawTo = Math.atan2(-(lookAt[0] - eye[0]), -(lookAt[2] - eye[2]));
      const yawErr = Math.abs(wrap(yawTo - player.yaw));
      const canSee = visible.includes(target);
      if (canSee && hasGun && yawErr < 0.03) fire = true;
      if (canSee && throwable && d < 9 && yawErr < 0.03) fire = true;
      if (!held && d < 1.6 && yawErr < 0.3) fire = true;
      // movement: keep time flowing by strafing; keep distance from melee enemies unless punching
      strafeTimer -= 1 / 60;
      if (strafeTimer <= 0) { strafeDir = -strafeDir; strafeTimer = 0.5 + ((seed * 7 + frame) % 5) * 0.1; }
      // aim in (nearly) frozen time: stand still while lining up a shot at a visible target
      const lining = canSee && (hasGun || throwable) && yawErr > 0.03 && yawErr < 0.6;
      moveX = lining ? 0 : strafeDir;
      const melee = !target.weapon;
      if (held && melee && d < 4) moveY = -1;
      else if (!held && d > 1.2) moveY = 1; // close in to punch
      else if (hasGun && d > 12) moveY = 1;
      else if (!canSee) moveY = 1;
    } else if (def.exit) {
      const [x0, z0, x1, z1] = def.exit.rect;
      lookAt = [(x0 + x1) / 2, eye[1], (z0 + z1) / 2];
      moveY = 1;
    } else {
      moveX = strafeDir; // nothing to do: keep time moving so the next wave arrives
      strafeTimer -= 1 / 60;
      if (strafeTimer <= 0) { strafeDir = -strafeDir; strafeTimer = 0.8; }
    }

    // ---- dodge: an enemy bullet whose path passes within 0.8 m of the chest gets a sidestep,
    // perpendicular to its flight, toward the side the player already leans to
    const chestP = [player.pos[0], player.pos[1] + 1.2, player.pos[2]];
    for (const b of world.projectiles) {
      if (!b.alive || b.ownerId === 0) continue;
      const v = b.vel, vl = Math.hypot(v[0], v[1], v[2]);
      const rel = [chestP[0] - b.pos[0], chestP[1] - b.pos[1], chestP[2] - b.pos[2]];
      const t = (rel[0] * v[0] + rel[1] * v[1] + rel[2] * v[2]) / (vl * vl);
      if (t < 0 || t > 1.2) continue; // already past, or far away in (simulation) time
      const miss = [rel[0] - v[0] * t, rel[2] - v[2] * t];
      if (Math.hypot(miss[0], miss[1]) > 0.8) continue;
      // world-space sidestep direction: perpendicular to the bullet, away from its line
      let sx = -v[2], sz = v[0];
      if (sx * miss[0] + sz * miss[1] < 0) { sx = -sx; sz = -sz; }
      // convert to the player's strafe axis (right = (cos yaw, -sin yaw))
      const right = Math.cos(player.yaw) * sx - Math.sin(player.yaw) * sz;
      const fwd = -Math.sin(player.yaw) * sx - Math.cos(player.yaw) * sz;
      const n = Math.hypot(right, fwd) || 1;
      moveX = right / n;
      moveY = fwd / n;
      break;
    }

    // ---- turn the view toward lookAt with a human turn rate
    let mouseDx = 0, mouseDy = 0;
    if (lookAt) {
      const yaw = Math.atan2(-(lookAt[0] - eye[0]), -(lookAt[2] - eye[2]));
      const pitch = Math.atan2(lookAt[1] - eye[1], Math.hypot(lookAt[0] - eye[0], lookAt[2] - eye[2]));
      const clampPx = (v: number) => Math.max(-MAX_PX_PER_FRAME, Math.min(MAX_PX_PER_FRAME, v));
      mouseDx = clampPx(-wrap(yaw - player.yaw) / SENS); // mouse right = turn right = yaw decreases
      mouseDy = clampPx(-(pitch - player.pitch) / SENS);
    }
    // bump into a step or obstacle? hop
    if (moveY > 0 && player.planarSpeed < 0.5 && frame % 30 === 0) jump = true;

    const pressed = new Set<string>();
    if (fire) pressed.add("fire");
    if (interact) pressed.add("interact");
    if (jump) pressed.add("jump");
    const input: PlayerInput = { mouseDx, mouseDy, moveAxes: () => ({ x: moveX, y: moveY }), wasPressed: (a) => pressed.has(a) };

    // ---- one frame, exactly like Loop.tick + Game.frame
    now += 1000 / 60;
    time.beginFrame(now);
    time.timeScale = runPlayerFrame(ctx, input, time.realDt, look);
    const before = world.projectiles.filter((q) => q.ownerId !== 0).map((q) => ({ spawn: [...q.spawnPos], pos: [...q.pos], owner: q.ownerId, ownerAt: world.enemies.find((e) => e.id === q.ownerId)?.pos.map((v) => +v.toFixed(1)) }));
    time.advanceSim();
    while (time.consumeStep()) world.step(FIXED_STEP);
    time.endSteps();
    recorder.setLastSteps(time.stepsThisFrame);
    for (const ev of world.events) {
      if (ev.type === "playerDeath") {
        lastKill = describeDeath(world, player, ev.dir);
        // the bullet that did it: dead, enemy-owned, ended at the player
        const b = before.sort((p, q) => Math.hypot(p.pos[0] - player.pos[0], p.pos[2] - player.pos[2]) - Math.hypot(q.pos[0] - player.pos[0], q.pos[2] - player.pos[2]))[0];
        if (b) lastKill += ` | bullet spawned [${b.spawn.map((v) => v.toFixed(2))}] by enemy@[${b.ownerAt}] clear=${world.static.lineClear(b.spawn, [player.pos[0], player.pos[1] + 1.2, player.pos[2]])}; player@[${player.pos.map((v) => v.toFixed(2))}]`;
      }
    }
    world.events.length = 0;

    const base = { realSeconds: +(frame / 60).toFixed(2), simSeconds: +world.simTime.toFixed(2), kills: world.stats.kills, shots: world.stats.shots };
    if (world.failed) return { result: "dead", ...base, death: lastKill };
    if (world.cleared) return { result: "cleared", ...base };
  }
  return { result: "timeout", realSeconds: maxRealSeconds, simSeconds: +world.simTime.toFixed(2), kills: world.stats.kills, shots: world.stats.shots };
}

/** Pitch-correct aim point for a thrown item (speed 15 m/s + 1.2 m/s lift, gravity 16), as a point to look at. */
function throwAim(eye: number[], target: number[]): number[] {
  const dx = target[0] - eye[0], dz = target[2] - eye[2], d = Math.hypot(dx, dz);
  let best = 0, bestErr = Infinity;
  for (let p = -0.6; p < 1; p += 0.002) {
    const vh = 15 * Math.cos(p), t = (d - 0.45 * Math.cos(p)) / vh;
    const y = eye[1] + Math.sin(p) * 0.45 - 0.08 + (15 * Math.sin(p) + 1.2) * t - 8 * t * t;
    if (Math.abs(y - target[1]) < bestErr) { bestErr = Math.abs(y - target[1]); best = p; }
  }
  return [target[0], eye[1] + Math.tan(best) * d, target[2]];
}

function describeDeath(world: World, player: PlayerController, dir: number[]) {
  const f = (v: number) => v.toFixed(1);
  const enemies = world.enemies.filter((e) => e.alive).map((e) => {
    const d = Math.hypot(e.pos[0] - player.pos[0], e.pos[2] - player.pos[2]);
    return `${e.kind}(${e.weapon?.kind ?? "unarmed"}, ${e.state}, ${f(d)}m, melee=${f(e.meleeT)})`;
  });
  const fromAbove = dir[1] < -0.9 ? " (fell)" : "";
  return `t=${f(world.simTime)}s dir=[${dir.map(f)}]${fromAbove} enemies: ${enemies.join("; ")}`;
}

export { WALK_SPEED };
