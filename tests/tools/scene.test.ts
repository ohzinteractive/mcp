import { describe, expect, it } from 'vitest';
import { BridgeError } from '../../src/bridge/BridgeError.js';
import { build_get_object_result, build_inspect_result, build_set_object_result } from '../../src/tools/scene.js';

const inspection = {
  root: {
    uuid: 'u-scene',
    name: 'HomeScene',
    type: 'Scene',
    position: [0, 0, 0],
    children: [
      {
        uuid: 'u-cube',
        name: 'cube',
        type: 'Mesh',
        position: [1, 2, 3],
        material: 'MeshStandardMaterial',
        vertices: 24
      }
    ]
  },
  counts: { total: 2, meshes: 1, returned: 2 },
  truncated: false,
  notes: []
};

const detail = {
  uuid: 'u-cube',
  name: 'cube',
  type: 'Mesh',
  parent: 'HomeScene',
  children: 0,
  visible: true,
  position: [1, 2, 3],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  material: 'MeshStandardMaterial',
  vertices: 24
};

interface Call
{
  cmd: string;
  args?: Record<string, unknown>;
}

function host(results: Record<string, unknown>, calls: Call[] = [], connected = true)
{
  return {
    connected,
    send: async (cmd: string, args?: Record<string, unknown>) =>
    {
      calls.push({ cmd, args });
      const result = results[cmd];

      if (result instanceof Error)
      {
        throw result;
      }

      return result;
    }
  };
}

function text_of(result: { content: Array<{ type: string; text?: string }> }): string
{
  return result.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
}

describe('inspect_scene', () =>
{
  it('renders the tree with indentation and identifiers', async () =>
  {
    const text = text_of(await build_inspect_result(host({ inspect_scene: inspection }), {}));

    expect(text).toContain('HomeScene');
    expect(text).toContain('cube');
    expect(text).toContain('u-cube');
    expect(text).toContain('Mesh');
    expect(text.split('\n').some((line) => line.startsWith('  '))).toBe(true);
  });

  it('reports counts so the caller knows what it is not seeing', async () =>
  {
    const text = text_of(await build_inspect_result(host({ inspect_scene: inspection }), {}));

    expect(text).toContain('2');
    expect(text.toLowerCase()).toContain('node');
  });

  it('surfaces truncation notes prominently', async () =>
  {
    const cut = { ...inspection, truncated: true, notes: ['stopped at max_nodes=200; 900 of 1100 nodes not returned'] };
    const text = text_of(await build_inspect_result(host({ inspect_scene: cut }), {}));

    expect(text).toContain('900 of 1100');
  });

  it('forwards depth, max_nodes and filter', async () =>
  {
    const calls: Call[] = [];
    await build_inspect_result(host({ inspect_scene: inspection }, calls), { depth: 2, max_nodes: 50, filter: 'cube' });

    expect(calls[0].args).toEqual({ depth: 2, max_nodes: 50, filter: 'cube' });
  });

  it('reports an empty scene clearly', async () =>
  {
    const empty = { root: null, counts: { total: 0, meshes: 0, returned: 0 }, truncated: false, notes: ['No scene is set.'] };
    const text = text_of(await build_inspect_result(host({ inspect_scene: empty }), {}));

    expect(text).toContain('No scene is set.');
  });

  it('errors when not connected', async () =>
  {
    const result = await build_inspect_result(host({}, [], false), {});

    expect(result.isError).toBe(true);
  });
});

describe('get_object', () =>
{
  it('renders the full transform and lineage', async () =>
  {
    const text = text_of(await build_get_object_result(host({ get_object: detail }), { name: 'cube' }));

    expect(text).toContain('cube');
    expect(text).toContain('1, 2, 3');
    expect(text).toContain('HomeScene');
    expect(text).toContain('24');
  });

  it('surfaces a not_found code', async () =>
  {
    const result = await build_get_object_result(
      host({ get_object: new BridgeError('not_found', "No object matching name 'ghost'") }),
      { name: 'ghost' }
    );

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('not_found');
  });
});

describe('set_object', () =>
{
  it('forwards only the changes supplied', async () =>
  {
    const calls: Call[] = [];
    await build_set_object_result(host({ set_object: { ...detail, changed: ['position'] } }, calls), {
      name: 'cube',
      position: [5, 0, -2]
    });

    expect(calls[0].args).toEqual({ name: 'cube', position: [5, 0, -2] });
  });

  it('reports which fields changed', async () =>
  {
    const text = text_of(await build_set_object_result(
      host({ set_object: { ...detail, changed: ['position', 'visible'] } }),
      { name: 'cube', position: [5, 0, -2] }
    ));

    expect(text).toContain('position');
    expect(text).toContain('visible');
  });

  it('warns when nothing actually changed', async () =>
  {
    const text = text_of(await build_set_object_result(
      host({ set_object: { ...detail, changed: [] } }),
      { name: 'cube' }
    ));

    expect(text.toLowerCase()).toContain('nothing changed');
  });

  it('returns the resulting image in the same call when capture is requested', async () =>
  {
    const calls: Call[] = [];
    const result = await build_set_object_result(
      host({
        set_object: { ...detail, changed: ['position'] },
        capture_viewport: { mode: 'fast', mime_type: 'image/png', width: 100, height: 80, bytes: 10, data: 'AAA=' }
      }, calls),
      { name: 'cube', position: [5, 0, -2], capture: true }
    );

    expect(calls.map((c) => c.cmd)).toEqual(['set_object', 'capture_viewport']);
    expect(result.content.some((c) => c.type === 'image')).toBe(true);
  });

  it('does not capture unless asked', async () =>
  {
    const calls: Call[] = [];
    const result = await build_set_object_result(
      host({ set_object: { ...detail, changed: ['position'] } }, calls),
      { name: 'cube', position: [5, 0, -2] }
    );

    expect(calls.map((c) => c.cmd)).toEqual(['set_object']);
    expect(result.content.some((c) => c.type === 'image')).toBe(false);
  });

  it('still reports the change when the follow-up capture fails', async () =>
  {
    const result = await build_set_object_result(
      host({
        set_object: { ...detail, changed: ['position'] },
        capture_viewport: new BridgeError('no_camera', 'no camera')
      }),
      { name: 'cube', position: [5, 0, -2], capture: true }
    );

    expect(result.isError).toBeUndefined();
    expect(text_of(result)).toContain('position');
    expect(text_of(result).toLowerCase()).toContain('capture');
  });
});
