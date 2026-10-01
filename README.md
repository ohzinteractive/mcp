# ohzi-mcp

An MCP server that lets an AI assistant see and drive a running OHZI WebGL/WebGPU experience.

Point it at a boilerplate app running in dev and you can ask for a screenshot of the viewport, walk the scene graph, move an object, orbit the camera, switch the render mode, navigate between views, synthesise clicks and drags, read the console, or look up a real `ohzi-core` signature — all against the live app, in the browser, as it is right now.

It exists because the visual iteration loop is slow. Describing a WebGL bug in prose, waiting for a guess, and checking it by hand is a poor loop. This closes it.

```
"capture the viewport"
"inspect the scene, then move the cube up 2 units and show me"
"orbit to tilt 45, orientation 60, and show me"
"turn on bloom and show me, then tell me the framerate"
"what methods does CameraController have?"
```

## Quick start

The server ships as the `mcp/` submodule of [ohzi-boilerplate](https://github.com/ohzinteractive/boilerplate), which is already wired for it.

1. **Build the server.**

   ```bash
   cd mcp && yarn install && yarn build
   ```

2. **Check `.mcp.json` at the boilerplate root.** It is committed, so normally there is nothing to do:

   ```json
   {
     "mcpServers": {
       "ohzi": {
         "command": "node",
         "args": ["mcp/build/server.js"],
         "env": { "OHZI_MCP_PORT": "7317" }
       }
     }
   }
   ```

3. **Start the app.** `yarn start` from the boilerplate root, then open it. The dev bridge connects on its own — it is on by default in dev builds.

4. **Verify.** Ask the assistant for `ohzi_status`. A connected app answers like this:

   ```
   OHZI app: connected
   active view: home
   camera ready: yes
   canvas: 834x770 @ dpr 2
   versions: ohzi-core 13.3.0, ohzi-components 4.1.0, pit-js 5.0.4
   ```

If it says `not connected`, the server is fine and the browser is not attached. Reload the page.

### Using it outside the boilerplate

The server is not on npm yet. Until it is, add it as a submodule, build it, and point `.mcp.json` at `build/server.js`. The runtime half lives in `ohzi-core` (`src/dev_bridge/`), so the host app must call it — see [Wiring an app](#wiring-an-app).

## Tools

Twenty-two tools, grouped below by what they touch. Every tool that changes something accepts `capture: true`, which returns a screenshot of the result in the same call — ask it to do something and see the outcome without a second round trip.

### Status and observation

| Tool | What it does |
|---|---|
| `ohzi_status` | Connection, active view, camera readiness, canvas size, package versions. Call it first; it never fails when the app is down. |
| `capture_viewport` | Renders the app to a PNG. `fast` reads the live canvas; `hires` re-renders larger in tiles and needs an active camera. |
| `get_console` | Recent console output and uncaught errors. Poll incrementally with `since`. |
| `get_performance` | Framerate, frame time, logical and physical canvas size, renderer counters. |

### Scene graph

| Tool | What it does |
|---|---|
| `inspect_scene` | Walks the active scene: names, uuids, transforms, materials, vertex counts. Depth and node count are capped and truncation is reported. |
| `get_object` | Full state of one object, by `uuid` or `name`. `uuid` wins when both are given, because names are not unique. |
| `set_object` | Changes position, rotation, scale or visibility. Rotation is in radians. |

### Camera

| Tool | What it does |
|---|---|
| `get_camera` | Position, fov, near/far, clear colour, plus orbital controller state when one is driving. |
| `set_camera` | Drives the camera. The OHZI controller is **orbital**, so prefer `tilt`, `orientation`, `zoom` and `target`. A raw `position` is refused while a controller is active, because the controller would overwrite it next frame. |
| `frame_object` | Points at one object and fits it in view using the controller's bounding-box focus. |

### Rendering

| Tool | What it does |
|---|---|
| `list_render_modes` | The modes this app registered, with their options. |
| `set_render_mode` | Swaps the pipeline — bloom, SSAO, debug normals, VR. Call `list_render_modes` first for valid names. |

### Views

| Tool | What it does |
|---|---|
| `list_views` | Views registered with `ViewManager`, with urls, marking the active one. |
| `go_to_view` | Transitions to another view. Transitions are animated, so the active view can lag the request by a few frames. |

### Debug helpers

| Tool | What it does |
|---|---|
| `debug_draw` | Draws a cube, sphere, plane, math sphere or bounding box to mark a position, a volume or an object, a label that faces the camera, or `sdf_text` to check the SDF text renderer (the app's default SDF font, or the msdf-atlas-gen `.json` layout given as `font`). Cube, sphere, plane, label and SDF text live in the Debug overlay and survive view changes; math sphere and bounding box live in the current view's scene. A bounding box is a snapshot and does not follow its object. |
| `debug_clear` | Removes helpers drawn with `debug_draw`, one by id or all of them. The helpers the app draws for itself are never touched. |

### Input

All four dispatch genuine DOM events at the elements PIT and `KeyboardInput` already listen on, so synthetic input travels the exact same path as a real user's.

| Tool | What it does |
|---|---|
| `pointer` | Mouse press, release, move or click. A click holds briefly between press and release — PIT clears its pressed/released flags every frame, so the app must get a chance to observe both. |
| `drag` | Press, move through interpolated steps, release. This is how you orbit or pan. |
| `scroll` | Wheel event. Negative scrolls up, positive down. |
| `key` | Keyboard event. `KeyboardInput` only tracks keys the app registered with `register_key`, so an unregistered code dispatches but is ignored. |

### API knowledge

These two read the **consuming project's** committed `types/*.d.ts`, so signatures match the versions that project pins rather than anything the model remembers. They work whether or not the app is running.

| Tool | What it does |
|---|---|
| `search_api` | Searches `ohzi-core`, `ohzi-components` and `pit-js` declarations by symbol or member name. |
| `get_symbol` | The full declared surface of one class or singleton: constructor, properties, accessors, methods. |

## How it works

```
  Assistant  ──stdio──▶  ohzi-mcp server  ──WebSocket──▶  browser
                         (this repo)       127.0.0.1      ohzi-core
                              │             :7317         DevBridge
                              │
                              └──reads──▶  core/types, components/types, pit/types
```

**The server hosts the socket; the browser connects to it.** That order matters. The server is a long-lived process started with the assistant, while the page reloads constantly. A reload simply reconnects, and the newest connection wins.

**The handshake is versioned.** The page sends `hello` with its protocol version; the server replies `welcome` or `refused`, naming both versions. A mismatched `ohzi-core` fails loudly instead of misbehaving quietly.

**Commands are id-correlated and time out.** Five seconds by default, fifteen for a capture, twenty for input — synthetic input spends real time between press and release on purpose.

**Handlers run at a frame boundary when they must.** Each is registered `immediate` or `frame_end`. Anything that renders or mutates is `frame_end`, drained from `MainApplication.on_frame_end()`, so it can never land part-way through a frame and tear. `capture_viewport` is the clearest case: it overrides `OScreen`, the renderer pixel ratio and the camera view offset, so running it mid-frame would corrupt the render.

### Wiring an app

The host app owns the registration, because only it knows which handlers make sense. In the boilerplate this is [`app/js/components/DevBridgeController.ts`](https://github.com/ohzinteractive/boilerplate/blob/main/app/js/components/DevBridgeController.ts), reached from `MainApplication`:

```ts
// The guard must live INSIDE this method, not only around the call site: class
// methods are never tree-shaken, so without it the dynamic import below keeps
// DevBridgeController, and the whole dev bridge behind it, in the production
// bundle. This is also why the controller is never imported statically.
async start_dev_bridge()
{
  if (!import.meta.env.DEV)
  {
    return;
  }

  const { DevBridgeController } = await import('./components/DevBridgeController');

  this.dev_bridge = new DevBridgeController().start();
}
```

`MainApplication` keeps the `DevBridge` field typed through `import type` — erased at build — and drains it from `on_frame_end()`. If it held the controller instead, that live method would be a hard runtime reference and would drag the dev bridge into production.

## Configuration

| Setting | Where | Default |
|---|---|---|
| Port, server side | `env.OHZI_MCP_PORT` in `.mcp.json` | `7317` |
| Port, app side | `OHZI_MCP_PORT` in the app's environment, read as `import.meta.env.OHZI_MCP_PORT` — Vite exposes it because of `envPrefix: 'OHZI'` | `7317` |
| Enabled | `Settings.dev_bridge.enabled` | `true` in dev |

Both sides must agree on the port, and both validate independently: an invalid value falls back to `7317` rather than producing `ws://127.0.0.1:NaN`. Leave both unset and they agree by default.

## Security

The bridge is a remote-control channel for your app, so it is deliberately narrow:

- **Dev only.** The runtime half is behind `import.meta.env.DEV` and is stripped from production builds. Verify with a string-literal grep of `dist/` — identifiers are mangled by minification, so grepping for a class name proves nothing.
- **Loopback only.** The WebSocket binds `127.0.0.1`. It is not reachable from the network.
- **No arbitrary evaluation.** There is no `eval` command. Every tool maps to a named handler with a typed schema.

## Development

```bash
yarn install
yarn build        # tsc to build/
yarn dev          # tsx watch src/server.ts
yarn test         # vitest run — 134 tests
yarn fix-syntax   # eslint --fix
```

Requires Node 20 or newer.

### Layout

| Path | Role |
|---|---|
| `src/server.ts` | Entry point. Starts the bridge host, registers every tool family, connects stdio. |
| `src/protocol.ts` | Wire types and parsers. `PROTOCOL_VERSION` lives here. |
| `src/config.ts` | Port resolution and timeout constants. |
| `src/bridge/BridgeHost.ts` | WebSocket host: handshake, id correlation, timeouts, reconnection. |
| `src/tools/*.ts` | One file per tool family. `shared.ts` holds the common result helpers. |
| `src/knowledge/ApiIndex.ts` | A hand-rolled `.d.ts` scanner — deliberately not the TypeScript compiler API, which would add roughly 20 MB to a published package. |
| `src/knowledge/load_types.ts` | Reads `core/types`, `components/types` and `pit/types` from the consuming project. |
| `docs/` | The design spec and implementation plans. |

Two rules when working in here:

1. **stdout is the MCP channel.** Every diagnostic goes to stderr. A stray `console.log` corrupts the protocol.
2. **A tool that cannot reach the app must explain itself, not throw.** `ohzi_status` is the reference: when nothing is connected it says so and says what to do about it.

## Related

- [ohzi-boilerplate](https://github.com/ohzinteractive/boilerplate) — the app this drives
- [ohzi-core](https://github.com/ohzinteractive/core) — hosts the runtime half in `src/dev_bridge/`
- `docs/2026-09-12-mcp-server-design.md` — the full design, with rationale for each decision

## License

MIT © OHZI Interactive Studio
