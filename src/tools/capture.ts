import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BridgeHost } from '../bridge/BridgeHost.js';
import { CAPTURE_TIMEOUT_MS } from '../config.js';

type CaptureHost = Pick<BridgeHost, 'connected' | 'send'>;

export interface CaptureArgs
{
  mode?: 'fast' | 'hires';
  width?: number;
  height?: number;
}

type ImageBlock = { type: 'image'; data: string; mimeType: string };
type TextBlock = { type: 'text'; text: string };

export interface CaptureToolResult
{
  // The SDK's CallToolResult carries an index signature; without it this type
  // is not assignable to a tool callback's return type.
  [key: string]: unknown;
  content: Array<ImageBlock | TextBlock>;
  isError?: boolean;
}

interface CapturePayload
{
  mode: string;
  mime_type: string;
  width: number;
  height: number;
  bytes: number;
  data: string;
}

function is_payload(value: unknown): value is CapturePayload
{
  if (typeof value !== 'object' || value === null)
  {
    return false;
  }

  const payload = value as Record<string, unknown>;

  return typeof payload.data === 'string'
    && payload.data.length > 0
    && typeof payload.width === 'number'
    && typeof payload.height === 'number';
}

function failure(text: string): CaptureToolResult
{
  return { content: [{ type: 'text', text }], isError: true };
}

export async function build_capture_result(host: CaptureHost, args: CaptureArgs): Promise<CaptureToolResult>
{
  if (!host.connected)
  {
    return failure('OHZI app: not connected. Start the dev server with `yarn start`, load the page, then try again.');
  }

  // Forward only the keys the caller actually set, so the app applies its own
  // defaults rather than receiving explicit undefined.
  const command_args: Record<string, unknown> = {};

  if (args.mode !== undefined)
  {
    command_args.mode = args.mode;
  }

  if (args.width !== undefined)
  {
    command_args.width = args.width;
  }

  if (args.height !== undefined)
  {
    command_args.height = args.height;
  }

  let payload: unknown;

  try
  {
    payload = await host.send('capture_viewport', command_args, CAPTURE_TIMEOUT_MS);
  }
  catch (error)
  {
    const details = error as { code?: string; message?: string };
    const code = details.code === undefined ? 'unknown' : details.code;
    const message = details.message === undefined ? 'no message' : details.message;

    return failure(`Capture failed (${code}): ${message}`);
  }

  if (!is_payload(payload))
  {
    return failure('The app returned a malformed capture payload with no image data.');
  }

  const mime_type = typeof payload.mime_type === 'string' ? payload.mime_type : 'image/png';
  const kilobytes = Math.round(payload.bytes / 1024);

  return {
    content: [
      { type: 'image', data: payload.data, mimeType: mime_type },
      { type: 'text', text: `${payload.mode} capture, ${payload.width}x${payload.height}, ${kilobytes} KB` }
    ]
  };
}

export function register_capture_tool(server: McpServer, host: BridgeHost): void
{
  server.registerTool(
    'capture_viewport',
    {
      title: 'Capture the OHZI viewport',
      description: 'Render the running OHZI app to a PNG and return it as an image. Use fast (default) to read the live canvas at its current size; use hires to re-render at a larger size, which needs an active camera and takes longer.',
      inputSchema: {
        mode: z.enum(['fast', 'hires']).optional()
          .describe('fast reads the live canvas at its current size (default). hires re-renders in 1024px tiles and requires an active camera.'),
        width: z.number().int().positive().max(8192).optional()
          .describe('hires only. Defaults to the canvas width. Clamped to 8192.'),
        height: z.number().int().positive().max(8192).optional()
          .describe('hires only. Defaults to the canvas height. Clamped to 8192.')
      },
      annotations: { readOnlyHint: true }
    },
    async (args) => build_capture_result(host, args)
  );
}
