import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BridgeHost } from '../bridge/BridgeHost.js';
import type { ImageBlock, TextBlock, ToolHost, ToolResult } from './shared.js';
import { attach_capture, describe_error, failure, not_connected } from './shared.js';

export interface DebugDrawArgs
{
  shape: 'cube' | 'sphere' | 'plane' | 'math_sphere' | 'bounding_box';
  position?: [number, number, number];
  size?: number;
  color?: number | string;
  object?: { name?: string; uuid?: string };
  capture?: boolean;
}

export async function build_debug_draw_result(host: ToolHost, args: DebugDrawArgs): Promise<ToolResult>
{
  if (!host.connected)
  {
    return not_connected();
  }

  const command_args: Record<string, unknown> = { shape: args.shape };

  if (args.position !== undefined)
  {
    command_args.position = args.position;
  }

  if (args.size !== undefined)
  {
    command_args.size = args.size;
  }

  if (args.color !== undefined)
  {
    command_args.color = args.color;
  }

  if (args.object !== undefined)
  {
    command_args.object = args.object;
  }

  let payload: unknown;

  try
  {
    payload = await host.send('debug_draw', command_args);
  }
  catch (error)
  {
    return failure(`Drawing failed ${describe_error(error)}`);
  }

  if (typeof payload !== 'object' || payload === null)
  {
    return failure('The app returned a malformed draw payload.');
  }

  const result = payload as { id?: unknown; shape?: unknown; helpers?: unknown };
  const lines = [
    `drew ${String(result.shape ?? args.shape)} ${String(result.id ?? '?')}`,
    `${String(result.helpers ?? '?')} debug_draw helpers on screen`
  ];

  const content: Array<ImageBlock | TextBlock> = [];

  if (args.capture === true)
  {
    await attach_capture(host, content);
  }

  content.push({ type: 'text', text: lines.join('\n') });

  return { content };
}

export interface DebugClearArgs
{
  id?: string;
  capture?: boolean;
}

export async function build_debug_clear_result(host: ToolHost, args: DebugClearArgs): Promise<ToolResult>
{
  if (!host.connected)
  {
    return not_connected();
  }

  const command_args: Record<string, unknown> = {};

  if (args.id !== undefined)
  {
    command_args.id = args.id;
  }

  let payload: unknown;

  try
  {
    payload = await host.send('debug_clear', command_args);
  }
  catch (error)
  {
    return failure(`Clearing failed ${describe_error(error)}`);
  }

  if (typeof payload !== 'object' || payload === null)
  {
    return failure('The app returned a malformed clear payload.');
  }

  const result = payload as { removed?: unknown; helpers?: unknown };
  const lines = [
    `removed ${String(result.removed ?? '?')}`,
    `${String(result.helpers ?? '?')} debug_draw helpers on screen`
  ];

  const content: Array<ImageBlock | TextBlock> = [];

  if (args.capture === true)
  {
    await attach_capture(host, content);
  }

  content.push({ type: 'text', text: lines.join('\n') });

  return { content };
}

export function register_debug_tools(server: McpServer, host: BridgeHost): void
{
  server.registerTool(
    'debug_draw',
    {
      title: 'Draw a debug helper in the OHZI app',
      description: 'Draw a debug helper in the running app to mark a position, a volume or an object. cube, sphere and plane go to the Debug overlay scene, which is drawn on top of the frame after the active render mode, so they stay visible in any render mode. math_sphere and bounding_box go into the current scene instead. plane and math_sphere are 20% opaque. bounding_box outlines an existing object and needs object. Helpers persist until debug_clear, including across view changes. Pass capture to see the result in the same call.',
      inputSchema: {
        shape: z.enum(['cube', 'sphere', 'plane', 'math_sphere', 'bounding_box']).describe('What to draw.'),
        position: z.tuple([z.number(), z.number(), z.number()]).optional().describe('World position [x, y, z]. Defaults to [0, 0, 0]. Ignored by bounding_box.'),
        size: z.number().positive().optional().describe('Cube edge, sphere and math_sphere radius, or plane width and height. Defaults to 1. Ignored by bounding_box.'),
        color: z.union([z.number().int().nonnegative(), z.string()]).optional().describe('Any three.js color: a hex number such as 0xff0000 or a CSS name or string. Defaults per shape: red for cube, sphere and math_sphere, green for plane, yellow for bounding_box.'),
        object: z.object({
          name: z.string().optional().describe('Exact object name.'),
          uuid: z.string().optional().describe('Object uuid. Wins over name.')
        }).optional().describe('The object to outline in the current scene. Required for bounding_box, ignored by other shapes.'),
        capture: z.boolean().optional().describe('Also return a screenshot of the result.')
      }
    },
    async (args) => build_debug_draw_result(host, args)
  );

  server.registerTool(
    'debug_clear',
    {
      title: 'Clear OHZI debug helpers',
      description: 'Remove helpers drawn with debug_draw: one by id, or all of them when no id is given. Never removes the helpers the app draws for itself. Returns how many were removed and how many remain. Pass capture to see the result in the same call.',
      inputSchema: {
        id: z.string().optional().describe('Helper id returned by debug_draw. Omit to remove every debug_draw helper.'),
        capture: z.boolean().optional().describe('Also return a screenshot of the result.')
      }
    },
    async (args) => build_debug_clear_result(host, args)
  );
}
