import { describe, expect, it } from 'vitest';
import { BridgeError } from '../../src/bridge/BridgeError.js';
import { build_list_render_modes_result, build_performance_result, build_set_render_mode_result } from '../../src/tools/render.js';

const modes = [
  { name: 'NormalRender', description: 'Standard forward rendering', options: [] },
  { name: 'NormalAORender', description: 'Forward rendering with SSAO', options: ['use_ssaa'] }
];

const performance = {
  fps: 59.9,
  smooth_fps: 60,
  frame_ms: 16.69,
  elapsed_s: 12.5,
  canvas: { width: 834, height: 770, render_width: 1668, render_height: 1540, dpr: 2 },
  draw_calls: 12,
  triangles: 3456
};

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

describe('list_render_modes', () =>
{
  it('lists each mode with its description and options', async () =>
  {
    const text = text_of(await build_list_render_modes_result(host({ list_render_modes: modes })));

    expect(text).toContain('NormalRender');
    expect(text).toContain('Standard forward rendering');
    expect(text).toContain('use_ssaa');
  });

  it('accepts a payload wrapped in a modes field', async () =>
  {
    const text = text_of(await build_list_render_modes_result(host({ list_render_modes: { modes } })));

    expect(text).toContain('NormalAORender');
  });

  it('errors when not connected', async () =>
  {
    expect((await build_list_render_modes_result(host({}, [], false))).isError).toBe(true);
  });
});

describe('set_render_mode', () =>
{
  it('forwards the name and options', async () =>
  {
    const calls: Call[] = [];
    await build_set_render_mode_result(host({ set_render_mode: { active: 'NormalAORender' } }, calls), {
      name: 'NormalAORender',
      options: { use_ssaa: true }
    });

    expect(calls[0]).toEqual({ cmd: 'set_render_mode', args: { name: 'NormalAORender', options: { use_ssaa: true } } });
  });

  it('omits options when none are given', async () =>
  {
    const calls: Call[] = [];
    await build_set_render_mode_result(host({ set_render_mode: { active: 'NormalRender' } }, calls), { name: 'NormalRender' });

    expect(calls[0].args).toEqual({ name: 'NormalRender' });
  });

  it('returns the resulting image when capture is requested', async () =>
  {
    const result = await build_set_render_mode_result(
      host({ set_render_mode: { active: 'NormalRender' }, capture_viewport: shot }),
      { name: 'NormalRender', capture: true }
    );

    expect(result.content.some((c) => c.type === 'image')).toBe(true);
  });

  it('surfaces unknown_render_mode with the available list', async () =>
  {
    const result = await build_set_render_mode_result(
      host({ set_render_mode: new BridgeError('unknown_render_mode', 'Unknown render mode. Available modes: NormalRender.') }),
      { name: 'Nope' }
    );

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('NormalRender');
  });
});

describe('get_performance', () =>
{
  it('renders framerate, frame time and canvas size', async () =>
  {
    const text = text_of(await build_performance_result(host({ get_performance: performance })));

    expect(text).toContain('59.9');
    expect(text).toContain('16.69');
    expect(text).toContain('834');
    expect(text).toContain('1668');
  });

  it('renders renderer counters when present', async () =>
  {
    const text = text_of(await build_performance_result(host({ get_performance: performance })));

    expect(text).toContain('12');
    expect(text).toContain('3456');
  });

  it('says the counters are unavailable rather than printing nothing', async () =>
  {
    const bare = { ...performance };
    delete (bare as Record<string, unknown>).draw_calls;
    delete (bare as Record<string, unknown>).triangles;

    const text = text_of(await build_performance_result(host({ get_performance: bare })));

    expect(text.toLowerCase()).toContain('not reported');
  });
});
