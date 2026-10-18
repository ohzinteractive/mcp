import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ScaffoldKind, ScaffoldPlanner, ScaffoldReport } from '../knowledge/core_tasks.js';
import type { ToolResult } from './shared.js';
import { describe_report, failure } from './shared.js';

export interface ScaffoldToolArgs
{
  name: string;
  dry_run?: boolean;
}

export type LoadPlanner = (kind: ScaffoldKind) => Promise<ScaffoldPlanner>;

function pascal_case(name: string): string
{
  return name.split('_').filter((part) => part.length > 0).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

// What the caller still has to do once the files exist. Each scaffolder wires a
// different amount, so the hint says where the new piece stands.
function next_step(kind: ScaffoldKind, name: string): string
{
  const pascal = pascal_case(name);

  switch (kind)
  {
  case 'view':
    return `next: Vite reloads the app; once it is back, open the view with go_to_view { name: '${name}' } (url /${name.replace(/_/g, '-')}). Its scene controller reuses HomeScene until you point it at its own scene, for example one made with create_scene.`;
  case 'scene':
    return `next: a scene is not registered anywhere. Use it from a view's scene controller with new ${pascal}Scene(), and add models to it with import_model { scene: '${name}' }. Its constructor names it Sections.${name.toUpperCase()}, so it expects a view of the same name: create_view { name: '${name}' } if there is none.`;
  case 'component':
    return 'next: the component is wired into MainApplication and Components.ts, so it starts with the app. Fill in its template and styles.';
  case 'modal':
    return `next: the state is registered in ModalComponent as '${name}'. Open it with ModalComponent.show_state('${name}', true) and fill in its template and styles.`;
  }
}

export async function build_scaffold_result(load_planner: LoadPlanner, root: string, kind: ScaffoldKind, args: ScaffoldToolArgs): Promise<ToolResult>
{
  const tool = `create_${kind}`;
  let planner: ScaffoldPlanner;

  try
  {
    planner = await load_planner(kind);
  }
  catch (error)
  {
    return failure((error as Error).message);
  }

  const dry_run = args.dry_run === true;
  let report: ScaffoldReport;

  try
  {
    report = planner(args.name, { root, dry_run }).run();
  }
  catch (error)
  {
    return failure(`${tool} refused: ${(error as Error).message}`);
  }

  if (report.errors.length > 0)
  {
    return failure([`${tool} refused, nothing was written:`, ...report.errors.map((error) => `- ${error}`)].join('\n'));
  }

  const lines = [`${tool} ${args.name}`, ...describe_report(report)];

  lines.push(report.dry_run ? 'dry run: nothing was written' : next_step(kind, args.name));

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

const TOOLS: Array<{ kind: ScaffoldKind; title: string; description: string }> = [
  {
    kind: 'view',
    title: 'Scaffold a new view',
    description: 'Create a view the way `yarn create-view` does: View, SceneController and TransitionController classes in app/js/views/<name>/, a transition json, a pug template and a scss partial, and wire it into Sections.ts, MainApplication.ts, default_state_data.js, index.pug and application.scss. Writes project files, so Vite reloads the app.'
  },
  {
    kind: 'scene',
    title: 'Scaffold a new scene',
    description: 'Create a scene the way `yarn create-scene` does: app/js/scenes/<Name>Scene.ts plus its regular and high tier object, sound and texture manifests in app/data/assets/<name>/. Registers nothing; a view\'s scene controller has to use it. Writes project files.'
  },
  {
    kind: 'component',
    title: 'Scaffold a new view component',
    description: 'Create a view component the way `yarn create-component` does: a component class in app/js/view_components/<name>/, a pug template and a scss partial, and wire it into MainApplication.ts, Components.ts, default_state_data.js, index.pug and application.scss. Writes project files, so Vite reloads the app.'
  },
  {
    kind: 'modal',
    title: 'Scaffold a new modal state',
    description: 'Create a modal state the way `yarn create-modal` does: a ModalState class in app/js/view_components/modal/states/, a pug template and a scss partial, and register it in ModalComponent.ts, modal.pug and application.scss. Writes project files, so Vite reloads the app.'
  }
];

// Every scaffolder validates its whole plan before it writes: a name that is
// taken, or an anchor that was edited away, refuses the call with nothing
// changed. That is what makes them safe to expose to a model.
export function register_scaffold_tools(server: McpServer, load_planner: LoadPlanner, root: string): void
{
  for (const tool of TOOLS)
  {
    server.registerTool(
      `create_${tool.kind}`,
      {
        title: tool.title,
        description: `${tool.description} Refuses, writing nothing, when the name is taken or the project is missing an anchor. Use dry_run to preview.`,
        inputSchema: {
          name: z.string().regex(SNAKE_CASE).describe(`The ${tool.kind} name in snake_case (a-z, 0-9 and _, starting with a letter), for example privacy_policy. Class names are derived from it.`),
          dry_run: z.boolean().optional().describe('Report what would be written without writing anything.')
        }
      },
      async (args) => build_scaffold_result(load_planner, root, tool.kind, args)
    );
  }
}
