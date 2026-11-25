// Physics for items lying around or flying through the air: gravity, bouncing off level
// geometry, thrown items hitting enemies, fragile items breaking, and settling to rest.
import { copy, len, normalize, v3 } from "../engine/vec3";
import { BODY_A, BODY_B, BODY_RADIUS, HEAD_OFFSET, HEAD_RADIUS } from "./enemy";
import { FRAGILE, ITEM_RADIUS, isWeapon } from "./items";
import { segmentCapsule, segmentSphere } from "../physics/static-world";
import type { World } from "./world";

const PROP_PHYS_RADIUS = 0.05;
const GRAVITY = 16;
/** Orientation an item settles into: [rotation about x, rotation about z]. */
export const REST_ROT = {
  pistol: [0, Math.PI / 2],
  scatter: [0, Math.PI / 2],
  carbine: [0, Math.PI / 2],
  blade: [0, Math.PI / 2],
  bottle: [Math.PI / 2, 0],
  brick: [0, 0],
  mug: [0, 0]
};

export function stepProps(world: World, dt: number) {
  for (const pr of world.props) {
    if (!pr.alive || pr.sleeping)
      continue;
    const prev = [pr.pos[0], pr.pos[1], pr.pos[2]];
    pr.vel[1] -= GRAVITY * dt;
    const drag = 1 - 0.05 * dt;
    pr.vel[0] *= drag;
    pr.vel[2] *= drag;
    pr.pos[0] += pr.vel[0] * dt;
    pr.pos[1] += pr.vel[1] * dt;
    pr.pos[2] += pr.vel[2] * dt;
    pr.rot[0] += pr.angVel[0] * dt;
    pr.rot[1] += pr.angVel[1] * dt;
    pr.rot[2] += pr.angVel[2] * dt;
    if (pr.thrown) {
      const hitR = ITEM_RADIUS[pr.item.kind];
      for (const e of world.enemies) {
        if (!e.alive || e.spawnT < 1)
          continue;
        const head = [e.pos[0], e.pos[1] + HEAD_OFFSET, e.pos[2]];
        const th = segmentSphere(prev, pr.pos, head, HEAD_RADIUS + hitR);
        const tb = segmentCapsule(prev, pr.pos, [e.pos[0], e.pos[1] + BODY_A, e.pos[2]], [e.pos[0], e.pos[1] + BODY_B, e.pos[2]], BODY_RADIUS + hitR);
        if (th < 0 && tb < 0)
          continue;
        const dir = normalize(v3(), pr.vel);
        const heavy = pr.item.kind === "brick" || isWeapon(pr.item.kind);
        if (th >= 0) {
          world.killEnemy(e, dir, head, false);
        } else {
          world.disarm(e, dir);
          world.stun(e, heavy ? 1.6 : 1.3, dir, 3);
          e.hitFlash = 1;
        }
        pr.vel[0] *= -0.25;
        pr.vel[1] = Math.abs(pr.vel[1]) * 0.3 + 1;
        pr.vel[2] *= -0.25;
        pr.thrown = false;
        if (FRAGILE[pr.item.kind])
          world.breakProp(pr);
        break;
      }
      if (!pr.alive)
        continue;
    }
    const res = world.static.resolveSphere(pr.pos, pr.vel, PROP_PHYS_RADIUS, 0.3, 0.12);
    if (res.impact > 0.5) {
      pr.angVel[0] *= 0.6;
      pr.angVel[1] *= 0.6;
      pr.angVel[2] *= 0.6;
      if (res.impact > 2)
        world.events.push({ type: "propImpact", pos: [pr.pos[0], pr.pos[1], pr.pos[2]], speed: res.impact });
      if (pr.thrown && FRAGILE[pr.item.kind] && res.impact > 4) {
        world.breakProp(pr);
        continue;
      }
      if (pr.thrown && res.impact > 3)
        pr.thrown = false;
    }
    const speed = len(pr.vel);
    if (pr.thrown && speed < 4)
      pr.thrown = false;
    if (res.grounded && speed < 0.35) {
      pr.restTimer += dt;
      pr.angVel[0] *= 0.8;
      pr.angVel[1] *= 0.8;
      pr.angVel[2] *= 0.8;
      if (pr.restTimer > 0.35) {
        pr.sleeping = true;
        pr.vel[0] = pr.vel[1] = pr.vel[2] = 0;
        const rest = REST_ROT[pr.item.kind];
        pr.rot[0] = rest[0];
        pr.rot[2] = rest[1];
        copy(pr.prevRot, pr.rot);
      }
    } else {
      pr.restTimer = 0;
    }
    if (pr.pos[1] < -10)
      pr.alive = false;
  }
}
