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
