export const DEFAULT_PORT = 7317;
export const DEFAULT_TIMEOUT_MS = 5000;
export const CAPTURE_TIMEOUT_MS = 15000;

export function resolve_port(env: NodeJS.ProcessEnv): number
{
  const raw = env.OHZI_MCP_PORT;

  if (raw === undefined)
  {
    return DEFAULT_PORT;
  }

  const port = Number.parseInt(raw, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535)
  {
    return DEFAULT_PORT;
  }

  return port;
}
