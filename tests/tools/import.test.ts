import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BridgeError } from '../../src/bridge/BridgeError.js';
import type { CoreTasks, ScaffoldReport } from '../../src/knowledge/core_tasks.js';
import { build_commit_object_result, build_import_model_result, register_import_tools, resolve_source } from '../../src/tools/import.js';
import { describe_report } from '../../src/tools/shared.js';

interface Call { cmd: string; args?: Record<string, unknown>; timeout_ms?: number }

interface FakeHost
{
  connected: boolean;
  generation: number;
  send: (cmd: string, args?: Record<string, unknown>, timeout_ms?: number) => Promise<unknown>;
}

// A result may be a function, called on every send, so a test can script a
// sequence of answers.
function host(results: Record<string, unknown>, calls: Call[] = [], connected = true): FakeHost
{
  return {
    connected,
    generation: 0,
    send: async(cmd: string, args?: Record<string, unknown>, timeout_ms?: number) =>
    {
      calls.push(timeout_ms === undefined ? { cmd, args } : { cmd, args, timeout_ms });
      const configured = results[cmd];
      const result = typeof configured === 'function' ? (configured as () => unknown)() : configured;
      if (result instanceof Error) { throw result; }
      return result;
    }
  };
}

// A fake clock: sleeping only moves time forward, so retries are instant.
function clock(on_sleep: (count: number) => void = () => {})
{
  let elapsed = 0;
  let count = 0;

  return {
    now: () => elapsed,
    sleep: async(ms: number) => { elapsed += ms; count++; on_sleep(count); },
    sleeps: () => count,
    elapsed: () => elapsed
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

function tasks(planned: { report?: ScaffoldReport; unchanged?: boolean; error?: Error; model?: Partial<typeof MODEL>; run?: () => ScaffoldReport } = {}, seen: unknown[] = [])
{
  return async() => ({
    plan_import_model: (args: unknown, options: unknown) =>
    {
      seen.push({ args, options });
      if (planned.error !== undefined) { throw planned.error; }
      return {
        scaffolder: { run: planned.run ?? (() => planned.report ?? report({ created: ['public/models/chair.glb'], patched: [{ file: 'app/data/assets/home/home_objects.js', label: 'manifest entry for chair' }] })) },
        model: { ...MODEL, ...planned.model },
        unchanged: planned.unchanged ?? false
      };
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

    const result = await build_import_model_result(host({ load_object: LOADED, capture_viewport: shot }, calls), tasks({}, seen), '/project', { source: 'models/chair.glb' }, clock());

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
    const result = await build_import_model_result(host({ load_object: new BridgeError('load_failed', 'Could not load /models/chair.glb: HTTP 404') }), tasks(), '/project', { source: '/x.glb' }, clock());

    expect(text_of(result)).toContain('created public/models/chair.glb');
    expect(text_of(result)).toContain('preview failed (load_failed): Could not load /models/chair.glb: HTTP 404');
  });

  it('reports a scaffolder that throws as a refusal', async() =>
  {
    const calls: Call[] = [];
    const result = await build_import_model_result(host({}, calls), tasks({ run: () => { throw new Error('EACCES: permission denied'); } }), '/project', { source: '/x.glb' }, clock());

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('Import refused: EACCES: permission denied');
    expect(calls).toEqual([]);
  });

  it('explains a project without the core scaffolders', async() =>
  {
    const result = await build_import_model_result(host({}), async() => { throw new Error('No OHZI scaffolders at /project/core'); }, '/project', { source: '/x.glb' });

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('No OHZI scaffolders');
  });
});

const manifest_patch = { file: 'app/data/assets/home/home_objects.js', label: 'manifest entry for chair' };
const high_manifest_patch = { file: 'app/data/assets/home/high/home_high_objects.js', label: 'manifest entry for chair' };

describe('import_model and the Vite reload', () =>
{
  it('waits for the app to reconnect after a manifest was patched, then loads', async() =>
  {
    const calls: Call[] = [];
    const fake = host({ load_object: LOADED, capture_viewport: shot }, calls);
    const timing = clock((count) => { if (count === 3) { fake.generation++; } });

    const result = await build_import_model_result(fake, tasks({ report: report({ patched: [manifest_patch] }) }), '/project', { source: '/x.glb' }, timing);

    expect(timing.sleeps()).toBe(3);
    expect(timing.elapsed()).toBe(750);
    expect(calls.map((call) => call.cmd)).toEqual(['status', 'load_object', 'capture_viewport']);
    expect(text_of(result)).toContain('loaded chair');
  });

  it('keeps waiting after the reconnect until the app has left its transition view', async() =>
  {
    const calls: Call[] = [];
    const views = ['transition', 'transition', 'current_initial', 'home'];
    const fake = host({ status: () => ({ active_view: views.shift() }), load_object: LOADED, capture_viewport: shot }, calls);
    const timing = clock((count) => { if (count === 2) { fake.generation++; } });

    const result = await build_import_model_result(fake, tasks({ report: report({ patched: [manifest_patch] }) }), '/project', { source: '/x.glb' }, timing);

    expect(calls.map((call) => call.cmd)).toEqual(['status', 'status', 'status', 'status', 'load_object', 'capture_viewport']);
    expect(timing.sleeps()).toBe(2 + 3);
    expect(text_of(result)).toContain('loaded chair');
  });

  it('loads anyway when the app never leaves its transition view', async() =>
  {
    const calls: Call[] = [];
    const fake = host({ status: { active_view: 'transition' }, load_object: LOADED, capture_viewport: shot }, calls);
    const timing = clock((count) => { if (count === 1) { fake.generation++; } });

    const result = await build_import_model_result(fake, tasks({ report: report({ patched: [manifest_patch] }) }), '/project', { source: '/x.glb' }, timing);

    expect(timing.elapsed()).toBe(250 + 8000);
    expect(calls.at(-2)?.cmd).toBe('load_object');
    expect(text_of(result)).toContain('loaded chair');
  });

  it('keeps waiting while the status call fails during the reload', async() =>
  {
    const answers: unknown[] = [new BridgeError('disconnected', 'gone'), { active_view: 'home' }];
    const fake = host({ status: () => answers.shift(), load_object: LOADED, capture_viewport: shot });
    const timing = clock((count) => { if (count === 1) { fake.generation++; } });

    const result = await build_import_model_result(fake, tasks({ report: report({ patched: [manifest_patch] }) }), '/project', { source: '/x.glb' }, timing);

    expect(timing.sleeps()).toBe(2);
    expect(text_of(result)).toContain('loaded chair');
  });

  it('waits for the high manifest too', async() =>
  {
    const fake = host({ load_object: LOADED, capture_viewport: shot });
    const timing = clock((count) => { if (count === 1) { fake.generation++; } });

    await build_import_model_result(fake, tasks({ report: report({ patched: [high_manifest_patch] }) }), '/project', { source: '/x.glb' }, timing);

    expect(timing.sleeps()).toBe(1);
  });

  it('gives up waiting after 8 seconds and loads anyway', async() =>
  {
    const calls: Call[] = [];
    const timing = clock();

    const result = await build_import_model_result(host({ load_object: LOADED, capture_viewport: shot }, calls), tasks({ report: report({ patched: [manifest_patch] }) }), '/project', { source: '/x.glb' }, timing);

    expect(timing.elapsed()).toBe(8000);
    expect(calls[0].cmd).toBe('load_object');
    expect(text_of(result)).toContain('loaded chair');
  });

  it('does not wait when only the GLB was overwritten', async() =>
  {
    const timing = clock();

    await build_import_model_result(host({ load_object: LOADED, capture_viewport: shot }), tasks({ report: report({ overwritten: ['public/models/chair.glb'] }) }), '/project', { source: '/x.glb' }, timing);

    expect(timing.sleeps()).toBe(0);
  });

  it('does not wait for a patch that is not a manifest', async() =>
  {
    const timing = clock();

    await build_import_model_result(host({ load_object: LOADED, capture_viewport: shot }), tasks({ report: report({ patched: [{ file: 'app/js/scenes/HomeScene.ts', label: 'x' }] }) }), '/project', { source: '/x.glb' }, timing);

    expect(timing.sleeps()).toBe(0);
  });

  it('retries load_object on not_ready until it succeeds, and captures only after that', async() =>
  {
    const calls: Call[] = [];
    let attempts = 0;
    const load = () => (++attempts < 3 ? new BridgeError('not_ready', 'the dev server is not serving the file yet') : LOADED);
    const timing = clock();

    const result = await build_import_model_result(host({ load_object: load, capture_viewport: shot }, calls), tasks({ report: report({ overwritten: ['public/models/chair.glb'] }) }), '/project', { source: '/x.glb' }, timing);

    expect(calls.map((call) => call.cmd)).toEqual(['load_object', 'load_object', 'load_object', 'capture_viewport']);
    expect(timing.elapsed()).toBe(2000);
    expect(result.content[0].type).toBe('image');
    expect(text_of(result)).toContain('loaded chair');
  });

  it('retries on app_not_connected and disconnected', async() =>
  {
    const calls: Call[] = [];
    const answers = [new BridgeError('app_not_connected', 'No OHZI app is connected'), new BridgeError('disconnected', 'The OHZI app disconnected'), LOADED];
    const load = () => answers.shift();

    const result = await build_import_model_result(host({ load_object: load, capture_viewport: shot }, calls), tasks({ report: report({ overwritten: ['public/models/chair.glb'] }) }), '/project', { source: '/x.glb' }, clock());

    expect(calls.filter((call) => call.cmd === 'load_object')).toHaveLength(3);
    expect(text_of(result)).toContain('loaded chair');
  });

  it('does not retry load_failed or no_draco_decoder', async() =>
  {
    for (const code of ['load_failed', 'no_draco_decoder'] as const)
    {
      const calls: Call[] = [];
      const timing = clock();

      const result = await build_import_model_result(host({ load_object: new BridgeError(code, 'nope') }, calls), tasks({ report: report({ overwritten: ['public/models/chair.glb'] }) }), '/project', { source: '/x.glb' }, timing);

      expect(calls).toHaveLength(1);
      expect(timing.sleeps()).toBe(0);
      expect(text_of(result)).toContain(`the files are in place, but the preview failed (${code}): nope`);
    }
  });

  it('stops retrying at the overall deadline and keeps the files-in-place message', async() =>
  {
    const calls: Call[] = [];
    const timing = clock();

    const result = await build_import_model_result(host({ load_object: new BridgeError('not_ready', 'not serving yet') }, calls), tasks({ report: report({ overwritten: ['public/models/chair.glb'] }) }), '/project', { source: '/x.glb' }, timing);

    expect(timing.elapsed()).toBeLessThanOrEqual(15000);
    expect(timing.elapsed()).toBeGreaterThanOrEqual(14000);
    expect(calls.every((call) => call.cmd === 'load_object')).toBe(true);
    expect(calls.length).toBeGreaterThan(10);
    expect(result.isError).toBeUndefined();
    expect(text_of(result)).toContain('overwrote public/models/chair.glb');
    expect(text_of(result)).toContain('the files are in place, but the preview failed (not_ready): not serving yet');
  });
});

describe('import_model and Draco', () =>
{
  const draco = { draco: true };

  it('refuses, writing nothing, when the app reports no Draco decoder', async() =>
  {
    const calls: Call[] = [];
    let runs = 0;

    const result = await build_import_model_result(host({ status: { draco_decoder: false } }, calls), tasks({ model: draco, run: () => { runs++; return report(); } }), '/project', { source: '/x.glb' }, clock());

    expect(runs).toBe(0);
    expect(calls.map((call) => call.cmd)).toEqual(['status']);
    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('Draco');
    expect(text_of(result)).toContain('DracoInitializer');
    expect(text_of(result)).toContain('app/js/Api.ts');
    expect(text_of(result)).toContain('nothing was written');
  });

  it('carries on when the decoder is present', async() =>
  {
    const calls: Call[] = [];

    const result = await build_import_model_result(host({ status: { draco_decoder: true }, load_object: LOADED, capture_viewport: shot }, calls), tasks({ model: draco }), '/project', { source: '/x.glb' }, clock());

    expect(calls.map((call) => call.cmd)).toEqual(['status', 'load_object', 'capture_viewport']);
    expect(result.isError).toBeUndefined();
    expect(text_of(result)).toContain('loaded chair');
  });

  it('carries on when an older app does not report the field', async() =>
  {
    const calls: Call[] = [];

    const result = await build_import_model_result(host({ status: { active_view: 'home' }, load_object: LOADED, capture_viewport: shot }, calls), tasks({ model: draco }), '/project', { source: '/x.glb' }, clock());

    expect(result.isError).toBeUndefined();
    expect(text_of(result)).toContain('loaded chair');
  });

  it('carries on when the status call itself fails', async() =>
  {
    const result = await build_import_model_result(host({ status: new BridgeError('timeout', 'slow'), load_object: LOADED, capture_viewport: shot }), tasks({ model: draco }), '/project', { source: '/x.glb' }, clock());

    expect(result.isError).toBeUndefined();
  });

  it('does not ask the app about Draco for a model without it, or on a dry run', async() =>
  {
    const calls: Call[] = [];

    await build_import_model_result(host({ load_object: LOADED, capture_viewport: shot }, calls), tasks({}), '/project', { source: '/x.glb' }, clock());
    await build_import_model_result(host({}, calls), tasks({ model: draco, report: report({ dry_run: true, applied: false }) }), '/project', { source: '/x.glb', dry_run: true }, clock());

    expect(calls.some((call) => call.cmd === 'status')).toBe(false);
  });

  it('notes that Draco models need DracoInitializer when the app is not connected', async() =>
  {
    const result = await build_import_model_result(host({}, [], false), tasks({ model: draco }), '/project', { source: '/x.glb' }, clock());

    expect(result.isError).toBeUndefined();
    expect(text_of(result)).toContain('preview skipped');
    expect(text_of(result)).toContain('DracoInitializer');
  });
});

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

  it('only accepts snake_case names, in both tools', () =>
  {
    const schemas: Record<string, z.ZodRawShape> = {};
    const server = { registerTool: (name: string, config: { inputSchema: z.ZodRawShape }) => { schemas[name] = config.inputSchema; } };

    register_import_tools(server as never, {} as never, async() => ({}) as never, '/project');

    for (const tool of ['import_model', 'commit_object'])
    {
      const schema = z.object(schemas[tool]);
      const base = tool === 'import_model' ? { source: '~/a.glb' } : {};

      expect(schema.safeParse({ ...base, name: 'chair_2' }).success).toBe(true);
      expect(schema.safeParse({ ...base, name: 'Chair' }).success).toBe(false);
      expect(schema.safeParse({ ...base, name: 'office chair' }).success).toBe(false);
      expect(schema.safeParse({ ...base, name: '2chair' }).success).toBe(false);
      expect(schemas[tool].name.description).toMatch(/snake_case/);
    }
  });
});
