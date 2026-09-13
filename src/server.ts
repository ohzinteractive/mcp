#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BridgeHost } from './bridge/BridgeHost.js';
import { resolve_port } from './config.js';
import { register_capture_tool } from './tools/capture.js';
import { register_console_tool } from './tools/console.js';
import { register_scene_tools } from './tools/scene.js';
import { register_status_tool } from './tools/status.js';

async function main(): Promise<void>
{
  const host = new BridgeHost();
  const port = resolve_port(process.env);

  // stdout is the MCP channel. Every diagnostic must go to stderr.
  await host.start(port);
  process.stderr.write(`[ohzi-mcp] bridge listening on ws://127.0.0.1:${port}\n`);

  const server = new McpServer({ name: 'ohzi-mcp', version: '0.1.0' });

  register_status_tool(server, host);
  register_capture_tool(server, host);
  register_console_tool(server, host);
  register_scene_tools(server, host);

  const shutdown = async () =>
  {
    await host.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(new StdioServerTransport());
}

main().catch((error) =>
{
  process.stderr.write(`[ohzi-mcp] fatal: ${(error as Error).message}\n`);
  process.exit(1);
});
