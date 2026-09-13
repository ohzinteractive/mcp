import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BridgeHost } from '../bridge/BridgeHost.js';
import type { ImageBlock, TextBlock, ToolHost, ToolResult } from './shared.js';
import { attach_capture, describe_error, failure, not_connected, triple } from './shared.js';

function render_state(state: Record<string, unknown>): string
{
  const lines = [
    `position   ${triple(state.position)}`,
    `fov        ${String(state.fov ?? '?')}`,
    `near/far   ${String(state.near ?? '?')} / ${String(state.far ?? '?')}`,
    `clear      ${String(state.clear_color ?? '?')} @ alpha ${String(state.clear_alpha ?? '?')}`
  ];

  const controller = state.controller;

  if (typeof controller === 'object' && controller !== null)
  {
    const orbit = controller as Record<string, unknown>;

    lines.push('');
    lines.push('orbital controller (angles in DEGREES, zoom normalised 0-1):');
    lines.push(`  tilt        ${String(orbit.tilt ?? '?')}`);
    lines.push(`  orientation ${String(orbit.orientation ?? '?')}`);
    lines.push(`  azimuth     ${String(orbit.azimuth ?? '?')}`);
    lines.push(`  zoom        ${String(orbit.zoom ?? '?')}  (min ${String(orbit.min_zoom ?? '?')}, max ${String(orbit.max_zoom ?? '?')})`);
    lines.push(`  target      ${triple(orbit.target)}`);
  }
  else
  {
    lines.push('');
    lines.push('no camera controller on the active scene: the camera is driven directly, so position is writable.');
  }

  if (Array.isArray(state.changed))
  {
    lines.push('');
    lines.push(state.changed.length === 0
      ? 'nothing changed: no valid values were supplied.'
      : `changed: ${state.changed.map((c) => String(c)).join(', ')}`);
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
    payload = await host.send(cmd, args);
  }
  catch (error)
  {
    return failure(`${label} failed ${describe_error(error)}`);
  }

  if (typeof payload !== 'object' || payload === null)
  {
    return failure('The app returned a malformed camera payload.');
  }

  const content: Array<ImageBlock | TextBlock> = [];

  if (capture)
  {
    await attach_capture(host, content);
  }

  content.push({ type: 'text', text: render_state(payload as Record<string, unknown>) });

  return { content };
}

export interface CameraArgs
{
  tilt?: number;
  orientation?: number;
  azimuth?: number;
  zoom?: number;
  fov?: number;
  target?: number[];
  position?: number[];
  capture?: boolean;
}

export interface FrameArgs
{
  uuid?: string;
  name?: string;
  scale?: number;
  capture?: boolean;
}

export async function build_get_camera_result(host: ToolHost, _args: Record<string, never>): Promise<ToolResult>
{
  return run(host, 'get_camera', {}, false, 'Reading the camera');
}

export async function build_set_camera_result(host: ToolHost, args: CameraArgs): Promise<ToolResult>
{
  const { capture, ...changes } = args;

  return run(host, 'set_camera', { ...changes }, capture === true, 'Updating the camera');
}

export async function build_frame_result(host: ToolHost, args: FrameArgs): Promise<ToolResult>
{
  const { capture, ...request } = args;

  return run(host, 'frame_object', { ...request }, capture === true, 'Framing the object');
}

export function register_camera_tools(server: McpServer, host: BridgeHost): void
{
  server.registerTool(
    'get_camera',
    {
      title: 'Read the OHZI camera',
      description: 'Return the active camera position, fov, near/far, clear colour, and the orbital controller state when one is driving it.',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => build_get_camera_result(host, {})
  );

  server.registerTool(
    'set_camera',
    {
      title: 'Move the OHZI camera',
      description: 'Drive the camera and return its resulting state. The OHZI CameraController is ORBITAL, so prefer tilt, orientation, azimuth, zoom and target. A raw position is refused while a controller is active because the controller would overwrite it on the next frame. Pass capture to see the result in the same call.',
      inputSchema: {
        tilt: z.number().optional().describe('Vertical orbit angle in DEGREES.'),
        orientation: z.number().optional().describe('Horizontal orbit angle in DEGREES.'),
        azimuth: z.number().optional().describe('Azimuth in DEGREES.'),
        zoom: z.number().min(0).max(1).optional().describe('Normalised zoom, 0 is farthest and 1 is nearest.'),
        fov: z.number().positive().max(179).optional().describe('Field of view in degrees; refreshes the projection matrix.'),
        target: z.array(z.number()).length(3).optional().describe('[x, y, z] point the camera orbits around.'),
        position: z.array(z.number()).length(3).optional().describe('Raw world position. Only allowed when no CameraController is active.'),
        capture: z.boolean().optional().describe('Also return a screenshot of the result.')
      }
    },
    async (args) => build_set_camera_result(host, args)
  );

  server.registerTool(
    'frame_object',
    {
      title: 'Frame an object in the OHZI camera',
      description: 'Point the camera at one scene object and fit it in view, using the controller bounding-box focus. Select by uuid or name. Requires a camera controller on the active scene.',
      inputSchema: {
        uuid: z.string().optional().describe('Exact uuid from inspect_scene.'),
        name: z.string().optional().describe('Exact object name.'),
        scale: z.number().positive().optional().describe('Framing margin. 1 fits tightly, higher pulls back. Defaults to 1.'),
        capture: z.boolean().optional().describe('Also return a screenshot of the result.')
      }
    },
    async (args) => build_frame_result(host, args)
  );
}
