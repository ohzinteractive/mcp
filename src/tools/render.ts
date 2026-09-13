import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BridgeHost } from '../bridge/BridgeHost.js';
import type { ImageBlock, TextBlock, ToolHost, ToolResult } from './shared.js';
import { attach_capture, describe_error, failure, not_connected } from './shared.js';

async function fetch_payload(host: ToolHost, cmd: string, args: Record<string, unknown>, label: string): Promise<unknown>
{
  try
  {
    return await host.send(cmd, args);
  }
  catch (error)
  {
    return failure(`${label} failed ${describe_error(error)}`);
  }
}

function is_failure(value: unknown): value is ToolResult
{
  return typeof value === 'object' && value !== null && (value as ToolResult).isError === true;
}

export async function build_list_render_modes_result(host: ToolHost): Promise<ToolResult>
{
  if (!host.connected)
  {
    return not_connected();
  }

  const payload = await fetch_payload(host, 'list_render_modes', {}, 'Listing render modes');

  if (is_failure(payload))
  {
    return payload;
  }

  const raw = Array.isArray(payload)
    ? payload
    : (typeof payload === 'object' && payload !== null && Array.isArray((payload as { modes?: unknown }).modes)
      ? (payload as { modes: unknown[] }).modes
      : null);

  if (raw === null)
  {
    return failure('The app returned a malformed render mode list.');
  }

  const lines = raw.map((entry) =>
  {
    const mode = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    const options = Array.isArray(mode.options) && mode.options.length > 0
      ? `  options: ${mode.options.map((o) => String(o)).join(', ')}`
      : '';

    return `${String(mode.name ?? '?')} — ${String(mode.description ?? '')}${options}`;
  });

  return { content: [{ type: 'text', text: [`${raw.length} render modes:`, '', ...lines].join('\n') }] };
}

export interface SetRenderModeArgs
{
  name: string;
  options?: Record<string, boolean>;
  capture?: boolean;
}

export async function build_set_render_mode_result(host: ToolHost, args: SetRenderModeArgs): Promise<ToolResult>
{
  if (!host.connected)
  {
    return not_connected();
  }

  const command_args: Record<string, unknown> = { name: args.name };

  if (args.options !== undefined)
  {
    command_args.options = args.options;
  }

  const payload = await fetch_payload(host, 'set_render_mode', command_args, 'Setting the render mode');

  if (is_failure(payload))
  {
    return payload;
  }

  const active = typeof payload === 'object' && payload !== null
    ? String((payload as { active?: unknown }).active ?? args.name)
    : args.name;

  const content: Array<ImageBlock | TextBlock> = [];

  if (args.capture === true)
  {
    await attach_capture(host, content);
  }

  content.push({ type: 'text', text: `active render mode: ${active}` });

  return { content };
}

export async function build_performance_result(host: ToolHost): Promise<ToolResult>
{
  if (!host.connected)
  {
    return not_connected();
  }

  const payload = await fetch_payload(host, 'get_performance', {}, 'Reading performance');

  if (is_failure(payload))
  {
    return payload;
  }

  if (typeof payload !== 'object' || payload === null)
  {
    return failure('The app returned a malformed performance payload.');
  }

  const report = payload as Record<string, unknown>;
  const canvas = (typeof report.canvas === 'object' && report.canvas !== null ? report.canvas : {}) as Record<string, unknown>;

  const lines = [
    `fps          ${String(report.fps ?? '?')} (smoothed ${String(report.smooth_fps ?? '?')})`,
    `frame time   ${String(report.frame_ms ?? '?')} ms`,
    `elapsed      ${String(report.elapsed_s ?? '?')} s`,
    `canvas       ${String(canvas.width ?? '?')}x${String(canvas.height ?? '?')} logical, ${String(canvas.render_width ?? '?')}x${String(canvas.render_height ?? '?')} physical @ dpr ${String(canvas.dpr ?? '?')}`
  ];

  const counters: string[] = [];

  for (const [label, key] of [['draw calls', 'draw_calls'], ['triangles', 'triangles'], ['geometries', 'geometries'], ['textures', 'textures']] as const)
  {
    if (typeof report[key] === 'number')
    {
      counters.push(`${label} ${String(report[key])}`);
    }
  }

  lines.push(counters.length === 0
    ? 'renderer counters not reported by this renderer'
    : `renderer     ${counters.join(', ')}`);

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

export function register_render_tools(server: McpServer, host: BridgeHost): void
{
  server.registerTool(
    'list_render_modes',
    {
      title: 'List OHZI render modes',
      description: 'List the render modes this app has registered, with their descriptions and the options each accepts.',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => build_list_render_modes_result(host)
  );

  server.registerTool(
    'set_render_mode',
    {
      title: 'Switch the OHZI render mode',
      description: 'Swap the active rendering pipeline, for example to enable bloom or SSAO. Call list_render_modes first for the valid names and their options. Pass capture to see the result in the same call.',
      inputSchema: {
        name: z.string().describe('Mode name from list_render_modes. Matched case insensitively.'),
        options: z.record(z.string(), z.boolean()).optional().describe('Mode-specific boolean options, for example { use_ssaa: true }.'),
        capture: z.boolean().optional().describe('Also return a screenshot of the result.')
      }
    },
    async (args) => build_set_render_mode_result(host, args)
  );

  server.registerTool(
    'get_performance',
    {
      title: 'Read OHZI performance',
      description: 'Report framerate, frame time, canvas size in logical and physical pixels, and renderer counters when the renderer exposes them.',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => build_performance_result(host)
  );
}
