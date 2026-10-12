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
