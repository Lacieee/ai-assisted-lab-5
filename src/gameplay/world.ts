import { Rng } from "../engine/rng";
import { clamp, copy, dirFromYawPitch, distSq, distXZ, dot, len, normalize, v3 } from "../engine/vec3";
import { enemyMuzzle, savePrev, updateEnemy } from "./enemy";
import { BULLET_SPEED, WEAPONS, isGun, isWeapon, newItem } from "./items";
import { WaveDirector } from "./waves";
import { stepProjectiles } from "./projectiles";
import { REST_ROT, stepProps } from "./props";
import { NavGrid } from "../physics/nav-grid";
import { StaticWorld } from "../physics/static-world";
import type { LevelDef } from "../levels/types";
import type { Enemy, Item, PlayerFrame, PlayerState, Projectile, Prop, Vec3, WorldEvent } from "./types";

export const EYE_HEIGHT = 1.6;
export const PLAYER_RADIUS = 0.3;
export const PLAYER_HEIGHT = 1.75;
export const REACH = 2.6;
const THROW_SPEED = 15;
const PUNCH_COOLDOWN = 0.32;
const PUNCH_RANGE = 1.7;
const SLASH_RANGE = 2.2;
const SHOT_HEARING = 16;
export class World {
  def: LevelDef;
  static: StaticWorld;
  nav: NavGrid;
  rng: Rng;
  events: WorldEvent[] = [];
  enemies: Enemy[] = [];
  props: Prop[] = [];
  projectiles: Projectile[] = [];
  player: PlayerState;
  stats = { kills: 0, shots: 0 };
  simTime = 0;
  cleared = false;
  failed = false;
  aimProp: Prop | null = null;
  nextId = 1;
  shotCounter = 0;
  waves = new WaveDirector();
  recentShots = [];
  constructor(def: LevelDef, sharedStatic?: { static: StaticWorld; nav: NavGrid }) {
    this.def = def;
    this.rng = new Rng(def.seed);
    if (sharedStatic) {
      this.static = sharedStatic.static;
      this.nav = sharedStatic.nav;
    } else {
      const boxes = def.boxes.filter((b) => b.collide).map((b) => ({ min: [...b.min], max: [...b.max] }));
      this.static = new StaticWorld(boxes);
      this.nav = new NavGrid(this.static);
    }
    const p = def.player;
    this.player = {
      pos: [p.pos[0], p.pos[1], p.pos[2]],
      vel: v3(),
      yaw: p.yaw,
      pitch: 0,
      grounded: true,
      alive: true,
      invulnerable: false,
      held: p.item ? newItem(p.item) : null,
      fireCooldown: 0,
      burstLeft: 0,
      burstTimer: 0,
      punchCooldown: 0,
      punchSide: 1,
      punchAge: 99,
      recoilAge: 99,
      throwAge: 99,
      slashAge: 99,
      pickupAge: 99
    };
    for (const ps of def.props)
      this.addProp(newItem(ps.kind), ps.pos, [0, 0, 0], false);
    this.waves.update(this, 0);
    this.waves.flush(this, true);
  }
  get staticData() {
    return { static: this.static, nav: this.nav };
  }
  playerEye(out) {
    out[0] = this.player.pos[0];
    out[1] = this.player.pos[1] + EYE_HEIGHT;
    out[2] = this.player.pos[2];
    return out;
  }
  newShotId() {
    return ++this.shotCounter;
  }
  get aliveEnemies() {
    return this.enemies.length;
  }
  get remainingEnemies() {
    return this.enemies.length + this.waves.pendingCount(this);
  }
  applyPlayerFrame(f: PlayerFrame): boolean {
    const p = this.player;
    copy(p.pos, f.pos);
    copy(p.vel, f.vel);
    p.yaw = f.yaw;
    p.pitch = f.pitch;
    p.grounded = f.grounded;
    if (!p.alive)
      return false;
    this.aimProp = this.findAimProp();
    let acted = false;
    if (f.interact) {
      const target = this.aimProp ?? this.nearestPropInRadius(1.4);
      if (target) {
        if (p.held)
          this.throwHeld(0.35);
        this.pickUp(target);
        acted = true;
      }
    }
    if (f.throwItem && p.held) {
      this.throwHeld(1);
      acted = true;
    }
    if (f.fire) {
      acted = this.primaryAction() || acted;
    }
    if (p.pos[1] < -6)
      this.killPlayer([0, -1, 0]);
    return acted;
  }
  primaryAction() {
    const p = this.player;
    const held = p.held;
    if (held) {
      if (isGun(held.kind)) {
        if (p.fireCooldown > 0 || p.burstLeft > 0)
          return false;
        if (held.ammo <= 0) {
          this.events.push({ type: "dryFire" });
          this.throwHeld(1);
          return true;
        }
        const def = WEAPONS[held.kind];
        held.ammo--;
        p.fireCooldown = def.cooldown;
        p.burstLeft = def.burst - 1;
        p.burstTimer = def.burstInterval;
        this.playerVolley(held.kind);
        return true;
      }
      if (held.kind === "blade") {
        if (p.fireCooldown > 0)
          return false;
        p.fireCooldown = WEAPONS.blade.cooldown;
        this.slash();
        return true;
      }
      this.throwHeld(1);
      return true;
    }
    if (this.aimProp && distSq(this.aimProp.pos, this.playerEye(v3())) < 2.2 * 2.2) {
      this.pickUp(this.aimProp);
      return true;
    }
    if (p.punchCooldown <= 0) {
      this.punch();
      return true;
    }
    return false;
  }
  forward(out) {
    return dirFromYawPitch(out, this.player.yaw, this.player.pitch);
  }
  playerVolley(kind) {
    const p = this.player;
    const def = WEAPONS[kind];
    const eye = this.playerEye(v3());
    const fwd = this.forward(v3());
    const right = [Math.cos(p.yaw), 0, -Math.sin(p.yaw)];
    const hit = this.static.raycast(eye, fwd, 80);
    const target = hit ? hit.point : [eye[0] + fwd[0] * 80, eye[1] + fwd[1] * 80, eye[2] + fwd[2] * 80];
    let muzzle = [
      eye[0] + fwd[0] * 0.45 + right[0] * 0.14,
      eye[1] + fwd[1] * 0.45 - 0.1,
      eye[2] + fwd[2] * 0.45 + right[2] * 0.14
    ];
    if (!this.static.lineClear(eye, muzzle))
      muzzle = [eye[0], eye[1], eye[2]];
    const dir = [target[0] - muzzle[0], target[1] - muzzle[1], target[2] - muzzle[2]];
    if (len(dir) < 1.5)
      copy(dir, fwd);
    normalize(dir, dir);
    const shotId = this.newShotId();
    for (let i = 0; i < Math.max(1, def.pellets); i++) {
      const d = [dir[0], dir[1], dir[2]];
      if (def.pellets > 1 || def.spread > 0)
        this.perturbDirection(d, def.spread);
      this.spawnProjectile(muzzle, d, 0, shotId);
    }
    this.stats.shots++;
    p.recoilAge = 0;
    this.recentShots.push({ pos: [eye[0], eye[1], eye[2]], time: this.simTime });
    this.events.push({ type: "shot", pos: muzzle, dir, weapon: kind, byPlayer: true });
  }
  punch() {
    const p = this.player;
    p.punchCooldown = PUNCH_COOLDOWN;
    p.punchAge = 0;
    p.punchSide = -p.punchSide;
    const target = this.meleeTarget(PUNCH_RANGE, 0.65);
    const fwd = this.forward(v3());
    if (!target) {
      this.events.push({ type: "punch", hit: false, pos: this.playerEye(v3()) });
      return;
    }
    target.hp--;
    target.hitFlash = 1;
    const hitPos = [target.pos[0], target.pos[1] + 1.3, target.pos[2]];
    this.events.push({ type: "punch", hit: true, pos: hitPos });
    if (target.hp <= 0) {
      this.killEnemy(target, fwd, hitPos, false);
    } else {
      this.disarm(target, fwd);
      this.stun(target, 0.9, fwd, 2.5);
    }
  }
  slash() {
    const p = this.player;
    p.slashAge = 0;
    const eye = this.playerEye(v3());
    const fwd = this.forward(v3());
    let hit = false;
    for (const e of this.enemies) {
      if (!e.alive || e.spawnT < 1)
        continue;
      const to = [e.pos[0] - eye[0], e.pos[1] + 1.1 - eye[1], e.pos[2] - eye[2]];
      const d = len(to);
      if (d > SLASH_RANGE)
        continue;
      normalize(to, to);
      if (dot(to, fwd) < 0.45)
        continue;
      if (!this.static.lineClear(eye, [e.pos[0], e.pos[1] + 1.1, e.pos[2]]))
        continue;
      this.killEnemy(e, fwd, [e.pos[0], e.pos[1] + 1.2, e.pos[2]], false);
      hit = true;
    }
    for (const b of this.projectiles) {
      if (!b.alive || b.ownerId === 0)
        continue;
      const to = [b.pos[0] - eye[0], b.pos[1] - eye[1], b.pos[2] - eye[2]];
      const d = len(to);
      if (d > 2)
        continue;
      normalize(to, to);
      if (dot(to, fwd) < 0.25)
        continue;
      b.alive = false;
      this.events.push({ type: "slice", pos: [b.pos[0], b.pos[1], b.pos[2]], dir: [b.vel[0], b.vel[1], b.vel[2]] });
      hit = true;
    }
    this.events.push({ type: "slash", hit });
  }
  meleeTarget(range, minDot) {
    const eye = this.playerEye(v3());
    const fwd = this.forward(v3());
    let best = null;
    let bestD = Infinity;
    for (const e of this.enemies) {
      if (!e.alive || e.spawnT < 1)
        continue;
      const chest = [e.pos[0], e.pos[1] + 1.25, e.pos[2]];
      const to = [chest[0] - eye[0], chest[1] - eye[1], chest[2] - eye[2]];
      const d = len(to);
      if (d > range + 0.3)
        continue;
      normalize(to, to);
      if (dot(to, fwd) < minDot)
        continue;
      if (d < bestD && this.static.lineClear(eye, chest)) {
        best = e;
        bestD = d;
      }
    }
    return best;
  }
  throwHeld(strength) {
    const p = this.player;
    const item = p.held;
    if (!item)
      return;
    p.held = null;
    p.burstLeft = 0;
    p.throwAge = 0;
    const eye = this.playerEye(v3());
    const fwd = this.forward(v3());
    const right = [Math.cos(p.yaw), 0, -Math.sin(p.yaw)];
    let start = [eye[0] + fwd[0] * 0.45 + right[0] * 0.12, eye[1] + fwd[1] * 0.45 - 0.08, eye[2] + fwd[2] * 0.45 + right[2] * 0.12];
    if (!this.static.lineClear(eye, start))
      start = [eye[0], eye[1] - 0.05, eye[2]];
    const s = THROW_SPEED * strength;
    const vel = [fwd[0] * s + p.vel[0], fwd[1] * s + 1.2 * strength + p.vel[1] * 0.5, fwd[2] * s + p.vel[2]];
    const prop = this.addProp(item, start, vel, strength > 0.5);
    prop.rot = [0, p.yaw, 0];
    prop.angVel = [this.rng.sym(12) - 8 * strength, this.rng.sym(4), this.rng.sym(6)];
    this.events.push({ type: "throw" });
  }
  pickUp(prop) {
    const p = this.player;
    prop.alive = false;
    p.held = prop.item;
    p.fireCooldown = Math.max(p.fireCooldown, 0.12);
    p.pickupAge = 0;
    this.events.push({ type: "pickup", kind: prop.item.kind });
  }
  findAimProp() {
    const eye = this.playerEye(v3());
    const fwd = this.forward(v3());
    let best = null;
    let bestScore = Infinity;
    for (const pr of this.props) {
      if (!pr.alive || pr.thrown)
        continue;
      const to = [pr.pos[0] - eye[0], pr.pos[1] - eye[1], pr.pos[2] - eye[2]];
      const along = dot(to, fwd);
      if (along < 0.1 || along > REACH)
        continue;
      const perp = Math.sqrt(Math.max(0, distSq(to, [0, 0, 0]) - along * along));
      const tol = 0.3 + along * 0.06;
      if (perp > tol)
        continue;
      const score = perp / tol + along * 0.1;
      if (score < bestScore && this.static.lineClear(eye, pr.pos)) {
        best = pr;
        bestScore = score;
      }
    }
    return best;
  }
  nearestPropInRadius(r) {
    let best = null;
    let bestD = r;
    for (const pr of this.props) {
      if (!pr.alive || pr.thrown)
        continue;
      const d = distXZ(pr.pos, this.player.pos);
      if (d < bestD && Math.abs(pr.pos[1] - this.player.pos[1]) < 1.8) {
        best = pr;
        bestD = d;
      }
    }
    return best;
  }
  spawnProjectile(origin, dir, ownerId, shotId) {
    this.projectiles.push({
      pos: [origin[0], origin[1], origin[2]],
      prevPos: [origin[0], origin[1], origin[2]],
      vel: [dir[0] * BULLET_SPEED, dir[1] * BULLET_SPEED, dir[2] * BULLET_SPEED],
      spawnPos: [origin[0], origin[1], origin[2]],
      ownerId,
      shotId,
      age: 0,
      alive: true
    });
    if (ownerId !== 0)
      this.recentShots.push({ pos: [origin[0], origin[1], origin[2]], time: this.simTime });
  }
  perturbDirection(d, coneDeg) {
    normalize(d, d);
    if (coneDeg <= 0)
      return;
    const ang = coneDeg * Math.PI / 180;
    const up = Math.abs(d[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
    const ax = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]];
    normalize(ax, ax);
    const ay = [d[1] * ax[2] - d[2] * ax[1], d[2] * ax[0] - d[0] * ax[2], d[0] * ax[1] - d[1] * ax[0]];
    const r = Math.sqrt(this.rng.next()) * Math.tan(ang);
    const phi = this.rng.next() * Math.PI * 2;
    const ox = Math.cos(phi) * r, oy = Math.sin(phi) * r;
    d[0] += ax[0] * ox + ay[0] * oy;
    d[1] += ax[1] * ox + ay[1] * oy;
    d[2] += ax[2] * ox + ay[2] * oy;
    normalize(d, d);
  }
  heardShot(pos) {
    for (const s of this.recentShots) {
      if (this.simTime - s.time < 0.5 && distSq(s.pos, pos) < SHOT_HEARING * SHOT_HEARING)
        return true;
    }
    return false;
  }
  killPlayer(dir) {
    const p = this.player;
    if (!p.alive || p.invulnerable)
      return;
    p.alive = false;
    this.failed = true;
    this.events.push({ type: "playerDeath", dir });
  }
  killEnemy(e, dir, point, silent) {
    if (!e.alive)
      return;
    e.alive = false;
    this.stats.kills++;
    if (!silent)
      this.disarm(e, dir);
    this.events.push({ type: "enemyDeath", enemy: e, dir: [dir[0], dir[1], dir[2]], point: [point[0], point[1], point[2]], silent });
  }
  disarm(e, dir) {
    if (!e.weapon)
      return;
    const item = e.weapon;
    e.weapon = null;
    e.burstLeft = 0;
    e.telegraph = 0;
    if (!isWeapon(item.kind))
      return;
    const dropped = newItem(item.kind);
    const muzzle = enemyMuzzle(e, v3());
    const vel = [dir[0] * 2 + this.rng.sym(0.8), 2.2 + this.rng.next(), dir[2] * 2 + this.rng.sym(0.8)];
    const pos = [muzzle[0], muzzle[1], muzzle[2]];
    if (!this.static.lineClear([e.pos[0], e.pos[1] + 1.3, e.pos[2]], pos)) {
      pos[0] = e.pos[0];
      pos[1] = e.pos[1] + 1.3;
      pos[2] = e.pos[2];
    }
    const pr = this.addProp(dropped, pos, vel, false);
    pr.angVel = [this.rng.sym(8), this.rng.sym(8), this.rng.sym(8)];
  }
  stun(e, seconds, dir, push) {
    e.state = "stunned";
    e.stateTime = 0;
    e.stunTimer = seconds;
    e.meleeT = 0;
    e.telegraph = 0;
    e.burstLeft = 0;
    e.vel[0] += dir[0] * push;
    e.vel[2] += dir[2] * push;
    this.events.push({ type: "enemyHit", pos: [e.pos[0], e.pos[1] + 1.3, e.pos[2]], dir: [dir[0], dir[1], dir[2]] });
  }
  findGunPropFor(e) {
    if (e.targetPropId >= 0) {
      const cur = this.props.find((p) => p.id === e.targetPropId && p.alive && !p.thrown);
      if (cur)
        return cur;
      e.targetPropId = -1;
    }
    let best = null;
    let bestD = 10;
    for (const pr of this.props) {
      if (!pr.alive || pr.thrown || !isGun(pr.item.kind) || pr.claimedBy >= 0 && pr.claimedBy !== e.id)
        continue;
      if (Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]) > 1)
        continue;
      const d = distXZ(pr.pos, e.pos);
      if (d < bestD && Math.abs(pr.pos[1] - e.pos[1]) < 1.2) {
        best = pr;
        bestD = d;
      }
    }
    if (best) {
      best.claimedBy = e.id;
      e.targetPropId = best.id;
    }
    return best;
  }
  enemyPickUp(e, prop) {
    prop.alive = false;
    e.weapon = prop.item;
    e.targetPropId = -1;
    e.fireCooldown = 0.8;
    e.aimTimer = 0.6;
  }
  step(dt) {
    this.simTime += dt;
    const p = this.player;
    for (const e of this.enemies)
      savePrev(e);
    for (const pr of this.props) {
      copy(pr.prevPos, pr.pos);
      copy(pr.prevRot, pr.rot);
    }
    p.fireCooldown -= dt;
    p.punchCooldown -= dt;
    p.punchAge += dt;
    p.recoilAge += dt;
    p.throwAge += dt;
    p.slashAge += dt;
    p.pickupAge += dt;
    if (p.burstLeft > 0 && p.alive) {
      p.burstTimer -= dt;
      if (p.burstTimer <= 0) {
        const held = p.held;
        if (held && isGun(held.kind) && held.ammo > 0) {
          held.ammo--;
          this.playerVolley(held.kind);
          p.burstLeft--;
          p.burstTimer = WEAPONS[held.kind].burstInterval;
        } else {
          p.burstLeft = 0;
        }
      }
    }
    this.waves.update(this, dt);
    this.waves.flush(this, false);
    for (const e of this.enemies)
      if (e.alive)
        updateEnemy(this, e, dt);
    stepProps(this, dt);
    stepProjectiles(this, dt);
    removeDead(this.enemies);
    removeDead(this.props);
    removeDead(this.projectiles);
    while (this.recentShots.length > 0 && this.simTime - this.recentShots[0].time > 1)
      this.recentShots.shift();
    this.checkWin();
  }
  checkWin() {
    if (this.cleared || this.failed || !this.player.alive)
      return;
    const allSpawned = this.waves.allSpawned(this);
    const allDead = allSpawned && this.enemies.length === 0;
    const exit = this.def.exit;
    if (exit) {
      const [x0, z0, x1, z1] = exit.rect;
      const px = this.player.pos[0], pz = this.player.pos[2];
      const inside = px >= Math.min(x0, x1) && px <= Math.max(x0, x1) && pz >= Math.min(z0, z1) && pz <= Math.max(z0, z1);
      if (inside && (!exit.requiresClear || allDead))
        this.cleared = true;
    } else if (allDead) {
      this.cleared = true;
    }
    if (this.cleared)
      this.player.invulnerable = true;
  }
  addProp(item: Item, pos: Vec3, vel: Vec3, thrown: boolean): Prop {
    const pr: Prop = {
      id: this.nextId++,
      item,
      pos: [pos[0], pos[1], pos[2]],
      prevPos: [pos[0], pos[1], pos[2]],
      vel: [vel[0], vel[1], vel[2]],
      rot: [REST_ROT[item.kind][0], 0, REST_ROT[item.kind][1]],
      prevRot: [REST_ROT[item.kind][0], 0, REST_ROT[item.kind][1]],
      angVel: v3(),
      thrown,
      sleeping: false,
      restTimer: 0,
      alive: true,
      claimedBy: -1
    };
    this.props.push(pr);
    return pr;
  }
  breakProp(pr) {
    pr.alive = false;
    this.events.push({ type: "itemBreak", pos: [pr.pos[0], pr.pos[1], pr.pos[2]], kind: pr.item.kind });
  }
  wake(pr) {
    pr.sleeping = false;
    pr.restTimer = 0;
  }
  activeLasers() {
    const out = [];
    for (const e of this.enemies) {
      if (!e.alive || e.telegraph <= 0)
        continue;
      out.push({ origin: enemyMuzzle(e, v3()), dir: [...e.lockedDir], progress: clamp(1 - e.telegraph / 0.6, 0, 1) });
    }
    return out;
  }
}
function removeDead(list) {
  let w = 0;
  for (let r = 0; r < list.length; r++) {
    const item = list[r];
    if (item.alive)
      list[w++] = item;
  }
  list.length = w;
}
