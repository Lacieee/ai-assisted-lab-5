// Decides when each wave of a level fires and feeds its enemies into the world,
// respecting the level's cap on how many enemies may be alive at once.
import { ENEMY_HEIGHT, ENEMY_RADIUS, createEnemy } from "./enemy";
import type { SpawnDef } from "../levels/types";
import type { World } from "./world";

export class WaveDirector {
  /** Next wave in def.waves that hasn't fired yet. */
  waveIndex = 0;
  /** The current wave's trigger has fired and its delay is counting down. */
  waveArmed = false;
  waveDelay = 0;
  lastWaveTime = 0;
  /** Spawns from fired waves still waiting for room under maxActive. */
  spawnQueue: { spawn: SpawnDef }[] = [];

  /** Enemies that have not spawned yet: queued plus those in waves still to come. */
  pendingCount(world: World) {
    let queued = this.spawnQueue.length;
    for (let i = this.waveIndex; i < world.def.waves.length; i++)
      queued += world.def.waves[i].spawns.length;
    return queued;
  }
  /** Every wave has fired and every spawn has entered the world. */
  allSpawned(world: World) {
    return this.waveIndex >= world.def.waves.length && this.spawnQueue.length === 0;
  }
  update(world: World, dt: number) {
    const waves = world.def.waves;
    while (this.waveIndex < waves.length) {
      const w = waves[this.waveIndex];
      if (!this.waveArmed) {
        let ok = false;
        const t = w.when;
        switch (t.type) {
          case "start":
            ok = true;
            break;
          case "remaining":
            ok = world.enemies.length + this.spawnQueue.length <= t.count;
            break;
          case "zone": {
            const [x0, z0, x1, z1] = t.rect;
            const px = world.player.pos[0], pz = world.player.pos[2];
            ok = px >= Math.min(x0, x1) && px <= Math.max(x0, x1) && pz >= Math.min(z0, z1) && pz <= Math.max(z0, z1);
            break;
          }
          case "time":
            ok = world.simTime - this.lastWaveTime >= t.seconds;
            break;
        }
        if (!ok)
          break;
        this.waveArmed = true;
        this.waveDelay = w.delay ?? 0;
      }
      this.waveDelay -= dt;
      if (this.waveDelay > 0)
        break;
      for (const s of w.spawns)
        this.spawnQueue.push({ spawn: s });
      this.waveIndex++;
      this.waveArmed = false;
      this.lastWaveTime = world.simTime;
    }
  }
  /** Moves queued spawns into the world while there is room. `initial` spawns appear fully formed and silently. */
  flush(world: World, initial: boolean) {
    const max = world.def.maxActive ?? 8;
    while (this.spawnQueue.length > 0 && world.enemies.length < max) {
      const q = this.spawnQueue.shift();
      const s = q.spawn;
      const wanted = s.pos.length === 2 ? [s.pos[0], 0.05, s.pos[1]] : [s.pos[0], s.pos[1] + 0.05, s.pos[2]];
      // A spawn point inside level geometry would get pushed up on top of it (BUGS.md #15).
      const pos = world.static.findFreeSpot(wanted, ENEMY_RADIUS, ENEMY_HEIGHT) ?? wanted;
      const yaw = s.yaw ?? Math.atan2(-(world.player.pos[0] - pos[0]), -(world.player.pos[2] - pos[2]));
      const e = createEnemy(world.nextId++, s.kind, pos, yaw, s.weapon, !!s.idle, world.rng.next());
      if (initial)
        e.spawnT = 1;
      e.prevSpawnT = e.spawnT;
      world.enemies.push(e);
      if (!initial)
        world.events.push({ type: "spawn", pos: [pos[0], pos[1], pos[2]] });
    }
  }
}
