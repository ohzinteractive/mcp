import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BridgeHost } from '../bridge/BridgeHost.js';
import type { AppInfo, CanvasInfo } from '../protocol.js';

type StatusHost = Pick<BridgeHost, 'connected' | 'app_info' | 'send'>;

interface LiveStatus
{
  active_view: string | null;
  has_camera: boolean;
  canvas: CanvasInfo;
}

function format_lines(info: AppInfo, live: LiveStatus | null, note: string | null): string
{
  const active_view = live === null ? info.active_view : live.active_view;
  const has_camera = live === null ? info.has_camera : live.has_camera;
  const canvas = live === null ? info.canvas : live.canvas;

  const lines = [
    'OHZI app: connected',
    `active view: ${active_view === null ? '(none)' : active_view}`,
    `camera ready: ${has_camera ? 'yes' : 'no'}`,
    `canvas: ${canvas.width}x${canvas.height} @ dpr ${canvas.dpr}`,
    `versions: ohzi-core ${info.core_version}, ohzi-components ${info.components_version}, pit-js ${info.pit_version}`
  ];

  if (note !== null)
  {
    lines.push(`note: ${note}`);
  }

  return lines.join('\n');
}

export async function build_status_report(host: StatusHost): Promise<string>
{
  // Captured up front so strict narrowing survives the await below.
  const info = host.app_info;

  if (!host.connected || info === null)
  {
    return [
      'OHZI app: not connected',
      '',
      'Start the dev server with `yarn start` and load the page in a browser.',
      'The bridge connects automatically in dev builds when Settings.dev_bridge.enabled is true.'
    ].join('\n');
  }

  try
  {
    const live = await host.send('status') as LiveStatus;
    return format_lines(info, live, null);
  }
  catch (error)
  {
    const code = (error as { code?: string }).code;
    const label = code === undefined ? 'unknown' : code;

    return format_lines(info, null, `live probe failed (${label}); values are from the handshake`);
  }
}

export function register_status_tool(server: McpServer, host: BridgeHost): void
{
  server.registerTool(
    'ohzi_status',
    {
      title: 'OHZI app status',
      description: 'Report whether the OHZI dev app is connected, which view is active, whether a camera is ready, the canvas size, and the ohzi-core/components/pit versions in use. Call this first; it never fails when the app is down.',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () =>
    {
      return { content: [{ type: 'text' as const, text: await build_status_report(host) }] };
    }
  );
}
