export const PROTOCOL_VERSION = 1;

export interface CanvasInfo
{
  width: number;
  height: number;
  dpr: number;
}

export interface AppInfo
{
  core_version: string;
  components_version: string;
  pit_version: string;
  active_view: string | null;
  has_camera: boolean;
  canvas: CanvasInfo;
}

export interface HelloEvent
{
  event: 'hello';
  protocol: number;
  app: AppInfo;
}

export interface WelcomeEvent
{
  event: 'welcome';
  protocol: number;
}

export interface RefusedEvent
{
  event: 'refused';
  reason: string;
  server_protocol: number;
  client_protocol: number | null;
}

export interface Command
{
  id: string;
  cmd: string;
  args?: Record<string, unknown>;
}

export type Reply =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: { code: string; message: string } };

export type BridgeErrorCode =
  | 'app_not_connected'
  | 'timeout'
  | 'protocol_mismatch'
  | 'disconnected'
  | 'unknown_command'
  | 'no_camera'
  | 'not_found'
  | 'controller_owns_camera'
  | 'handler_failed'
  | 'capture_failed';

function is_record(value: unknown): value is Record<string, unknown>
{
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parse_hello(raw: unknown): HelloEvent | null
{
  if (!is_record(raw) || raw.event !== 'hello' || typeof raw.protocol !== 'number')
  {
    return null;
  }

  const app = raw.app;

  if (!is_record(app) || !is_record(app.canvas))
  {
    return null;
  }

  return raw as unknown as HelloEvent;
}

export function parse_reply(raw: unknown): Reply | null
{
  if (!is_record(raw) || typeof raw.id !== 'string' || typeof raw.ok !== 'boolean')
  {
    return null;
  }

  if (raw.ok === false)
  {
    const error = raw.error;

    if (!is_record(error) || typeof error.code !== 'string' || typeof error.message !== 'string')
    {
      return null;
    }
  }

  return raw as unknown as Reply;
}
