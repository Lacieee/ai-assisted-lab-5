# STILLFRAME — Part 2: Module Structure

Part 1 found the game living in one 7,400-line `index.html`. Part 2 turns it into an npm + Vite +
TypeScript project with one module per responsibility. **The game's behaviour must not change.**
This document explains the structure, why it is split that way, and how we know nothing changed.

## 1. The folders

```
src/
  main.ts          entry point: get a WebGPU device, start the Game
  app/             wiring: Game state machine, level loading, save data
  engine/          game-agnostic basics: GPU device, input, fixed-step clock, vector math, RNG
  render/          the WebGPU pipeline, meshes, camera, themes; shaders/*.wgsl
  audio/           Web Audio graph + procedural sound synthesis
  physics/         collision against level geometry, nav grid + A* for enemies
  gameplay/        the simulation: World, enemies, waves, projectiles, props, player movement, replays
  visuals/         what the simulation looks like: enemy poses, particles, first-person hands, mesh library
  levels/          the 15 levels as data, plus the small builder DSL they are written in
  ui/              DOM menus, HUD, debug overlay
```

| Folder | Files | What a newcomer goes there for |
|---|---|---|
| `app/` | `game.ts`, `level-loader.ts`, `save.ts` | "What happens when I press PLAY / die / clear a level?" |
| `engine/` | `gfx.ts`, `input.ts`, `time.ts`, `loop.ts`, `vec3.ts`, `rng.ts` | Key bindings, the 1/120 s fixed step, math helpers |
| `render/` | `renderer.ts`, `mesh.ts`, `mesh-builder.ts`, `camera.ts`, `themes.ts`, `shaders/` | Lighting, bloom, outlines, a shader bug |
| `audio/` | `audio-engine.ts`, `synths.ts` | Volume, panning, how the gunshot sound is generated |
| `physics/` | `static-world.ts`, `nav-grid.ts` | Walking through walls, raycasts, enemies not finding a path |
| `gameplay/` | `world.ts`, `enemy.ts`, `waves.ts`, `projectiles.ts`, `props.ts`, `items.ts`, `player-controller.ts`, `time-scale-driver.ts`, `replay.ts`, `types.ts` | Game rules: damage, AI, weapons, the time mechanic |
| `visuals/` | `pose.ts`, `fx-system.ts`, `viewmodel.ts`, `mesh-library.ts` | Animation, particles, the on-screen gun |
| `levels/` | `act1-transit.ts`, `act2-office.ts`, `act3-rooftops.ts`, `level-builder.ts`, `index.ts`, `types.ts` | Making or tweaking a level |
| `ui/` | `ui.ts`, `debug-overlay.ts` | Menus, HUD text, settings screen |

## 2. Why it is split this way

### Folders follow layers, and imports only point down

```
            main
             │
            app  ─────────────────────────────┐
   ┌────────┬─┴──────┬────────┬────────┐      │
   ui    visuals  gameplay  render   audio  levels
   │        │        │        │
 levels   render  physics     │
            │        │        │
            └──── engine ─────┘
```

This was checked with a script that reads every `import` in `src/` and lists the cross-folder edges:
`app → everything`, `gameplay → engine, physics`, `visuals → engine, render`, `ui → levels`,
`main → app, engine`. **No folder imports `app`, and there are no runtime import cycles.** (`gameplay/`
and `levels/` share *types* with `import type`, which is erased at build time.)

What this gives a reader: to understand a folder you only need the folders below it. `engine/` can be
read on its own. `gameplay/` needs `engine/` and `physics/` and nothing else.

### The simulation is headless

`gameplay/` never imports `render/`, `visuals/`, `audio/` or the DOM. That split already existed
inside the original file: `World` reports what happened as a list of events (`shot`, `enemyDeath`,
`impact` …), and `Game` turns those events into sound and particles. Keeping that line as a folder boundary
matters for three reasons:

1. **Replays depend on it.** A replay re-runs the simulation from recorded player input, so the simulation has
   to be deterministic. Code that can't touch the screen or the audio clock can't accidentally depend on them.
2. **It can be tested in Node.** The golden-master test (section 4) runs the whole simulation without a
   browser or GPU. That is only possible because of this boundary.
3. **Rules and presentation change independently.** "Enemies should turn slower" and "the death shatter
   should look better" end up in different folders.

### `render/` vs `visuals/`

`render/` is the generic WebGPU machinery: pipelines, passes, buffers, shaders. It knows nothing about
guns or enemies. `visuals/` decides what game things look like: the 11-part enemy skeleton, the
particle effects, the first-person hands. A graphics programmer and a gameplay/animation programmer
work in different folders.

### `levels/` is data

The 15 levels are about 1,800 lines of declarative data. Each act has its own file, so two people
editing different levels don't conflict (Part 1, problem 1). `levels/types.ts` describes the format
(`LevelDef`, `WaveDef`, `SpawnDef` …), and all 15 levels now type-check against it.

### Shaders are real files

Each WGSL module is in `render/shaders/*.wgsl` and is imported with Vite's `?raw`. Shared code
(`common.wgsl`, `post.wgsl`) is prepended in `renderer.ts`, exactly as the original concatenated strings.
This gives the shaders syntax highlighting and readable diffs, and makes them easy to find.

### Breaking up the `World` god object (Part 1, problem 2)

`World` was 840 lines that owned everything. Three self-contained jobs were moved out, each into its own file:

| New file | What moved | Shape |
|---|---|---|
| `gameplay/waves.ts` | when waves fire, the spawn queue, `maxActive` | `WaveDirector` class (owns its 5 fields) |
| `gameplay/projectiles.ts` | bullet movement and hit resolution | `stepProjectiles(world, dt)` |
| `gameplay/props.ts` | item physics, thrown items hitting enemies | `stepProps(world, dt)` |

`World` is now 577 lines and reads as a table of contents: `step()` calls the waves, then the enemies,
props and projectiles. The moved code takes `world` as a parameter, the same style `enemy.ts` already
used (`updateEnemy(world, e, dt)`). This keeps each piece in its own file without inventing an event bus or
an ECS. Those would be bigger design changes than a structural refactor should make.

## 3. What was deliberately *not* done

- **No bug fixes.** Anything that looked wrong went into [BUGS.md](BUGS.md) instead, for example the swapped
  arguments to the time-scale driver and level 1-1 being locked. Fixing them here would mix
  behaviour changes into a refactor and make it impossible to review.
- **No renaming or cleanup of magic numbers.** Same reason: each is a small behaviour risk that belongs in
  its own change.
- **`strict: false` in TypeScript.** The original had no types. The data types the simulation passes around
  are now written down (`gameplay/types.ts`, `levels/types.ts`), but turning on strict mode file by file is
  left for later.
- **`renderer.ts` (712 lines) and `game.ts` (722 lines) are still big.** Each is one cohesive
  responsibility, and splitting them is the obvious next refactor.

## 4. How we know behaviour didn't change

### Golden-master test (`npm test`)

`test/reference/original-index.html` is a verbatim copy of the original game (commit `bda2868`). The test
loads its `<script>` as a module. The only change is the CDN import, which points at the same version
of `wgpu-matrix` from npm. It then runs the **original** and the **refactored** code side by side
with identical scripted input and requires identical results:

- **Simulation:** all 15 levels, 40 s each, at 60 fps. The script walks, strafes, looks around, fires, throws,
  picks things up, jumps, and stands still, so the time-scale driver goes through its range.
  Deaths and clears restart the level, and each attempt is also replayed. Every 10 frames (and on every frame
  with events) it hashes the world state (player, enemies, props, bullets, events, stats), the
  time scale and step count, the first-person viewmodel draw calls, and every enemy's skeleton pose.
- **Geometry:** the bytes of every GPU buffer for all 15 levels and the shared mesh library, plus collision
  and navigation results. A fake `GPUDevice` records them.
- **Particles:** every effect emitter, stepped and drawn for 400 frames.
- **Sound:** every synthesized effect, with `Math.random` seeded.
- **Assets:** each `.wgsl` file, `styles.css` and the HTML body must match the original text exactly.

**Does the test actually catch changes?** It was checked by deliberately breaking things. Each of these
made it fail: walker speed 2.3 → 2.31, viewmodel bob 0.012 → 0.013, a wave trigger `<=` → `<`,
player hit radius 0.26 → 0.25, prop radius 0.05 → 0.06.

**Known limit:** changing the gunshot hearing range (16 → 15 m) did *not* fail the test. No scripted run
fires a shot with an idle enemy sitting right at that distance. The test covers what 40 s of scripted play
reaches, which is not every line.

### Small steps

After the first migration, the history is a series of commits that each do one thing and each pass
`npm test`, `npm run typecheck` and `npm run build`:

```
f11c73b  Add golden-master test comparing src/ against the original index.html
39e8ae8  Add types for simulation and level data          (type-only, no emitted JS changes)
20980a8  Move wave spawning out of World into WaveDirector
0b3f1e0  Move projectile stepping out of World
fa842cd  Move prop physics out of World
13def86  Tidy import lists left over from the module split
```

The three "Move … out of World" commits move code verbatim. The only edit is `this.` → `world.`. This
makes them easy to review with `git diff --color-moved`, where the moved block shows as a move rather
than as deletions and additions.

### How the split was made (commit `82063d1`)

That first commit is large: 36 modules appeared at once. It was not written by hand.
`index.html` was esbuild output, and esbuild leaves a blank line between the modules it concatenates and
renames clashing names (`GRAVITY2`, `WHITE3`). So the original module boundaries could be recovered
mechanically. [`tools/split-bundle.mjs`](tools/split-bundle.mjs) cuts the bundle at those line ranges,
turns `var` back into `const`/`let`, adds `export`s for names used elsewhere and `import`s for
names used here, and writes the shaders to `.wgsl` files. After the script, these edits were made by hand:
- removed imports the script over-matched (reported by `tsc`)
- added type annotations for three optional parameters
- renamed the esbuild collision names back (`GRAVITY2` → `GRAVITY` and so on, only where the name is local to its module)
- imported `styles.css` from `main.ts`

The golden-master test was added afterwards and passes against that commit, which covers it as well.

## 5. Day-to-day

| Command | What it does |
|---|---|
| `npm run dev` / **F5 "Dev server"** | Vite dev server + Chrome; breakpoints in `.ts` files work |
| `npm run build` / **F5 "Production build"** | typecheck + bundle with source maps, then preview |
| `npm test` | golden-master test, about 20 s |
| `npm run typecheck` | `tsc` for `src/` (browser types) and `test/` (Node types) |

**Note for Part 3:** fixing the bugs in BUGS.md *will* change behaviour, and the golden test will go red,
which is the point. Each fix should come with an explanation of the expected difference. The reference
copy should then be retired, or the golden test switched to comparing against the previous commit.

## 6. Publishing on GitHub Pages

**Live game: https://lacieee.github.io/ai-assisted-lab-5/** (needs a WebGPU browser: recent Chrome or Edge).

The repository is https://github.com/Lacieee/ai-assisted-lab-5. Every push to `master` runs
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which has two jobs:

1. **build**: `npm ci` → `npm test` (golden-master, playability and playthrough tests) → `npm run build`
   (typecheck + Vite bundle) → upload `dist/` as the Pages artifact. If any test fails, nothing is published.
2. **deploy**: `actions/deploy-pages` publishes the artifact to the `github-pages` environment.

Decisions that make it work from the Pages address and not only locally:

- **Relative asset paths.** Pages serves the game from `/ai-assisted-lab-5/`, not from the site root, so
  `vite.config.ts` sets `base: "./"`. The built `index.html` then loads `./assets/...`, which works under any
  sub-path. This was checked before pushing by serving `dist/` under `/ai-assisted-lab-5/` locally.
- **No CDN and no runtime fetches.** `wgpu-matrix` is bundled from npm, the shaders are inlined at build time
  (`?raw` imports), and the audio is synthesized in code. The published site is self-contained.
- **Bit-exact snapshots only on ARM64.** The simulation snapshots are exact game states recorded on Apple Silicon.
  The first CI run on Linux x64 failed because V8's `Math.sin/cos/atan2` can round the last bit differently
  there, and a 40-second simulation amplifies that. A macOS (ARM64) runner fixed it but queued for 10+ minutes,
  so CI runs on Linux and skips just those snapshots there. Everything else still runs on every push: the
  side-by-side comparison with the original, the playability tests and the Act 1 playthrough.
- **Repository settings (one-time):** Settings → Pages → Source: *GitHub Actions*, and `master` as the branch that deploys:
  the `github-pages` environment's protection rules allow deployments from `master` only.
- **Dev-only code stays out.** The `?nolock` switch and the `window.__game` handle used for automated play
  exist only under `import.meta.env.DEV` and are absent from the published bundle.
