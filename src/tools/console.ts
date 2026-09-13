import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BridgeHost } from '../bridge/BridgeHost.js';

const DEFAULT_LIMIT = 50;

type ConsoleHost = Pick<BridgeHost, 'connected' | 'send'>;

export interface ConsoleArgs
{
  level?: 'log' | 'info' | 'warn' | 'error';
  limit?: number;
  since?: number;
}

export interface ConsoleToolResult
{
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

interface ConsoleEntry
{
  seq: number;
  level: string;
  message: string;
}

function failure(text: string): ConsoleToolResult
{
  return { content: [{ type: 'text', text }], isError: true };
}

function success(text: string): ConsoleToolResult
{
  return { content: [{ type: 'text', text }] };
}

function is_entry(value: unknown): value is ConsoleEntry
{
  if (typeof value !== 'object' || value === null)
  {
    return false;
  }

  const entry = value as Record<string, unknown>;

  return typeof entry.seq === 'number'
    && typeof entry.level === 'string'
    && typeof entry.message === 'string';
}

function number_or(value: unknown, fallback: number): number
{
  return typeof value === 'number' ? value : fallback;
}

export async function build_console_result(host: ConsoleHost, args: ConsoleArgs): Promise<ConsoleToolResult>
{
  if (!host.connected)
  {
    return failure('OHZI app: not connected. Start the dev server with `yarn start`, load the page, then try again.');
  }

  const command_args: Record<string, unknown> = {
    // Bounded by default: an unbounded read can swallow the whole context.
    limit: args.limit === undefined ? DEFAULT_LIMIT : args.limit
  };

  if (args.level !== undefined)
  {
    command_args.level = args.level;
  }

  if (args.since !== undefined)
  {
    command_args.since = args.since;
  }

  let payload: unknown;

  try
  {
    payload = await host.send('get_console', command_args);
  }
  catch (error)
  {
    const details = error as { code?: string; message?: string };
    const code = details.code === undefined ? 'unknown' : details.code;
    const message = details.message === undefined ? 'no message' : details.message;

    return failure(`Reading the console failed (${code}): ${message}`);
  }

  if (typeof payload !== 'object' || payload === null || !Array.isArray((payload as { entries?: unknown }).entries))
  {
    return failure('The app returned a malformed console payload.');
  }

  const record = payload as Record<string, unknown>;
  const entries = (record.entries as unknown[]).filter(is_entry);
  const dropped = number_or(record.dropped, 0);
  const total = number_or(record.total, entries.length);
  const capacity = number_or(record.capacity, 0);

  if (entries.length === 0)
  {
    return success(`No console entries recorded (${total} total seen, ${dropped} dropped, capacity ${capacity}).`);
  }

  const first = entries[0].seq;
  const last = entries[entries.length - 1].seq;

  const header = `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, seq ${first}-${last} of ${total} seen, ${dropped} dropped, capacity ${capacity}.`;
  const hint = `Poll incrementally with since=${last}.`;
  const lines = entries.map((entry) => `[${entry.seq}] ${entry.level.padEnd(5)} ${entry.message}`);

  return success([header, hint, '', ...lines].join('\n'));
}

export function register_console_tool(server: McpServer, host: BridgeHost): void
{
  server.registerTool(
    'get_console',
    {
      title: 'Read the OHZI app console',
      description: 'Read recent console output and uncaught errors from the running OHZI app. Use this to diagnose anything a screenshot cannot show. Pass since with the highest seq you have already seen to fetch only new entries.',
      inputSchema: {
        level: z.enum(['log', 'info', 'warn', 'error']).optional()
          .describe('Return only entries at this level.'),
        limit: z.number().int().positive().max(200).optional()
          .describe('Maximum entries to return, most recent last. Defaults to 50.'),
        since: z.number().int().nonnegative().optional()
          .describe('Return only entries with a seq greater than this.')
      },
      annotations: { readOnlyHint: true }
    },
    async (args) => build_console_result(host, args)
  );
}
