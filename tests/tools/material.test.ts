import { describe, expect, it } from 'vitest';
import { BridgeError } from '../../src/bridge/BridgeError.js';
import { build_set_material_result } from '../../src/tools/material.js';

const standard = {
  uuid: 'm-standard',
  name: 'paint',
  type: 'MeshStandardMaterial',
  users: 1,
  color: '#ff8800',
  roughness: 0.25,
  metalness: 0.75,
  emissive: '#000000',
  emissive_intensity: 1,
  opacity: 1,
  transparent: false,
  wireframe: false
};

const edit = {
  target: 'cube',
  meshes: 1,
  materials: [standard],
  changed: ['color'],
  notes: []
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

describe('set_material', () =>
{
  it('refuses when the app is not connected', async () =>
  {
    const result = await build_set_material_result(host({}, [], false), { name: 'cube', color: '#ff8800' });

    expect(result.isError).toBe(true);
  });

  it('forwards the selector and only the changes supplied, without capture', async () =>
  {
    const calls: Call[] = [];
    await build_set_material_result(host({ set_material: edit }, calls), {
      name: 'cube',
      color: '#ff8800',
      wireframe: true,
      transparent: false,
      capture: false
    });

    expect(calls[0]).toEqual({ cmd: 'set_material', args: { name: 'cube', color: '#ff8800', wireframe: true, transparent: false } });
  });

  it('renders the resulting material state', async () =>
  {
    const text = text_of(await build_set_material_result(host({ set_material: edit }), { name: 'cube', color: '#ff8800' }));

    expect(text).toContain('paint (MeshStandardMaterial)');
    expect(text).toContain('color     #ff8800');
    expect(text).toContain('roughness 0.25');
    expect(text).toContain('metalness 0.75');
    expect(text).toContain('wireframe no');
    expect(text).toContain('changed: color');
  });

  it('leaves out fields the material does not have', async () =>
  {
    const basic = { uuid: 'm-basic', name: '', type: 'MeshBasicMaterial', users: 1, color: '#ffffff', opacity: 1, transparent: false, wireframe: false };
    const text = text_of(await build_set_material_result(
      host({ set_material: { ...edit, materials: [basic] } }),
      { name: 'cube', color: '#ffffff' }
    ));

    expect(text).not.toContain('roughness');
    expect(text).not.toContain('emissive');
  });

  it('warns when a material is shared with other meshes', async () =>
  {
    const text = text_of(await build_set_material_result(
      host({ set_material: { ...edit, materials: [{ ...standard, users: 3 }] } }),
      { name: 'cube', color: '#ff8800' }
    ));

    expect(text).toContain('shared by 3 meshes in this scene');
  });

  it('says how many meshes were covered when editing a whole branch', async () =>
  {
    const text = text_of(await build_set_material_result(
      host({ set_material: { ...edit, target: 'chair', meshes: 4 } }),
      { name: 'chair', roughness: 0.5 }
    ));

    expect(text).toContain('chair: 1 material on 4 meshes');
  });

  it('lists at most 8 materials in detail and counts the rest, so a whole model stays cheap', async () =>
  {
    const materials = Array.from({ length: 12 }, (_, i) => ({ ...standard, uuid: `m-${i}`, name: `mat_${i}` }));
    const text = text_of(await build_set_material_result(
      host({ set_material: { ...edit, target: 'chair', meshes: 20, materials } }),
      { name: 'chair', roughness: 0.5 }
    ));

    expect(text).toContain('chair: 12 materials on 20 meshes');
    expect(text).toContain('mat_7 (MeshStandardMaterial)');
    expect(text).not.toContain('mat_8 (MeshStandardMaterial)');
    expect(text).toContain('... 4 more materials not listed');
  });

  it('passes the app notes through', async () =>
  {
    const text = text_of(await build_set_material_result(
      host({ set_material: { ...edit, notes: ['roughness: MeshBasicMaterial has no roughness, skipped.'] } }),
      { name: 'cube', roughness: 0.5 }
    ));

    expect(text).toContain('! roughness: MeshBasicMaterial has no roughness, skipped.');
  });

  it('warns when the changes it was given did not apply', async () =>
  {
    const text = text_of(await build_set_material_result(host({ set_material: { ...edit, changed: [] } }), { name: 'cube', roughness: 0.5 }));

    expect(text).toContain('nothing changed: the values were invalid, or these materials do not have those fields.');
  });

  it('just reports the current values when called with only a selector', async () =>
  {
    const text = text_of(await build_set_material_result(host({ set_material: { ...edit, changed: [] } }), { name: 'cube', capture: false }));

    expect(text).toContain('color     #ff8800');
    expect(text.toLowerCase()).not.toContain('nothing changed');
  });

  it('returns the resulting image in the same call when capture is requested', async () =>
  {
    const calls: Call[] = [];
    const result = await build_set_material_result(
      host({
        set_material: edit,
        capture_viewport: { mode: 'fast', mime_type: 'image/png', width: 100, height: 80, bytes: 10, data: 'AAA=' }
      }, calls),
      { name: 'cube', color: '#ff8800', capture: true }
    );

    expect(calls.map((c) => c.cmd)).toEqual(['set_material', 'capture_viewport']);
    expect(result.content.some((c) => c.type === 'image')).toBe(true);
  });

  it('reports a bridge error with its code', async () =>
  {
    const result = await build_set_material_result(
      host({ set_material: new BridgeError('not_found', 'No object matching name \'ghost\' in the current scene.') }),
      { name: 'ghost', color: '#ff8800' }
    );

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('not_found');
  });

  it('refuses a malformed payload', async () =>
  {
    const result = await build_set_material_result(host({ set_material: { materials: 'nope' } }), { name: 'cube' });

    expect(result.isError).toBe(true);
  });
});
