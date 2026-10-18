import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { PlanOptions, ScaffoldKind, ScaffoldReport } from '../../src/knowledge/core_tasks.js';
import { build_scaffold_result, register_scaffold_tools } from '../../src/tools/scaffold.js';

function text_of(result: { content: Array<{ type: string; text?: string }> }): string
{
  return result.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
}

function report(overrides: Partial<ScaffoldReport> = {}): ScaffoldReport
{
  return { dry_run: false, applied: true, errors: [], created: [], overwritten: [], patched: [], skipped: [], ...overrides };
}

interface Seen { kind: ScaffoldKind; name: string; options: PlanOptions }

function planner(outcome: { report?: ScaffoldReport; error?: Error; load_error?: Error } = {}, seen: Seen[] = [])
{
  return async(kind: ScaffoldKind) =>
  {
    if (outcome.load_error !== undefined) { throw outcome.load_error; }

    return (name: string, options: PlanOptions) =>
    {
      seen.push({ kind, name, options });
      if (outcome.error !== undefined) { throw outcome.error; }
      return { run: () => outcome.report ?? report({ dry_run: options.dry_run === true }) };
    };
  };
}

const VIEW_REPORT = report({
  created: ['app/js/views/gallery/GalleryView.ts'],
  patched: [{ file: 'app/js/MainApplication.ts', label: 'view import' }]
});

describe('build_scaffold_result', () =>
{
  it('plans against the project root and describes what was written', async() =>
  {
    const seen: Seen[] = [];
    const result = await build_scaffold_result(planner({ report: VIEW_REPORT }, seen), '/project', 'view', { name: 'gallery' });

    expect(result.isError).toBeUndefined();
    expect(seen).toEqual([{ kind: 'view', name: 'gallery', options: { root: '/project', dry_run: false } }]);

    const text = text_of(result);

    expect(text).toContain('create_view gallery');
    expect(text).toContain('created app/js/views/gallery/GalleryView.ts');
    expect(text).toContain('patched app/js/MainApplication.ts (view import)');
  });

  it('passes dry_run through and says nothing was written', async() =>
  {
    const seen: Seen[] = [];
    const result = await build_scaffold_result(
      planner({ report: report({ dry_run: true, applied: false, created: ['app/js/scenes/GalleryScene.ts'] }) }, seen),
      '/project',
      'scene',
      { name: 'gallery', dry_run: true }
    );

    expect(seen[0].options).toEqual({ root: '/project', dry_run: true });

    const text = text_of(result);

    expect(text).toContain('would create app/js/scenes/GalleryScene.ts');
    expect(text).toContain('dry run: nothing was written');
    expect(text).not.toContain('next:');
  });

  it('refuses with every reason when the plan fails validation', async() =>
  {
    const result = await build_scaffold_result(
      planner({ report: report({ applied: false, errors: ['already exists: app/js/views/home/HomeView.ts', 'already applied, refusing to duplicate: view import'] }) }),
      '/project',
      'view',
      { name: 'home' }
    );

    expect(result.isError).toBe(true);
    expect(text_of(result)).toBe([
      'create_view refused, nothing was written:',
      '- already exists: app/js/views/home/HomeView.ts',
      '- already applied, refusing to duplicate: view import'
    ].join('\n'));
  });

  it('reports a planner that throws', async() =>
  {
    const result = await build_scaffold_result(planner({ error: new Error('A view name is required') }), '/project', 'view', { name: 'x' });

    expect(result.isError).toBe(true);
    expect(text_of(result)).toBe('create_view refused: A view name is required');
  });

  it('reports a project whose core cannot provide the planner', async() =>
  {
    const result = await build_scaffold_result(planner({ load_error: new Error('Update the core submodule.') }), '/project', 'modal', { name: 'cookies' });

    expect(result.isError).toBe(true);
    expect(text_of(result)).toBe('Update the core submodule.');
  });

  it.each([
    ['view', /go_to_view \{ name: 'gallery' \}/],
    ['scene', /new GalleryScene\(\)/],
    ['component', /starts with the app/],
    ['modal', /show_state\('gallery', true\)/]
  ] as Array<[ScaffoldKind, RegExp]>)('tells the caller what to do next with a new %s', async(kind, hint) =>
  {
    const result = await build_scaffold_result(planner(), '/project', kind, { name: 'gallery' });

    expect(text_of(result)).toMatch(hint);
  });
});

describe('register_scaffold_tools', () =>
{
  it('registers one tool per scaffolder, each taking a snake_case name', () =>
  {
    const schemas: Record<string, z.ZodRawShape> = {};
    const server = { registerTool: (name: string, config: { inputSchema: z.ZodRawShape }) => { schemas[name] = config.inputSchema; } };

    register_scaffold_tools(server as never, async() => (() => ({})) as never, '/project');

    expect(Object.keys(schemas)).toEqual(['create_view', 'create_scene', 'create_component', 'create_modal']);

    for (const schema of Object.values(schemas))
    {
      expect(z.object(schema).safeParse({ name: 'privacy_policy', dry_run: true }).success).toBe(true);
      expect(z.object(schema).safeParse({ name: 'PrivacyPolicy' }).success).toBe(false);
      expect(z.object(schema).safeParse({ name: '2d_view' }).success).toBe(false);
      expect(z.object(schema).safeParse({}).success).toBe(false);
    }
  });
});
