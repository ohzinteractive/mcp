import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ApiIndex, ApiSymbol } from '../knowledge/ApiIndex.js';
import type { ToolResult } from './shared.js';
import { failure } from './shared.js';

const DEFAULT_LIMIT = 12;

function ok(text: string): ToolResult
{
  return { content: [{ type: 'text', text }] };
}

function headline(symbol: ApiSymbol): string
{
  const kind = symbol.kind === 'singleton'
    ? `singleton instance of class ${symbol.class_name}`
    : 'class';

  return `${symbol.name} — ${kind} — ${symbol.package} — ${symbol.file}`;
}

export interface SearchArgs
{
  query: string;
  package?: string;
  limit?: number;
}

export function build_search_api_result(index: ApiIndex, args: SearchArgs): ToolResult
{
  const limit = args.limit === undefined ? DEFAULT_LIMIT : args.limit;
  const hits = index.search(args.query, args.package, limit);

  if (hits.length === 0)
  {
    const scope = args.package === undefined ? '' : ` in ${args.package}`;

    return ok(`No API symbols match '${args.query}'${scope}. ${index.size} symbols are indexed from the committed type declarations.`);
  }

  const lines = hits.map((hit) =>
  {
    const members = hit.matched_members.length === 0
      ? ''
      : `\n    matched members: ${hit.matched_members.slice(0, 8).join(', ')}`;

    return `${headline(hit)}${members}`;
  });

  return ok([`${hits.length} of ${index.size} indexed symbols match '${args.query}':`, '', ...lines].join('\n'));
}

export interface SymbolArgs
{
  name: string;
}

export function build_get_symbol_result(index: ApiIndex, args: SymbolArgs): ToolResult
{
  const symbol = index.get(args.name);

  if (symbol === null)
  {
    const near = index.search(args.name.slice(0, 6), undefined, 5).map((hit) => hit.name);
    const suggestion = near.length === 0 ? '' : ` Did you mean: ${near.join(', ')}?`;

    return failure(`No API symbol named '${args.name}'.${suggestion}`);
  }

  const groups: Array<[string, string[]]> = [
    ['constructor', []],
    ['properties', []],
    ['accessors', []],
    ['methods', []]
  ];

  for (const member of symbol.members)
  {
    if (member.kind === 'constructor')
    {
      groups[0][1].push(member.signature);
    }
    else if (member.kind === 'property')
    {
      groups[1][1].push(member.signature);
    }
    else if (member.kind === 'getter' || member.kind === 'setter')
    {
      groups[2][1].push(member.signature);
    }
    else
    {
      groups[3][1].push(member.signature);
    }
  }

  const lines = [headline(symbol), ''];

  for (const [label, entries] of groups)
  {
    if (entries.length === 0)
    {
      continue;
    }

    lines.push(`${label}:`);

    for (const entry of entries)
    {
      lines.push(`  ${entry}`);
    }

    lines.push('');
  }

  return ok(lines.join('\n').trimEnd());
}

export function register_knowledge_tools(server: McpServer, index: () => ApiIndex): void
{
  server.registerTool(
    'search_api',
    {
      title: 'Search the OHZI API',
      description: "Search the committed TypeScript declarations of ohzi-core, ohzi-components and pit-js by symbol or member name. Signatures come from the versions this project pins, not from anything remembered. Works whether or not the app is running.",
      inputSchema: {
        query: z.string().describe('Symbol or member name, matched case insensitively as a substring.'),
        package: z.enum(['ohzi-core', 'ohzi-components', 'pit-js']).optional().describe('Restrict to one package.'),
        limit: z.number().int().positive().max(50).optional().describe('Maximum symbols to return. Defaults to 12.')
      },
      annotations: { readOnlyHint: true }
    },
    (args) => build_search_api_result(index(), args)
  );

  server.registerTool(
    'get_symbol',
    {
      title: 'Read one OHZI API symbol',
      description: 'Return the full declared surface of one class or singleton: constructor, properties, accessors and methods, with real signatures read from the committed declarations.',
      inputSchema: {
        name: z.string().describe('Exact symbol name, for example Graphics, AbstractScene or CameraController.')
      },
      annotations: { readOnlyHint: true }
    },
    (args) => build_get_symbol_result(index(), args)
  );
}
