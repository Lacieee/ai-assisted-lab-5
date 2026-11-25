// Moves bullets one fixed step and resolves what they hit: level geometry, enemies (head or
// body), the player, props, or another bullet (bullets that meet cancel out).
import { copy, distSq, normalize, v3 } from "../engine/vec3";
import { BODY_A, BODY_B, BODY_RADIUS, HEAD_OFFSET, HEAD_RADIUS } from "./enemy";
import { BULLET_LIFE, BULLET_RADIUS, BULLET_SPEED, FRAGILE, ITEM_RADIUS } from "./items";
import { segmentCapsule, segmentSphere } from "../physics/static-world";
import type { World } from "./world";

// Player hit capsule, measured up from the feet.
const PLAYER_BODY_A = 0.3;
const PLAYER_BODY_B = 1.5;
const PLAYER_BODY_R = 0.26;

export function stepProjectiles(world: World, dt: number) {
  const bullets = world.projectiles;
  const playerHead = v3();
  const pa = v3();
  const pb = v3();
  const dirN = v3();
  for (const b of bullets) {
    if (!b.alive)
      continue;
    copy(b.prevPos, b.pos);
    b.age += dt;
    if (b.age > BULLET_LIFE) {
      b.alive = false;
      continue;
    }
    const next = [b.pos[0] + b.vel[0] * dt, b.pos[1] + b.vel[1] * dt, b.pos[2] + b.vel[2] * dt];
    const segLen = BULLET_SPEED * dt;
    normalize(dirN, b.vel);
    let bestT = 1;
    let hitKind = "none";
    let hitEnemy = null;
    let hitProp = null;
    let hitNormal = [0, 1, 0];
    const sh = world.static.raycast(b.pos, dirN, segLen);
    if (sh) {
      bestT = sh.t / segLen;
      hitKind = "static";
      hitNormal = sh.normal;
    }
    for (const e of world.enemies) {
      if (!e.alive || e.spawnT < 1)
        continue;
      if (e.id === b.ownerId && b.age < 0.25)
        continue;
      if (Math.abs(e.pos[0] - b.pos[0]) > 3 || Math.abs(e.pos[2] - b.pos[2]) > 3)
        continue;
      const head = [e.pos[0], e.pos[1] + HEAD_OFFSET, e.pos[2]];
      const th = segmentSphere(b.pos, next, head, HEAD_RADIUS + BULLET_RADIUS);
      if (th >= 0 && th < bestT) {
        bestT = th;
        hitKind = "head";
        hitEnemy = e;
      }
      pa[0] = e.pos[0];
      pa[1] = e.pos[1] + BODY_A;
      pa[2] = e.pos[2];
      pb[0] = e.pos[0];
      pb[1] = e.pos[1] + BODY_B;
      pb[2] = e.pos[2];
      const tb = segmentCapsule(b.pos, next, pa, pb, BODY_RADIUS + BULLET_RADIUS);
      if (tb >= 0 && tb < bestT) {
        bestT = tb;
        hitKind = "enemy";
        hitEnemy = e;
      }
    }
    const p = world.player;
    if (b.ownerId !== 0 && p.alive) {
      pa[0] = p.pos[0];
      pa[1] = p.pos[1] + PLAYER_BODY_A;
      pa[2] = p.pos[2];
      pb[0] = p.pos[0];
      pb[1] = p.pos[1] + PLAYER_BODY_B;
      pb[2] = p.pos[2];
      const tp = segmentCapsule(b.pos, next, pa, pb, PLAYER_BODY_R + BULLET_RADIUS);
      world.playerEye(playerHead);
      const thd = segmentSphere(b.pos, next, playerHead, 0.16);
      const t = tp >= 0 && thd >= 0 ? Math.min(tp, thd) : Math.max(tp, thd);
      if (t >= 0 && t < bestT) {
        bestT = t;
        hitKind = "player";
      }
    }
    for (const pr of world.props) {
      if (!pr.alive)
        continue;
      if (Math.abs(pr.pos[0] - b.pos[0]) > 1.5 || Math.abs(pr.pos[2] - b.pos[2]) > 1.5)
        continue;
      const t = segmentSphere(b.pos, next, pr.pos, ITEM_RADIUS[pr.item.kind] + BULLET_RADIUS);
      if (t >= 0 && t < bestT) {
        bestT = t;
        hitKind = "prop";
        hitProp = pr;
      }
    }
    const hitPoint = [b.pos[0] + (next[0] - b.pos[0]) * bestT, b.pos[1] + (next[1] - b.pos[1]) * bestT, b.pos[2] + (next[2] - b.pos[2]) * bestT];
    switch (hitKind) {
      case "none":
        copy(b.pos, next);
        break;
      case "static":
        b.alive = false;
        copy(b.pos, hitPoint);
        world.events.push({ type: "impact", pos: hitPoint, normal: hitNormal });
        break;
      case "head":
      case "enemy":
        b.alive = false;
        copy(b.pos, hitPoint);
        if (hitEnemy)
          world.killEnemy(hitEnemy, [dirN[0], dirN[1], dirN[2]], hitPoint, false);
        break;
      case "player":
        b.alive = false;
        copy(b.pos, hitPoint);
        world.killPlayer([dirN[0], dirN[1], dirN[2]]);
        break;
      case "prop":
        b.alive = false;
        copy(b.pos, hitPoint);
        if (hitProp) {
          world.wake(hitProp);
          hitProp.vel[0] += dirN[0] * 3;
          hitProp.vel[1] += 1.5;
          hitProp.vel[2] += dirN[2] * 3;
          hitProp.angVel[0] += world.rng.sym(10);
          hitProp.angVel[2] += world.rng.sym(10);
          if (FRAGILE[hitProp.item.kind])
            world.breakProp(hitProp);
        }
        world.events.push({ type: "impact", pos: hitPoint, normal: [-dirN[0], -dirN[1], -dirN[2]] });
        break;
    }
  }
  const n = bullets.length;
  for (let i = 0; i < n; i++) {
    const a = bullets[i];
    if (!a.alive)
      continue;
    for (let j = i + 1; j < n; j++) {
      const c = bullets[j];
      if (!c.alive || c.shotId === a.shotId)
        continue;
      if (distSq(a.pos, c.pos) < 0.16 * 0.16 || segmentSphere(a.prevPos, a.pos, c.pos, 0.12) >= 0) {
        a.alive = false;
        c.alive = false;
        world.events.push({ type: "bulletClash", pos: [(a.pos[0] + c.pos[0]) / 2, (a.pos[1] + c.pos[1]) / 2, (a.pos[2] + c.pos[2]) / 2] });
        break;
      }
    }
  }
}
