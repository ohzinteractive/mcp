export const DEFAULT_PORT = 7317;
export const DEFAULT_TIMEOUT_MS = 5000;
export const CAPTURE_TIMEOUT_MS = 15000;
// A GLB of tens of megabytes takes a while to fetch and parse.
export const LOAD_TIMEOUT_MS = 30000;
// Writing a manifest makes Vite reload the page. import_model waits this long
// for the app to come back before it loads the preview.
export const RELOAD_WAIT_MS = 8000;
export const RELOAD_POLL_MS = 250;
// A GLB that was just written is served only once Vite's watcher has seen it.
// The preview is retried for this long, measured from the first attempt.
export const PREVIEW_DEADLINE_MS = 15000;
export const PREVIEW_RETRY_MS = 1000;

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
