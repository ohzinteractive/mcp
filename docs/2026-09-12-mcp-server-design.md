# OHZI MCP Server — Design

**Date:** 2026-09-12
**Status:** Approved, implementation not started
**Repos affected:** `mcp` (new), `core`, `boilerplate`, `pit` (wave 5). `components` unchanged.

---

## 1. Goal

Let a developer drive and observe a running OHZI WebGL/WebGPU experience by talking to Claude.

The primary pain being solved is the **visual iteration loop**: today you tweak a value, alt-tab, reload, squint, repeat — and Claude cannot see anything it builds. After this work, Claude can inspect the live scene, change it, and get a screenshot back in the same tool call.

A secondary goal is API ground truth: Claude should quote real OHZI signatures instead of inventing them.

## 2. Non-goals

- Production use. The bridge is dev-only and never present in a production bundle.
- Remote/networked use. Loopback only.
- Replacing TweakPane. TweakPane stays; this is complementary.
- Scaffolding automation as a first deliverable. It lands last (wave 7) and only after the scaffolders are hardened.
- Exposing Three.js knowledge. Claude already knows Three.js; we expose only what is OHZI-specific.

## 3. Decisions and rationale

### 3.1 The server lives in its own repo

`mcp/` is a git submodule of the boilerplate (`https://github.com/ohzinteractive/mcp`), published to npm separately. Rationale: it serves three libraries it does not own and needs its own release cadence.

### 3.2 The MCP server hosts the WebSocket; the browser connects to it

A browser cannot listen, so the choice is between the MCP server and Vite hosting the socket.

Chosen: **the MCP server hosts it.** Vite-plugin hosting couples the bridge to Vite's lifecycle, and Vite restarts on config changes. With the server hosting:

- either side may start in any order;
- when no app is connected, tools fail fast with "app not running" instead of hanging — the correct failure mode when Claude calls a tool speculatively.

Note on process lifecycle: with stdio MCP, **Claude Code spawns the server process** from `.mcp.json`. There is nothing to attach to `yarn start`. A standalone `yarn mcp` exists only for debugging the server outside Claude.

### 3.3 `import.meta.env.DEV` is the correct guard (no separate core entry point)

Verified in `vite.config.mjs`: `resolve.alias` maps `ohzi-core` → `./core/src`, `ohzi-components` → `./components/src`, `pit-js` → `./pit/src`. That alias block is top-level, applying to **both** dev and build, and `build.rollupOptions.output.manualChunks` tests for `/core/src/`.

So the boilerplate's Vite compiles core/components/pit **from source** in dev and in production. The rollup `build/index.mjs` output exists only for the standalone npm consumer path, which the boilerplate never takes. `import.meta.env.DEV` is therefore statically replaced with `false` at build time and the branch is dead-code-eliminated.

Precedent: `MainApplication.on_enter()` already guards TweakPane with `if (import.meta.env.DEV)`.

The DEV branch uses a dynamic `await import()` so the dev-only code lands in its own chunk and cannot be retained by accident.

### 3.4 Knowledge is generated from the project's committed `types/*.d.ts`

`types/*.d.ts` are git-tracked in core, components and pit, and listed in each package's npm `files`. The generator reads the **consuming project's** types from disk at runtime — not a manifest baked in at mcp publish time — so API truth is locked to the versions that project actually pins.

This matters because the prose docs have already drifted (see §9.1). Generated-from-types knowledge structurally cannot drift.

## 4. Architecture

```
Claude Code
    | stdio                             MCP protocol
ohzi-mcp                                mcp/ submodule -> npm
    | ws://127.0.0.1:<OHZI_MCP_PORT>    loopback, dev only
    | {id, cmd, args} -> {id, ok, result} | {id, ok:false, error}
Browser (Vite dev app)
    |
OhziDevBridge   --> Graphics, SceneManager, CameraManager, Time, OScreen, ViewManager
                --> PIT InputController (wave 5)
```

Port comes from `OHZI_MCP_PORT`, default `7317`. The boilerplate's `envPrefix` is already `OHZI`, so the value in `.env` reaches the client automatically. A configurable port is required so two boilerplate projects can be open in two Claude sessions.

## 5. Wire protocol

Protocol version `1`. JSON text frames.

### Handshake

On connect, the browser sends:

```json
{ "event": "hello", "protocol": 1,
  "app": { "core_version": "13.3.0", "components_version": "4.1.0", "pit_version": "5.0.4",
           "active_view": "home", "canvas": { "width": 1280, "height": 720, "dpr": 2 } } }
```

Server replies `{ "event": "welcome", "protocol": 1 }`.

**On protocol mismatch the server refuses the connection with an explicit message naming both versions.** This is required, not optional: `mcp` is published to npm independently of `core`, so version skew between the two ends of the wire is certain to happen in practice.

### Commands

```json
{ "id": "c17", "cmd": "capture_viewport", "args": { "mode": "fast", "width": 1280 } }
{ "id": "c17", "ok": true,  "result": { "...": "..." } }
{ "id": "c17", "ok": false, "error": { "code": "no_camera", "message": "CameraManager.current is undefined" } }
```

Every command is id-correlated with a timeout: **5 s default, 15 s for captures**, configurable. A hung frame can never wedge the Claude session.

Images travel as base64 inside the JSON result for v1. Simpler than binary frames and adequate at the default capture size (see §10.2).

### Frame-boundary execution

`Graphics.take_screenshot` mutates global render state (overrides `OScreen` size and renderer pixel ratio, pans via `setViewOffset`, then restores). Render-mode swaps are likewise unsafe mid-frame.

Therefore:

- **Read-only commands** (`inspect_scene`, `get_camera`, `get_console`, `get_performance`) are answered immediately.
- **Any command that renders or mutates** is queued and drained in `MainApplication.on_frame_end()`.

## 6. Tool surface

The **W** column is the wave in which the tool lands (see §11).

| W | Group | Tool | Args | Returns |
|---|---|---|---|---|
| 1 | Health | `ohzi_status` | — | connected, versions, active view, canvas size, camera readiness |
| 2 | Seeing | `capture_viewport` | `mode` (fast\|hires), `width?`, `height?` | MCP image content |
| 2 | | `get_console` | `level?`, `limit?`, `since?` | log/warn/error entries + uncaught exceptions |
| 3 | Scene | `inspect_scene` | `depth?`, `max_nodes?`, `filter?` | node tree + summary counts + truncation report |
| 3 | | `get_object` | `name` \| `uuid` | transform, material, geometry, bounding box |
| 3 | | `set_object` | `name`\|`uuid`, `position?`, `rotation?`, `scale?`, `visible?`, `capture?` | new state (+ image) |
| 4 | Camera | `get_camera` | — | camera + controller state (§6.3) |
| 4 | | `set_camera` | controller or raw args (§6.3), `capture?` | new state (+ image) |
| 4 | | `frame_object` | `name`, `scale?`, `capture?` | new state (+ image) |
| 5 | Render | `list_render_modes` | — | registered mode names |
| 5 | | `set_render_mode` | `name`, `capture?` | active mode (+ image) |
| 5 | | `get_performance` | — | fps, dpr, render size, `renderer.info`, PerformanceController state |
| 5 | Views | `list_views` | — | sections + urls |
| 5 | | `go_to_view` | `name`, `skip?`, `capture?` | active view (+ image) |
| 6 | Input | `pointer` | `action`, `x`, `y`, `space?`, `capture?` | new state (+ image) |
| 6 | | `drag` | `from`, `to`, `duration_ms?`, `space?`, `capture?` | new state (+ image) |
| 6 | | `scroll` / `key` | `delta` / `code`+`action`, `capture?` | new state (+ image) |
| 7 | Knowledge | `search_api` | `query`, `package?` | matching symbols + signatures |
| 7 | | `get_symbol` | `name` | full signature, members, source path |
| 7 | Scaffold | `create_view` / `create_scene` / `create_modal` | `name`, `dry_run?` | files created / would create |

### 6.1 Act-and-see: the `capture` flag

Every mutating tool accepts `capture: true` and returns the resulting image **in the same response**.

```
set_camera({ tilt: 70, orientation: 27, zoom: 0.4, capture: true })
  -> { camera: {...}, controller: {...}, image: <png> }
```

Without this, each tweak costs two round trips. With it, one call = act and see. This is the single decision that determines whether the loop feels alive. For the same reason, mutating tools return their new state rather than `ok: true`.

### 6.2 Traversal caps are mandatory

`inspect_scene` enforces `depth` and `max_nodes` with defaults and reports what it truncated. A production scene graph will otherwise serialize into something that consumes the whole context window.

### 6.3 Camera model: orbital first, raw as fallback

`CameraController` is **orbital**, not position/target based. Its real surface is `set_rotation(tilt, orientation, azimuth)`, `set_normalized_zoom(zoom)`, `get_current_tilt()`, `get_current_orientation()`, `get_current_azimuth()`, `focus_on_bounding_box(bb, scale)` and `focus_camera_on_points(points, zoom_scale)`.

The camera tools therefore speak the controller's idiom whenever `SceneManager.current.camera_controller` exists, because that is the layer that actually owns camera state — writing `camera.position` directly would be overwritten by the controller on the next `update()`.

- `get_camera` returns the raw camera (`position`, `quaternion`, `fov`, `near`, `far`, `clear_color`, `clear_alpha`) **and**, when a controller is present, `{ tilt, orientation, azimuth, normalized_zoom }`.
- `set_camera` accepts `tilt` / `orientation` / `azimuth` / `zoom` and routes them to `set_rotation()` + `set_normalized_zoom()`. It accepts raw `position` / `fov` only when no controller is present, and returns an explicit `controller_owns_camera` error if raw position is requested while a controller is active.
- `frame_object` computes the target's `Box3` and calls `focus_on_bounding_box(bb, scale)`.

### 6.4 Units and coordinate conventions

Stated explicitly because every one of these is a plausible source of silent misinterpretation:

| Quantity | Convention |
|---|---|
| `rotation` on `set_object` | **radians**, matching Three.js `Euler` |
| `tilt` / `orientation` / `azimuth` | **degrees**, matching `CameraController.set_rotation` |
| `zoom` | **normalized 0–1**, matching `set_normalized_zoom` |
| `duration_ms` on `drag` | milliseconds; the drag spans multiple frames and resolves when complete |
| `x` / `y` on `pointer` and `drag` | **CSS pixels relative to the canvas** by default; pass `space: "ndc"` for [-1..1] |
| `width` / `height` on `capture_viewport` | CSS pixels; the service applies DPR internally |

## 7. Per-repo changes

### `mcp/` (new)

```
src/server.ts            stdio MCP server, tool registry
src/bridge/host.ts       ws host, handshake, id correlation, timeouts
src/tools/*.ts           one module per tool group
src/knowledge/           manifest generator reading the project's types/*.d.ts
docs/                    this document
```

### `core/src/dev_bridge/` (new folder)

| File | Responsibility |
|---|---|
| `DevBridge.ts` | ws client with retry, command dispatch, frame-boundary queue |
| `SceneInspector.ts` | serialize `SceneManager.current` under depth/node caps |
| `CaptureService.ts` | fast `canvas.toBlob()` path; hi-res via `Graphics.take_screenshot` |
| `ConsoleBuffer.ts` | ring buffer over console methods + `onerror` / `onunhandledrejection` |
| `RenderModeRegistry.ts` | maps `'UnrealBloomRender'` to its constructor (a class cannot be `eval`'d from a string) |

The fast capture path is viable because `Api.ts` already constructs the `WebGPURenderer` with `preserveDrawingBuffer: true`, so `canvas.toBlob()` returns valid pixels. `Graphics.take_screenshot` remains the hi-res option and already handles WebGPU readback correctly via tiled rendering.

### `boilerplate` (wiring only)

- `Settings.dev_bridge` — enable flag and port.
- `MainApplication.on_enter()` — DEV branch beside the existing TweakPane branch, dynamic-importing `DevBridge`.
- `MainApplication.on_frame_end()` — new override draining the bridge's queued commands.
- `.mcp.json` — so Claude Code spawns the server.
- `yarn mcp` — standalone debug entry.
- Doc correction pass (§9.1).

### `pit` (wave 5)

`SyntheticInputModule.ts` plus activation, mirroring `MouseInputModule` / `TouchInputModule`. `InputController` already holds both and flips `active_input_module` between them, so synthetic input is module #3 in an existing pattern. Because the boilerplate's `Input` extends `InputController`, injected input flows through the real `clicked` / `swiped_*` derivation with no special-casing.

### `components`

No changes required.

## 8. Security

- The bridge is entered only from a DEV branch, so it is absent from production bundles — absence, not a runtime guard.
- The WS host binds `127.0.0.1` only.
- `Settings.dev_bridge.enabled` allows opting out even in dev.
- No filesystem or shell access is exposed through the bridge. Scaffolding tools (wave 7) run in the **server** process, not the browser, and are confined to the project root.

## 9. Pre-existing problems this work must respect

### 9.1 Documentation drift (fix in wave 7)

`docs/creating-views.md`, `docs/creating-scenes.md`, `docs/creating-modals.md` and the root `CLAUDE.md` describe a `.js` codebase and instruct the reader to edit `MainApplication.js` / `Sections.js`. The actual scaffolder (`core/tasks/create_view/create_view.mjs`) emits `.ts` and patches `MainApplication.ts`, `Sections.ts` and `GeneralLoader.ts`.

Because these docs become MCP-served knowledge, they must be corrected before being exposed.

### 9.2 Scaffolder fragility (blocks wave 7)

`create_view.mjs` patches six files via `replace-in-file` against literal anchors (`'HomeView';`, `'home_view.start();'`, `__SECTIONS__`, `loader_opacity: 0,`). It is **not idempotent** — a second run duplicates imports — and it does not check for name collisions. It runs with `cwd=core/` using relative `../app/...` paths.

Acceptable for a human who reads the output. Not acceptable behind an MCP tool an LLM may call speculatively. Wave 7 therefore hardens the scaffolders (idempotency, collision validation, `dry_run`) **before** exposing them.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Version skew between `mcp` (npm) and `core` (submodule) | Protocol version in the handshake; refuse mismatched connections with an explicit message |
| Base64 image payloads grow large | Default capture at canvas size, not hi-res; switch to binary WS frames if it hurts |
| Scene serialization floods context | Mandatory depth/node caps with truncation reporting |
| `take_screenshot` mutates global render state | Queue all rendering commands to `on_frame_end()`; never run mid-frame |
| `CameraManager.current` undefined before first view | `no_camera` error code; `ohzi_status` reports readiness |
| Port collision across concurrent projects | `OHZI_MCP_PORT`, default 7317 |

## 11. Wave plan and acceptance criteria

Each row is one commit in one repo. Submodule pointer bumps ride at the end of each wave, since core commits must land before the boilerplate can point at them.

| Wave | Commits | Acceptance |
|---|---|---|
| **1 · Wire** | `mcp`: server + ws host + `ohzi_status`; `core`: DevBridge client; `boilerplate`: dev-guard wiring + `.mcp.json` | Claude calls `ohzi_status` and gets the live app's active view |
| **2 · See** | `core`: CaptureService; `mcp`: `capture_viewport`; `core`: ConsoleBuffer; `mcp`: `get_console` | **Claude screenshots the running app and describes what it sees** |
| **3 · Scene** | `core`: SceneInspector; `mcp`: `inspect_scene` / `get_object` / `set_object` | Claude walks the scene graph and moves a mesh |
| **4 · Camera** | `core`: camera command handlers (orbital, §6.3); `mcp`: camera tools with `capture`; `mcp`: `frame_object` | "frame the model" returns the image |
| **5 · Render + Views** | `core`: RenderModeRegistry; `mcp`: render-mode + performance tools; `mcp`: `list_views` / `go_to_view` | "enable bloom, screenshot, report fps"; Claude navigates between views |
| **6 · Input** | `pit`: SyntheticInputModule; `mcp`: pointer/drag/scroll/key | Claude clicks the UI and sees the result |
| **7 · Know** | `mcp`: manifest generator + `search_api` / `get_symbol`; `core`: scaffolder hardening; `boilerplate`: doc drift fix | Claude quotes real signatures; scaffolder refuses a duplicate run cleanly |

**Wave 2 is the milestone.** Everything before it is plumbing; everything after is leverage.
