// Shape of a level definition. Levels are plain data built with LevelBuilder (see level-builder.ts).
import type { EnemyKind, ItemKind, Vec3 } from "../gameplay/types";

export type ThemeName = "transit" | "office" | "rooftop";

/** An axis-aligned box of level geometry. `mat` names a material in the level's theme. */
export interface LevelBox {
  min: Vec3;
  max: Vec3;
  mat: string;
  /** false for decoration the player and bullets pass through (light strips, trims). */
  collide: boolean;
}

/** [x0, z0, x1, z1] on the ground plane; corners may come in either order. */
export type Rect = [number, number, number, number];

export type WaveTrigger =
  | { type: "start" }
  | { type: "remaining"; count: number }
  | { type: "zone"; rect: Rect }
  | { type: "time"; seconds: number };

export interface SpawnDef {
  kind: EnemyKind;
  /** [x, z] on the floor at y = 0, or [x, y, z]. */
  pos: number[];
  /** undefined: the kind's default weapon; null: unarmed. */
  weapon?: ItemKind | null;
  yaw?: number;
  /** Starts unaware of the player until it sees them or hears a shot. */
  idle?: boolean;
}

export interface WaveDef {
  when: WaveTrigger;
  /** Seconds between the trigger firing and the spawns being queued. */
  delay?: number;
  spawns: SpawnDef[];
}

export interface LevelMeta {
  id: string;
  name: string;
  act: number;
  theme: ThemeName;
  /** Title card shown before the level starts. */
  words: string[];
  seed: number;
  player: { pos: Vec3; yaw: number; item?: ItemKind };
  props: { kind: ItemKind; pos: Vec3 }[];
  waves: WaveDef[];
  /** If present, the level is won by reaching this zone instead of killing everyone. */
  exit?: { rect: Rect; requiresClear: boolean };
  /** Most enemies alive at once; further spawns wait in a queue. Default 8. */
  maxActive?: number;
}

export interface LevelDef extends LevelMeta {
  boxes: LevelBox[];
}
