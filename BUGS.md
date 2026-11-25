# Suspected bugs

Things that look wrong, noticed while migrating the code to Vite + TypeScript and reading through it.
Ordered roughly by how much they hurt the player. Fixed entries say so in a **Status** line and name the
regression test that guards them.

## High

### 1. The first level can never be started
**Status: FIXED** — `index <= 0`. Regression test: `test/playability.test.ts`.

`src/ui/ui.ts:325` (`isUnlocked`) returns `true` only for `index < 0`. For level 0, `this.levels[-1]` is
`undefined`, so it returns `false`.
**Why it looks wrong:** `Game.startLevel` (`src/app/game.ts:168`) bails out on a locked level. On a fresh save
the title-screen PLAY button (which calls `onPlayLevel(0)`) does nothing, and level 1-1 shows as `LOCKED` in the
level select. Every other level depends on 1-1 being cleared, so nothing is playable. The guard was almost
certainly meant to be `index <= 0`. (I saw this in the browser too: clicking PLAY did nothing.)

### 2. Time-scale driver gets its arguments swapped, so the core mechanic is broken
`src/app/game.ts:328` calls
`driver.update(dt, WALK_SPEED, this.player.planarSpeed, ...)`, but the signature in
`src/gameplay/time-scale-driver.ts:19` is `update(realDt, planarSpeed, maxSpeed, ...)`.
**Why it looks wrong:** `moveInput` becomes `WALK_SPEED / planarSpeed`. Standing still gives `4 / 0 = Infinity`,
which clamps to 1. Any speed up to 4 m/s also gives a ratio ≥ 1. Time therefore runs at full speed all the
time, and "time moves only when you move" never happens.

### 3. Gamepad "pause" button does nothing, and a gamepad alone can't play
`GAMEPAD_BUTTONS.pause` (`src/engine/input.ts:27`) is mapped, but nothing ever reads `wasPressed("pause")`.
Pausing only happens through the `pointerlockchange` listener. Also, in the `playing` state
(`src/app/game.ts:312`) the game forces `timeScale = 0` whenever the pointer isn't locked.
**Why it looks wrong:** gamepad support is advertised, yet the Start button never pauses. A gamepad-only
player (no mouse click to grab pointer lock) is stuck in frozen time.

## Medium

### 4. Simulation time is silently thrown away on slow frames
`src/engine/time.ts:33`: once `MAX_STEPS_PER_FRAME` (8 steps = 66 ms) is reached, the *whole* accumulator is
zeroed. `MAX_REAL_DT` is 100 ms, so any frame between 66 and 100 ms loses sim time.
**Why it looks wrong:** on a slow machine the game runs in slow motion even at full time scale. The replay
then records fewer steps than the real run had. Dropping only the excess, or raising the cap to match
`MAX_REAL_DT / FIXED_STEP = 12`, looks like the intent.

### 5. Props claimed by an enemy that dies stay claimed forever
`World.findGunPropFor` (`src/gameplay/world.ts:463`) sets `prop.claimedBy = e.id`, and skips props claimed by
someone else. Nothing resets `claimedBy` when that enemy dies or gets stunned.
**Why it looks wrong:** if an enemy is killed while running for a gun on the floor, no other enemy will ever go
for that gun.

### 6. Replay viewmodel bob uses distance from the world origin as "stride"
`src/app/game.ts:445`: in replay, `stride = Math.hypot(current.pos[0], current.pos[2])`.
**Why it looks wrong:** live play passes `player.stride`, the accumulated distance walked. The replay passes
the player's distance from (0, 0), so the weapon bob in replays doesn't match the run. It also bobs while
standing still away from the origin. The stride should be recorded in the replay frame.

## Low / consistency

### 7. Enemy and player use different gravity
Enemies use `GRAVITY = 18` (`src/gameplay/enemy.ts:22`). The player and props use `16`
(`player-controller.ts`, `world.ts`).
**Why it looks wrong:** there's no visible reason for the difference. It looks like constants that drifted apart
after being copied into three files (the bundle had them as `GRAVITY`, `GRAVITY2`, `GRAVITY3`).

### 8. Hit capsules don't match the collision heights
The enemy body capsule ends at `BODY_B = 1.45` while the head sits at `HEAD_OFFSET = 1.7`, radius 0.17. The
player capsule ends at `PLAYER_BODY_B = 1.5` with the head sphere at eye height 1.6, radius 0.16
(`world.ts:778`). That radius is a magic number next to `HEAD_RADIUS`.
**Why it looks wrong:** the gaps differ slightly between player and enemy. It's unclear whether that is deliberate
tuning or drift.

### 9. Hard-coded copies of named constants
- `src/gameplay/player-controller.ts:89` pushes the player away from enemies using `PLAYER_RADIUS + 0.3`,
  where `0.3` is `ENEMY_RADIUS` (not exported).
- `src/gameplay/world.ts:859` computes laser progress with `e.telegraph / 0.6`, where `0.6` is
  `TELEGRAPH` in `enemy.ts`.

**Why it looks wrong:** changing the named constant won't change these places.

### 10. Two different pitch limits
The camera clamps pitch to `π/2 − 0.001` (`render/camera.ts`). The player controller clamps it to `π/2 − 0.02`
(`gameplay/player-controller.ts:9`).
**Why it looks wrong:** this is harmless today, because the controller clamp is the tighter one. Still, it's
two sources of truth for one limit.

### 11. Time display can show `x:60.00`
`fmtTime` (`src/ui/ui.ts:3`) splits minutes before rounding seconds with `toFixed(2)`. For example,
59.996 s renders as `0:60.00`.
**Why it looks wrong:** seconds should never read 60. Rounding should happen before the minute/second split.

### 12. Collision boxes are filtered in two places
`buildLevelMesh` (`src/app/level-loader.ts`) and the fallback in the `World` constructor (`world.ts:61`) both run
the same `boxes.filter(b => b.collide).map(...)`.
**Why it looks wrong:** this is duplicated logic. If one copy changes (for example to add trigger boxes), the
live game and the fallback path will disagree.

### 13. Dead code and unused bindings
`flyUp`, `flyDown` and `debugToggleCamera` (F1) are bound in `DEFAULT_BINDINGS` but never read. A free/debug camera
seems to have been planned and never wired up. `Game.lastDeathDir`, `World.aliveEnemies` and
`Input.wasReleased` are never called. `aliveEnemies` also returns `enemies.length`, which counts every enemy in
the list, not only the alive ones.
**Why it looks wrong:** unused API invites misuse. `aliveEnemies` is misleading, because it only works
because `removeDead` runs at the end of each step.

### 14. `requestPointerLock` fallback logs nothing on browsers that return `undefined`
`src/engine/input.ts:63`: older browsers return `undefined` from `requestPointerLock()`. The `?.catch` then
skips both the retry and the warning.
**Why it looks wrong:** it's minor, but a failed lock there is completely silent, and the game just sits
frozen with the "click to lock" hint.
