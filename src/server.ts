#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BridgeHost } from './bridge/BridgeHost.js';
import { ApiIndex } from './knowledge/ApiIndex.js';
import { load_types } from './knowledge/load_types.js';
import { resolve_port } from './config.js';
import { load_core_tasks, load_scaffold_planner } from './knowledge/core_tasks.js';
import { register_camera_tools } from './tools/camera.js';
import { register_capture_tool } from './tools/capture.js';
import { register_console_tool } from './tools/console.js';
import { register_debug_tools } from './tools/debug.js';
import { register_import_tools } from './tools/import.js';
import { register_input_tools } from './tools/input.js';
import { register_knowledge_tools } from './tools/knowledge.js';
import { register_material_tools } from './tools/material.js';
import { register_render_tools } from './tools/render.js';
import { register_scaffold_tools } from './tools/scaffold.js';
import { register_scene_tools } from './tools/scene.js';
import { register_view_tools } from './tools/views.js';
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
  register_material_tools(server, host);
  register_camera_tools(server, host);
  register_render_tools(server, host);
  register_view_tools(server, host);
  register_debug_tools(server, host);
  register_input_tools(server, host);
  // Reads and writes the consuming project, which is the working directory, the
  // same root load_types reads its declarations from.
  register_import_tools(server, host, () => load_core_tasks(process.cwd()), process.cwd());
  // The scaffolders only write files, so they work with the app closed.
  register_scaffold_tools(server, (kind) => load_scaffold_planner(process.cwd(), kind), process.cwd());

  // Built lazily: reading a few hundred declaration files should not slow
  // startup for a session that never asks about the API. Read from the working
  // directory, which is the consuming project, so signatures match the versions
  // that project pins.
  let api_index: ApiIndex | null = null;

  register_knowledge_tools(server, () =>
  {
    if (api_index === null)
    {
      const files = load_types(process.cwd());
      api_index = new ApiIndex(files);

      process.stderr.write(`[ohzi-mcp] indexed ${api_index.size} API symbols from ${files.length} declaration files\n`);
    }

    return api_index;
  });

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
