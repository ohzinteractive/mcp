import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BridgeHost } from '../bridge/BridgeHost.js';
import type { ImageBlock, TextBlock, ToolHost, ToolResult } from './shared.js';
import { attach_capture, describe_error, failure, not_connected, text_or as text, triple } from './shared.js';

export type SceneToolResult = ToolResult;

type SceneHost = ToolHost;

interface SceneNode
{
  uuid?: unknown;
  name?: unknown;
  type?: unknown;
  position?: unknown;
  rotation?: unknown;
  scale?: unknown;
  visible?: unknown;
  material?: unknown;
  vertices?: unknown;
  children?: unknown;
  truncated?: unknown;
}

// Indented text rather than JSON: the same information at a fraction of the
// tokens, and far easier to read at a glance.
function render_tree(node: SceneNode, level: number, lines: string[]): void
{
  const indent = '  '.repeat(level);
  const name = text(node.name, '');
  const label = name.length > 0 ? name : '(unnamed)';

  const parts = [`${indent}${label} (${text(node.type, 'Object3D')}) ${text(node.uuid, '')}`];

  if (Array.isArray(node.position) && node.position.some((v) => v !== 0))
  {
    parts.push(`pos ${triple(node.position)}`);
  }

  if (node.scale !== undefined)
  {
    parts.push(`scale ${triple(node.scale)}`);
  }

  if (node.rotation !== undefined)
  {
    parts.push(`rot ${triple(node.rotation)}`);
  }

  if (node.visible === false)
  {
    parts.push('hidden');
  }

  if (typeof node.material === 'string')
  {
    parts.push(node.material);
  }

  if (typeof node.vertices === 'number')
  {
    parts.push(`${node.vertices}v`);
  }

  lines.push(parts.join('  '));

  if (typeof node.truncated === 'string')
  {
    lines.push(`${indent}  ... ${node.truncated}`);
  }

  const children = Array.isArray(node.children) ? node.children : [];

  for (const child of children)
  {
    render_tree(child as SceneNode, level + 1, lines);
  }
}

export interface InspectArgs
{
  depth?: number;
  max_nodes?: number;
  filter?: string;
}

export async function build_inspect_result(host: SceneHost, args: InspectArgs): Promise<SceneToolResult>
{
  if (!host.connected)
  {
    return not_connected();
  }

  const command_args: Record<string, unknown> = {};

  if (args.depth !== undefined)
  {
    command_args.depth = args.depth;
  }

  if (args.max_nodes !== undefined)
  {
    command_args.max_nodes = args.max_nodes;
  }

  if (args.filter !== undefined)
  {
    command_args.filter = args.filter;
  }

  let payload: unknown;

  try
  {
    payload = await host.send('inspect_scene', command_args);
  }
  catch (error)
  {
    return failure(`Inspecting the scene failed ${describe_error(error)}`);
  }

  if (typeof payload !== 'object' || payload === null)
  {
    return failure('The app returned a malformed scene payload.');
  }

  const result = payload as { root?: unknown; counts?: unknown; truncated?: unknown; notes?: unknown };
  const counts = (typeof result.counts === 'object' && result.counts !== null ? result.counts : {}) as Record<string, unknown>;
  const notes = Array.isArray(result.notes) ? result.notes.map((n) => String(n)) : [];

  const header = `${String(counts.returned ?? 0)} of ${String(counts.total ?? 0)} nodes returned, ${String(counts.meshes ?? 0)} meshes in the scene.`;
  const lines: string[] = [header];

  for (const note of notes)
  {
    lines.push(`! ${note}`);
  }

  if (typeof result.root !== 'object' || result.root === null)
  {
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  lines.push('');
  render_tree(result.root as SceneNode, 0, lines);

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

function render_detail(detail: Record<string, unknown>): string
{
  const lines = [
    `${text(detail.name, '(unnamed)')} (${text(detail.type, 'Object3D')})`,
    `uuid     ${text(detail.uuid, '?')}`,
    `parent   ${detail.parent === null ? '(scene root)' : text(detail.parent, '?')}`,
    `children ${String(detail.children ?? 0)}`,
    `visible  ${detail.visible === false ? 'no' : 'yes'}`,
    `position ${triple(detail.position)}`,
    `rotation ${triple(detail.rotation)}`,
    `scale    ${triple(detail.scale)}`
  ];

  if (typeof detail.material === 'string')
  {
    lines.push(`material ${detail.material}`);
  }

  if (typeof detail.vertices === 'number')
  {
    lines.push(`vertices ${detail.vertices}`);
  }

  if (Array.isArray(detail.changed))
  {
    lines.push('');
    lines.push(detail.changed.length === 0
      ? 'nothing changed: no valid values were supplied.'
      : `changed: ${detail.changed.map((c) => String(c)).join(', ')}`);
  }

  return lines.join('\n');
}

export interface SelectorArgs
{
  uuid?: string;
  name?: string;
}

export async function build_get_object_result(host: SceneHost, args: SelectorArgs): Promise<SceneToolResult>
{
  if (!host.connected)
  {
    return not_connected();
  }

  let payload: unknown;

  try
  {
    payload = await host.send('get_object', { ...args });
  }
  catch (error)
  {
    return failure(`Reading the object failed ${describe_error(error)}`);
  }

  if (typeof payload !== 'object' || payload === null)
  {
    return failure('The app returned a malformed object payload.');
  }

  return { content: [{ type: 'text', text: render_detail(payload as Record<string, unknown>) }] };
}

export interface SetObjectArgs extends SelectorArgs
{
  position?: number[];
  rotation?: number[];
  scale?: number[];
  visible?: boolean;
  capture?: boolean;
}

export async function build_set_object_result(host: SceneHost, args: SetObjectArgs): Promise<SceneToolResult>
{
  if (!host.connected)
  {
    return not_connected();
  }

  const { capture, ...changes } = args;

  let payload: unknown;

  try
  {
    payload = await host.send('set_object', { ...changes });
  }
  catch (error)
  {
    return failure(`Updating the object failed ${describe_error(error)}`);
  }

  if (typeof payload !== 'object' || payload === null)
  {
    return failure('The app returned a malformed object payload.');
  }

  const content: Array<ImageBlock | TextBlock> = [];

  if (capture === true)
  {
    await attach_capture(host, content);
  }

  content.push({ type: 'text', text: render_detail(payload as Record<string, unknown>) });

  return { content };
}

export function register_scene_tools(server: McpServer, host: BridgeHost): void
{
  server.registerTool(
    'inspect_scene',
    {
      title: 'Inspect the OHZI scene graph',
      description: 'Walk the active scene and return its node tree with names, uuids, transforms, materials and vertex counts. Depth and node count are capped and any truncation is reported. Use filter to narrow to a branch.',
      inputSchema: {
        depth: z.number().int().positive().max(20).optional().describe('How many levels to descend. Defaults to 4.'),
        max_nodes: z.number().int().positive().max(2000).optional().describe('Maximum nodes to return. Defaults to 200.'),
        filter: z.string().optional().describe('Keep only branches whose node name or type contains this, case insensitive.')
      },
      annotations: { readOnlyHint: true }
    },
    async (args) => build_inspect_result(host, args)
  );

  server.registerTool(
    'get_object',
    {
      title: 'Read one OHZI scene object',
      description: 'Return the full transform, parent, material and vertex count of a single object, selected by uuid or name. uuid wins when both are given because names are not unique.',
      inputSchema: {
        uuid: z.string().optional().describe('Exact uuid from inspect_scene.'),
        name: z.string().optional().describe('Exact object name.')
      },
      annotations: { readOnlyHint: true }
    },
    async (args) => build_get_object_result(host, args)
  );

  server.registerTool(
    'set_object',
    {
      title: 'Move or hide an OHZI scene object',
      description: 'Change the position, rotation, scale or visibility of one object in the running app and return its resulting state. Pass capture to get a screenshot of the result in the same call. Rotation is in radians.',
      inputSchema: {
        uuid: z.string().optional().describe('Exact uuid from inspect_scene.'),
        name: z.string().optional().describe('Exact object name.'),
        position: z.array(z.number()).max(3).optional().describe('[x, y, z]. Omitted or non-numeric axes are left untouched.'),
        rotation: z.array(z.number()).max(3).optional().describe('[x, y, z] in RADIANS, matching Three.js Euler.'),
        scale: z.array(z.number()).max(3).optional().describe('[x, y, z].'),
        visible: z.boolean().optional().describe('Show or hide the object.'),
        capture: z.boolean().optional().describe('Also return a screenshot of the result, so one call both acts and shows.')
      }
    },
    async (args) => build_set_object_result(host, args)
  );
}
