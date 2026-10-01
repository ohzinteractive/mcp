import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BridgeError } from '../../src/bridge/BridgeError.js';
import { build_debug_clear_result, build_debug_draw_result, register_debug_tools } from '../../src/tools/debug.js';

interface Call { cmd: string; args?: Record<string, unknown> }

function host(results: Record<string, unknown>, calls: Call[] = [], connected = true)
{
  return {
    connected,
    send: async (cmd: string, args?: Record<string, unknown>) =>
    {
      calls.push({ cmd, args });
      const result = results[cmd];
      if (result instanceof Error) { throw result; }
      return result;
    }
  };
}

function text_of(result: { content: Array<{ type: string; text?: string }> }): string
{
  return result.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
}

const shot = { mode: 'fast', mime_type: 'image/png', width: 8, height: 8, bytes: 3, data: 'AAA=' };
const drawn = { id: 'abc-123', shape: 'cube', helpers: 2 };

describe('debug_draw', () =>
{
  it('forwards only the defined fields and never capture', async () =>
  {
    const calls: Call[] = [];
    await build_debug_draw_result(host({ debug_draw: drawn }, calls), {
      shape: 'sphere',
      position: [1, 2, 3],
      size: undefined,
      color: 'red',
      capture: false
    });

    expect(calls).toEqual([{ cmd: 'debug_draw', args: { shape: 'sphere', position: [1, 2, 3], color: 'red' } }]);
  });

  it('forwards the object reference for bounding boxes', async () =>
  {
    const calls: Call[] = [];
    await build_debug_draw_result(host({ debug_draw: drawn }, calls), { shape: 'bounding_box', object: { name: 'Hero' } });

    expect(calls[0].args).toEqual({ shape: 'bounding_box', object: { name: 'Hero' } });
  });

  it('forwards the text and the font for sdf_text', async () =>
  {
    const calls: Call[] = [];
    await build_debug_draw_result(host({ debug_draw: drawn }, calls), { shape: 'sdf_text', text: 'Hello', font: '/fonts/sdf/roboto.json', size: 0.5 });

    expect(calls[0].args).toEqual({ shape: 'sdf_text', text: 'Hello', font: '/fonts/sdf/roboto.json', size: 0.5 });
  });

  it('accepts sdf_text with a font in its input schema', () =>
  {
    const schemas: Record<string, z.ZodRawShape> = {};
    const server = { registerTool: (name: string, config: { inputSchema: z.ZodRawShape }) => { schemas[name] = config.inputSchema; } };

    register_debug_tools(server as never, {} as never);
    const schema = z.object(schemas.debug_draw);

    expect(schema.safeParse({ shape: 'sdf_text', text: 'Hello', font: '/fonts/sdf/roboto.json' }).success).toBe(true);
    expect(schema.safeParse({ shape: 'sdf_text', text: 'Hello', font: '' }).success).toBe(false);
  });

  it('forwards the text for labels', async () =>
  {
    const calls: Call[] = [];
    await build_debug_draw_result(host({ debug_draw: drawn }, calls), { shape: 'label', text: 'spawn point', position: [0, 2, 0] });

    expect(calls[0].args).toEqual({ shape: 'label', text: 'spawn point', position: [0, 2, 0] });
  });

  it('reports the helper id, shape and live count', async () =>
  {
    const text = text_of(await build_debug_draw_result(host({ debug_draw: drawn }), { shape: 'cube' }));

    expect(text).toBe('drew cube abc-123\n2 debug_draw helpers alive');
  });

  it('errors when not connected', async () =>
  {
    expect((await build_debug_draw_result(host({}, [], false), { shape: 'cube' })).isError).toBe(true);
  });

  it('surfaces a bridge error with its code', async () =>
  {
    const result = await build_debug_draw_result(
      host({ debug_draw: new BridgeError('not_found', 'No object named Ghost.') }),
      { shape: 'bounding_box', object: { name: 'Ghost' } }
    );

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('not_found');
    expect(text_of(result)).toContain('Drawing failed');
  });

  it('rejects a malformed payload', async () =>
  {
    const result = await build_debug_draw_result(host({ debug_draw: null }), { shape: 'cube' });

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('malformed');
  });

  it('returns the image first when capture is requested', async () =>
  {
    const result = await build_debug_draw_result(
      host({ debug_draw: drawn, capture_viewport: shot }),
      { shape: 'cube', capture: true }
    );

    expect(result.content[0].type).toBe('image');
    expect(result.content[result.content.length - 1].type).toBe('text');
  });
});

describe('debug_clear', () =>
{
  it('forwards the id when given and never capture', async () =>
  {
    const calls: Call[] = [];
    await build_debug_clear_result(host({ debug_clear: { removed: 1, helpers: 0 } }, calls), { id: 'abc-123', capture: false });

    expect(calls).toEqual([{ cmd: 'debug_clear', args: { id: 'abc-123' } }]);
  });

  it('sends empty args when clearing everything', async () =>
  {
    const calls: Call[] = [];
    await build_debug_clear_result(host({ debug_clear: { removed: 3, helpers: 0 } }, calls), {});

    expect(calls[0]).toEqual({ cmd: 'debug_clear', args: {} });
  });

  it('reports how many helpers were removed and remain', async () =>
  {
    const text = text_of(await build_debug_clear_result(host({ debug_clear: { removed: 3, helpers: 0 } }), {}));

    expect(text).toBe('removed 3\n0 debug_draw helpers alive');
  });

  it('errors when not connected', async () =>
  {
    expect((await build_debug_clear_result(host({}, [], false), {})).isError).toBe(true);
  });

  it('surfaces a bridge error with its code', async () =>
  {
    const result = await build_debug_clear_result(
      host({ debug_clear: new BridgeError('not_found', 'No helper with that id was drawn through debug_draw.') }),
      { id: 'nope' }
    );

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('not_found');
    expect(text_of(result)).toContain('Clearing failed');
  });

  it('rejects a malformed payload', async () =>
  {
    const result = await build_debug_clear_result(host({ debug_clear: 'nope' }), {});

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('malformed');
  });

  it('returns the image first when capture is requested', async () =>
  {
    const result = await build_debug_clear_result(
      host({ debug_clear: { removed: 1, helpers: 0 }, capture_viewport: shot }),
      { capture: true }
    );

    expect(result.content[0].type).toBe('image');
  });
});
