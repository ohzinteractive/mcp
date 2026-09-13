import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { ApiIndex } from '../../src/knowledge/ApiIndex.js';
import { load_types } from '../../src/knowledge/load_types.js';

// Runs against the real committed declarations of this project. A parser that
// only satisfies fixtures written by its own author proves very little.
const root = resolve(__dirname, '../../..');
const files = load_types(root);
const index = new ApiIndex(files);

describe('load_types against the real project', () =>
{
  it('finds declaration files in all three packages', () =>
  {
    expect(files.length).toBeGreaterThan(100);
    expect(new Set(files.map((f) => f.package))).toEqual(new Set(['ohzi-core', 'ohzi-components', 'pit-js']));
  });

  it('returns an empty list for a root with no types rather than throwing', () =>
  {
    expect(load_types('/definitely/not/a/project')).toEqual([]);
  });
});

describe('ApiIndex against the real declarations', () =>
{
  it('indexes a substantial API surface', () =>
  {
    expect(index.size).toBeGreaterThan(100);
  });

  it('resolves the core singletons to their exported names', () =>
  {
    for (const name of ['SceneManager', 'CameraManager', 'Graphics', 'Time', 'OScreen'])
    {
      const symbol = index.get(name);

      expect(symbol, `${name} should be indexed`).not.toBeNull();
      expect(symbol?.package).toBe('ohzi-core');
    }
  });

  it('captures real method signatures rather than approximations', () =>
  {
    const controller = index.get('CameraController');
    const set_rotation = controller?.members.find((m) => m.name === 'set_rotation');

    expect(set_rotation?.kind).toBe('method');
    expect(set_rotation?.signature).toContain('tilt');
    expect(set_rotation?.signature).toContain('orientation');
  });

  it('captures AbstractScene lifecycle callbacks', () =>
  {
    const names = index.get('AbstractScene')?.members.map((m) => m.name) ?? [];

    expect(names).toContain('on_assets_ready');
    expect(names).toContain('set_assets');
  });

  it('indexes the components and pit packages too', () =>
  {
    expect(index.search('', 'ohzi-components', 200).length).toBeGreaterThan(0);
    expect(index.get('InputController')?.package).toBe('pit-js');
  });

  it('finds symbols by a member name a developer would search for', () =>
  {
    const hits = index.search('take_screenshot', undefined, 5);

    expect(hits.map((h) => h.name)).toContain('Graphics');
  });
});
