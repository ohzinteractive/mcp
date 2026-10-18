import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScaffoldKind } from '../../src/knowledge/core_tasks.js';
import { CORE_TASKS_ENTRY, SCAFFOLD_PLANNERS, load_core_tasks, load_scaffold_planner } from '../../src/knowledge/core_tasks.js';

// This repo is the mcp submodule of the boilerplate. When it is checked out on
// its own there is no core next to it, and the contract cannot be checked.
const boilerplate = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const has_core = existsSync(join(boilerplate, CORE_TASKS_ENTRY));

const MANIFEST = (variable: string) => `export const ${variable} = [\n];\n`;

const SCENE = `import { CommonScene } from './common/CommonScene';
// __OBJECT_IMPORTS__

export class HomeScene extends CommonScene
{
  // __OBJECT_FIELDS__

  on_assets_ready()
  {
    // __OBJECTS__
  }

  on_high_quality_assets_ready()
  {
    // __HIGH_OBJECTS__
  }
}
`;

// A GLB with only a JSON chunk, which is all the importer reads.
function tiny_glb(): Buffer
{
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' } }));
  const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(20);

  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);

  return Buffer.concat([header, padded]);
}

describe.skipIf(!has_core)('the real core import_model scaffolder', () =>
{
  let project: string;
  let downloads: string;

  beforeEach(() =>
  {
    project = mkdtempSync(join(tmpdir(), 'ohzi-contract-'));
    downloads = mkdtempSync(join(tmpdir(), 'ohzi-contract-glb-'));

    for (const [file, contents] of Object.entries({
      'app/data/assets/home/home_objects.js': MANIFEST('home_objects'),
      'app/data/assets/home/high/home_high_objects.js': MANIFEST('home_high_objects'),
      'app/js/scenes/HomeScene.ts': SCENE
    }))
    {
      mkdirSync(dirname(join(project, file)), { recursive: true });
      writeFileSync(join(project, file), contents);
    }
  });

  afterEach(() =>
  {
    rmSync(project, { recursive: true, force: true });
    rmSync(downloads, { recursive: true, force: true });
  });

  it('returns the report and model shapes the mcp types promise', async() =>
  {
    const tasks = await load_core_tasks(boilerplate);
    const source = join(downloads, 'chair.glb');

    writeFileSync(source, tiny_glb());

    const planned = tasks.plan_import_model({ source, scene: 'home' }, { root: project });
    const report = planned.scaffolder.run();

    expect(Object.keys(planned).sort()).toEqual(['model', 'scaffolder', 'unchanged']);
    expect(Object.keys(report).sort()).toEqual(['applied', 'created', 'dry_run', 'errors', 'overwritten', 'patched', 'skipped']);
    expect(Object.keys(planned.model).sort()).toEqual(['draco', 'name', 'size', 'tier', 'url', 'version']);
    expect(report.errors).toEqual([]);
    expect(report.created).toEqual(['public/models/chair.glb']);
    expect(report.patched).toEqual([{ file: 'app/data/assets/home/home_objects.js', label: 'manifest entry for chair' }]);
    expect(planned.model).toMatchObject({ name: 'chair', url: '/models/chair.glb', draco: false, tier: 'regular' });
  });
});

describe.skipIf(!has_core)('the real core create_* scaffolders', () =>
{
  let project: string;

  beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'ohzi-contract-scaffold-')); });
  afterEach(() => { rmSync(project, { recursive: true, force: true }); });

  for (const kind of Object.keys(SCAFFOLD_PLANNERS) as ScaffoldKind[])
  {
    it(`${kind}: returns the report shape the mcp types promise`, async() =>
    {
      const plan = await load_scaffold_planner(boilerplate, kind);
      const report = plan('probe', { root: project, dry_run: true }).run();

      expect(Object.keys(report).sort()).toEqual(['applied', 'created', 'dry_run', 'errors', 'overwritten', 'patched', 'skipped']);
      expect(report.dry_run).toBe(true);
      expect(report.applied).toBe(false);
      expect(report.created.length).toBeGreaterThan(0);
    });
  }
});
