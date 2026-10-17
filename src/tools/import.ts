import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import type { BridgeHost } from '../bridge/BridgeHost.js';
import { LOAD_TIMEOUT_MS, PREVIEW_DEADLINE_MS, PREVIEW_RETRY_MS, RELOAD_POLL_MS, RELOAD_WAIT_MS } from '../config.js';
import type { CoreTasks, ImportedModel, ScaffoldReport, Tier, Transform } from '../knowledge/core_tasks.js';
import type { ImageBlock, TextBlock, ToolHost, ToolResult } from './shared.js';
import { attach_capture, describe_error, failure, not_connected, triple } from './shared.js';

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

export interface ImportTiming
{
  sleep(ms: number): Promise<void>;
  now(): number;
}

const REAL_TIMING: ImportTiming = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now()
};

// The app is momentarily unreachable or not yet serving the file: worth another
// try. Anything else, such as a file that fails to parse, will not get better.
const RETRYABLE_CODES = new Set(['not_ready', 'app_not_connected', 'disconnected']);

const DRACO_HINT = 'Enable DracoInitializer in app/js/Api.ts.';

function patched_a_manifest(report: ScaffoldReport): boolean
{
  return report.patched.some((entry) => entry.file.endsWith('_objects.js'));
}

// The app registers a view called 'transition' that shows while it loads, and
// 'current_initial' is the view manager's state before any view is entered. A
// preview loaded then lands in a scene the app replaces a moment later.
const LOADING_VIEWS = new Set(['transition', 'current_initial']);

async function app_is_loading(host: ImportHost): Promise<boolean>
{
  try
  {
    const status = await host.send('status') as { active_view?: unknown } | null;

    return typeof status?.active_view === 'string' && LOADING_VIEWS.has(status.active_view);
  }
  catch
  {
    return true;
  }
}

// Vite fully reloads the page when a manifest changes, which wipes the preview,
// so the load has to wait for the new page to connect and to finish loading.
async function wait_for_reload(host: ImportHost, generation: number, timing: ImportTiming): Promise<void>
{
  const start = timing.now();

  while (host.generation === generation && timing.now() - start < RELOAD_WAIT_MS)
  {
    await timing.sleep(RELOAD_POLL_MS);
  }

  if (host.generation === generation)
  {
    return;
  }

  const reconnected = timing.now();

  while (timing.now() - reconnected < RELOAD_WAIT_MS && await app_is_loading(host))
  {
    await timing.sleep(RELOAD_POLL_MS);
  }
}

async function load_with_retries(host: ImportHost, model: ImportedModel, timing: ImportTiming): Promise<unknown>
{
  const start = timing.now();

  for (;;)
  {
    try
    {
      return await host.send('load_object', { name: model.name, url: model.url, draco: model.draco, version: model.version }, LOAD_TIMEOUT_MS);
    }
    catch (error)
    {
      const code = (error as { code?: string }).code;

      if (code === undefined || !RETRYABLE_CODES.has(code) || timing.now() - start + PREVIEW_RETRY_MS >= PREVIEW_DEADLINE_MS)
      {
        throw error;
      }

      await timing.sleep(PREVIEW_RETRY_MS);
    }
  }
}

// Asks the running app whether it can decode Draco. Only an explicit false
// counts: an older app without the field, or a failed call, must not block.
async function lacks_draco_decoder(host: ImportHost): Promise<boolean>
{
  try
  {
    const status = await host.send('status') as { draco_decoder?: unknown } | null;

    return status?.draco_decoder === false;
  }
  catch
  {
    return false;
  }
}

export type ImportHost = ToolHost & { generation: number };

export async function build_import_model_result(
  host: ImportHost,
  load_tasks: () => Promise<CoreTasks>,
  root: string,
  args: ImportModelToolArgs,
  timing: ImportTiming = REAL_TIMING
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

  if (model.draco && !dry_run && host.connected && await lacks_draco_decoder(host))
  {
    return failure(`Import refused, nothing was written: this model is Draco-compressed, but the running app has no Draco decoder. ${DRACO_HINT}`);
  }

  const lines = [`import_model ${model.name} (${model.tier} tier, ${model.draco ? 'draco' : 'no draco'}, ${model.size} bytes)`];
  const generation = host.generation;
  let reloads = false;

  if (planned.unchanged)
  {
    lines.push('no file changes: this exact file is already imported');
  }
  else
  {
    let report: ScaffoldReport;

    try
    {
      report = planned.scaffolder.run();
    }
    catch (error)
    {
      return failure(`Import refused: ${(error as Error).message}`);
    }

    if (report.errors.length > 0)
    {
      return failure(['Import refused, nothing was written:', ...report.errors.map((error) => `- ${error}`)].join('\n'));
    }

    lines.push(...describe_report(report));
    reloads = !report.dry_run && patched_a_manifest(report);
  }

  if (dry_run)
  {
    lines.push('dry run: nothing was written and nothing was loaded');

    return text(lines);
  }

  if (!host.connected)
  {
    lines.push('preview skipped: the app is not connected. Start it with `yarn start`, then call import_model again to load it.');

    if (model.draco)
    {
      lines.push(`note: this is a Draco model, so the app needs a Draco decoder to preview it. ${DRACO_HINT}`);
    }

    return text(lines);
  }

  if (reloads)
  {
    await wait_for_reload(host, generation, timing);
  }

  let payload: unknown;

  try
  {
    payload = await load_with_retries(host, model, timing);
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

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

export function register_import_tools(server: McpServer, host: BridgeHost, load_tasks: () => Promise<CoreTasks>, root: string): void
{
  server.registerTool(
    'import_model',
    {
      title: 'Import a GLB model into the OHZI project',
      description: 'Copy a local self-contained .glb into public/models, list it in a scene\'s object manifest (app/data/assets/<scene>/<scene>_objects.js, or the high tier), and load it into the running app for preview, returning a screenshot. Writes project files. Draco is detected and supported once DracoInitializer is enabled in app/js/Api.ts; models that require meshopt or KTX2 are refused. Importing the identical file again changes nothing and only reloads the preview; a changed file under the same name needs replace. Place the preview with set_object, then save the placement as code with commit_object.',
      inputSchema: {
        source: z.string().min(1).describe('Path to the .glb on this machine. Absolute, ~/..., or relative to the project root.'),
        scene: z.string().min(1).optional().describe('Scene folder under app/data/assets. Defaults to home.'),
        name: z.string().regex(SNAKE_CASE).optional().describe('Model name in snake_case (a-z, 0-9 and _, starting with a letter): the manifest name, file name and scene field. Defaults to the file name in snake_case.'),
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
        name: z.string().regex(SNAKE_CASE).describe('Model name in snake_case, as used with import_model.'),
        scene: z.string().min(1).optional().describe('Scene folder under app/data/assets. Defaults to home.'),
        dry_run: z.boolean().optional().describe('Report what would be written without writing anything.')
      }
    },
    async (args) => build_commit_object_result(host, load_tasks, root, args)
  );
}
