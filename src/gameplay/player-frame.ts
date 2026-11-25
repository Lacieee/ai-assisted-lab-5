// One rendered frame of player control while playing: move and look, turn that into a recorded
// PlayerFrame, apply it to the world, and work out how fast time should run.
import { PlayerController, WALK_SPEED } from "./player-controller";
import type { ReplayRecorder } from "./replay";
import type { TimeScaleDriver } from "./time-scale-driver";
import type { World } from "./world";

/** The subset of input the player needs; implemented by engine/Input. */
export interface PlayerInput {
  mouseDx: number;
  mouseDy: number;
  moveAxes(): { x: number; y: number };
  wasPressed(action: string): boolean;
}

export interface PlayerFrameContext {
  player: PlayerController;
  world: World;
  driver: TimeScaleDriver;
  recorder: ReplayRecorder;
}

/** Runs one frame of player control and returns the time scale for the simulation steps that follow. */
export function runPlayerFrame(ctx: PlayerFrameContext, input: PlayerInput, dt: number, look: { sensitivity: number; invertY: boolean }): number {
  const { player, world, driver, recorder } = ctx;
  player.update(input, dt, world, look, true);
  const f = player.toFrame(input.wasPressed("fire"), input.wasPressed("throw"), input.wasPressed("interact"));
  const acted = world.applyPlayerFrame(f);
  recorder.push(f);
  if (acted)
    driver.actionKick();
  const busy = world.player.burstLeft > 0;
  return driver.update(dt, player.planarSpeed, WALK_SPEED, player.lookSpeed, !player.grounded, busy);
}
