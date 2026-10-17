# import_model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two MCP tools. `import_model` copies a local `.glb` into an OHZI project, registers it in a scene's object manifest, and live-loads it into the running app. `commit_object` saves its final placement as a wrapper class plus scene wiring at marker comments.

**Architecture:**
- **core (`core/tasks/import_model/`).** All file planning lives here, built on the shared `Scaffolder` (plan → validate → write, `dry_run`). The browser side is a new dev bridge service, `ModelLoader`, plus `ResourceContainer.replace_resource`.
- **mcp.** It loads the project's own `core/tasks` at runtime and exposes the two tools.
- **boilerplate.** It adds the markers to `HomeScene.ts` and registers `load_object`.

**Tech Stack:** Node 20 ESM (`.mjs` scaffolders), TypeScript, three.js (GLTFLoader, DRACOLoader, GLTFExporter in tests), vitest (core: `unit` and `browser` projects; mcp: vitest 4.1.11), `@modelcontextprotocol/sdk` with zod raw shapes.

**Spec:** `mcp/docs/2026-10-12-import-model-design.md`. Read it before starting. Section references below (§) point into it.

## Global Constraints

- Code style: Allman braces, 2-space indentation, single quotes, snake_case for methods, variables and members. Class and file names are PascalCase (`Chair.ts`, `ModelLoader.ts`); scaffolder scripts are snake_case `.mjs`.
- Shell tools: use `rg`, `fd`, `bat` and `eza`. Never `grep`, `find`, `cat` or `ls`.
- Commits: conventional commits, one per task unless a task says otherwise. **No `Co-Authored-By` and no AI attribution lines.**
- Branches: `feat/import-model` in `core`, `mcp` and the boilerplate. The mcp branch already exists with the spec commit.
- **Never run `yarn install` at the boilerplate root during this work.** It force-checks-out the pinned submodule tags and destroys the feature branches in `core/` and `mcp/`. Install inside a submodule only if a dependency is missing there.
- Node 20. vitest stays at 4.1.11 in mcp, because vitest 5 needs Node 22.
- Every write the tools make stays inside the project root, through the `Scaffolder`. The browser bridge never touches the filesystem (original design §8).
- The source GLB may be anywhere on disk. It is only read.
- Unsupported required extensions: `EXT_meshopt_compression`, `KHR_texture_basisu`. Draco is detected through `KHR_draco_mesh_compression` in `extensionsUsed`.
- The model URL is `/models/<name>.glb` (regular) or `/models/high/<name>.glb` (high). Its file is `public` + URL.
- Transform numbers are rounded to 4 decimals, and `-0` is written as `0`.
- The `load_object` timeout is 30 000 ms (`LOAD_TIMEOUT_MS`).
- Markers: `// __OBJECT_IMPORTS__`, `// __OBJECT_FIELDS__`, `// __OBJECTS__` (end of `on_assets_ready()`) and `// __HIGH_OBJECTS__` (end of `on_high_quality_assets_ready()`).
- Class files live in `app/js/objects/<Pascal>.ts`. Scene files are `app/js/scenes/<Pascal(scene)>Scene.ts`.

## Review Focus

1. **Model names that collide with something the scene already has.** For example `camera`, which is already a scene field; `grid`, whose class name `Grid` is already imported from ohzi-core; or `position`, a member of every three.js `Object3D`. These must be refused with a message, never written as code that breaks compilation. Tests: Task 3 (Object3D members, globals) and Task 6 (scene field, imported identifier).
2. **A second name pointing at a URL that already belongs to another manifest entry.** If `chair` is imported, `--name stool` cannot point at `/models/chair.glb`, and importing a new `chair` must not overwrite a file owned by `stool`. Must be refused. Test: Task 5.
3. **Source paths written as `~/Downloads/chair.glb` or relative paths.** The MCP tool expands `~` and resolves relative paths against the project root. The CLI resolves relative paths against the directory the user ran `yarn` from (`INIT_CWD`), not `core/`. Tests: Task 7 (CLI) and Task 13 (tool, `resolve_source`).
4. **Manifests in other shapes.** For example a last real entry with no trailing comma, only commented entries, or an empty `= [];` on one line. The append must still produce valid JS. Test: Task 4.
5. **Transform values like `-0`, `1e-7`, `3.14159265` or `NaN`.** They must become `0`, `0` and `3.1416`, and `NaN` must be refused instead of writing `NaN` into code. Test: Task 6.

---

## File Structure

**core**

| File | Responsibility |
|---|---|
| `tasks/_shared/scaffolding.mjs` (modify) | `create()` gains `{ overwrite }` and Buffer contents; reports `overwritten` |
| `tasks/import_model/glb_header.mjs` (new) | Parse and validate a GLB header and JSON chunk; Draco detection; unsupported-extension refusal |
| `tasks/import_model/object_names.mjs` (new) | Validate model and scene names (identifier, reserved words, Object3D members, globals); class names |
| `tasks/import_model/manifest.mjs` (new) | Manifest paths and URLs; parse entries as text; append an entry; rewrite `size` |
| `tasks/import_model/import_model.mjs` (new) | `plan_import_model` and the `yarn import-model` CLI; re-exports `plan_commit_object` |
| `tasks/import_model/commit_object.mjs` (new) | `plan_commit_object`: wrapper class, transform lines, scene wiring |
| `tasks/import_model/TemplateObject.ts` (new) | Wrapper class template |
| `tasks/create_scene/TemplateScene.ts` (modify) | The four markers |
| `src/ResourceContainer.ts` (modify) | `replace_resource` |
| `src/dev_bridge/ModelLoader.ts` (new) | The `load_object` handler: load, register, replace and dispose, summarize |
| `src/index.ts` (modify) | Export `ModelLoader` |
| `package.json` (modify) | `import-model` script |
| `tests/helpers/glb.ts` (new) | `make_glb()` in-memory GLB builder |
| `tests/helpers/fixture_project.ts` (new) | A temporary OHZI project with manifests and a scene with markers |
| `tests/tasks/scaffolding_overwrite.test.ts`, `glb_header.test.ts`, `object_names.test.ts`, `manifest.test.ts`, `import_model.test.ts`, `commit_object.test.ts`, `import_model_cli.test.ts` (new) | Unit tests |
| `tests/tasks/create_scene.test.ts` (modify) | Markers present, and commit works on a fresh scene |
| `tests/ResourceContainer.test.ts` (new) | `replace_resource` |
| `tests/dev_bridge/ModelLoader.test.ts`, `ModelLoader.browser.test.ts` (new) | `ModelLoader` |

**mcp**

| File | Responsibility |
|---|---|
| `src/knowledge/core_tasks.ts` (new) | `load_core_tasks(root)` and the `CoreTasks` types |
| `src/tools/import.ts` (new) | `build_import_model_result`, `build_commit_object_result`, `register_import_tools` |
| `src/protocol.ts` (modify) | `load_failed` in `BridgeErrorCode` |
| `src/config.ts` (modify) | `LOAD_TIMEOUT_MS` |
| `src/server.ts` (modify) | Register the tools |
| `README.md` (modify) | A Models section; the tool count goes from 22 to 24 |
| `tests/knowledge/core_tasks.test.ts`, `tests/tools/import.test.ts` (new) | Tests |

**boilerplate**

| File | Responsibility |
|---|---|
| `app/js/scenes/HomeScene.ts` (modify) | The four markers |
| `app/js/components/DevBridgeController.ts` (modify) | Register `load_object` |
| `package.json` (modify) | `import-model` script |
| `docs/creating-scenes.md` (modify) | An "Importing models" section |

---

## Part A: core (branch `feat/import-model`)

Before Task 1, run:

```bash
cd core && git switch -c feat/import-model
```

Run unit tests from `core/` with `npx vitest run --project unit <file>`, and browser tests with `npx vitest run --project browser <file>`.

### Task 1: Scaffolder can overwrite and write bytes

**Files:**
- Modify: `core/tasks/_shared/scaffolding.mjs` (`create`, `simulate`, `run`, `print_report`)
- Test: `core/tests/tasks/scaffolding_overwrite.test.ts`

**Interfaces:**
- Produces: `scaffolder.create(relative_path, contents: string | Buffer, { overwrite = false } = {})`. The report from `run()` gains `overwritten: string[]`. A path that exists and has `overwrite: true` goes to `overwritten`, not `created`.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
// @ts-expect-error plain .mjs scaffolder script
import { Scaffolder } from '../../tasks/_shared/scaffolding.mjs';

let root: string;

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ohzi-overwrite-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const file = (r: string) => path.join(root, r);

describe('Scaffolder overwrite', () =>
{
  it('still refuses an existing file by default', () =>
  {
    fs.writeFileSync(file('a.txt'), 'old');

    const report = new Scaffolder({ root }).create('a.txt', 'new').run();

    expect(report.applied).toBe(false);
    expect(report.errors.join(' ')).toContain('already exists: a.txt');
    expect(fs.readFileSync(file('a.txt'), 'utf8')).toBe('old');
  });

  it('replaces an existing file when asked and reports it as overwritten', () =>
  {
    fs.writeFileSync(file('a.txt'), 'old');

    const report = new Scaffolder({ root }).create('a.txt', 'new', { overwrite: true }).run();

    expect(report.applied).toBe(true);
    expect(report.overwritten).toEqual(['a.txt']);
    expect(report.created).toEqual([]);
    expect(fs.readFileSync(file('a.txt'), 'utf8')).toBe('new');
  });

  it('reports an overwrite of a missing file as a create', () =>
  {
    const report = new Scaffolder({ root }).create('a.txt', 'new', { overwrite: true }).run();

    expect(report.created).toEqual(['a.txt']);
    expect(report.overwritten).toEqual([]);
  });

  it('writes binary contents byte for byte', () =>
  {
    const bytes = Buffer.from([0x67, 0x6c, 0x54, 0x46, 0x00, 0xff, 0x80]);

    new Scaffolder({ root }).create('public/models/a.glb', bytes).run();

    expect(fs.readFileSync(file('public/models/a.glb')).equals(bytes)).toBe(true);
  });

  it('dry run overwrites nothing', () =>
  {
    fs.writeFileSync(file('a.txt'), 'old');

    const report = new Scaffolder({ root, dry_run: true }).create('a.txt', 'new', { overwrite: true }).run();

    expect(report.overwritten).toEqual(['a.txt']);
    expect(report.applied).toBe(false);
    expect(fs.readFileSync(file('a.txt'), 'utf8')).toBe('old');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run --project unit tests/tasks/scaffolding_overwrite.test.ts`
Expected: FAIL. The overwrite cases report `already exists`, and `report.overwritten` is `undefined`.

- [ ] **Step 3: Implement**

In `scaffolding.mjs`:

```js
  /**
   * Queue a file. Its parent directories are created on apply. contents may be a
   * string or a Buffer. An existing file is refused unless overwrite is set,
   * which is how a re-import replaces a model the artist exported again.
   */
  create(relative_path, contents, { overwrite = false } = {})
  {
    this.creates.push({ relative_path, contents, overwrite });

    return this;
  }
```

In `simulate()`, declare `const overwritten = [];` next to `created`, and replace the creates loop with:

```js
    for (const entry of this.creates)
    {
      const exists = fs.existsSync(this.absolute(entry.relative_path));

      if (files.has(entry.relative_path) || (exists && !entry.overwrite))
      {
        errors.push(`already exists: ${entry.relative_path}`);
        continue;
      }

      files.set(entry.relative_path, entry.contents);
      (exists ? overwritten : created).push(entry.relative_path);
    }
```

Return `{ files, errors, created, overwritten, patched, skipped }`. In `run()`, add `overwritten: outcome.overwritten` to `report`. `fs.writeFileSync(target, contents, 'utf8')` already writes a Buffer byte for byte, because the encoding is ignored for buffers.

In `print_report`, after the `created` loop:

```js
  for (const file of report.overwritten ?? [])
  {
    console.log(`\x1b[33m${report.dry_run ? 'would overwrite' : 'overwrote'}\x1b[0m ${file}`);
  }
```

- [ ] **Step 4: Run this test and every scaffolder test, and confirm they pass**

Run: `npx vitest run --project unit tests/tasks`
Expected: PASS, including the existing `create_*` and `scaffolding` tests.

- [ ] **Step 5: Commit**

```bash
git add tasks/_shared/scaffolding.mjs tests/tasks/scaffolding_overwrite.test.ts
git commit -m "feat(tasks): let the scaffolder overwrite files and write bytes"
```

### Task 2: GLB header parser

**Files:**
- Create: `core/tasks/import_model/glb_header.mjs`
- Create: `core/tests/helpers/glb.ts`
- Test: `core/tests/tasks/glb_header.test.ts`

**Interfaces:**
- Produces:
  - `read_glb_header(bytes: Buffer | Uint8Array) → { draco: boolean, extensions_used: string[], extensions_required: string[] }`. It throws `Error` with a user-facing message.
  - `assert_supported(header)`. It throws for unsupported required extensions.
  - `UNSUPPORTED_EXTENSIONS: string[]`.
  - Test helper: `make_glb(json: unknown, options?: { magic?: number; version?: number; chunk_type?: number }): Buffer`.

- [ ] **Step 1: Write the test helper and the failing test**

`core/tests/helpers/glb.ts`:

```ts
const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;

// A GLB with only a JSON chunk. That is all the header parser reads, and it
// keeps fixtures out of the repository.
export function make_glb(json: unknown, { magic = GLB_MAGIC, version = 2, chunk_type = CHUNK_JSON } = {}): Buffer
{
  const text = Buffer.from(JSON.stringify(json), 'utf8');
  const padded = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(20);

  header.writeUInt32LE(magic, 0);
  header.writeUInt32LE(version, 4);
  header.writeUInt32LE(20 + padded.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(chunk_type, 16);

  return Buffer.concat([header, padded]);
}
```

`core/tests/tasks/glb_header.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs scaffolder script
import { assert_supported, read_glb_header } from '../../tasks/import_model/glb_header.mjs';
import { make_glb } from '../helpers/glb';

const ASSET = { asset: { version: '2.0' } };

describe('read_glb_header', () =>
{
  it('reads a plain GLB as not draco with no extensions', () =>
  {
    expect(read_glb_header(make_glb(ASSET))).toEqual({ draco: false, extensions_used: [], extensions_required: [] });
  });

  it('detects draco from extensionsUsed', () =>
  {
    const header = read_glb_header(make_glb({ ...ASSET, extensionsUsed: ['KHR_draco_mesh_compression'] }));

    expect(header.draco).toBe(true);
  });

  it('rejects a file that is shorter than a GLB header', () =>
  {
    expect(() => read_glb_header(Buffer.from('glTF'))).toThrowError(/shorter than a GLB header/);
  });

  it('rejects a file without the glTF magic number', () =>
  {
    expect(() => read_glb_header(make_glb(ASSET, { magic: 0x12345678 }))).toThrowError(/not a GLB file/);
  });

  it('rejects glTF 1.0', () =>
  {
    expect(() => read_glb_header(make_glb(ASSET, { version: 1 }))).toThrowError(/unsupported GLB version 1/);
  });

  it('rejects a first chunk that is not JSON', () =>
  {
    expect(() => read_glb_header(make_glb(ASSET, { chunk_type: 0x004e4942 }))).toThrowError(/first chunk is not JSON/);
  });

  it('rejects a JSON chunk that does not parse', () =>
  {
    const glb = make_glb(ASSET);
    glb.write('{', 20);
    glb.write('{', 21);

    expect(() => read_glb_header(glb)).toThrowError(/does not parse/);
  });

  it('rejects a JSON chunk that is not an object', () =>
  {
    expect(() => read_glb_header(make_glb(null))).toThrowError(/does not parse/);
  });

  it('rejects a truncated JSON chunk', () =>
  {
    const glb = make_glb(ASSET);

    expect(() => read_glb_header(glb.subarray(0, 24))).toThrowError(/truncated/);
  });
});

describe('assert_supported', () =>
{
  it('accepts draco', () =>
  {
    const header = read_glb_header(make_glb({ ...ASSET, extensionsUsed: ['KHR_draco_mesh_compression'], extensionsRequired: ['KHR_draco_mesh_compression'] }));

    expect(() => assert_supported(header)).not.toThrow();
  });

  it('refuses meshopt and KTX2 when required, naming them', () =>
  {
    const header = read_glb_header(make_glb({ ...ASSET, extensionsRequired: ['EXT_meshopt_compression', 'KHR_texture_basisu'] }));

    expect(() => assert_supported(header)).toThrowError(/EXT_meshopt_compression, KHR_texture_basisu/);
  });

  it('accepts an unsupported extension that is only used, not required', () =>
  {
    const header = read_glb_header(make_glb({ ...ASSET, extensionsUsed: ['KHR_texture_basisu'] }));

    expect(() => assert_supported(header)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run --project unit tests/tasks/glb_header.test.ts`
Expected: FAIL, because the module `glb_header.mjs` cannot be found.

- [ ] **Step 3: Implement `core/tasks/import_model/glb_header.mjs`**

```js
const GLB_MAGIC = 0x46546c67; // 'glTF', little endian
const CHUNK_JSON = 0x4e4f534a; // 'JSON', little endian
const HEADER_BYTES = 20; // 12 byte file header + 8 byte chunk header
const DRACO = 'KHR_draco_mesh_compression';

// The glTF loading path wires a Draco decoder only. A model that requires
// either of these would load as empty geometry or untextured.
const UNSUPPORTED_EXTENSIONS = ['EXT_meshopt_compression', 'KHR_texture_basisu'];

function strings(value)
{
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}

/**
 * Reads what import_model needs from a GLB without a glTF library: whether it
 * is a GLB at all, and which extensions it uses and requires.
 */
function read_glb_header(bytes)
{
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

  if (buffer.length < HEADER_BYTES)
  {
    throw new Error('not a GLB file: it is shorter than a GLB header.');
  }

  if (buffer.readUInt32LE(0) !== GLB_MAGIC)
  {
    throw new Error('not a GLB file: it does not start with "glTF". Export the model as binary glTF (.glb).');
  }

  const version = buffer.readUInt32LE(4);

  if (version !== 2)
  {
    throw new Error(`unsupported GLB version ${version}: only glTF 2.0 is supported.`);
  }

  const json_length = buffer.readUInt32LE(12);

  if (buffer.readUInt32LE(16) !== CHUNK_JSON)
  {
    throw new Error('not a valid GLB file: its first chunk is not JSON.');
  }

  if (HEADER_BYTES + json_length > buffer.length)
  {
    throw new Error('not a valid GLB file: its JSON chunk is truncated.');
  }

  let json;

  try
  {
    json = JSON.parse(buffer.toString('utf8', HEADER_BYTES, HEADER_BYTES + json_length));
  }
  catch
  {
    json = null;
  }

  if (typeof json !== 'object' || json === null || Array.isArray(json))
  {
    throw new Error('not a valid GLB file: its JSON chunk does not parse to a glTF object.');
  }

  const extensions_used = strings(json.extensionsUsed);

  return {
    draco: extensions_used.includes(DRACO),
    extensions_used,
    extensions_required: strings(json.extensionsRequired)
  };
}

function assert_supported(header)
{
  const unsupported = header.extensions_required.filter((name) => UNSUPPORTED_EXTENSIONS.includes(name));

  if (unsupported.length > 0)
  {
    throw new Error(`this GLB requires ${unsupported.join(', ')}, which the OHZI glTF loader cannot read. Export it again without that compression.`);
  }
}

export { UNSUPPORTED_EXTENSIONS, assert_supported, read_glb_header };
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run --project unit tests/tasks/glb_header.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tasks/import_model/glb_header.mjs tests/helpers/glb.ts tests/tasks/glb_header.test.ts
git commit -m "feat(tasks): add GLB header parser"
```

### Task 3: Model and scene names

**Files:**
- Create: `core/tasks/import_model/object_names.mjs`
- Test: `core/tests/tasks/object_names.test.ts`

**Interfaces:**
- Consumes: `sanitize_name` and `capitalize` from `tasks/_shared/scaffolding.mjs`.
- Produces:
  - `validate_object_name(raw: string) → string`, the sanitized name. It throws on failure.
  - `validate_scene_name(raw: string) → string`.
  - `class_name(name: string) → string` (`office_chair` → `OfficeChair`).

A model name becomes a file name, a scene field (`this.<name>`) and a class name, so it must be safe as all three. This check is also the defense against path traversal and code injection.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs scaffolder script
import { class_name, validate_object_name, validate_scene_name } from '../../tasks/import_model/object_names.mjs';

describe('validate_object_name', () =>
{
  it('sanitizes a file name into snake case', () =>
  {
    expect(validate_object_name('Office Chair-v2')).toBe('office_chair_v2');
  });

  it('strips path characters, so a name can never leave its folder', () =>
  {
    expect(validate_object_name('../../etc/passwd')).toBe('etcpasswd');
  });

  it('refuses an empty name', () =>
  {
    expect(() => validate_object_name('!!!')).toThrowError(/model name is required/);
  });

  it('refuses a name that starts with a digit', () =>
  {
    expect(() => validate_object_name('2chairs')).toThrowError(/must start with a letter/);
  });

  it('refuses reserved words', () =>
  {
    expect(() => validate_object_name('class')).toThrowError(/reserved word/);
    expect(() => validate_object_name('constructor')).toThrowError(/reserved word|member/);
  });

  it('refuses names that would overwrite a scene member', () =>
  {
    for (const name of ['position', 'scale', 'children', 'add', 'name', 'visible'])
    {
      expect(() => validate_object_name(name), name).toThrowError(/scenes already have a member/);
    }
  });

  it('refuses names whose class would shadow a global or the class file imports', () =>
  {
    for (const name of ['map', 'promise', 'image', 'audio', 'object3d', 'resource_container'])
    {
      expect(() => validate_object_name(name), name).toThrowError(/class name/);
    }
  });

  it('accepts ordinary model names', () =>
  {
    for (const name of ['chair', 'office_chair', 'tree2', 'car_body'])
    {
      expect(validate_object_name(name)).toBe(name);
    }
  });
});

describe('validate_scene_name', () =>
{
  it('accepts a scene folder name', () =>
  {
    expect(validate_scene_name('home')).toBe('home');
  });

  it('refuses an empty scene name', () =>
  {
    expect(() => validate_scene_name('')).toThrowError(/scene name is required/);
  });
});

describe('class_name', () =>
{
  it('turns snake case into PascalCase', () =>
  {
    expect(class_name('office_chair')).toBe('OfficeChair');
    expect(class_name('chair')).toBe('Chair');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run --project unit tests/tasks/object_names.test.ts`
Expected: FAIL, because the module cannot be found.

- [ ] **Step 3: Implement `core/tasks/import_model/object_names.mjs`**

```js
import { Scene } from 'three';
import { capitalize, sanitize_name } from '../_shared/scaffolding.mjs';

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

const RESERVED = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import',
  'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public',
  'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while',
  'with', 'yield', 'constructor', 'arguments', 'eval', 'undefined'
]);

// Browser globals that node does not define, plus what the generated class
// file itself imports. A class with one of these names would shadow it.
const TAKEN_CLASS_NAMES = new Set([
  'Image', 'Audio', 'Option', 'Text', 'Node', 'Element', 'Event', 'Document', 'Window', 'Location',
  'History', 'Screen', 'Worker', 'Blob', 'File', 'Request', 'Response', 'Headers', 'Storage',
  'ResourceContainer', 'Object3D'
]);

// Every property and method a three.js Scene has, from the instance up through
// Object3D to Object.prototype. A field named like one of them would replace it.
function scene_members()
{
  const names = new Set();
  let current = new Scene();

  while (current !== null)
  {
    for (const name of Object.getOwnPropertyNames(current))
    {
      names.add(name);
    }

    current = Object.getPrototypeOf(current);
  }

  return names;
}

const SCENE_MEMBERS = scene_members();

function validate_identifier(raw, label)
{
  const name = sanitize_name(raw);

  if (name.length === 0)
  {
    throw new Error(`a ${label} is required.`);
  }

  if (!IDENTIFIER.test(name))
  {
    throw new Error(`"${name}" is not a valid ${label}: it must start with a letter and use only a-z, 0-9 and _.`);
  }

  return name;
}

function class_name(name)
{
  return capitalize(name);
}

function validate_object_name(raw)
{
  const name = validate_identifier(raw, 'model name');

  if (RESERVED.has(name))
  {
    throw new Error(`"${name}" is a reserved word, so it cannot be a model name. Pass a different name.`);
  }

  if (SCENE_MEMBERS.has(name))
  {
    throw new Error(`"${name}" cannot be a model name: scenes already have a member called ${name}, and this.${name} would replace it. Pass a different name.`);
  }

  const pascal = class_name(name);

  // Case-insensitive: object3d becomes Object3d, which still reads as Object3D.
  const taken = [...TAKEN_CLASS_NAMES].some((taken_name) => taken_name.toLowerCase() === pascal.toLowerCase());

  if (pascal in globalThis || taken)
  {
    throw new Error(`"${name}" cannot be a model name: its class name ${pascal} would shadow an existing ${pascal}. Pass a different name.`);
  }

  return name;
}

function validate_scene_name(raw)
{
  return validate_identifier(raw, 'scene name');
}

export { class_name, validate_object_name, validate_scene_name };
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run --project unit tests/tasks/object_names.test.ts`
Expected: PASS. If `import { Scene } from 'three'` fails to resolve from `tasks/`, check that `three` is in core's `dependencies`. It is, because `src/` uses it.

- [ ] **Step 5: Commit**

```bash
git add tasks/import_model/object_names.mjs tests/tasks/object_names.test.ts
git commit -m "feat(tasks): validate model and scene names for import-model"
```

### Task 4: Manifest text helpers

**Files:**
- Create: `core/tasks/import_model/manifest.mjs`
- Test: `core/tests/tasks/manifest.test.ts`

**Interfaces:**
- Produces:
  - `TIERS = ['regular', 'high']`.
  - `manifest_path(scene, tier) → string`, relative to the project root.
  - `model_url(name, tier) → string`.
  - `parse_entries(text) → Array<{ name: string; url: string | null; size: number | null; text: string }>`, where `text` is the entry's exact source, braces included.
  - `append_entry(text, { name, url, size, draco }) → string`.
  - `with_size(entry_text, size) → string`.

Manifests are parsed as text, never imported. The boilerplate's `.js` manifests are ESM, Node 20 would treat them as CommonJS outside a `"type": "module"` package, and evaluating project files is not this tool's business. Whole-line `//` comments are blanked before matching. Trailing comments are not used in manifests.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs scaffolder script
import { append_entry, manifest_path, model_url, parse_entries, with_size } from '../../tasks/import_model/manifest.mjs';

const COMMENTED = `export const home_objects = [
  // {
  //   name: 'cube',
  //   url: '/models/cube.glb',
  //   size: 12192,
  //   draco: false
  // }
];
`;

const ONE_ENTRY_NO_COMMA = `export const home_objects = [
  {
    name: 'table',
    url: '/models/table.glb',
    size: 10,
    draco: false
  }
];
`;

const CHAIR = { name: 'chair', url: '/models/chair.glb', size: 42, draco: true };

const CHAIR_TEXT = `  {
    name: 'chair',
    url: '/models/chair.glb',
    size: 42,
    draco: true
  }`;

// The appended manifest must still be a valid array literal.
function evaluate(text: string): unknown[]
{
  const body = text.replace(/^export const \w+ = /, 'return ');

  return new Function(body)() as unknown[];
}

describe('paths', () =>
{
  it('builds manifest paths and URLs per tier', () =>
  {
    expect(manifest_path('home', 'regular')).toBe('app/data/assets/home/home_objects.js');
    expect(manifest_path('home', 'high')).toBe('app/data/assets/home/high/home_high_objects.js');
    expect(model_url('chair', 'regular')).toBe('/models/chair.glb');
    expect(model_url('chair', 'high')).toBe('/models/high/chair.glb');
  });
});

describe('parse_entries', () =>
{
  it('ignores commented entries', () =>
  {
    expect(parse_entries(COMMENTED)).toEqual([]);
  });

  it('reads name, url, size and the exact entry text', () =>
  {
    const [entry] = parse_entries(ONE_ENTRY_NO_COMMA);

    expect(entry.name).toBe('table');
    expect(entry.url).toBe('/models/table.glb');
    expect(entry.size).toBe(10);
    expect(ONE_ENTRY_NO_COMMA).toContain(entry.text);
    expect(entry.text.startsWith('{')).toBe(true);
  });

  it('reports a missing size as null', () =>
  {
    const [entry] = parse_entries(`export const a = [\n  { name: 'x', url: '/models/x.glb' }\n];\n`);

    expect(entry.size).toBeNull();
  });
});

describe('append_entry', () =>
{
  it('appends after only commented entries', () =>
  {
    const text = append_entry(COMMENTED, CHAIR);

    expect(text).toContain(`  // }\n${CHAIR_TEXT}\n];`);
    expect(evaluate(text)).toEqual([CHAIR]);
  });

  it('adds the missing comma after the last real entry', () =>
  {
    const text = append_entry(ONE_ENTRY_NO_COMMA, CHAIR);

    expect(text).toContain(`    draco: false\n  },\n${CHAIR_TEXT}\n];`);
    expect(evaluate(text)).toHaveLength(2);
  });

  it('keeps an existing trailing comma', () =>
  {
    const text = append_entry(ONE_ENTRY_NO_COMMA.replace('  }\n];', '  },\n];'), CHAIR);

    expect(text).not.toContain('},,');
    expect(evaluate(text)).toHaveLength(2);
  });

  it('expands an empty one-line array', () =>
  {
    const text = append_entry('export const home_objects = [];\n', CHAIR);

    expect(evaluate(text)).toEqual([CHAIR]);
  });

  it('refuses a file with no array to append to', () =>
  {
    expect(() => append_entry('export const home_objects = {};\n', CHAIR)).toThrowError(/no closing/);
  });
});

describe('with_size', () =>
{
  it('rewrites only the size', () =>
  {
    const [entry] = parse_entries(ONE_ENTRY_NO_COMMA);

    expect(with_size(entry.text, 99)).toBe(entry.text.replace('size: 10', 'size: 99'));
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run --project unit tests/tasks/manifest.test.ts`
Expected: FAIL, because the module cannot be found.

- [ ] **Step 3: Implement `core/tasks/import_model/manifest.mjs`**

```js
const TIERS = ['regular', 'high'];

function manifest_path(scene, tier)
{
  return tier === 'high'
    ? `app/data/assets/${scene}/high/${scene}_high_objects.js`
    : `app/data/assets/${scene}/${scene}_objects.js`;
}

function model_url(name, tier)
{
  return tier === 'high' ? `/models/high/${name}.glb` : `/models/${name}.glb`;
}

// Same length in, same length out, so indexes into the result are indexes
// into the original text.
function blank_line_comments(text)
{
  return text.replace(/^([ \t]*)(\/\/[^\n]*)/gm, (match, indent, comment) => indent + ' '.repeat(comment.length));
}

function parse_entries(text)
{
  const visible = blank_line_comments(text);
  const entries = [];

  for (const match of visible.matchAll(/\{[^{}]*\}/g))
  {
    const body = match[0];
    const name = /name:\s*['"]([^'"]+)['"]/.exec(body);

    if (name === null)
    {
      continue;
    }

    const url = /url:\s*['"]([^'"]+)['"]/.exec(body);
    const size = /size:\s*(\d+)/.exec(body);

    entries.push({
      name: name[1],
      url: url === null ? null : url[1],
      size: size === null ? null : Number(size[1]),
      text: text.slice(match.index, match.index + body.length)
    });
  }

  return entries;
}

function format_entry({ name, url, size, draco })
{
  return [
    '  {',
    `    name: '${name}',`,
    `    url: '${url}',`,
    `    size: ${size},`,
    `    draco: ${draco}`,
    '  }'
  ].join('\n');
}

function append_entry(text, entry)
{
  if (/=\s*\[\s*\];/.test(text))
  {
    return text.replace(/=\s*\[\s*\];/, `= [\n${format_entry(entry)}\n];`);
  }

  const lines = text.split('\n');
  const close = lines.findLastIndex((line) => line.trim().startsWith('];'));

  if (close === -1)
  {
    throw new Error('the manifest has no closing "];" line, so the entry cannot be appended.');
  }

  for (let index = close - 1; index >= 0; index--)
  {
    const trimmed = lines[index].trim();

    if (trimmed === '' || trimmed.startsWith('//'))
    {
      continue;
    }

    if (trimmed.endsWith('}'))
    {
      lines[index] = lines[index].replace(/\}\s*$/, '},');
    }

    break;
  }

  lines.splice(close, 0, format_entry(entry));

  return lines.join('\n');
}

function with_size(entry_text, size)
{
  return entry_text.replace(/size:\s*\d+/, `size: ${size}`);
}

export { TIERS, append_entry, manifest_path, model_url, parse_entries, with_size };
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run --project unit tests/tasks/manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tasks/import_model/manifest.mjs tests/tasks/manifest.test.ts
git commit -m "feat(tasks): add object manifest text helpers"
```

### Task 5: plan_import_model

**Files:**
- Create: `core/tasks/import_model/import_model.mjs`
- Create: `core/tests/helpers/fixture_project.ts`
- Test: `core/tests/tasks/import_model.test.ts`

**Interfaces:**
- Consumes: Task 1 `create(..., { overwrite })`; Task 2 `read_glb_header`, `assert_supported`; Task 3 `validate_object_name`, `validate_scene_name`; Task 4 `TIERS`, `manifest_path`, `model_url`, `parse_entries`, `append_entry`, `with_size`.
- Produces: `plan_import_model({ source, scene = 'home', name, tier = 'regular', replace = false }, { root, dry_run = false })`. It returns `{ scaffolder, model, unchanged }`:
  - `model` is `{ name, url, draco, version, size, tier }`, where `version` is the first 12 hex characters of the SHA-256 of the bytes.
  - `scaffolder.run()` returns the Task 1 report.
  - `unchanged` is `true` when the identical file is already imported, and then the scaffolder has nothing queued.
  - Validation failures **throw**.
- Test helpers (`fixture_project.ts`): `SCENE`, `EMPTY_OBJECTS(variable)`, `make_project(root, { scene? })`, `write(root, relative, contents)`, `read(root, relative)`, `exists(root, relative)`.

- [ ] **Step 1: Write the fixture helper**

`core/tests/helpers/fixture_project.ts`:

```ts
import fs from 'fs';
import path from 'path';

export function EMPTY_OBJECTS(variable: string): string
{
  return `export const ${variable} = [
  // {
  //   name: 'cube',
  //   url: '/models/cube.glb',
  //   size: 12192,
  //   draco: false
  // }
];
`;
}

// A scene shaped like the boilerplate's HomeScene: it already has a camera
// field and imports Grid, so name collisions can be tested against it.
export const SCENE = `import { CommonScene } from './common/CommonScene';

import { Grid, PerspectiveCamera } from 'ohzi-core';
// __OBJECT_IMPORTS__

export class HomeScene extends CommonScene
{
  camera: PerspectiveCamera;
  // __OBJECT_FIELDS__

  init()
  {
    this.add(new Grid());
  }

  on_assets_ready()
  {
    super.on_assets_ready();

    // __OBJECTS__
  }

  on_high_quality_assets_ready()
  {
    super.on_high_quality_assets_ready();

    // __HIGH_OBJECTS__
  }
}
`;

export function write(root: string, relative: string, contents: string | Buffer): void
{
  const target = path.join(root, relative);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

export function read(root: string, relative: string): string
{
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

export function exists(root: string, relative: string): boolean
{
  return fs.existsSync(path.join(root, relative));
}

export function make_project(root: string, { scene = SCENE }: { scene?: string } = {}): void
{
  write(root, 'app/data/assets/home/home_objects.js', EMPTY_OBJECTS('home_objects'));
  write(root, 'app/data/assets/home/high/home_high_objects.js', EMPTY_OBJECTS('home_high_objects'));
  write(root, 'app/js/scenes/HomeScene.ts', scene);
}
```

- [ ] **Step 2: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
// @ts-expect-error plain .mjs scaffolder script
import { plan_import_model } from '../../tasks/import_model/import_model.mjs';
import { exists, make_project, read, write } from '../helpers/fixture_project';
import { make_glb } from '../helpers/glb';

let root: string;
let downloads: string;

beforeEach(() =>
{
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ohzi-import-'));
  downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'ohzi-downloads-'));
  make_project(root);
});

afterEach(() =>
{
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(downloads, { recursive: true, force: true });
});

function glb_file(file_name: string, json: unknown = { asset: { version: '2.0' } }): string
{
  const target = path.join(downloads, file_name);
  fs.writeFileSync(target, make_glb(json));

  return target;
}

function run(args: Record<string, unknown>, dry_run = false)
{
  const planned = plan_import_model(args, { root, dry_run });

  return { ...planned, report: planned.scaffolder.run() };
}

describe('plan_import_model', () =>
{
  it('copies the file, appends the manifest entry and describes the model', () =>
  {
    const source = glb_file('Office Chair.glb', { asset: { version: '2.0' }, extensionsUsed: ['KHR_draco_mesh_compression'] });
    const bytes = fs.readFileSync(source);

    const { model, unchanged, report } = run({ source });

    expect(unchanged).toBe(false);
    expect(report.applied).toBe(true);
    expect(model).toEqual({
      name: 'office_chair',
      url: '/models/office_chair.glb',
      draco: true,
      version: crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12),
      size: bytes.length,
      tier: 'regular'
    });
    expect(fs.readFileSync(path.join(root, 'public/models/office_chair.glb')).equals(bytes)).toBe(true);
    expect(read(root, 'app/data/assets/home/home_objects.js')).toContain(`name: 'office_chair',\n    url: '/models/office_chair.glb',\n    size: ${bytes.length},\n    draco: true`);
  });

  it('uses the given name and the high tier', () =>
  {
    const { model } = run({ source: glb_file('x.glb'), name: 'tree', tier: 'high' });

    expect(model.url).toBe('/models/high/tree.glb');
    expect(exists(root, 'public/models/high/tree.glb')).toBe(true);
    expect(read(root, 'app/data/assets/home/high/home_high_objects.js')).toContain(`name: 'tree'`);
    expect(read(root, 'app/data/assets/home/home_objects.js')).not.toContain(`name: 'tree'`);
  });

  it('accepts an upper case .GLB extension', () =>
  {
    expect(run({ source: glb_file('CHAIR.GLB') }).model.name).toBe('chair');
  });

  it('dry run writes nothing', () =>
  {
    const { report } = run({ source: glb_file('chair.glb') }, true);

    expect(report.created).toEqual(['public/models/chair.glb']);
    expect(exists(root, 'public/models/chair.glb')).toBe(false);
  });

  it('is unchanged when the identical file is imported again', () =>
  {
    const source = glb_file('chair.glb');
    run({ source });

    const second = run({ source });

    expect(second.unchanged).toBe(true);
    expect(second.report.created).toEqual([]);
    expect(second.report.patched).toEqual([]);
  });

  it('refuses a changed file under the same name without replace', () =>
  {
    run({ source: glb_file('chair.glb') });
    const changed = glb_file('chair_v2.glb', { asset: { version: '2.0', generator: 'v2' } });

    expect(() => run({ source: changed, name: 'chair' })).toThrowError(/Pass replace/);
  });

  it('replaces a changed file and its size with replace, keeping one manifest entry', () =>
  {
    run({ source: glb_file('chair.glb') });
    const changed = glb_file('chair_v2.glb', { asset: { version: '2.0', generator: 'a much longer generator string' } });
    const bytes = fs.readFileSync(changed);

    const { report } = run({ source: changed, name: 'chair', replace: true });
    const manifest = read(root, 'app/data/assets/home/home_objects.js');

    expect(report.overwritten).toEqual(['public/models/chair.glb']);
    expect(manifest).toContain(`size: ${bytes.length},`);
    expect(manifest.match(/name: 'chair'/g)).toHaveLength(1);
  });

  it('refuses a GLB on disk that the manifest does not list, unless replace', () =>
  {
    write(root, 'public/models/chair.glb', 'stray');

    expect(() => run({ source: glb_file('chair.glb') })).toThrowError(/not in app\/data\/assets\/home\/home_objects\.js/);
    expect(run({ source: glb_file('chair.glb'), replace: true }).report.overwritten).toEqual(['public/models/chair.glb']);
  });

  it('refuses a name already used in the other tier', () =>
  {
    run({ source: glb_file('chair.glb') });

    expect(() => run({ source: glb_file('chair.glb'), tier: 'high', replace: true })).toThrowError(/already in the regular manifest/);
  });

  it('refuses a URL that another entry already owns', () =>
  {
    write(root, 'app/data/assets/home/home_objects.js', `export const home_objects = [\n  {\n    name: 'stool',\n    url: '/models/chair.glb',\n    size: 1,\n    draco: false\n  }\n];\n`);

    expect(() => run({ source: glb_file('chair.glb'), replace: true })).toThrowError(/already belongs to the manifest entry "stool"/);
  });

  it('refuses an entry of the same name that points elsewhere', () =>
  {
    write(root, 'app/data/assets/home/home_objects.js', `export const home_objects = [\n  {\n    name: 'chair',\n    url: '/models/old/chair.glb',\n    size: 1,\n    draco: false\n  }\n];\n`);

    expect(() => run({ source: glb_file('chair.glb') })).toThrowError(/points at \/models\/old\/chair\.glb/);
  });

  it('refuses a scene without an asset folder, suggesting create-scene', () =>
  {
    expect(() => run({ source: glb_file('chair.glb'), scene: 'gallery' })).toThrowError(/yarn create-scene gallery/);
  });

  it('refuses a source that is missing, not a .glb, or not a GLB inside', () =>
  {
    expect(() => run({ source: path.join(downloads, 'nope.glb') })).toThrowError(/no file at/);
    expect(() => run({ source: glb_file('chair.gltf') })).toThrowError(/only self-contained \.glb/);

    const fake = path.join(downloads, 'fake.glb');
    fs.writeFileSync(fake, 'this is not a model, just text');
    expect(() => run({ source: fake })).toThrowError(/not a GLB file/);
  });

  it('refuses a GLB that requires meshopt', () =>
  {
    const source = glb_file('chair.glb', { asset: { version: '2.0' }, extensionsRequired: ['EXT_meshopt_compression'] });

    expect(() => run({ source })).toThrowError(/EXT_meshopt_compression/);
  });

  it('refuses a bad tier', () =>
  {
    expect(() => run({ source: glb_file('chair.glb'), tier: 'medium' })).toThrowError(/tier must be/);
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npx vitest run --project unit tests/tasks/import_model.test.ts`
Expected: FAIL, because the module `import_model.mjs` cannot be found.

- [ ] **Step 4: Implement `core/tasks/import_model/import_model.mjs`**

The CLI `main` is added in Task 7. This task only exports `plan_import_model`.

```js
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Scaffolder } from '../_shared/scaffolding.mjs';
import { assert_supported, read_glb_header } from './glb_header.mjs';
import { TIERS, append_entry, manifest_path, model_url, parse_entries, with_size } from './manifest.mjs';
import { validate_object_name, validate_scene_name } from './object_names.mjs';

function read_source(source)
{
  const source_path = path.resolve(String(source ?? ''));

  if (path.extname(source_path).toLowerCase() !== '.glb')
  {
    throw new Error(`only self-contained .glb files can be imported: ${source_path}`);
  }

  if (!fs.existsSync(source_path) || !fs.statSync(source_path).isFile())
  {
    throw new Error(`no file at ${source_path}`);
  }

  const bytes = fs.readFileSync(source_path);
  const header = read_glb_header(bytes);

  assert_supported(header);

  return { source_path, bytes, header };
}

function read_manifests(root, scene)
{
  const asset_dir = `app/data/assets/${scene}`;

  if (!fs.existsSync(path.resolve(root, asset_dir)))
  {
    throw new Error(`scene "${scene}" has no asset folder at ${asset_dir}. Create the scene first: yarn create-scene ${scene}`);
  }

  const manifests = {};

  for (const tier of TIERS)
  {
    const relative = manifest_path(scene, tier);
    const absolute = path.resolve(root, relative);

    if (!fs.existsSync(absolute))
    {
      throw new Error(`missing manifest ${relative}. Every scene created with yarn create-scene has one.`);
    }

    const text = fs.readFileSync(absolute, 'utf8');

    manifests[tier] = { relative, text, entries: parse_entries(text) };
  }

  return manifests;
}

/**
 * Plans copying a GLB into public/models and listing it in a scene's object
 * manifest. Validation failures throw before anything is queued; run() on the
 * returned scaffolder writes, or reports, the rest.
 */
function plan_import_model({ source, scene = 'home', name, tier = 'regular', replace = false }, { root, dry_run = false })
{
  if (!TIERS.includes(tier))
  {
    throw new Error(`tier must be "regular" or "high", not "${tier}".`);
  }

  const { source_path, bytes, header } = read_source(source);
  const scene_name = validate_scene_name(scene);
  const model_name = validate_object_name(name ?? path.basename(source_path).slice(0, -'.glb'.length));
  const manifests = read_manifests(root, scene_name);
  const other_tier = tier === 'high' ? 'regular' : 'high';

  if (manifests[other_tier].entries.some((entry) => entry.name === model_name))
  {
    throw new Error(`"${model_name}" is already in the ${other_tier} manifest (${manifests[other_tier].relative}). A model lives in one tier only.`);
  }

  const url = model_url(model_name, tier);
  const owner = [...manifests.regular.entries, ...manifests.high.entries].find((entry) => entry.url === url && entry.name !== model_name);

  if (owner !== undefined)
  {
    throw new Error(`${url} already belongs to the manifest entry "${owner.name}". Pass a different name.`);
  }

  const manifest = manifests[tier];
  const file = `public${url}`;
  const target = path.resolve(root, file);
  const existing = fs.existsSync(target) ? fs.readFileSync(target) : null;
  const entry = manifest.entries.find((candidate) => candidate.name === model_name);
  const scaffolder = new Scaffolder({ root, dry_run });
  const model = {
    name: model_name,
    url,
    draco: header.draco,
    version: crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12),
    size: bytes.length,
    tier
  };

  if (entry !== undefined)
  {
    if (entry.url !== url)
    {
      throw new Error(`the manifest entry "${model_name}" points at ${entry.url}, not ${url}. Pass a different name or fix the manifest.`);
    }

    if (existing !== null && existing.equals(bytes))
    {
      return { scaffolder, model, unchanged: true };
    }

    if (existing !== null && !replace)
    {
      throw new Error(`${file} already holds a different "${model_name}". Pass replace to overwrite it.`);
    }

    scaffolder.create(file, bytes, { overwrite: true });

    if (entry.size !== null)
    {
      scaffolder.ensure(manifest.relative, entry.text, with_size(entry.text, bytes.length), `size of ${model_name}`);
    }

    return { scaffolder, model, unchanged: false };
  }

  if (existing !== null && !replace)
  {
    throw new Error(`${file} already exists but is not in ${manifest.relative}. Pass replace to overwrite it and add the entry.`);
  }

  scaffolder.create(file, bytes, { overwrite: replace });
  scaffolder.patch(
    manifest.relative,
    manifest.text,
    append_entry(manifest.text, { name: model_name, url, size: bytes.length, draco: header.draco }),
    `manifest entry for ${model_name}`
  );

  return { scaffolder, model, unchanged: false };
}

export { plan_import_model };
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run --project unit tests/tasks/import_model.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tasks/import_model/import_model.mjs tests/helpers/fixture_project.ts tests/tasks/import_model.test.ts
git commit -m "feat(tasks): add plan_import_model"
```

### Task 6: plan_commit_object and the object template

**Files:**
- Create: `core/tasks/import_model/commit_object.mjs`
- Create: `core/tasks/import_model/TemplateObject.ts`
- Modify: `core/tasks/import_model/import_model.mjs` (re-export)
- Test: `core/tests/tasks/commit_object.test.ts`

**Interfaces:**
- Consumes: Task 3 `validate_object_name`, `validate_scene_name`, `class_name`; Task 4 `TIERS`, `manifest_path`, `parse_entries`; `Scaffolder`, `render_template`.
- Produces: `plan_commit_object({ name, scene = 'home', transform: { position, rotation, scale } }, { root, dry_run = false }) → Scaffolder`. Validation failures throw. `import_model.mjs` re-exports it, so the mcp loads a single entry file.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
// @ts-expect-error plain .mjs scaffolder script
import { plan_commit_object } from '../../tasks/import_model/import_model.mjs';
import { exists, make_project, read, SCENE, write } from '../helpers/fixture_project';

let root: string;

const PLACED = { position: [1.25, 0, -2], rotation: [0, 1.5708, 0], scale: [1, 1, 1] };

const CHAIR_CLASS = `import { ResourceContainer } from 'ohzi-core';
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
`;

function list(name: string, tier: 'regular' | 'high' = 'regular')
{
  const relative = tier === 'high' ? 'app/data/assets/home/high/home_high_objects.js' : 'app/data/assets/home/home_objects.js';
  const variable = tier === 'high' ? 'home_high_objects' : 'home_objects';
  const url = tier === 'high' ? `/models/high/${name}.glb` : `/models/${name}.glb`;

  write(root, relative, `export const ${variable} = [\n  {\n    name: '${name}',\n    url: '${url}',\n    size: 1,\n    draco: false\n  }\n];\n`);
}

function commit(args: Record<string, unknown>, dry_run = false)
{
  return plan_commit_object({ transform: PLACED, ...args }, { root, dry_run }).run();
}

beforeEach(() =>
{
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ohzi-commit-'));
  make_project(root);
});

afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('plan_commit_object, first commit', () =>
{
  it('creates the wrapper class from the template', () =>
  {
    list('chair');

    const report = commit({ name: 'chair' });

    expect(report.applied).toBe(true);
    expect(report.created).toEqual(['app/js/objects/Chair.ts']);
    expect(read(root, 'app/js/objects/Chair.ts')).toBe(CHAIR_CLASS);
  });

  it('wires the scene above each marker', () =>
  {
    list('chair');

    commit({ name: 'chair' });
    const scene = read(root, 'app/js/scenes/HomeScene.ts');

    expect(scene).toContain(`import { Grid, PerspectiveCamera } from 'ohzi-core';\nimport { Chair } from '../objects/Chair';\n// __OBJECT_IMPORTS__`);
    expect(scene).toContain(`  camera: PerspectiveCamera;\n  chair: Chair;\n  // __OBJECT_FIELDS__`);
    expect(scene).toContain(`    super.on_assets_ready();\n\n    this.chair = new Chair();\n    this.add(this.chair);\n\n    // __OBJECTS__`);
  });

  it('wires a high tier model in on_high_quality_assets_ready', () =>
  {
    list('tree', 'high');

    commit({ name: 'tree' });
    const scene = read(root, 'app/js/scenes/HomeScene.ts');

    expect(scene).toContain(`    this.tree = new Tree();\n    this.add(this.tree);\n\n    // __HIGH_OBJECTS__`);
    expect(scene).not.toContain(`this.tree = new Tree();\n    this.add(this.tree);\n\n    // __OBJECTS__`);
  });

  it('keeps insertion order across models', () =>
  {
    list('chair');
    commit({ name: 'chair' });
    write(root, 'app/data/assets/home/home_objects.js', read(root, 'app/data/assets/home/home_objects.js').replace('];', `  ,{\n    name: 'table',\n    url: '/models/table.glb',\n    size: 1,\n    draco: false\n  }\n];`));

    commit({ name: 'table' });
    const scene = read(root, 'app/js/scenes/HomeScene.ts');

    expect(scene.indexOf('this.chair = new Chair();')).toBeLessThan(scene.indexOf('this.table = new Table();'));
  });

  it('dry run writes nothing', () =>
  {
    list('chair');

    const report = commit({ name: 'chair' }, true);

    expect(report.created).toEqual(['app/js/objects/Chair.ts']);
    expect(exists(root, 'app/js/objects/Chair.ts')).toBe(false);
    expect(read(root, 'app/js/scenes/HomeScene.ts')).toBe(SCENE);
  });
});

describe('plan_commit_object, committing again', () =>
{
  beforeEach(() =>
  {
    list('chair');
    commit({ name: 'chair' });
  });

  it('rewrites only the transform lines and leaves the scene alone', () =>
  {
    const scene_before = read(root, 'app/js/scenes/HomeScene.ts');

    const report = commit({ name: 'chair', transform: { position: [3, 1, 0], rotation: [0, 0, 0], scale: [2, 2, 2] } });
    const chair = read(root, 'app/js/objects/Chair.ts');

    expect(report.applied).toBe(true);
    expect(chair).toContain('    this.position.set(3, 1, 0);\n    this.rotation.set(0, 0, 0);\n    this.scale.set(2, 2, 2);');
    expect(read(root, 'app/js/scenes/HomeScene.ts')).toBe(scene_before);
    expect(report.skipped.map((entry: { label: string }) => entry.label)).toEqual(expect.arrayContaining(['import of Chair', 'field chair', 'instance of Chair']));
  });

  it('preserves code a developer added to the class', () =>
  {
    write(root, 'app/js/objects/Chair.ts', read(root, 'app/js/objects/Chair.ts').replace('  }\n}\n', '  }\n\n  update()\n  {\n    this.rotation.y += 0.01;\n  }\n}\n'));

    commit({ name: 'chair', transform: { position: [9, 9, 9], rotation: [0, 0, 0], scale: [1, 1, 1] } });

    expect(read(root, 'app/js/objects/Chair.ts')).toContain('this.rotation.y += 0.01;');
    expect(read(root, 'app/js/objects/Chair.ts')).toContain('this.position.set(9, 9, 9);');
  });

  it('refuses a class with a duplicated or missing transform line', () =>
  {
    const original = read(root, 'app/js/objects/Chair.ts');

    write(root, 'app/js/objects/Chair.ts', original.replace('    this.scale.set(1, 1, 1);\n', '    this.scale.set(1, 1, 1);\n    this.scale.set(2, 2, 2);\n'));
    expect(() => commit({ name: 'chair' })).toThrowError(/has 2 "this\.scale\.set\(\.\.\.\)" lines/);

    write(root, 'app/js/objects/Chair.ts', original.replace('    this.position.set(1.25, 0, -2);\n', ''));
    expect(() => commit({ name: 'chair' })).toThrowError(/has 0 "this\.position\.set\(\.\.\.\)" lines/);
  });
});

describe('plan_commit_object, refusals', () =>
{
  it('refuses a model that no manifest lists', () =>
  {
    expect(() => commit({ name: 'chair' })).toThrowError(/Import it first/);
  });

  it('refuses a scene that lacks a marker, naming it and where it goes', () =>
  {
    list('chair');
    write(root, 'app/js/scenes/HomeScene.ts', SCENE.replace('  // __OBJECT_FIELDS__\n', ''));

    expect(() => commit({ name: 'chair' })).toThrowError(/__OBJECT_FIELDS__ \(in the class field list\)/);
  });

  it('refuses a name that is already a scene member', () =>
  {
    list('camera');

    expect(() => commit({ name: 'camera' })).toThrowError(/already has a member called camera/);
  });

  it('refuses a name whose class is already an identifier in the scene', () =>
  {
    list('grid');

    expect(() => commit({ name: 'grid' })).toThrowError(/already uses the identifier Grid/);
  });

  it('refuses an existing class file that wraps a different model', () =>
  {
    list('chair');
    write(root, 'app/js/objects/Chair.ts', CHAIR_CLASS.replace(/'chair'/g, `'chair2'`));

    expect(() => commit({ name: 'chair' })).toThrowError(/wraps a different model/);
  });
});

describe('plan_commit_object, numbers', () =>
{
  it('rounds to 4 decimals and writes -0 and tiny values as 0', () =>
  {
    list('chair');

    commit({ name: 'chair', transform: { position: [-0, 1e-7, 3.14159265], rotation: [-0.00001, 0, 0], scale: [1, 1, 1] } });
    const chair = read(root, 'app/js/objects/Chair.ts');

    expect(chair).toContain('this.position.set(0, 0, 3.1416);');
    expect(chair).toContain('this.rotation.set(0, 0, 0);');
  });

  it('refuses NaN, Infinity and vectors that are not three numbers', () =>
  {
    list('chair');

    expect(() => commit({ name: 'chair', transform: { ...PLACED, position: [NaN, 0, 0] } })).toThrowError(/finite numbers/);
    expect(() => commit({ name: 'chair', transform: { ...PLACED, scale: [Infinity, 1, 1] } })).toThrowError(/finite numbers/);
    expect(() => commit({ name: 'chair', transform: { ...PLACED, rotation: [0, 0] } })).toThrowError(/rotation must be \[x, y, z\]/);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run --project unit tests/tasks/commit_object.test.ts`
Expected: FAIL, because `plan_commit_object` is not exported (`undefined is not a function`).

- [ ] **Step 3: Write the template `core/tasks/import_model/TemplateObject.ts`**

`tasks/` is excluded from core's tsconfig, so this file is never type-checked in core. It is checked where it is rendered.

```ts
import { ResourceContainer } from 'ohzi-core';
import { Object3D } from 'three';

export class __CLASS__ extends Object3D
{
  constructor()
  {
    super();

    this.name = '__NAME__';
    this.add(ResourceContainer.get('__NAME__').scene);

    this.position.set(__POSITION__);
    this.rotation.set(__ROTATION__);
    this.scale.set(__SCALE__);
  }
}
```

- [ ] **Step 4: Implement `core/tasks/import_model/commit_object.mjs`**

```js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Scaffolder, render_template } from '../_shared/scaffolding.mjs';
import { TIERS, manifest_path, parse_entries } from './manifest.mjs';
import { class_name, validate_object_name, validate_scene_name } from './object_names.mjs';

const TEMPLATES = path.dirname(fileURLToPath(import.meta.url));

const MARKERS = {
  imports: '// __OBJECT_IMPORTS__',
  fields: '// __OBJECT_FIELDS__',
  regular: '// __OBJECTS__',
  high: '// __HIGH_OBJECTS__'
};

const MARKER_HOMES = {
  imports: 'after the scene imports',
  fields: 'in the class field list',
  regular: 'at the end of on_assets_ready()',
  high: 'at the end of on_high_quality_assets_ready()'
};

const TRANSFORM_KEYS = ['position', 'rotation', 'scale'];

// A field on the scene must not collide with one these already declare.
const MEMBER_SOURCES = ['app/js/scenes/common/CommonScene.ts', 'core/src/scenes/AbstractScene.ts'];

function escape(text)
{
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function format_number(value)
{
  if (typeof value !== 'number' || !Number.isFinite(value))
  {
    throw new Error(`transform values must be finite numbers, got ${value}.`);
  }

  const rounded = Math.round(value * 10000) / 10000;

  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function format_vector(vector, label)
{
  if (!Array.isArray(vector) || vector.length !== 3)
  {
    throw new Error(`${label} must be [x, y, z].`);
  }

  return vector.map(format_number).join(', ');
}

function find_tier(root, scene, name)
{
  for (const tier of TIERS)
  {
    const absolute = path.resolve(root, manifest_path(scene, tier));

    if (fs.existsSync(absolute) && parse_entries(fs.readFileSync(absolute, 'utf8')).some((entry) => entry.name === name))
    {
      return tier;
    }
  }

  return null;
}

function marker_indent(text, marker)
{
  const match = new RegExp(`^([ \\t]*)${escape(marker)}`, 'm').exec(text);

  return match === null ? null : match[1];
}

function declares_member(text, name)
{
  return new RegExp(`^[ \\t]*(?:(?:private|protected|public|static|readonly|async|get|set)\\s+)*${name}\\s*[?!]?\\s*[:(=;]`, 'm').test(text);
}

function has_line(text, line)
{
  return text.split('\n').some((candidate) => candidate.trim() === line);
}

function plan_class(scaffolder, root, model_name, pascal, values)
{
  const object_file = `app/js/objects/${pascal}.ts`;
  const object_path = path.resolve(root, object_file);

  if (!fs.existsSync(object_path))
  {
    scaffolder.create(object_file, render_template(path.join(TEMPLATES, 'TemplateObject.ts'), [
      [/__CLASS__/g, pascal],
      [/__NAME__/g, model_name],
      [/__POSITION__/g, values.position],
      [/__ROTATION__/g, values.rotation],
      [/__SCALE__/g, values.scale]
    ]));

    return;
  }

  const text = fs.readFileSync(object_path, 'utf8');

  if (!text.includes(`this.name = '${model_name}';`))
  {
    throw new Error(`${object_file} already exists but wraps a different model. Pass a different name.`);
  }

  for (const key of TRANSFORM_KEYS)
  {
    const matches = [...text.matchAll(new RegExp(`^([ \\t]*)this\\.${key}\\.set\\([^)\\n]*\\);[ \\t]*$`, 'gm'))];

    if (matches.length !== 1)
    {
      throw new Error(`${object_file} has ${matches.length} "this.${key}.set(...)" lines, and commit_object rewrites exactly one. Fix the class by hand.`);
    }

    const [line, indent] = matches[0];

    scaffolder.ensure(object_file, line, `${indent}this.${key}.set(${values[key]});`, `${key} of ${pascal}`);
  }
}

function plan_scene_wiring(scaffolder, root, scene_file, scene_text, model_name, pascal, tier)
{
  const import_line = `import { ${pascal} } from '../objects/${pascal}';`;
  const field_line = `${model_name}: ${pascal};`;
  const instance_line = `this.${model_name} = new ${pascal}();`;

  if (has_line(scene_text, import_line))
  {
    scaffolder.ensure(scene_file, import_line, import_line, `import of ${pascal}`);
  }
  else
  {
    if (new RegExp(`\\b${pascal}\\b`).test(scene_text))
    {
      throw new Error(`${scene_file} already uses the identifier ${pascal}. Pass a different name.`);
    }

    const indent = marker_indent(scene_text, MARKERS.imports);

    scaffolder.patch(scene_file, MARKERS.imports, `${import_line}\n${indent}${MARKERS.imports}`, `import of ${pascal}`);
  }

  if (has_line(scene_text, field_line))
  {
    scaffolder.ensure(scene_file, field_line, field_line, `field ${model_name}`);
  }
  else
  {
    const sources = [scene_text, ...MEMBER_SOURCES
      .map((relative) => path.resolve(root, relative))
      .filter((absolute) => fs.existsSync(absolute))
      .map((absolute) => fs.readFileSync(absolute, 'utf8'))];

    if (sources.some((text) => declares_member(text, model_name)))
    {
      throw new Error(`the scene already has a member called ${model_name}. Pass a different name.`);
    }

    const indent = marker_indent(scene_text, MARKERS.fields);

    scaffolder.patch(scene_file, MARKERS.fields, `${field_line}\n${indent}${MARKERS.fields}`, `field ${model_name}`);
  }

  if (has_line(scene_text, instance_line))
  {
    scaffolder.ensure(scene_file, instance_line, instance_line, `instance of ${pascal}`);
  }
  else
  {
    const indent = marker_indent(scene_text, MARKERS[tier]);

    scaffolder.patch(
      scene_file,
      MARKERS[tier],
      `${instance_line}\n${indent}this.add(this.${model_name});\n\n${indent}${MARKERS[tier]}`,
      `instance of ${pascal}`
    );
  }
}

/**
 * Plans saving a model's placement as code: a wrapper class that holds the
 * transform, and the scene wiring that creates it once its assets are ready.
 * A repeat commit rewrites only the three transform lines of the class.
 */
function plan_commit_object({ name, scene = 'home', transform }, { root, dry_run = false })
{
  const scene_name = validate_scene_name(scene);
  const model_name = validate_object_name(name);
  const pascal = class_name(model_name);
  const tier = find_tier(root, scene_name, model_name);

  if (tier === null)
  {
    throw new Error(`"${model_name}" is not in the object manifests of app/data/assets/${scene_name}. Import it first with import_model.`);
  }

  const values = {
    position: format_vector(transform?.position, 'position'),
    rotation: format_vector(transform?.rotation, 'rotation'),
    scale: format_vector(transform?.scale, 'scale')
  };

  const scene_file = `app/js/scenes/${class_name(scene_name)}Scene.ts`;
  const scene_path = path.resolve(root, scene_file);

  if (!fs.existsSync(scene_path))
  {
    throw new Error(`no scene file at ${scene_file}.`);
  }

  const scene_text = fs.readFileSync(scene_path, 'utf8');
  const missing = ['imports', 'fields', tier].filter((key) => marker_indent(scene_text, MARKERS[key]) === null);

  if (missing.length > 0)
  {
    const list = missing.map((key) => `${MARKERS[key]} (${MARKER_HOMES[key]})`).join(', ');

    throw new Error(`${scene_file} is missing ${list}. Add the marker comment there and commit again.`);
  }

  const scaffolder = new Scaffolder({ root, dry_run });

  plan_class(scaffolder, root, model_name, pascal, values);
  plan_scene_wiring(scaffolder, root, scene_file, scene_text, model_name, pascal, tier);

  return scaffolder;
}

export { plan_commit_object };
```

At the end of `import_model.mjs`, add:

```js
export { plan_commit_object } from './commit_object.mjs';
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run --project unit tests/tasks/commit_object.test.ts`
Expected: PASS. In "keeps insertion order across models", the fixture manifest gets an entry with a leading comma. That is only test scaffolding, because `parse_entries` matches each brace block on its own.

- [ ] **Step 6: Commit**

```bash
git add tasks/import_model/commit_object.mjs tasks/import_model/TemplateObject.ts tasks/import_model/import_model.mjs tests/tasks/commit_object.test.ts
git commit -m "feat(tasks): add plan_commit_object and object template"
```

### Task 7: yarn import-model CLI

**Files:**
- Modify: `core/tasks/import_model/import_model.mjs` (add `main`)
- Modify: `core/package.json` (`scripts`)
- Test: `core/tests/tasks/import_model_cli.test.ts`

**Interfaces:**
- Consumes: Task 5 `plan_import_model`; `print_report`.
- Produces: `main(argv: string[], { cwd = process.cwd(), env = process.env } = {}) → number`, the exit code. The project root is `path.resolve(cwd, '..')`, because the script runs from `core/`, like the other scaffolders. A relative source resolves against `env.INIT_CWD ?? cwd`. Yarn sets `INIT_CWD` to the directory the user ran `yarn` from.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
// @ts-expect-error plain .mjs scaffolder script
import { main } from '../../tasks/import_model/import_model.mjs';
import { exists, make_project, read } from '../helpers/fixture_project';
import { make_glb } from '../helpers/glb';

let root: string;

beforeEach(() =>
{
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ohzi-cli-'));
  make_project(root);
  fs.mkdirSync(path.join(root, 'core'));
  fs.mkdirSync(path.join(root, 'downloads'));
  fs.writeFileSync(path.join(root, 'downloads/chair.glb'), make_glb({ asset: { version: '2.0' } }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() =>
{
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

const core_dir = () => path.join(root, 'core');

describe('import-model CLI', () =>
{
  it('resolves a relative source against INIT_CWD, not core/', () =>
  {
    const code = main(['node', 'import_model.mjs', 'downloads/chair.glb'], { cwd: core_dir(), env: { INIT_CWD: root } });

    expect(code).toBe(0);
    expect(exists(root, 'public/models/chair.glb')).toBe(true);
  });

  it('passes --name, --tier and --scene through', () =>
  {
    main(['node', 'import_model.mjs', 'downloads/chair.glb', '--name', 'stool', '--tier', 'high', '--scene', 'home'], { cwd: core_dir(), env: { INIT_CWD: root } });

    expect(read(root, 'app/data/assets/home/high/home_high_objects.js')).toContain(`name: 'stool'`);
  });

  it('dry run writes nothing', () =>
  {
    main(['node', 'import_model.mjs', 'downloads/chair.glb', '--dry-run'], { cwd: core_dir(), env: { INIT_CWD: root } });

    expect(exists(root, 'public/models/chair.glb')).toBe(false);
  });

  it('exits 1 with usage when no source is given', () =>
  {
    expect(main(['node', 'import_model.mjs'], { cwd: core_dir(), env: {} })).toBe(1);
  });

  it('exits 1 on a refusal', () =>
  {
    expect(main(['node', 'import_model.mjs', 'downloads/missing.glb'], { cwd: core_dir(), env: { INIT_CWD: root } })).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run --project unit tests/tasks/import_model_cli.test.ts`
Expected: FAIL, because `main` is not exported.

- [ ] **Step 3: Implement**

In `import_model.mjs`, add `import { pathToFileURL } from 'url';`, extend the scaffolding import to `import { Scaffolder, print_report } from '../_shared/scaffolding.mjs';`, and add:

```js
const VALUE_FLAGS = ['--scene', '--name', '--tier'];
const USAGE = 'usage: yarn import-model <file.glb> [--scene home] [--name chair] [--tier regular|high] [--replace] [--dry-run]';

function main(argv, { cwd = process.cwd(), env = process.env } = {})
{
  const args = argv.slice(2);
  const option = (flag) =>
  {
    const index = args.indexOf(flag);

    return index === -1 ? undefined : args[index + 1];
  };
  const source = args.find((arg, index) => !arg.startsWith('--') && !VALUE_FLAGS.includes(args[index - 1]));

  if (source === undefined)
  {
    console.error(USAGE);

    return 1;
  }

  // yarn runs this from core/, but the user typed the path relative to where
  // they ran yarn, which yarn records in INIT_CWD.
  const base = env.INIT_CWD ?? cwd;
  const root = path.resolve(cwd, '..');

  try
  {
    const { scaffolder, model, unchanged } = plan_import_model({
      source: path.resolve(base, source),
      scene: option('--scene'),
      name: option('--name'),
      tier: option('--tier'),
      replace: args.includes('--replace')
    }, { root, dry_run: args.includes('--dry-run') });

    if (unchanged)
    {
      console.log(`${model.name} is already imported with identical bytes. Nothing to do.`);

      return 0;
    }

    return print_report(scaffolder.run(), `import-model ${model.name}`);
  }
  catch (error)
  {
    console.error(`\x1b[31m${error.message}\x1b[0m`);

    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
{
  process.exit(main(process.argv));
}
```

Change the export line to `export { main, plan_import_model };`. Keep the `plan_commit_object` re-export.

`scene` and `tier` pass `undefined` when the flag is absent, so the defaults of `plan_import_model` (`'home'`, `'regular'`) apply.

In `core/package.json` `scripts`, after `"create-scene"`, add:

```json
    "import-model": "node ./tasks/import_model/import_model.mjs",
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run --project unit tests/tasks`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tasks/import_model/import_model.mjs package.json tests/tasks/import_model_cli.test.ts
git commit -m "feat(tasks): add import-model CLI"
```

### Task 8: Object markers in the scene template

**Files:**
- Modify: `core/tasks/create_scene/TemplateScene.ts`
- Test: `core/tests/tasks/create_scene.test.ts` (add cases)

**Interfaces:**
- Consumes: Task 6 `plan_commit_object`, which is used as an integration check against a freshly scaffolded scene.

- [ ] **Step 1: Write the failing tests** (append inside `describe('create_scene', ...)`)

Add this import at the top of the file:

```ts
// @ts-expect-error plain .mjs scaffolder script
import { plan_commit_object } from '../../tasks/import_model/import_model.mjs';
```

```ts
  it('puts the four object markers in the new scene', () =>
  {
    plan_scene('gallery', { root }).run();

    const scene = read('app/js/scenes/GalleryScene.ts');

    for (const marker of ['// __OBJECT_IMPORTS__', '// __OBJECT_FIELDS__', '// __OBJECTS__', '// __HIGH_OBJECTS__'])
    {
      expect(scene, marker).toContain(marker);
    }
  });

  it('lets commit_object wire a model into a freshly created scene', () =>
  {
    plan_scene('gallery', { root }).run();
    fs.writeFileSync(path.join(root, 'app/data/assets/gallery/gallery_objects.js'), `export const gallery_objects = [\n  {\n    name: 'chair',\n    url: '/models/chair.glb',\n    size: 1,\n    draco: false\n  }\n];\n`);

    const report = plan_commit_object(
      { name: 'chair', scene: 'gallery', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { root }
    ).run();

    expect(report.errors).toEqual([]);
    expect(read('app/js/scenes/GalleryScene.ts')).toContain('this.chair = new Chair();');
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --project unit tests/tasks/create_scene.test.ts`
Expected: FAIL. The markers are missing, and the commit refuses with "is missing // __OBJECT_IMPORTS__ ...".

- [ ] **Step 3: Add the markers to `TemplateScene.ts`**

- After `import { Input } from '../components/Input';` add the line `// __OBJECT_IMPORTS__`.
- After `  camera_controller: CameraController;` add `  // __OBJECT_FIELDS__`.
- Replace the body of `on_assets_ready()` and `on_high_quality_assets_ready()` with:

```ts
  on_assets_ready()
  {
    this.set_high_assets(template_high_objects, template_high_textures, template_high_sounds);

    super.on_assets_ready();

    // __OBJECTS__
  }

  on_high_quality_assets_ready()
  {
    super.on_high_quality_assets_ready();

    // __HIGH_OBJECTS__
  }
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run --project unit tests/tasks`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tasks/create_scene/TemplateScene.ts tests/tasks/create_scene.test.ts
git commit -m "feat(tasks): add object markers to the scene template"
```

### Task 9: ResourceContainer.replace_resource

**Files:**
- Modify: `core/src/ResourceContainer.ts`. This is the singleton that `ohzi-core` exports, not `src/loaders/assets_loader/ResourceContainer.ts`.
- Test: `core/tests/ResourceContainer.test.ts`

**Interfaces:**
- Produces: `ResourceContainer.replace_resource(name: string, url: string, resource: any): void`. It overwrites both the by-name and the by-URL entry. `set_resource` is unchanged: it keeps the first resource stored for a URL.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { ResourceContainer } from '../src/ResourceContainer';

describe('ResourceContainer.replace_resource', () =>
{
  beforeEach(() => { ResourceContainer.init(); });

  it('overwrites a resource already stored under the same url', () =>
  {
    const old_model = { id: 'old' };
    const new_model = { id: 'new' };

    ResourceContainer.set_resource('chair', '/models/chair.glb', old_model);
    ResourceContainer.replace_resource('chair', '/models/chair.glb', new_model);

    expect(ResourceContainer.get('chair')).toBe(new_model);
    expect(ResourceContainer.resources_by_url['/models/chair.glb']).toBe(new_model);
  });

  it('leaves set_resource deduplicating by url, now to the replacement', () =>
  {
    const new_model = { id: 'new' };

    ResourceContainer.set_resource('chair', '/models/chair.glb', { id: 'old' });
    ResourceContainer.replace_resource('chair', '/models/chair.glb', new_model);
    ResourceContainer.set_resource('stool', '/models/chair.glb', { id: 'ignored' });

    expect(ResourceContainer.get('stool')).toBe(new_model);
  });

  it('stores a resource that was never there', () =>
  {
    const model = { id: 'm' };

    ResourceContainer.replace_resource('tree', '/models/tree.glb', model);

    expect(ResourceContainer.get('tree')).toBe(model);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run --project unit tests/ResourceContainer.test.ts`
Expected: FAIL, because `replace_resource is not a function`.

- [ ] **Step 3: Implement** (after `set_resource`)

```ts
  // set_resource keeps the first resource stored for a url. A model loaded
  // again from the same url after its file changed needs to win instead.
  replace_resource(name: string, url: string, resource: any)
  {
    this.resources[name] = resource;
    this.resources_by_url[url] = resource;
  }
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run --project unit tests/ResourceContainer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ResourceContainer.ts tests/ResourceContainer.test.ts
git commit -m "feat(resources): add ResourceContainer.replace_resource"
```

### Task 10: ModelLoader (unit)

**Files:**
- Create: `core/src/dev_bridge/ModelLoader.ts`
- Modify: `core/src/index.ts` (import and export)
- Test: `core/tests/dev_bridge/ModelLoader.test.ts`

**Interfaces:**
- Consumes: Task 9 `replace_resource`, through the `ResourceStore` interface.
- Produces:
  - `new ModelLoader(load_gltf: LoadGltf, resources: ResourceStore)`.
  - `load(scene: Object3D, args: Record<string, unknown>): Promise<{ name: string; meshes: number; triangles: number; bounding_box: { min: number[]; max: number[] } | null }>`.
  - Types: `LoadGltf = (url: string, draco: boolean) => Promise<{ scene: Object3D }>` and `ResourceStore = { replace_resource(name: string, url: string, resource: unknown): void }`.
  - Error codes on the thrown `Error`'s `code`: `bad_request`, `not_found`, `load_failed`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Scene } from 'three';
import { ModelLoader } from '../../src/dev_bridge/ModelLoader';

function box_model()
{
  const root = new Group();
  root.add(new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial()));

  return { scene: root };
}

function harness(gltf: unknown = box_model())
{
  const urls: string[] = [];
  const stored: Array<{ name: string; url: string; resource: unknown }> = [];
  const loader = new ModelLoader(
    async(url, draco) =>
    {
      urls.push(`${url}|${draco}`);
      if (gltf instanceof Error) { throw gltf; }
      return gltf as { scene: Group };
    },
    { replace_resource: (name, url, resource) => { stored.push({ name, url, resource }); } }
  );

  return { loader, urls, stored, scene: new Scene() };
}

describe('ModelLoader', () =>
{
  it('loads, registers, names and adds the model, and summarizes it', async() =>
  {
    const gltf = box_model();
    const { loader, stored, scene } = harness(gltf);

    const summary = await loader.load(scene, { name: 'chair', url: '/models/chair.glb' });

    expect(stored).toEqual([{ name: 'chair', url: '/models/chair.glb', resource: gltf }]);
    expect(gltf.scene.name).toBe('chair');
    expect(scene.children).toContain(gltf.scene);
    expect(summary).toEqual({ name: 'chair', meshes: 1, triangles: 12, bounding_box: { min: [-1, -1, -1], max: [1, 1, 1] } });
  });

  it('adds the version to the fetched url and passes draco through', async() =>
  {
    const { loader, urls, stored, scene } = harness();

    await loader.load(scene, { name: 'chair', url: '/models/chair.glb', draco: true, version: 'abc123' });

    expect(urls).toEqual(['/models/chair.glb?v=abc123|true']);
    expect(stored[0].url).toBe('/models/chair.glb');
  });

  it('replaces a direct child of the same name and disposes of it', async() =>
  {
    const { loader, scene } = harness();
    const old_mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    old_mesh.name = 'chair';
    scene.add(old_mesh);
    let disposed = 0;
    old_mesh.geometry.addEventListener('dispose', () => { disposed++; });
    (old_mesh.material as MeshBasicMaterial).addEventListener('dispose', () => { disposed++; });

    await loader.load(scene, { name: 'chair', url: '/models/chair.glb' });

    expect(scene.children.filter((child) => child.name === 'chair')).toHaveLength(1);
    expect(scene.children).not.toContain(old_mesh);
    expect(disposed).toBe(2);
  });

  it('reports load_failed with the url when the load throws', async() =>
  {
    const { loader, scene } = harness(new Error('HTTP 404'));

    await expect(loader.load(scene, { name: 'chair', url: '/models/chair.glb' })).rejects.toMatchObject({ code: 'load_failed', message: expect.stringContaining('/models/chair.glb: HTTP 404') });
  });

  it('reports load_failed for a result without a scene', async() =>
  {
    const { loader, scene } = harness({});

    await expect(loader.load(scene, { name: 'chair', url: '/models/chair.glb' })).rejects.toMatchObject({ code: 'load_failed' });
  });

  it('rejects a request without a name or url, or without a scene', async() =>
  {
    const { loader, scene } = harness();

    await expect(loader.load(scene, { url: '/x.glb' })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(loader.load(scene, { name: 'x' })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(loader.load(undefined as never, { name: 'x', url: '/x.glb' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('reports an empty model with null bounds', async() =>
  {
    const { loader, scene } = harness({ scene: new Group() });

    expect(await loader.load(scene, { name: 'empty', url: '/e.glb' })).toEqual({ name: 'empty', meshes: 0, triangles: 0, bounding_box: null });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run --project unit tests/dev_bridge/ModelLoader.test.ts`
Expected: FAIL, because the module cannot be found.

- [ ] **Step 3: Implement `core/src/dev_bridge/ModelLoader.ts`**

```ts
import type { BufferGeometry, Material, Object3D } from 'three';
import { Box3 } from 'three';

const PRECISION = 10000;

export type GltfLike = { scene: Object3D };
export type LoadGltf = (url: string, draco: boolean) => Promise<GltfLike>;

export interface ResourceStore
{
  replace_resource(name: string, url: string, resource: unknown): void;
}

export interface ModelSummary
{
  name: string;
  meshes: number;
  triangles: number;
  bounding_box: { min: number[]; max: number[] } | null;
}

type Drawable = Object3D & { isMesh?: boolean; geometry?: BufferGeometry; material?: Material | Material[] };

/**
 * Loads a GLB into the running scene for the import_model preview. A model of
 * the same name is swapped out, so importing a re-exported file again replaces
 * it in place.
 */
class ModelLoader
{
  private load_gltf: LoadGltf;
  private resources: ResourceStore;

  constructor(load_gltf: LoadGltf, resources: ResourceStore)
  {
    this.load_gltf = load_gltf;
    this.resources = resources;
  }

  async load(scene: Object3D, args: Record<string, unknown>): Promise<ModelSummary>
  {
    const name = args.name;
    const url = args.url;

    if (typeof name !== 'string' || name.length === 0)
    {
      throw this.error('bad_request', 'load_object needs a name.');
    }

    if (typeof url !== 'string' || url.length === 0)
    {
      throw this.error('bad_request', 'load_object needs a url.');
    }

    if (scene === undefined || scene === null)
    {
      throw this.error('not_found', 'There is no current scene to add the model to.');
    }

    // The version is a hash of the file. The same url serves new bytes after a
    // replace, and without it the browser would answer from its cache.
    const version = typeof args.version === 'string' && args.version.length > 0 ? args.version : null;
    const fetch_url = version === null ? url : `${url}?v=${encodeURIComponent(version)}`;

    let gltf: GltfLike;

    try
    {
      gltf = await this.load_gltf(fetch_url, args.draco === true);
    }
    catch (error)
    {
      throw this.error('load_failed', `Could not load ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (gltf === null || typeof gltf !== 'object' || gltf.scene === undefined || gltf.scene === null)
    {
      throw this.error('load_failed', `${url} loaded, but it has no scene.`);
    }

    this.resources.replace_resource(name, url, gltf);

    const previous = scene.children.find((child) => child.name === name);

    if (previous !== undefined)
    {
      scene.remove(previous);
      this.dispose(previous);
    }

    gltf.scene.name = name;
    scene.add(gltf.scene);

    return this.summarize(name, gltf.scene);
  }

  private summarize(name: string, root: Object3D): ModelSummary
  {
    let meshes = 0;
    let triangles = 0;

    root.traverse((node) =>
    {
      const drawable = node as Drawable;

      if (drawable.isMesh !== true || drawable.geometry === undefined)
      {
        return;
      }

      const geometry = drawable.geometry;
      const count = geometry.index !== null ? geometry.index.count : (geometry.attributes.position?.count ?? 0);

      meshes++;
      triangles += Math.floor(count / 3);
    });

    root.updateMatrixWorld(true);

    const box = new Box3().setFromObject(root);
    const round = (value: number) => Math.round(value * PRECISION) / PRECISION;

    return {
      name,
      meshes,
      triangles,
      bounding_box: box.isEmpty() ? null : { min: box.min.toArray().map(round), max: box.max.toArray().map(round) }
    };
  }

  private dispose(root: Object3D)
  {
    root.traverse((node) =>
    {
      const drawable = node as Drawable;

      drawable.geometry?.dispose();

      const materials = Array.isArray(drawable.material)
        ? drawable.material
        : drawable.material === undefined ? [] : [drawable.material];

      for (const material of materials)
      {
        material.dispose();
      }
    });
  }

  private error(code: string, message: string): Error
  {
    const error: Error & { code?: string } = new Error(message);
    error.code = code;

    return error;
  }
}

export { ModelLoader };
```

In `core/src/index.ts`:
- Add `import { ModelLoader } from './dev_bridge/ModelLoader';` after the `InputSynthesizer` import (line ~23).
- Add `ModelLoader, ` to the big `export { ... }` block, right after `MeshSampler, `.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run --project unit tests/dev_bridge/ModelLoader.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dev_bridge/ModelLoader.ts src/index.ts tests/dev_bridge/ModelLoader.test.ts
git commit -m "feat(dev-bridge): add ModelLoader and load_failed"
```

### Task 11: ModelLoader on the GPU

**Files:**
- Test: `core/tests/dev_bridge/ModelLoader.browser.test.ts`

**Interfaces:**
- Consumes: Task 10 `ModelLoader`; Task 9 `ResourceContainer.replace_resource`; `create_harness` and `BACKENDS` from `tests/helpers/webgpu_harness`.

This task adds a test only, with no production change. The test passes as soon as it is written if Task 10 is correct. That is fine, because its job is to prove a real GLB goes through three's loader and renders on both backends. If it fails, debug Task 10's code; do not weaken the test.

- [ ] **Step 1: Write the test**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { CameraManager } from '../../src/CameraManager';
import { ModelLoader } from '../../src/dev_bridge/ModelLoader';
import { Graphics } from '../../src/Graphics';
import { ResourceContainer } from '../../src/ResourceContainer';
import { SceneManager } from '../../src/SceneManager';
import { AbstractScene } from '../../src/scenes/AbstractScene';
import { BACKENDS, create_harness, type Harness, SIZE } from '../helpers/webgpu_harness';

// A real GLB made in memory: a red unlit plane, big enough to fill the view.
async function red_plane_url(): Promise<string>
{
  const plane = new Mesh(new PlaneGeometry(100, 100), new MeshBasicMaterial({ color: 0xff0000, side: DoubleSide }));
  const glb = await new GLTFExporter().parseAsync(plane, { binary: true }) as ArrayBuffer;

  return URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
}

for (const backend of BACKENDS)
{
  describe(`ModelLoader on WebGPURenderer (${backend.name} backend)`, () =>
  {
    let harness: Harness;
    let loader: ModelLoader;

    beforeEach(async() =>
    {
      harness = await create_harness(backend);
      SceneManager.current = new AbstractScene({ name: 'model_loader_test', compilators: {} });
      ResourceContainer.init();
      loader = new ModelLoader((url) => new GLTFLoader().loadAsync(url), ResourceContainer);
    });

    afterEach(() =>
    {
      harness.dispose();
    });

    it('loads a real GLB, registers it and renders it', async() =>
    {
      // No version: a blob: url cannot take a query string.
      const summary = await loader.load(SceneManager.current, { name: 'plane', url: await red_plane_url() });

      expect(summary).toMatchObject({ name: 'plane', meshes: 1, triangles: 2 });
      expect(ResourceContainer.get('plane').scene.name).toBe('plane');

      CameraManager.current.clear_color.set(0xffffff);
      Graphics.clear(undefined, CameraManager.current, true, false);
      Graphics.render(SceneManager.current, CameraManager.current);

      const center = harness.read_canvas().rgb({ x: SIZE / 2, y: SIZE / 2 });

      expect(center.r).toBeGreaterThan(250);
      expect(center.g).toBeLessThan(5);
      expect(center.b).toBeLessThan(5);
      expect(harness.reported_errors).toEqual([]);
    });

    it('reports load_failed for bytes that are not a GLB', async() =>
    {
      const url = URL.createObjectURL(new Blob(['not a model']));

      await expect(loader.load(SceneManager.current, { name: 'broken', url })).rejects.toMatchObject({ code: 'load_failed' });
    });
  });
}
```

- [ ] **Step 2: Run the test and confirm it passes**

Run: `npx vitest run --project browser tests/dev_bridge/ModelLoader.browser.test.ts`
Expected: PASS on both backends. If the center pixel is white, read `create_harness` to see where its camera points. `DebugDrawer.browser.test.ts` shows a 16-unit cube at the origin filling the center, so a plane at the origin facing +Z must be visible. `DoubleSide` covers a camera behind it.

- [ ] **Step 3: Run the whole core suite**

Run: `yarn test`
Expected: PASS for unit and browser.

- [ ] **Step 4: Commit**

```bash
git add tests/dev_bridge/ModelLoader.browser.test.ts
git commit -m "test(dev-bridge): load and render a real GLB with ModelLoader"
```

---

## Part B: mcp (branch `feat/import-model`, already checked out)

Run tests from `mcp/` with `npx vitest run <file>`, and the whole suite with `yarn test`.

### Task 12: Load core tasks from the project

**Files:**
- Create: `mcp/src/knowledge/core_tasks.ts`
- Test: `mcp/tests/knowledge/core_tasks.test.ts`

**Interfaces:**
- Produces: `load_core_tasks(root: string): Promise<CoreTasks>`, `CORE_TASKS_ENTRY`, and these types, which later tasks import:

```ts
export type Tier = 'regular' | 'high';

export interface ScaffoldReport
{
  dry_run: boolean;
  applied: boolean;
  errors: string[];
  created: string[];
  overwritten: string[];
  patched: Array<{ file: string; label: string }>;
  skipped: Array<{ file: string; label: string; reason: string }>;
}

export interface Plan { run(): ScaffoldReport }

export interface ImportedModel { name: string; url: string; draco: boolean; version: string; size: number; tier: Tier }

export interface Transform { position: number[]; rotation: number[]; scale: number[] }

export interface PlanOptions { root: string; dry_run?: boolean }

export interface CoreTasks
{
  plan_import_model(
    args: { source: string; scene?: string; name?: string; tier?: Tier; replace?: boolean },
    options: PlanOptions
  ): { scaffolder: Plan; model: ImportedModel; unchanged: boolean };
  plan_commit_object(args: { name: string; scene?: string; transform: Transform }, options: PlanOptions): Plan;
}
```

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CORE_TASKS_ENTRY, load_core_tasks } from '../../src/knowledge/core_tasks.js';

let root: string;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ohzi-core-tasks-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function entry(source: string)
{
  const target = join(root, CORE_TASKS_ENTRY);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
}

describe('load_core_tasks', () =>
{
  it('loads the planners from the project', async() =>
  {
    entry('export function plan_import_model() { return \'import\'; }\nexport function plan_commit_object() { return \'commit\'; }\n');

    const tasks = await load_core_tasks(root);

    expect((tasks.plan_import_model as unknown as () => string)()).toBe('import');
    expect((tasks.plan_commit_object as unknown as () => string)()).toBe('commit');
  });

  it('explains a project without the core scaffolders', async() =>
  {
    await expect(load_core_tasks(root)).rejects.toThrowError(/No OHZI scaffolders at .*core\/tasks\/import_model\/import_model\.mjs/);
  });

  it('explains a core that is too old to export the planners', async() =>
  {
    entry('export function plan_import_model() {}\n');

    await expect(load_core_tasks(root)).rejects.toThrowError(/Update the core submodule/);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/knowledge/core_tasks.test.ts`
Expected: FAIL, because the module cannot be found.

- [ ] **Step 3: Implement `mcp/src/knowledge/core_tasks.ts`**

Put the type block from **Interfaces** at the top, then:

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The scaffolders are not published to npm with core, so they are read from the
// consuming project's own core checkout, the same way load_types reads its
// types: the project's copy is the truth for the version it pins.
export const CORE_TASKS_ENTRY = 'core/tasks/import_model/import_model.mjs';

export async function load_core_tasks(root: string): Promise<CoreTasks>
{
  const entry = join(root, CORE_TASKS_ENTRY);

  if (!existsSync(entry))
  {
    throw new Error(`No OHZI scaffolders at ${entry}. import_model and commit_object need the core submodule checked out with tasks/import_model.`);
  }

  const module = await import(/* @vite-ignore */ pathToFileURL(entry).href) as Partial<CoreTasks>;

  if (typeof module.plan_import_model !== 'function' || typeof module.plan_commit_object !== 'function')
  {
    throw new Error(`${entry} does not export plan_import_model and plan_commit_object. Update the core submodule.`);
  }

  return module as CoreTasks;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/knowledge/core_tasks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/knowledge/core_tasks.ts tests/knowledge/core_tasks.test.ts
git commit -m "feat(knowledge): load core tasks from the project at runtime"
```

### Task 13: import_model tool

**Files:**
- Create: `mcp/src/tools/import.ts`
- Modify: `mcp/src/protocol.ts` (add `| 'load_failed'` to `BridgeErrorCode`)
- Modify: `mcp/src/config.ts` (`export const LOAD_TIMEOUT_MS = 30000;`)
- Test: `mcp/tests/tools/import.test.ts`

**Interfaces:**
- Consumes: Task 12 types; `ToolHost`, `ToolResult`, `ImageBlock`, `TextBlock`, `attach_capture`, `describe_error`, `failure` and `triple` from `./shared.js`.
- Produces:
  - `resolve_source(source: string, root: string, home?: string): string`.
  - `describe_report(report: ScaffoldReport): string[]`.
  - `build_import_model_result(host: ToolHost, load_tasks: () => Promise<CoreTasks>, root: string, args: ImportModelToolArgs): Promise<ToolResult>`.
  - `ImportModelToolArgs = { source: string; scene?: string; name?: string; tier?: Tier; replace?: boolean; dry_run?: boolean }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { BridgeError } from '../../src/bridge/BridgeError.js';
import type { CoreTasks, ScaffoldReport } from '../../src/knowledge/core_tasks.js';
import { build_import_model_result, describe_report, resolve_source } from '../../src/tools/import.js';

interface Call { cmd: string; args?: Record<string, unknown>; timeout_ms?: number }

function host(results: Record<string, unknown>, calls: Call[] = [], connected = true)
{
  return {
    connected,
    send: async(cmd: string, args?: Record<string, unknown>, timeout_ms?: number) =>
    {
      calls.push(timeout_ms === undefined ? { cmd, args } : { cmd, args, timeout_ms });
      const result = results[cmd];
      if (result instanceof Error) { throw result; }
      return result;
    }
  };
}

function text_of(result: { content: Array<{ type: string; text?: string }> }): string
{
  return result.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
}

function report(overrides: Partial<ScaffoldReport> = {}): ScaffoldReport
{
  return { dry_run: false, applied: true, errors: [], created: [], overwritten: [], patched: [], skipped: [], ...overrides };
}

const MODEL = { name: 'chair', url: '/models/chair.glb', draco: false, version: 'abc123def456', size: 2048, tier: 'regular' as const };
const LOADED = { name: 'chair', meshes: 3, triangles: 1204, bounding_box: { min: [-1, 0, -1], max: [1, 2, 1] } };
const shot = { mode: 'fast', mime_type: 'image/png', width: 8, height: 8, bytes: 3, data: 'AAA=' };

function tasks(planned: { report?: ScaffoldReport; unchanged?: boolean; error?: Error } = {}, seen: unknown[] = [])
{
  return async() => ({
    plan_import_model: (args: unknown, options: unknown) =>
    {
      seen.push({ args, options });
      if (planned.error !== undefined) { throw planned.error; }
      return { scaffolder: { run: () => planned.report ?? report({ created: ['public/models/chair.glb'], patched: [{ file: 'app/data/assets/home/home_objects.js', label: 'manifest entry for chair' }] }) }, model: MODEL, unchanged: planned.unchanged ?? false };
    },
    plan_commit_object: () => { throw new Error('not used'); }
  }) as unknown as CoreTasks;
}

describe('resolve_source', () =>
{
  it('expands ~ and resolves relative paths against the project root', () =>
  {
    expect(resolve_source('~/Downloads/chair.glb', '/project', '/Users/me')).toBe('/Users/me/Downloads/chair.glb');
    expect(resolve_source('assets/chair.glb', '/project', '/Users/me')).toBe('/project/assets/chair.glb');
    expect(resolve_source('/abs/chair.glb', '/project', '/Users/me')).toBe('/abs/chair.glb');
  });
});

describe('describe_report', () =>
{
  it('lists every change, in the future tense for a dry run', () =>
  {
    const r = report({ created: ['a'], overwritten: ['b'], patched: [{ file: 'c', label: 'L' }], skipped: [{ file: 'd', label: 'M', reason: 'already in place' }] });

    expect(describe_report(r)).toEqual(['created a', 'overwrote b', 'patched c (L)', 'unchanged d (M: already in place)']);
    expect(describe_report({ ...r, dry_run: true })[0]).toBe('would create a');
  });
});

describe('import_model', () =>
{
  it('plans with the resolved source, writes, loads with the long timeout and attaches a capture', async() =>
  {
    const calls: Call[] = [];
    const seen: unknown[] = [];

    const result = await build_import_model_result(host({ load_object: LOADED, capture_viewport: shot }, calls), tasks({}, seen), '/project', { source: 'models/chair.glb' });

    expect(seen).toEqual([{ args: { source: '/project/models/chair.glb', scene: undefined, name: undefined, tier: undefined, replace: undefined }, options: { root: '/project', dry_run: false } }]);
    expect(calls[0]).toEqual({ cmd: 'load_object', args: { name: 'chair', url: '/models/chair.glb', draco: false, version: 'abc123def456' }, timeout_ms: 30000 });
    expect(result.content[0]).toEqual({ type: 'image', data: 'AAA=', mimeType: 'image/png' });
    expect(text_of(result)).toContain('created public/models/chair.glb');
    expect(text_of(result)).toContain('loaded chair: 3 meshes, 1204 triangles');
    expect(text_of(result)).toContain(`commit_object { name: 'chair', scene: 'home' }`);
    expect(result.isError).toBeUndefined();
  });

  it('reports a refusal from the planner as an error, with nothing loaded', async() =>
  {
    const calls: Call[] = [];

    const result = await build_import_model_result(host({}, calls), tasks({ error: new Error('no file at /x.glb') }), '/project', { source: '/x.glb' });

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('Import refused: no file at /x.glb');
    expect(calls).toEqual([]);
  });

  it('reports scaffolder errors as an error', async() =>
  {
    const result = await build_import_model_result(host({}), tasks({ report: report({ applied: false, errors: ['already exists: x'] }) }), '/project', { source: '/x.glb' });

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('- already exists: x');
  });

  it('dry run plans but neither writes nor loads', async() =>
  {
    const calls: Call[] = [];

    const result = await build_import_model_result(host({}, calls), tasks({ report: report({ dry_run: true, applied: false, created: ['public/models/chair.glb'] }) }), '/project', { source: '/x.glb', dry_run: true });

    expect(text_of(result)).toContain('would create public/models/chair.glb');
    expect(text_of(result)).toContain('dry run');
    expect(calls).toEqual([]);
  });

  it('still loads an unchanged model, for a fresh preview', async() =>
  {
    const calls: Call[] = [];

    const result = await build_import_model_result(host({ load_object: LOADED, capture_viewport: shot }, calls), tasks({ unchanged: true }), '/project', { source: '/x.glb' });

    expect(text_of(result)).toContain('already imported');
    expect(calls[0].cmd).toBe('load_object');
  });

  it('keeps the writes and says so when the app is not connected', async() =>
  {
    const result = await build_import_model_result(host({}, [], false), tasks(), '/project', { source: '/x.glb' });

    expect(result.isError).toBeUndefined();
    expect(text_of(result)).toContain('created public/models/chair.glb');
    expect(text_of(result)).toContain('preview skipped');
  });

  it('keeps the writes and reports a failed preview', async() =>
  {
    const result = await build_import_model_result(host({ load_object: new BridgeError('load_failed', 'Could not load /models/chair.glb: HTTP 404') }), tasks(), '/project', { source: '/x.glb' });

    expect(text_of(result)).toContain('created public/models/chair.glb');
    expect(text_of(result)).toContain('preview failed (load_failed): Could not load /models/chair.glb: HTTP 404');
  });

  it('explains a project without the core scaffolders', async() =>
  {
    const result = await build_import_model_result(host({}), async() => { throw new Error('No OHZI scaffolders at /project/core'); }, '/project', { source: '/x.glb' });

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('No OHZI scaffolders');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/tools/import.test.ts`
Expected: FAIL, because the module cannot be found.

- [ ] **Step 3: Implement**

`mcp/src/config.ts`, after `CAPTURE_TIMEOUT_MS`:

```ts
// A GLB of tens of megabytes takes a while to fetch and parse.
export const LOAD_TIMEOUT_MS = 30000;
```

`mcp/src/protocol.ts`: add `| 'load_failed'` as the last member of `BridgeErrorCode`.

`mcp/src/tools/import.ts`:

```ts
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { LOAD_TIMEOUT_MS } from '../config.js';
import type { CoreTasks, ScaffoldReport, Tier } from '../knowledge/core_tasks.js';
import type { ImageBlock, TextBlock, ToolHost, ToolResult } from './shared.js';
import { attach_capture, describe_error, failure, triple } from './shared.js';

export interface ImportModelToolArgs
{
  source: string;
  scene?: string;
  name?: string;
  tier?: Tier;
  replace?: boolean;
  dry_run?: boolean;
}

export function resolve_source(source: string, root: string, home: string = homedir()): string
{
  if (source === '~')
  {
    return home;
  }

  if (source.startsWith('~/'))
  {
    return join(home, source.slice(2));
  }

  return isAbsolute(source) ? source : resolve(root, source);
}

export function describe_report(report: ScaffoldReport): string[]
{
  const verb = (done: string, planned: string) => (report.dry_run ? planned : done);

  return [
    ...report.created.map((file) => `${verb('created', 'would create')} ${file}`),
    ...report.overwritten.map((file) => `${verb('overwrote', 'would overwrite')} ${file}`),
    ...report.patched.map((entry) => `${verb('patched', 'would patch')} ${entry.file} (${entry.label})`),
    ...report.skipped.map((entry) => `unchanged ${entry.file} (${entry.label}: ${entry.reason})`)
  ];
}

function text(lines: string[]): ToolResult
{
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

function describe_load(payload: unknown): string
{
  const loaded = (typeof payload === 'object' && payload !== null ? payload : {}) as {
    name?: unknown; meshes?: unknown; triangles?: unknown; bounding_box?: { min?: unknown; max?: unknown } | null;
  };
  const bounds = loaded.bounding_box === null || loaded.bounding_box === undefined
    ? 'empty bounds'
    : `bounds [${triple(loaded.bounding_box.min)}] to [${triple(loaded.bounding_box.max)}]`;

  return `loaded ${String(loaded.name ?? '?')}: ${String(loaded.meshes ?? '?')} meshes, ${String(loaded.triangles ?? '?')} triangles, ${bounds}`;
}

export async function build_import_model_result(
  host: ToolHost,
  load_tasks: () => Promise<CoreTasks>,
  root: string,
  args: ImportModelToolArgs
): Promise<ToolResult>
{
  let tasks: CoreTasks;

  try
  {
    tasks = await load_tasks();
  }
  catch (error)
  {
    return failure((error as Error).message);
  }

  const dry_run = args.dry_run === true;
  let planned: ReturnType<CoreTasks['plan_import_model']>;

  try
  {
    planned = tasks.plan_import_model({
      source: resolve_source(args.source, root),
      scene: args.scene,
      name: args.name,
      tier: args.tier,
      replace: args.replace
    }, { root, dry_run });
  }
  catch (error)
  {
    return failure(`Import refused: ${(error as Error).message}`);
  }

  const { model } = planned;
  const lines = [`import_model ${model.name} (${model.tier} tier, ${model.draco ? 'draco' : 'no draco'}, ${model.size} bytes)`];

  if (planned.unchanged)
  {
    lines.push('no file changes: this exact file is already imported');
  }
  else
  {
    const report = planned.scaffolder.run();

    if (report.errors.length > 0)
    {
      return failure(['Import refused, nothing was written:', ...report.errors.map((error) => `- ${error}`)].join('\n'));
    }

    lines.push(...describe_report(report));
  }

  if (dry_run)
  {
    lines.push('dry run: nothing was written and nothing was loaded');

    return text(lines);
  }

  if (!host.connected)
  {
    lines.push('preview skipped: the app is not connected. Start it with `yarn start`, then call import_model again to load it.');

    return text(lines);
  }

  let payload: unknown;

  try
  {
    payload = await host.send('load_object', { name: model.name, url: model.url, draco: model.draco, version: model.version }, LOAD_TIMEOUT_MS);
  }
  catch (error)
  {
    lines.push(`the files are in place, but the preview failed ${describe_error(error)}`);

    return text(lines);
  }

  const scene = args.scene ?? 'home';

  lines.push(describe_load(payload));
  lines.push(`next: place it with set_object { name: '${model.name}' }, then save the placement with commit_object { name: '${model.name}', scene: '${scene}' }`);

  const content: Array<ImageBlock | TextBlock> = [];

  await attach_capture(host, content);
  content.push({ type: 'text', text: lines.join('\n') });

  return { content };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/tools/import.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/import.ts src/protocol.ts src/config.ts tests/tools/import.test.ts
git commit -m "feat(tools): add import_model"
```

### Task 14: commit_object tool, registration and README

**Files:**
- Modify: `mcp/src/tools/import.ts` (add `build_commit_object_result` and `register_import_tools`)
- Modify: `mcp/src/server.ts`
- Modify: `mcp/README.md`
- Test: `mcp/tests/tools/import.test.ts` (add cases)

**Interfaces:**
- Consumes: Task 12 types; Task 13 `describe_report`; `not_connected` from `./shared.js`.
- Produces:
  - `build_commit_object_result(host, load_tasks, root, args: { name: string; scene?: string; dry_run?: boolean }): Promise<ToolResult>`.
  - `register_import_tools(server: McpServer, host: BridgeHost, load_tasks: () => Promise<CoreTasks>, root: string): void`.

- [ ] **Step 1: Write the failing tests** (append to `import.test.ts`, and extend its imports)

```ts
import { z } from 'zod';
import { build_commit_object_result, register_import_tools } from '../../src/tools/import.js';

const OBJECT = { name: 'chair', type: 'Group', position: [1.25, 0, -2], rotation: [0, 1.5708, 0], scale: [1, 1, 1] };

function commit_tasks(planned: { report?: ScaffoldReport; error?: Error } = {}, seen: unknown[] = [])
{
  return async() => ({
    plan_import_model: () => { throw new Error('not used'); },
    plan_commit_object: (args: unknown, options: unknown) =>
    {
      seen.push({ args, options });
      if (planned.error !== undefined) { throw planned.error; }
      return { run: () => planned.report ?? report({ created: ['app/js/objects/Chair.ts'], patched: [{ file: 'app/js/scenes/HomeScene.ts', label: 'instance of Chair' }] }) };
    }
  }) as unknown as CoreTasks;
}

describe('commit_object', () =>
{
  it('reads the live transform and plans the commit with it', async() =>
  {
    const calls: Call[] = [];
    const seen: unknown[] = [];

    const result = await build_commit_object_result(host({ get_object: OBJECT }, calls), commit_tasks({}, seen), '/project', { name: 'chair' });

    expect(calls).toEqual([{ cmd: 'get_object', args: { name: 'chair' } }]);
    expect(seen).toEqual([{ args: { name: 'chair', scene: undefined, transform: { position: [1.25, 0, -2], rotation: [0, 1.5708, 0], scale: [1, 1, 1] } }, options: { root: '/project', dry_run: false } }]);
    expect(text_of(result)).toContain('created app/js/objects/Chair.ts');
    expect(text_of(result)).toContain('patched app/js/scenes/HomeScene.ts (instance of Chair)');
  });

  it('defaults a missing rotation and scale', async() =>
  {
    const seen: Array<{ args: { transform: unknown } }> = [];

    await build_commit_object_result(host({ get_object: { name: 'chair', position: [0, 1, 0] } }), commit_tasks({}, seen), '/project', { name: 'chair' });

    expect(seen[0].args.transform).toEqual({ position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
  });

  it('refuses when the app is not connected', async() =>
  {
    const result = await build_commit_object_result(host({}, [], false), commit_tasks(), '/project', { name: 'chair' });

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('not connected');
  });

  it('explains an object that is not loaded', async() =>
  {
    const result = await build_commit_object_result(host({ get_object: new BridgeError('not_found', 'No object named chair') }), commit_tasks(), '/project', { name: 'chair' });

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('Import it with import_model first');
  });

  it('refuses a malformed payload', async() =>
  {
    const result = await build_commit_object_result(host({ get_object: { position: 'x' } }), commit_tasks(), '/project', { name: 'chair' });

    expect(result.isError).toBe(true);
  });

  it('passes planner refusals and scaffolder errors through as errors', async() =>
  {
    const refused = await build_commit_object_result(host({ get_object: OBJECT }), commit_tasks({ error: new Error('HomeScene.ts is missing // __OBJECTS__') }), '/project', { name: 'chair' });
    const failed = await build_commit_object_result(host({ get_object: OBJECT }), commit_tasks({ report: report({ applied: false, errors: ['anchor not found'] }) }), '/project', { name: 'chair' });

    expect(refused.isError).toBe(true);
    expect(text_of(refused)).toContain('Commit refused: HomeScene.ts is missing // __OBJECTS__');
    expect(failed.isError).toBe(true);
    expect(text_of(failed)).toContain('- anchor not found');
  });
});

describe('register_import_tools', () =>
{
  it('registers both tools, with write-capable schemas', () =>
  {
    const schemas: Record<string, z.ZodRawShape> = {};
    const server = { registerTool: (name: string, config: { inputSchema: z.ZodRawShape }) => { schemas[name] = config.inputSchema; } };

    register_import_tools(server as never, {} as never, async() => ({}) as never, '/project');

    expect(Object.keys(schemas)).toEqual(['import_model', 'commit_object']);
    expect(z.object(schemas.import_model).safeParse({ source: '~/a.glb', tier: 'high', replace: true }).success).toBe(true);
    expect(z.object(schemas.import_model).safeParse({ source: '~/a.glb', tier: 'medium' }).success).toBe(false);
    expect(z.object(schemas.commit_object).safeParse({ name: 'chair', dry_run: true }).success).toBe(true);
    expect(z.object(schemas.commit_object).safeParse({}).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/tools/import.test.ts`
Expected: FAIL, because `build_commit_object_result` is not exported.

- [ ] **Step 3: Implement**

Add to `import.ts` (extend the imports with `import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';`, `import { z } from 'zod';`, `import type { BridgeHost } from '../bridge/BridgeHost.js';`, `import type { Transform } from '../knowledge/core_tasks.js';` and `not_connected`):

```ts
export interface CommitObjectToolArgs
{
  name: string;
  scene?: string;
  dry_run?: boolean;
}

function vector(value: unknown, fallback: number): number[] | null
{
  if (value === undefined)
  {
    return [fallback, fallback, fallback];
  }

  return Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === 'number') ? value : null;
}

export async function build_commit_object_result(
  host: ToolHost,
  load_tasks: () => Promise<CoreTasks>,
  root: string,
  args: CommitObjectToolArgs
): Promise<ToolResult>
{
  if (!host.connected)
  {
    return not_connected();
  }

  let tasks: CoreTasks;

  try
  {
    tasks = await load_tasks();
  }
  catch (error)
  {
    return failure((error as Error).message);
  }

  let payload: unknown;

  try
  {
    payload = await host.send('get_object', { name: args.name });
  }
  catch (error)
  {
    return failure(`Reading "${args.name}" from the running app failed ${describe_error(error)}. Import it with import_model first, or check the name with inspect_scene.`);
  }

  const detail = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
  const position = vector(detail.position, 0);
  const rotation = vector(detail.rotation, 0);
  const scale = vector(detail.scale, 1);

  if (position === null || rotation === null || scale === null || detail.position === undefined)
  {
    return failure('The app returned a malformed object payload.');
  }

  const transform: Transform = { position, rotation, scale };
  let report: ScaffoldReport;

  try
  {
    report = tasks.plan_commit_object({ name: args.name, scene: args.scene, transform }, { root, dry_run: args.dry_run === true }).run();
  }
  catch (error)
  {
    return failure(`Commit refused: ${(error as Error).message}`);
  }

  if (report.errors.length > 0)
  {
    return failure(['Commit refused, nothing was written:', ...report.errors.map((error) => `- ${error}`)].join('\n'));
  }

  const lines = [
    `commit_object ${args.name}: position [${position.join(', ')}], rotation [${rotation.join(', ')}], scale [${scale.join(', ')}]`,
    ...describe_report(report)
  ];

  if (report.dry_run)
  {
    lines.push('dry run: nothing was written');
  }

  return text(lines);
}

export function register_import_tools(server: McpServer, host: BridgeHost, load_tasks: () => Promise<CoreTasks>, root: string): void
{
  server.registerTool(
    'import_model',
    {
      title: 'Import a GLB model into the OHZI project',
      description: 'Copy a local self-contained .glb into public/models, list it in a scene\'s object manifest (app/data/assets/<scene>/<scene>_objects.js, or the high tier), and load it into the running app for preview, returning a screenshot. Writes project files. Draco is detected and supported; models that require meshopt or KTX2 are refused. Importing the identical file again changes nothing and only reloads the preview; a changed file under the same name needs replace. Place the preview with set_object, then save the placement as code with commit_object.',
      inputSchema: {
        source: z.string().min(1).describe('Path to the .glb on this machine. Absolute, ~/..., or relative to the project root.'),
        scene: z.string().min(1).optional().describe('Scene folder under app/data/assets. Defaults to home.'),
        name: z.string().min(1).optional().describe('Model name: the manifest name, file name and scene field. Defaults to the file name in snake_case.'),
        tier: z.enum(['regular', 'high']).optional().describe('regular loads with the scene; high loads after it, with the high quality assets. Defaults to regular.'),
        replace: z.boolean().optional().describe('Overwrite a different file already imported under this name.'),
        dry_run: z.boolean().optional().describe('Report what would be written without writing or loading anything.')
      }
    },
    async (args) => build_import_model_result(host, load_tasks, root, args)
  );

  server.registerTool(
    'commit_object',
    {
      title: 'Save an imported model\'s placement as code',
      description: 'Read the live transform of an object loaded by import_model and save it as code. The first commit creates app/js/objects/<Name>.ts (a class extending Object3D that wraps the model and holds its transform) and wires the scene at its // __OBJECT_IMPORTS__, // __OBJECT_FIELDS__ and // __OBJECTS__ (or // __HIGH_OBJECTS__) markers. A later commit rewrites only the three transform lines of the class. Writes project files.',
      inputSchema: {
        name: z.string().min(1).describe('Model name used with import_model.'),
        scene: z.string().min(1).optional().describe('Scene folder under app/data/assets. Defaults to home.'),
        dry_run: z.boolean().optional().describe('Report what would be written without writing anything.')
      }
    },
    async (args) => build_commit_object_result(host, load_tasks, root, args)
  );
}
```

In `mcp/src/server.ts`:
- Add `import { load_core_tasks } from './knowledge/core_tasks.js';` and `import { register_import_tools } from './tools/import.js';`.
- After `register_input_tools(server, host);`, add:

```ts
  // Reads and writes the consuming project, which is the working directory, the
  // same root load_types reads its declarations from.
  register_import_tools(server, host, () => load_core_tasks(process.cwd()), process.cwd());
```

In `mcp/README.md`:
- Change "Twenty-two tools" to "Twenty-four tools".
- Add, after the Debug helpers section:

```markdown
### Models

| Tool | What it does |
|---|---|
| `import_model` | Copies a local self-contained `.glb` into `public/models`, lists it in a scene's object manifest and loads it into the running app for preview, with a screenshot. Draco models work; models that require meshopt or KTX2 are refused. Importing the identical file again only reloads the preview; a changed file under the same name needs `replace`. Writes project files. |
| `commit_object` | Saves the live placement of an imported model as code: a wrapper class in `app/js/objects/` and the scene wiring at its `// __OBJECT_*__` markers. A later commit rewrites only the transform lines. Writes project files. |
```

- [ ] **Step 4: Run the whole mcp suite and the type check**

Run: `yarn test && yarn build`
Expected: every test PASSES and `tsc` reports no errors.

- [ ] **Step 5: Commit**

Two commits, matching spec §9:

```bash
git add src/tools/import.ts src/server.ts tests/tools/import.test.ts
git commit -m "feat(tools): add commit_object"
git add README.md
git commit -m "docs: document import_model and commit_object"
```

---

## Part C: boilerplate (branch `feat/import-model`)

Before Task 15, run `git switch -c feat/import-model` at the boilerplate root. The boilerplate has no test framework. Each task is verified with a dry run of the real scaffolders against the real project, and the end-to-end check is Task 17.

### Task 15: Markers in HomeScene and the import-model script

**Files:**
- Modify: `app/js/scenes/HomeScene.ts`
- Modify: `package.json`

- [ ] **Step 1: Prove the commit currently refuses HomeScene**

Run, from the boilerplate root (the manifest is patched in memory only):

```bash
node --input-type=module -e "
import { plan_commit_object } from './core/tasks/import_model/import_model.mjs';
try { plan_commit_object({ name: 'chair', transform: { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] } }, { root: process.cwd(), dry_run: true }); }
catch (error) { console.log(error.message); }
"
```

Expected: `"chair" is not in the object manifests ...`. That is the manifest refusal, which comes first.

- [ ] **Step 2: Add the markers**

- After `import { CommonScene } from './common/CommonScene';` add the line `// __OBJECT_IMPORTS__`.
- After `  camera_controller: CameraController;` add `  // __OBJECT_FIELDS__`.
- At the end of `on_assets_ready()`, after the commented `// cube.position.set(0.5, 0.5, 0.5);` line, add a blank line and `    // __OBJECTS__`.
- At the end of `on_high_quality_assets_ready()`, after `// AudioManager.init_sounds(home_high_sounds);`, add a blank line and `    // __HIGH_OBJECTS__`.

In the root `package.json` `scripts`, after `"create-scene"`, add:

```json
    "import-model": "cd core && yarn import-model",
```

- [ ] **Step 3: Dry-run a full import and commit against the real project**

```bash
check_dir=$(mktemp -d) && node --input-type=module -e "
import fs from 'fs';
const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' } }));
const pad = Buffer.alloc((4 - json.length % 4) % 4, 0x20);
const h = Buffer.alloc(20); h.writeUInt32LE(0x46546c67,0); h.writeUInt32LE(2,4); h.writeUInt32LE(20+json.length+pad.length,8); h.writeUInt32LE(json.length+pad.length,12); h.writeUInt32LE(0x4e4f534a,16);
fs.writeFileSync(process.argv[1] + '/chair.glb', Buffer.concat([h, json, pad]));
" "$check_dir" && yarn import-model "$check_dir/chair.glb" --dry-run
```

Expected: `would create public/models/chair.glb` and `would patch app/data/assets/home/home_objects.js (manifest entry for chair)`. Then run `git status --short` and confirm that only `HomeScene.ts` and `package.json` changed.

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit -p .` and `npx eslint app/js/scenes/HomeScene.ts`
Expected: no new errors in `HomeScene.ts`.

- [ ] **Step 5: Commit**

Two commits, matching spec §9:

```bash
git add app/js/scenes/HomeScene.ts
git commit -m "feat(scenes): add object markers to HomeScene"
git add package.json
git commit -m "chore: add import-model script"
```

### Task 16: Register load_object, and document it

**Files:**
- Modify: `app/js/components/DevBridgeController.ts`
- Modify: `docs/creating-scenes.md`

- [ ] **Step 1: Register the command**

In `DevBridgeController.ts`:
- Add `ModelLoader` and `ResourceContainer` to the `ohzi-core` import, in alphabetical order.
- Add `import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';` below the `three` import.
- Call `this.register_models();` after `this.register_debug();` in `start()`.
- Add this method after `register_debug()`:

```ts
  register_models()
  {
    // The project's own Draco decoder, set up by DracoInitializer, so a preview
    // decodes exactly like the scene's asset loading does.
    const model_loader = new ModelLoader((url, draco) =>
    {
      const loader = new GLTFLoader();

      if (draco)
      {
        loader.setDRACOLoader(ResourceContainer.get('draco_loader'));
      }

      return loader.loadAsync(url);
    }, ResourceContainer);

    // frame_end: it changes what the next frame renders. The load itself is
    // async, but its continuation runs as its own task between frames, never in
    // the middle of one.
    this.bridge.register('load_object', 'frame_end', (args) => model_loader.load(SceneManager.current, args));
  }
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit -p .` and `npx eslint app/js/components/DevBridgeController.ts`
Expected: no new errors.

- [ ] **Step 3: Document**

In `docs/creating-scenes.md`, add this section after "Asset Configuration → Objects (3D Models)":

````markdown
### Importing models

`yarn import-model path/to/chair.glb` copies a `.glb` into `public/models/` and lists it in the scene's object manifest. Options: `--scene home`, `--name chair`, `--tier regular|high`, `--replace` (overwrite a changed file), `--dry-run`. Draco models are detected; models that require meshopt or KTX2 are refused.

With the OHZI MCP server, ask Claude to import the model instead: `import_model` also loads it into the running app, you place it with `set_object`, and `commit_object` saves the placement as a class in `app/js/objects/` plus scene wiring at these markers, which every scene created by `yarn create-scene` has:

```ts
// __OBJECT_IMPORTS__    after the imports
// __OBJECT_FIELDS__     in the class field list
// __OBJECTS__           at the end of on_assets_ready()
// __HIGH_OBJECTS__      at the end of on_high_quality_assets_ready()
```

Committing again rewrites only the `position`, `rotation` and `scale` lines of the class, so anything you add to it is kept.
````

- [ ] **Step 4: Commit**

Two commits:

```bash
git add app/js/components/DevBridgeController.ts
git commit -m "feat(dev-bridge): register load_object"
git add docs/creating-scenes.md
git commit -m "docs: add importing models to creating-scenes"
```

### Task 17: End to end, production check and submodule pointers

**Files:**
- Modify: the `core` and `mcp` submodule pointers

- [ ] **Step 1: Build the mcp server**

Run: `cd mcp && yarn build`. `mcp/build` is git-ignored.

- [ ] **Step 2: Live check with a real GLB**

Use any small real `.glb`, for example three's `examples/models/gltf/` files if they are present in `node_modules/three`, or export a cube from Blender. Prefer one Draco-compressed GLB too.

Run the app on a spare port, so it doesn't fight another session's MCP server: `OHZI_MCP_PORT=7318 yarn start`.

In a scratch Node ESM script in the session scratchpad:
- Start `BridgeHost` from `mcp/build/bridge/BridgeHost.js` on 7318.
- Drive Chromium with Playwright, `args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist']`, to `http://localhost:1234/`.
- Call `build_import_model_result(host, () => load_core_tasks(root), root, { source })` from the built tools.
- Then `host.send('set_object', { name: 'chair', position: [1, 0, 0] })`.
- Then `build_commit_object_result(...)`.
- Reload the page.
- Then `host.send('get_object', { name: 'chair' })`.

Expected:
- The import result has an image showing the model.
- After the commit, `app/js/objects/Chair.ts` exists and `HomeScene.ts` is wired.
- After the reload, `get_object` returns position `[1, 0, 0]`. The model now comes from the committed code.
- Re-import with `replace: true` after changing the file: the preview swaps to the new model, which proves the `?v=` cache busting and `replace_resource`.

- [ ] **Step 3: Clean up the live-check artifacts**

Run `git checkout -- app/data/assets app/js/scenes/HomeScene.ts`, then `rm -rf app/js/objects public/models/chair.glb public/models/high`. Run `git status --short` and confirm only the intended work remains.

- [ ] **Step 4: Production bundle check**

Run `yarn build`, then:

```bash
rg -l "load_object needs a name" dist
rg -l "lib/draco/" dist
```

Expected: the first prints **nothing** (ModelLoader is not in the bundle). The second prints a file. It is the control string, proving the search works.

- [ ] **Step 5: Update the submodule pointers**

Run `git add core mcp && git status --short`. Both should show as modified pointers on their `feat/import-model` heads.

```bash
git commit -m "chore: point core and mcp at import-model"
```
