# STILLFRAME

**Play it: https://lacieee.github.io/ai-assisted-lab-5/** (needs a WebGPU browser: recent Chrome or Edge)

A browser FPS where time only moves when you move. It runs on WebGPU, so use a recent Chrome or Edge.

## Running it

```bash
npm install
npm run dev        # dev server on http://localhost:5173 with hot reload
npm run build      # typecheck, then production build into dist/
npm run preview    # serve dist/ on http://localhost:4173
npm test           # golden-master test: src/ must behave exactly like the original index.html
```

### Deployment

Every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml). It installs,
runs `npm test`, builds, and publishes `dist/` to GitHub Pages. A failing test blocks the deploy. The
build runs on ARM64 macOS because the simulation snapshots are bit-exact (see the workflow comment).

### From VS Code (F5)

Open the Run and Debug panel, pick a configuration and press **F5**:

| Configuration | What it does |
|---|---|
| **Dev server (Chrome, debug TS)** | Starts `npm run dev`, waits until Vite is ready, then opens Chrome on it. |
| **Production build (Chrome, preview)** | Runs `npm run build` (including `tsc`), then `npm run preview`, then opens Chrome on it. |

Both configurations load source maps, so breakpoints you set in `src/**/*.ts` are hit
in the editor. The production build ships its source maps for this reason. Stopping the debug
session also stops the server it started.

## Source layout

```
index.html            HTML shell only (canvas, overlay, "WebGPU required" panel)
src/
  main.ts             entry point: create the GPU device, start the Game
  styles.css
  app/                wires everything together; the only folder that knows every other one
    game.ts           Game: state machine (title / playing / dead / replay ...), frame loop glue
    level-loader.ts   turns a level definition into GPU meshes, collision and nav data
    save.ts           settings and best times in localStorage
  engine/             game-agnostic building blocks
    gfx.ts            WebGPU device, canvas and resolution handling
    input.ts          keyboard, mouse (pointer lock), gamepad, action bindings
    time.ts, loop.ts  fixed 1/120 s step with time scaling, requestAnimationFrame loop
    vec3.ts, rng.ts   small math helpers and a seeded RNG
  render/             how things are drawn; knows nothing about gameplay
    renderer.ts       multi-pass pipeline: shadow, opaque, glass, fx, outline, bloom, final
    shaders/*.wgsl    one file per pass; common.wgsl / post.wgsl are shared prefixes
    mesh.ts, mesh-builder.ts, camera.ts, themes.ts
  audio/
    audio-engine.ts   Web Audio graph, 3D panning, music
    synths.ts         procedural generation of every sound effect
  physics/            spatial queries over the static level boxes
    static-world.ts   raycasts and character collision
    nav-grid.ts       walkability grid and A* pathfinding for enemies
  gameplay/           the simulation: deterministic and headless (no rendering, DOM or audio)
    world.ts          simulation state and player actions; step() drives the pieces below
    waves.ts          when waves fire and the spawn queue
    projectiles.ts    bullet movement and hits
    props.ts          physics of items lying around or thrown
    types.ts          data types: Enemy, Prop, Projectile, WorldEvent ...
    enemy.ts          enemy archetypes and their AI
    items.ts          weapons and throwable items
    player-controller.ts, time-scale-driver.ts, replay.ts
  visuals/            how the simulation looks: meshes, particles, animation
    mesh-library.ts, fx-system.ts, viewmodel.ts, pose.ts
  levels/             pure data: the 15 levels, split by act
    level-builder.ts  small DSL used to describe rooms, walls, stairs
    act1-transit.ts, act2-office.ts, act3-rooftops.ts, index.ts, types.ts
  ui/
    ui.ts             DOM menus, HUD, settings, results
    debug-overlay.ts
```

The reasoning behind this layout, and how behaviour was kept identical, is in [PART2.md](PART2.md).

### Why this layout

- **The folders follow the game's layers, and imports only point downward.**
  `app → gameplay / visuals / ui / render / audio → physics / engine`. Nothing imports `app`,
  and there are no import cycles. A newcomer can read a folder without knowing the ones above it.
- **`gameplay/` never imports `render/`, `visuals/`, `audio/` or the DOM.** The simulation is
  deterministic (replays work by re-simulating it), so keeping it headless means it can be unit tested
  in Node and the renderer can change without touching game rules.
- **`render/` and `visuals/` are separate.** `render/` is the generic WebGPU pipeline. `visuals/` decides
  what a gun, an enemy pose or a glass shard looks like. A shader change goes in one folder, a new enemy
  animation in the other.
- **`levels/` is data.** Designers work there without reading engine code, and each act is its own file,
  so two people editing different levels don't conflict.
- **Shaders are real `.wgsl` files** imported with Vite's `?raw`. That gives them syntax highlighting and
  readable diffs. The renderer concatenates the shared prefixes (`common.wgsl`, `post.wgsl`) exactly as before.

## TypeScript status

The code was recovered from a single bundled `index.html`. Modules, imports and exports are fully
typed, and `tsc` runs with no errors as part of `npm run build`. The compiler currently runs with
`strict: false`, because the original code carried no type annotations. Tightening that file by file
(turning on `noImplicitAny`, then `strict`) is the natural next step.
