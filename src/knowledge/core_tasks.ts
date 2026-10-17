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
