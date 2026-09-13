import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BridgeHost } from '../bridge/BridgeHost.js';
import type { ImageBlock, TextBlock, ToolHost, ToolResult } from './shared.js';
import { attach_capture, describe_error, failure, not_connected, triple } from './shared.js';

// Gestures span real time, so they need more headroom than a plain read.
const INPUT_TIMEOUT_MS = 20000;

function render(payload: Record<string, unknown>): string
{
  const dispatched = Array.isArray(payload.dispatched)
    ? payload.dispatched.map((entry) => String(entry))
    : [];

  const lines = [`dispatched: ${dispatched.length === 0 ? '(nothing)' : dispatched.join(' -> ')}`];

  if (Array.isArray(payload.at))
  {
    lines.push(`at         ${triple(payload.at)} (viewport css pixels)`);
  }

  if (Array.isArray(payload.from))
  {
    lines.push(`from       ${triple(payload.from)}`);
  }

  if (Array.isArray(payload.to))
  {
    lines.push(`to         ${triple(payload.to)}`);
  }

  if (typeof payload.code === 'string')
  {
    lines.push(`key        ${payload.code}`);
  }

  if (typeof payload.delta === 'number')
  {
    lines.push(`delta      ${payload.delta}`);
  }

  return lines.join('\n');
}

async function run(host: ToolHost, cmd: string, args: Record<string, unknown>, capture: boolean, label: string): Promise<ToolResult>
{
  if (!host.connected)
  {
    return not_connected();
  }

  let payload: unknown;

  try
  {
    payload = await host.send(cmd, args, INPUT_TIMEOUT_MS);
  }
  catch (error)
  {
    return failure(`${label} failed ${describe_error(error)}`);
  }

  if (typeof payload !== 'object' || payload === null)
  {
    return failure('The app returned a malformed input payload.');
  }

  const content: Array<ImageBlock | TextBlock> = [];

  if (capture)
  {
    await attach_capture(host, content);
  }

  content.push({ type: 'text', text: render(payload as Record<string, unknown>) });

  return { content };
}

function forward(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args))
  {
    if (key !== 'capture' && value !== undefined)
    {
      out[key] = value;
    }
  }

  return out;
}

export interface PointerArgs
{
  action?: string;
  x: number;
  y: number;
  button?: string;
  space?: string;
  hold_ms?: number;
  capture?: boolean;
}

export interface DragArgs
{
  from: number[];
  to: number[];
  steps?: number;
  duration_ms?: number;
  button?: string;
  space?: string;
  capture?: boolean;
}

export interface ScrollArgs
{
  delta: number;
  x?: number;
  y?: number;
  space?: string;
  capture?: boolean;
}

export interface KeyArgs
{
  code: string;
  action?: string;
  hold_ms?: number;
  capture?: boolean;
}

export async function build_pointer_result(host: ToolHost, args: PointerArgs): Promise<ToolResult>
{
  return run(host, 'pointer', forward(args as unknown as Record<string, unknown>), args.capture === true, 'Pointer input');
}

export async function build_drag_result(host: ToolHost, args: DragArgs): Promise<ToolResult>
{
  return run(host, 'drag', forward(args as unknown as Record<string, unknown>), args.capture === true, 'Drag input');
}

export async function build_scroll_result(host: ToolHost, args: ScrollArgs): Promise<ToolResult>
{
  return run(host, 'scroll', forward(args as unknown as Record<string, unknown>), args.capture === true, 'Scroll input');
}

export async function build_key_result(host: ToolHost, args: KeyArgs): Promise<ToolResult>
{
  return run(host, 'key', forward(args as unknown as Record<string, unknown>), args.capture === true, 'Key input');
}

export function register_input_tools(server: McpServer, host: BridgeHost): void
{
  const space = z.enum(['pixels', 'ndc']).optional()
    .describe("Coordinate space. 'pixels' (default) is CSS pixels relative to the canvas; 'ndc' is [-1..1] with y up.");
  const button = z.enum(['left', 'middle', 'right']).optional().describe('Mouse button. Defaults to left.');
  const capture = z.boolean().optional().describe('Also return a screenshot of the result.');

  server.registerTool(
    'pointer',
    {
      title: 'Send pointer input to the OHZI app',
      description: 'Dispatch a real mouse event at the canvas so the app sees it through its normal input path. A click holds briefly between press and release, because PIT clears its pressed and released flags each frame and the app must observe both.',
      inputSchema: {
        action: z.enum(['click', 'down', 'up', 'move']).optional().describe('Defaults to click.'),
        x: z.number().describe('Horizontal position in the chosen space.'),
        y: z.number().describe('Vertical position in the chosen space.'),
        button,
        space,
        hold_ms: z.number().positive().max(10000).optional().describe('Time held between press and release. Defaults to 60ms, roughly four frames.'),
        capture
      }
    },
    async (args) => build_pointer_result(host, args)
  );

  server.registerTool(
    'drag',
    {
      title: 'Drag across the OHZI canvas',
      description: 'Press at one point, move through interpolated steps, and release at another. Use this for orbiting, panning or any gesture the app reads from pointer deltas.',
      inputSchema: {
        from: z.array(z.number()).length(2).describe('[x, y] start point.'),
        to: z.array(z.number()).length(2).describe('[x, y] end point.'),
        steps: z.number().int().positive().max(120).optional().describe('Intermediate moves. Defaults to 8.'),
        duration_ms: z.number().positive().max(10000).optional().describe('Total gesture time. Defaults to 240ms.'),
        button,
        space,
        capture
      }
    },
    async (args) => build_drag_result(host, args)
  );

  server.registerTool(
    'scroll',
    {
      title: 'Scroll the OHZI canvas',
      description: 'Dispatch a wheel event. Negative deltas scroll up, positive down. PIT maps this to scroll and zoom depending on the app.',
      inputSchema: {
        delta: z.number().describe('Wheel deltaY.'),
        x: z.number().optional().describe('Pointer position for the wheel event. Defaults to 0.'),
        y: z.number().optional().describe('Pointer position for the wheel event. Defaults to 0.'),
        space,
        capture
      }
    },
    async (args) => build_scroll_result(host, args)
  );

  server.registerTool(
    'key',
    {
      title: 'Send keyboard input to the OHZI app',
      description: 'Dispatch a keyboard event. Note that KeyboardInput only tracks keys the app has registered with register_key, so an unregistered code will dispatch but be ignored.',
      inputSchema: {
        code: z.string().describe("KeyboardEvent code, for example 'Space', 'KeyW' or 'ArrowLeft'."),
        action: z.enum(['press', 'down', 'up']).optional().describe('Defaults to press, which is a keydown then a keyup.'),
        hold_ms: z.number().positive().max(10000).optional().describe('Time held between keydown and keyup. Defaults to 60ms.'),
        capture
      }
    },
    async (args) => build_key_result(host, args)
  );
}
