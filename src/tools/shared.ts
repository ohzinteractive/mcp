import type { BridgeHost } from '../bridge/BridgeHost.js';
import { CAPTURE_TIMEOUT_MS } from '../config.js';

export type ImageBlock = { type: 'image'; data: string; mimeType: string };
export type TextBlock = { type: 'text'; text: string };

export interface ToolResult
{
  [key: string]: unknown;
  content: Array<ImageBlock | TextBlock>;
  isError?: boolean;
}

export type ToolHost = Pick<BridgeHost, 'connected' | 'send'>;

export function failure(text: string): ToolResult
{
  return { content: [{ type: 'text', text }], isError: true };
}

export function not_connected(): ToolResult
{
  return failure('OHZI app: not connected. Start the dev server with `yarn start`, load the page, then try again.');
}

export function describe_error(error: unknown): string
{
  const details = error as { code?: string; message?: string };
  const code = details.code === undefined ? 'unknown' : details.code;
  const message = details.message === undefined ? 'no message' : details.message;

  return `(${code}): ${message}`;
}

export function triple(value: unknown): string
{
  return Array.isArray(value) ? value.join(', ') : '?';
}

export function text_or(value: unknown, fallback: string): string
{
  return typeof value === 'string' ? value : fallback;
}

// Act and see in one call. A failed screenshot must never hide the fact that
// the change itself succeeded, so the failure is reported as a note rather
// than turning the whole result into an error.
export async function attach_capture(host: ToolHost, content: Array<ImageBlock | TextBlock>): Promise<void>
{
  try
  {
    const shot = await host.send('capture_viewport', {}, CAPTURE_TIMEOUT_MS) as { data?: unknown; mime_type?: unknown };

    if (typeof shot.data === 'string' && shot.data.length > 0)
    {
      content.push({ type: 'image', data: shot.data, mimeType: text_or(shot.mime_type, 'image/png') });
    }
  }
  catch (error)
  {
    content.push({ type: 'text', text: `The change applied, but the follow-up capture failed ${describe_error(error)}` });
  }
}
