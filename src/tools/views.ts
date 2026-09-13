import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BridgeHost } from '../bridge/BridgeHost.js';
import type { ImageBlock, TextBlock, ToolHost, ToolResult } from './shared.js';
import { attach_capture, describe_error, failure, not_connected } from './shared.js';

export async function build_list_views_result(host: ToolHost): Promise<ToolResult>
{
  if (!host.connected)
  {
    return not_connected();
  }

  let payload: unknown;

  try
  {
    payload = await host.send('list_views', {});
  }
  catch (error)
  {
    return failure(`Listing views failed ${describe_error(error)}`);
  }

  if (typeof payload !== 'object' || payload === null)
  {
    return failure('The app returned a malformed view list.');
  }

  const result = payload as { current?: unknown; views?: unknown };
  const views = Array.isArray(result.views) ? result.views : [];

  const lines = views.map((entry) =>
  {
    const view = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    const marker = view.current === true ? '  <- current' : '';

    return `${String(view.name ?? '?')}  ${String(view.url ?? '')}${marker}`;
  });

  const header = `${views.length} views, current: ${result.current === null || result.current === undefined ? '(none)' : String(result.current)}`;

  return { content: [{ type: 'text', text: [header, '', ...lines].join('\n') }] };
}

export interface GoToViewArgs
{
  name: string;
  change_url?: boolean;
  skip?: boolean;
  capture?: boolean;
}

export async function build_go_to_view_result(host: ToolHost, args: GoToViewArgs): Promise<ToolResult>
{
  if (!host.connected)
  {
    return not_connected();
  }

  const command_args: Record<string, unknown> = { name: args.name };

  if (args.change_url !== undefined)
  {
    command_args.change_url = args.change_url;
  }

  if (args.skip !== undefined)
  {
    command_args.skip = args.skip;
  }

  let payload: unknown;

  try
  {
    payload = await host.send('go_to_view', command_args);
  }
  catch (error)
  {
    return failure(`Navigating failed ${describe_error(error)}`);
  }

  if (typeof payload !== 'object' || payload === null)
  {
    return failure('The app returned a malformed navigation payload.');
  }

  const result = payload as { requested?: unknown; current?: unknown };
  const requested = String(result.requested ?? args.name);
  const current = result.current === null || result.current === undefined ? '(none)' : String(result.current);

  const lines = [`requested: ${requested}`, `current:   ${current}`];

  // Transitions are animated, so the active view often lags the request by a
  // few frames. Saying so avoids it reading as a failure.
  if (current !== requested)
  {
    lines.push('');
    lines.push(`the app is still on '${current}': view transitions are animated, so give it a moment and read the status again.`);
  }

  const content: Array<ImageBlock | TextBlock> = [];

  if (args.capture === true)
  {
    await attach_capture(host, content);
  }

  content.push({ type: 'text', text: lines.join('\n') });

  return { content };
}

export function register_view_tools(server: McpServer, host: BridgeHost): void
{
  server.registerTool(
    'list_views',
    {
      title: 'List OHZI views',
      description: 'List the views registered with ViewManager, with their urls, and mark which one is active.',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => build_list_views_result(host)
  );

  server.registerTool(
    'go_to_view',
    {
      title: 'Navigate the OHZI app to a view',
      description: 'Transition the running app to another view. Transitions are animated, so the active view may lag the request by a few frames. Pass capture to see the result in the same call.',
      inputSchema: {
        name: z.string().describe('View name from list_views.'),
        change_url: z.boolean().optional().describe('Update the browser URL. Defaults to true.'),
        skip: z.boolean().optional().describe('Skip the transition animation. Defaults to false.'),
        capture: z.boolean().optional().describe('Also return a screenshot of the result.')
      }
    },
    async (args) => build_go_to_view_result(host, args)
  );
}
