STILLFRAME — Code Analysis
1. What Kind of Game Is This?

STILLFRAME is a first-person shooter (FPS) rendered in a browser using WebGPU. The entire game lives in a single index.html file (~7400 lines of JavaScript, WGSL shaders, CSS, and HTML).

Controls
Input	Action
WASD / Arrow keys	Move
Mouse	Look (pointer-locked)
LMB (left click)	Fire weapon / punch / throw held item
RMB (right click)	Throw held item
E	Pick up nearby item
Space	Jump
R	Restart level
Esc	Pause
Gamepad	Full support (sticks + mapped buttons)
Player Goal

The player progresses through 15 levels across 3 acts (Transit → Office Tower → Rooftops). Each level spawns waves of enemies. The objective is either to kill all enemies or to reach a marked exit zone. Completion records a real-time speedrun clock, encouraging replays for faster times.

2. The One Mechanic That Makes It Different

Time moves only when you move.

This is a SUPERHOT-style time mechanic implemented via the TimeScaleDriver class. When the player is stationary and not looking around, in-game time nearly stops (MIN = 0.015, i.e. 1.5% of real time). Time speeds up proportionally with:

Movement speed (walking/running)
Look speed (mouse movement, weighted at 35%)
Actions (shooting/throwing gives a 0.12 s "kick" to full speed)
Being airborne (forces at least 80% speed)

The fixed-step simulation runs at 1/120 s ticks, and the Time class scales how many ticks accumulate per real-time frame using timeScale. This lets the player plan in near-frozen time, turn, aim, then move to execute — turning a twitchy shooter into a tactical puzzle.

The post-processing pipeline reinforces this visually: when time is slow, the image becomes desaturated, gains chromatic aberration, stronger vignette, and heavier film grain (updatePost), making the frozen-time state feel cinematic.

3. Code Map — Subsystems and Dependencies

The monolithic file contains roughly 15 logical subsystems. Here's a dependency diagram:

Subsystem Responsibilities
Subsystem	Lines	Responsibility
Gfx	509–622	WebGPU device creation, canvas sizing, resolution scaling
Mesh / MeshBuilder	632–665, 3837–3921	Vertex layout, GPU buffer upload, procedural box/quad/tri geometry
Renderer	1163–1833	Multi-pass GPU pipeline: shadow → opaque → glass → FX → outline → bloom → final composite
Camera	1837–1874	View/projection matrix computation from yaw/pitch/position
Input	1904–2053	Keyboard, mouse (pointer lock), gamepad polling; action binding layer
Time / Loop	2056–2156	Fixed-step accumulator (1/120 s), timeScale, requestAnimationFrame loop
Vec3 math	2158–2231	Lightweight inline 3-component math utilities
AudioEngine	2233–2507	Web Audio API: procedural synthesis of all SFX, ambient music, 3D panning
LevelBuilder	2509–2604	Declarative level construction DSL (rooms, walls, stairs, doors)
Level definitions	2611–3393	15 levels across 3 acts with spawn waves, props, geometry
Ui	3400–3733	DOM-based title screen, pause, settings, results, replay bar, HUD
Save	3735–3777	localStorage persistence: settings + per-level best times
StaticWorld	3997–4265	AABB grid-based spatial hash, raycasting, capsule/sphere collision, character movement
NavGrid	4305–4581	Baked 2D walkability grid, A* pathfinding with line-of-sight smoothing
World	5221–6062	Full simulation state: player actions, projectiles, props, waves, win/lose
Enemy AI	4826–5196	Three enemy archetypes (walker, rusher, marksman) with patrol/pursue/shoot/melee FSM
PlayerController	6064–6159	Physics-based FPS movement: acceleration, gravity, jumping, stair stepping
TimeScaleDriver	6161–6190	Converts player activity into the 0.015–1.0 time scale
FxSystem	6192–6453	Particle streaks, glass shards with physics, muzzle flashes, spawn shimmer
Viewmodel	6456–6568	First-person weapon/fist rendering with sway, bob, recoil, throw animations
Replay	6571–6621	Records per-frame player input; replays by re-simulating the World
Pose / Skeleton	6623–6694	11-part procedural skeleton animation for enemies (walk cycle, aim, attack)
Game	6704–7393	Top-level orchestrator: state machine (title/intro/playing/dead/cleared/paused/replay), wires everything together
4. One Frame: From Keypress to Pixels

Here's the journey of pressing W (move forward) during gameplay:

Key details along the path:

Input buffering (lines 1984–1994): press() adds the code to pressedRaw; at the start of update(), pressedRaw is drained into pressedFrame so each key press is consumed exactly once.

Movement physics (lines 6101–6141): Desired velocity is clamped to WALK_SPEED (4 m/s), then acceleration is applied (ACCEL=30 grounded, AIR_ACCEL=10 airborne). StaticWorld.moveCharacter resolves axis-by-axis AABB collisions with stair stepping.

Time scaling (lines 6957–6999): TimeScaleDriver.update() maps planarSpeed / WALK_SPEED to a [0.015, 1.0] time scale. The result feeds Time.timeScale, which controls how many fixed 1/120 s simulation ticks occur this frame.

Rendering (lines 1476–1608): A single GPUCommandEncoder records 8+ render passes. Instance data for all visible meshes is packed into one GPU storage buffer. The final pass writes gamma-corrected sRGB to the swap chain texture.

5. Three Design Problems
Problem 1: Monolithic Single-File Architecture (7400 lines)

What: The entire game — shaders, CSS, 15 level definitions, physics, AI, rendering, audio synthesis, UI — lives in one index.html. The JavaScript alone would be ~6800 lines in a .js file.

Why it hurts:

No code navigation: IDEs can't split by module boundaries; "go to definition" returns dozens of same-file matches for common names like update, render, draw.
No parallel development: Two developers editing enemy AI and level design will always conflict on the same file.
No tree-shaking or lazy loading: The browser must parse and compile all 7400 lines before anything renders, even though level definitions (1800+ lines) for levels the player hasn't reached are dead weight.
Testing is impossible: There's no way to unit-test StaticWorld.raycast or NavGrid.findPath in isolation because they aren't importable modules.

Fix: Split into ES modules (gfx.js, renderer.js, input.js, world.js, enemies.js, levels/*.js, shaders as .wgsl files imported via fetch) and use a bundler for production.

Problem 2: The World Class Is a God Object

What: The World class (lines 5221–6062, ~840 lines) owns all simulation state and logic: player actions, enemy spawning, projectile physics, prop physics, wave management, item pickup, throwable collision, win condition checking, and even sound event generation.

Why it hurts:

Cognitive overload: Understanding projectile collision means reading through prop collision, player input handling, and wave spawning code in the same class.
Tight coupling: stepProjectiles directly calls killPlayer, killEnemy, breakProp, wake. Adding a new damage type or defense mechanic means modifying the 160-line stepProjectiles function.
State mutation everywhere: 15+ mutable arrays/objects (enemies, props, projectiles, recentShots, spawnQueue, stats, etc.) are all freely mutated by the 30+ methods, making it hard to reason about invariants.
Untestable: You can't test projectile-vs-enemy collision without constructing a full World with a StaticWorld, NavGrid, level definition, and player state.

Fix: Extract ProjectileSystem, PropPhysics, WaveSpawner, and PlayerActions into separate classes that communicate through a shared event bus or ECS-style entity store.

Problem 3: Magic Numbers Everywhere

What: Gameplay-critical constants are scattered as inline literals throughout the code rather than being named or configurable:

javascript
// Enemy AI (line 4994):
e.aimPitch = Math.atan2(playerEye[1] - 0.35 - (e.pos[1] + 1.48), Math.max(0.1, distP));
//                                     ^^^^                 ^^^^            ^^^
// TimeScaleDriver (line 6180):
const lookInput = clamp(lookSpeed / 900, 0, 1) * 0.35;
//                                  ^^^           ^^^^
// Post-processing (line 7227):
p.aberration = reduce ? 0 : freeze * 0.6 + this.flash[3] * 0.8;
//                                   ^^^                    ^^^

Why it hurts:

Tuning is painful: A designer wanting to adjust how fast enemies react can't search for a named constant — they have to understand what 0.35 on line 4994 means in context. The same literal 0.35 appears with completely different meanings on dozens of lines.
Bugs from copy-paste: The body capsule height uses 1.45 for enemies (line 4836) and 1.5 for the player (line 5202) — is that intentional or a drift? Impossible to tell.
No data-driven tuning: To experiment with time-scale feel, someone must edit JavaScript source, not a config file or settings panel.

Fix: Extract all tunable values into named const declarations grouped by subsystem (e.g. ENEMY_AIM_OFFSET_Y = 0.35, TIMESCALE_LOOK_WEIGHT = 0.35), ideally in a config.js module. For post-production, expose them through a debug panel.

TIP

Bonus observation: The audio engine synthesizes all sound effects procedurally at startup (lines 2388–2507) — gunshots, glass shattering, punches, pickups — using Math.sin, noise, and filters. This is why the game has zero external assets: no images, no audio files, no models. Everything is generated from code.