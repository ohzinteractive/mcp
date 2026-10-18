import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export type Tier = 'regular' | 'high';

export interface ScaffoldReport
{
  dry_run: boolean;
  applied: boolean;
  errors: string[];
  created: string[];
  overwritten: string[];
  patched: Array<{ file: string; label: string }>;
  skipped: Array<{ file: string; label: string; reason: string }>;
}

export interface Plan { run(): ScaffoldReport }

export interface ImportedModel { name: string; url: string; draco: boolean; version: string; size: number; tier: Tier }

export interface Transform { position: number[]; rotation: number[]; scale: number[] }

export interface PlanOptions { root: string; dry_run?: boolean }

export interface CoreTasks
{
  plan_import_model(
    args: { source: string; scene?: string; name?: string; tier?: Tier; replace?: boolean },
    options: PlanOptions
  ): { scaffolder: Plan; model: ImportedModel; unchanged: boolean };
  plan_commit_object(args: { name: string; scene?: string; transform: Transform }, options: PlanOptions): Plan;
}

// The scaffolders are not published to npm with core, so they are read from the
// consuming project's own core checkout, the same way load_types reads its
// types: the project's copy is the truth for the version it pins.
export const CORE_TASKS_ENTRY = 'core/tasks/import_model/import_model.mjs';

export async function load_core_tasks(root: string): Promise<CoreTasks>
{
  const entry = join(root, CORE_TASKS_ENTRY);

  if (!existsSync(entry))
  {
    throw new Error(`No OHZI scaffolders at ${entry}. import_model and commit_object need the core submodule checked out with tasks/import_model.`);
  }

  const module = await import(/* @vite-ignore */ pathToFileURL(entry).href) as Partial<CoreTasks>;

  if (typeof module.plan_import_model !== 'function' || typeof module.plan_commit_object !== 'function')
  {
    throw new Error(`${entry} does not export plan_import_model and plan_commit_object. Update the core submodule.`);
  }

  return module as CoreTasks;
}

export type ScaffoldKind = 'view' | 'scene' | 'component' | 'modal';

export type ScaffoldPlanner = (name: string, options: PlanOptions) => Plan;

// One module per scaffolder, each read from the project's core checkout like
// the import_model entry. Loaded one at a time, so a core that predates one
// scaffolder still serves the others.
export const SCAFFOLD_PLANNERS: Record<ScaffoldKind, { entry: string; planner: string }> = {
  view: { entry: 'core/tasks/create_view/create_view.mjs', planner: 'plan_view' },
  scene: { entry: 'core/tasks/create_scene/create_scene.mjs', planner: 'plan_scene' },
  component: { entry: 'core/tasks/create_component/create_component.mjs', planner: 'plan_component' },
  modal: { entry: 'core/tasks/create_modal/create_modal.mjs', planner: 'plan_modal' }
};

export async function load_scaffold_planner(root: string, kind: ScaffoldKind): Promise<ScaffoldPlanner>
{
  const { entry, planner } = SCAFFOLD_PLANNERS[kind];
  const path = join(root, entry);

  if (!existsSync(path))
  {
    throw new Error(`No OHZI scaffolder at ${path}. create_${kind} needs the core submodule checked out with tasks/create_${kind}. Update the core submodule.`);
  }

  const module = await import(/* @vite-ignore */ pathToFileURL(path).href) as Record<string, unknown>;

  if (typeof module[planner] !== 'function')
  {
    throw new Error(`${path} does not export ${planner}. Update the core submodule.`);
  }

  return module[planner] as ScaffoldPlanner;
}
