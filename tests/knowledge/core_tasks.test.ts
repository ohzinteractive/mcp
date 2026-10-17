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
