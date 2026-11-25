// Data types of the simulation. Everything here is plain data owned by World.

/** A 3-component vector stored as a plain array [x, y, z] (see engine/vec3.ts). */
export type Vec3 = number[];

export type GunKind = "pistol" | "scatter" | "carbine";
export type WeaponKind = GunKind | "blade";
export type ItemKind = WeaponKind | "bottle" | "brick" | "mug";

/** Something that can be held: a weapon or a throwable. */
export interface Item {
  kind: ItemKind;
  ammo: number;
}

export type EnemyKind = "walker" | "rusher" | "marksman";
export type EnemyState = "idle" | "alert" | "pursue" | "stunned";

export interface Enemy {
  id: number;
  kind: EnemyKind;
  alive: boolean;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  grounded: boolean;
  state: EnemyState;
  stateTime: number;
  hp: number;
  weapon: Item | null;
  fireCooldown: number;
  burstLeft: number;
  burstTimer: number;
  /** Time left before the enemy may fire after spotting the player. */
  aimTimer: number;
  /** Marksman laser countdown; > 0 while the shot is being telegraphed. */
  telegraph: number;
  lockedDir: Vec3;
  /** Melee swing progress 0..1, 0 when not swinging. */
  meleeT: number;
  meleeCooldown: number;
  stunTimer: number;
  path: Vec3[] | null;
  pathIndex: number;
  repathTimer: number;
  seesPlayer: boolean;
  walkPhase: number;
  moveBlend: number;
  aimBlend: number;
  aimPitch: number;
  hitFlash: number;
  /** Spawn-in progress 0..1; the enemy can't act or be hit until it reaches 1. */
  spawnT: number;
  strafeSeed: number;
  /** Id of the floor gun this enemy is walking to, or -1. */
  targetPropId: number;
  lastShotId: number;
  // previous-step values, for interpolating between fixed steps when drawing
  prevPos: Vec3;
  prevYaw: number;
  prevWalkPhase: number;
  prevMoveBlend: number;
  prevAimBlend: number;
  prevSpawnT: number;
  prevMeleeT: number;
}

/** An item lying in or flying through the world. */
export interface Prop {
  id: number;
  item: Item;
  pos: Vec3;
  prevPos: Vec3;
  vel: Vec3;
  rot: Vec3;
  prevRot: Vec3;
  angVel: Vec3;
  /** Thrown by the player and still fast enough to hurt. */
  thrown: boolean;
  sleeping: boolean;
  restTimer: number;
  alive: boolean;
  /** Id of the enemy walking to pick this up, or -1. */
  claimedBy: number;
}

export interface Projectile {
  pos: Vec3;
  prevPos: Vec3;
  vel: Vec3;
  spawnPos: Vec3;
  /** 0 for the player, otherwise the enemy id. */
  ownerId: number;
  /** Pellets of one trigger pull share an id, so they don't collide with each other. */
  shotId: number;
  age: number;
  alive: boolean;
}

export interface PlayerState {
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  grounded: boolean;
  alive: boolean;
  invulnerable: boolean;
  held: Item | null;
  fireCooldown: number;
  burstLeft: number;
  burstTimer: number;
  punchCooldown: number;
  punchSide: number;
  // seconds since the last action of each kind, for the viewmodel animations
  punchAge: number;
  recoilAge: number;
  throwAge: number;
  slashAge: number;
  pickupAge: number;
}

/** What the player did in one rendered frame. Recorded for replays. */
export interface PlayerFrame {
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  grounded: boolean;
  fire: boolean;
  throwItem: boolean;
  interact: boolean;
  /** Fixed simulation steps that ran after this frame. */
  steps: number;
}

/** Things that happened during a step, drained by Game each frame to drive sound and particles. */
export type WorldEvent =
  | { type: "shot"; pos: Vec3; dir: Vec3; weapon: ItemKind; byPlayer: boolean }
  | { type: "dryFire" }
  | { type: "punch"; hit: boolean; pos: Vec3 }
  | { type: "slash"; hit: boolean }
  | { type: "slice"; pos: Vec3; dir: Vec3 }
  | { type: "throw" }
  | { type: "pickup"; kind: ItemKind }
  | { type: "impact"; pos: Vec3; normal: Vec3 }
  | { type: "enemyDeath"; enemy: Enemy; dir: Vec3; point: Vec3; silent: boolean }
  | { type: "enemyHit"; pos: Vec3; dir: Vec3 }
  | { type: "playerDeath"; dir: Vec3 }
  | { type: "bulletClash"; pos: Vec3 }
  | { type: "itemBreak"; pos: Vec3; kind: ItemKind }
  | { type: "propImpact"; pos: Vec3; speed: number }
  | { type: "spawn"; pos: Vec3 }
  | { type: "melee"; pos: Vec3 }
  | { type: "telegraph" };
