# import_model — Design

**Date:** 2026-10-12
**Status:** Approved, implementation not started
**Repos affected:** `core`, `mcp`, `boilerplate`. `components` and `pit` are unchanged.

---

## 1. Goal

A developer points Claude at a local `.glb`. Claude adds it to the project's asset manifests and loads it into the running scene so it can be previewed. The developer then moves it with the existing tools (`set_object`, `frame_object`, `capture_viewport`). When they are happy, Claude commits the placement as ordinary project code.

The workflow is **preview, then commit**. Importing is cheap and can be repeated. Code is written once, with the final values.

## 2. Non-goals

- `.gltf` files with external `.bin` or texture files. v1 accepts self-contained `.glb` only.
- More than one placement of the same model. Each wrapper parents the shared `gltf.scene`.
- Compression or optimization (Draco encoding, meshopt, KTX2).
- GLB extensions the loader cannot read. Only Draco is wired into the glTF loading path; meshopt and KTX2 are not.
- Textures, HDRs and sounds. Their manifest formats exist, so they can be added later.

## 3. Decisions and rationale

### 3.1 File writes happen in the server process, never in the browser

The original design (§8) forbids filesystem access through the bridge. The MCP server reads the source file and writes the project. The browser only loads a URL that the server has already put in `public/`.

### 3.2 Placements are code at markers, not data

A committed placement is a wrapper class plus scene wiring. It is inserted at marker comments, the same way `create-view`, `create-scene` and `create-modal` metaprogram the codebase. A placements data file was considered and rejected: developers already know and expect the marker pattern.

### 3.3 One wrapper class per model

Each committed model gets a class that extends `Object3D`, in `app/js/objects/`. The scene only creates and adds it. This gives the model a home for its own behavior later (an `update()`, materials, interaction). It also means a repeat commit only touches the three transform lines.

### 3.4 The patching logic lives in core/tasks, and the server loads it at runtime

`plan_import_model` and `plan_commit_object` live in `core/tasks/import_model/`, next to the other scaffolders, and are built on the shared `Scaffolder` (plan → validate → write, `dry_run`). A `yarn import-model <path>` CLI is included for parity with the other scaffolders.

`tasks/` is not in core's published npm `files`, so the MCP server imports it from `<cwd>/core/tasks/import_model/import_model.mjs` at runtime. That is the same principle as `load_types`: the consuming project's own copy is the truth. If the folder is missing, the tool fails with a clear message. The server never carries a copy of its own.

## 4. Data flow

```
Claude ──import_model──> mcp server
                          │ 1. read + validate source GLB (header parser)
                          │ 2. plan_import_model → copy to public/models, append manifest entry
                          │ 3. bridge: load_object { name, url, draco, version }
                          ▼
                        browser (DevBridge → ModelLoader)
                          │ GLTFLoader (+ 'draco_loader'), set_resource, replace by name, add to SceneManager.current
                          ▼
                        summary + capture_viewport image

Claude ──set_object / frame_object / capture_viewport──> (existing tools, unchanged)

Claude ──commit_object──> mcp server
                          │ 1. bridge: get_object { name } → live transform
                          │ 2. plan_commit_object → write/update wrapper class, wire scene at markers
                          ▼
                        report of files created or patched
```

## 5. Tool surface

| Tool | Args | Returns |
|---|---|---|
| `import_model` | `source` (absolute path), `scene?` (default `'home'`), `name?` (default: the file name in snake_case), `tier?` (`'regular'`\|`'high'`, default `'regular'`), `replace?`, `dry_run?` | the file report, the load summary (meshes, triangles, bounding box), an image |
| `commit_object` | `name`, `scene?` (default `'home'`), `dry_run?` | the file report |

Neither tool sets `readOnlyHint`. Both write the project.

### 5.1 `import_model`

1. **Validate the source** (server, before any write):
   - The file exists and has a `.glb` extension.
   - The first 4 bytes are the GLB magic number (`glTF`), the version is 2, and the first chunk is JSON and parses.
   - `extensionsUsed` contains `KHR_draco_mesh_compression` → `draco: true`.
   - `extensionsRequired` contains anything from the unsupported list (`EXT_meshopt_compression`, `KHR_texture_basisu`) → refuse, and name the extension.
2. **Validate the name**: run `sanitize_name`, then require `^[a-z][a-z0-9_]*$` and reject JS/TS reserved words. The name becomes a file name, a variable name and a class name, so this check is also the defense against path traversal and code injection.
3. **Plan the writes** (`plan_import_model`):
   - Copy to `public/models/<name>.glb` (or `public/models/high/<name>.glb` for the high tier).
   - Append `{ name, url, size, draco }` to `app/data/assets/<scene>/<scene>_objects.js`, or to `.../high/<scene>_high_objects.js`. `size` is the byte length of the copied file. The server computes it because `calculate_sizes.mjs` only runs before `yarn start` and only knows the home manifests.
4. **Collision rules**:

   | Situation | Without `replace` | With `replace` |
   |---|---|---|
   | Name not in the manifest, no file on disk | write | write |
   | Same name, same URL, identical bytes | no writes; live load only | same |
   | Same name, different bytes | refuse, suggest `replace` | overwrite the file, update `size` |
   | A `.glb` in `public/models/` that is not in the manifest | refuse | overwrite and add the entry |
   | The name exists in the other tier's manifest | refuse | refuse |
   | `app/data/assets/<scene>/` is missing | refuse, suggest `create-scene` | same |

5. **Live load**: send `load_object { name, url, draco, version }` (§7). If the app is not connected, the writes still stand and the result says the preview was skipped. If the load fails, the writes still stand and the result reports the `load_failed` message.

### 5.2 `commit_object`

1. Find the model in the scene's manifests to learn its tier. If it is not in either one, refuse.
2. Read the live transform with `get_object { name }`. It is already rounded to 4 decimals by `SceneInspector`. If the app is not connected, or there is no object with that name, refuse and say "import or load it first".
3. **Plan the writes** (`plan_commit_object`):
   - If `app/js/objects/<Pascal>.ts` does not exist, create it from the template (§6.1).
   - If it exists, rewrite exactly the three transform lines (§6.3).
   - Make sure the scene wiring is present (§6.2). Wiring that is already there is left unchanged, so committing twice does not touch the scene file.
4. Write `-0` as `0`.

## 6. Generated code

Style: Allman braces, 2-space indentation, single quotes, snake_case members. Class and file names are PascalCase (`office_chair` → `OfficeChair`), matching `HomeScene.ts`.

### 6.1 The wrapper class: `app/js/objects/Chair.ts`

```ts
import { ResourceContainer } from 'ohzi-core';
import { Object3D } from 'three';

export class Chair extends Object3D
{
  constructor()
  {
    super();

    this.name = 'chair';
    this.add(ResourceContainer.get('chair').scene);

    this.position.set(1.25, 0, -2);
    this.rotation.set(0, 1.5708, 0);
    this.scale.set(1, 1, 1);
  }
}
```

The template lives at `core/tasks/import_model/TemplateObject.ts`.

### 6.2 Scene wiring at four markers

| Marker | Location | Inserted above the marker |
|---|---|---|
| `// __OBJECT_IMPORTS__` | after the scene's imports | `import { Chair } from '../objects/Chair';` |
| `// __OBJECT_FIELDS__` | the class field list | `chair: Chair;` |
| `// __OBJECTS__` | the end of `on_assets_ready()` | `this.chair = new Chair();` and `this.add(this.chair);` |
| `// __HIGH_OBJECTS__` | the end of `on_high_quality_assets_ready()` | the same, for high-tier models |

The field is required: even with `strict` off, TypeScript rejects assigning an undeclared `this.chair`. Lines are inserted *above* the marker, so the marker always stays last and insertion order is stable. A scene without the needed marker gets a refusal that quotes the line to add and where to put it.

The markers are added to `app/js/scenes/HomeScene.ts` and to `core/tasks/create_scene/TemplateScene.ts`.

### 6.3 Committing again

A repeat commit rewrites exactly these lines in the class file:

```
    this.position.set(<x>, <y>, <z>);
    this.rotation.set(<x>, <y>, <z>);
    this.scale.set(<x>, <y>, <z>);
```

Each must appear **exactly once**, matched by a pattern derived from the template. If one is missing or duplicated, the tool refuses and leaves the file alone. Anything else a developer added to the class is preserved.

### 6.4 Known consequences

- The wrapper parents the shared `gltf.scene`. Creating it twice would take the model away from the first instance (see §2).
- A preview names the raw `gltf.scene` root `<name>`. After a commit and reload, the wrapper carries that name instead, so `get_object`, `set_object` and repeat commits keep working.
- If `import_model` replaces a model during a session where the wrapper is already present, the live wrapper is swapped for the raw root until the next reload. The committed code is unaffected.

## 7. Browser side: `load_object`

`core/src/dev_bridge/ModelLoader.ts`, registered by `DevBridgeController` with `frame_end` timing, since it mutates the scene. Async handlers are already supported by `CommandDispatcher`.

1. Load `url?v=<version>` with three's `GLTFLoader`. `version` is the first 12 hex characters of the file's SHA-256, computed by the server. It defeats the browser cache when `replace` overwrites a file at the same URL. When `draco` is set, attach `ResourceContainer.get('draco_loader')`.
2. `ResourceContainer.replace_resource(name, url, gltf)`, a new method that overwrites both the by-name and by-URL entries, so app code can `ResourceContainer.get(name)` during the preview. `set_resource` cannot be used: it keeps whatever was stored first for a URL, so after `replace`, or after a reload that already loaded the manifest entry, it would hand back the old model.
3. If an object named `name` is already a direct child of `SceneManager.current`, remove it and dispose of its geometries and materials.
4. Set `gltf.scene.name = name` and add it to `SceneManager.current`.
5. Return `{ name, meshes, triangles, bounding_box: { min, max } }`.

Errors: a failed fetch or parse rejects with a new code, `load_failed`. The mcp side sends `load_object` with a **30 s** timeout (`LOAD_TIMEOUT_MS`), because large GLBs take a while to load, then calls `attach_capture`.

DEV guard: `ModelLoader` is reached only through the lazily imported bridge chunk. The production bundle is checked for its unique strings, as in the original design (§8).

## 8. Testing

Strict TDD: a failing test first, at every step.

| Unit | File | Approach |
|---|---|---|
| GLB header parser | `core/tests/tasks/glb_header.test.ts` | GLBs built in memory inside the test (valid, bad magic, bad version, non-JSON first chunk, Draco used, meshopt required) |
| `plan_import_model` | `core/tests/tasks/import_model.test.ts` | A temporary project root, like `create_scene.test.ts`. Every row of the §5.1 collision table, both tiers, a missing scene folder, `dry_run` |
| `plan_commit_object` | same file | First commit (class created, 4 markers patched), repeat commit (only the transform lines change, the scene is untouched), developer additions preserved, a duplicated or missing transform line refused, a missing marker refused, `-0` |
| `ResourceContainer.replace_resource` | `core/tests/ResourceContainer.test.ts` | Overwrites a resource already stored under the same URL. `set_resource` behavior is unchanged |
| `ModelLoader` | `core/tests/dev_bridge/ModelLoader.test.ts` | A fake loader: register, replace and dispose, the `?v=` URL, summary counts, `load_failed` |
| `ModelLoader` on the GPU | `core/tests/dev_bridge/ModelLoader.browser.test.ts` | Load a real in-memory GLB, as in `DebugDrawer.browser.test.ts` |
| `import_model` / `commit_object` tools | `mcp/tests/tools/import.test.ts` | A fake host plus a stand-in for the core-tasks module. Result text, image attachment, not connected, preview skipped, refusals passed through |
| Runtime core-tasks loader | `mcp/tests/knowledge/core_tasks.test.ts` | Resolves from cwd, and gives a clear error when the folder is missing |
| End to end | manual | Start the app on a spare port through `BridgeHost`. Import a real GLB, move it, commit, reload, and check it is in the same place |

## 9. Delivery

Each line is one commit. Core lands first, because the others depend on it. Submodule pointers are updated last.

1. **core** `feat/import-model`
   - `feat(tasks): add GLB header parser`
   - `feat(tasks): add plan_import_model`
   - `feat(tasks): add plan_commit_object and object template`
   - `feat(tasks): add import-model CLI`
   - `feat(tasks): add object markers to the scene template`
   - `feat(resources): add ResourceContainer.replace_resource`
   - `feat(dev-bridge): add ModelLoader and load_failed`
2. **mcp** `feat/import-model`
   - `feat(protocol): add load_failed error code`
   - `feat(knowledge): load core tasks from the project at runtime`
   - `feat(tools): add import_model`
   - `feat(tools): add commit_object`
   - `docs: document import_model and commit_object`
3. **boilerplate** `feat/import-model`
   - `feat(scenes): add object markers to HomeScene`
   - `feat(dev-bridge): register load_object`
   - `chore: add import-model script`
   - `docs: add importing models to creating-scenes`
   - the production bundle check, then submodule pointer updates
