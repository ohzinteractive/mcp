import { describe, expect, it } from 'vitest';
import { BridgeError } from '../../src/bridge/BridgeError.js';
import { build_go_to_view_result, build_list_views_result } from '../../src/tools/views.js';

const listing = {
  current: 'home',
  views: [
    { name: 'home', url: '/', current: true },
    { name: 'transition', url: '/transition', current: false }
  ]
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

describe('list_views', () =>
{
  it('lists views with urls and marks the current one', async () =>
  {
    const text = text_of(await build_list_views_result(host({ list_views: listing })));

    expect(text).toContain('home');
    expect(text).toContain('/transition');
    expect(text).toContain('current');
  });

  it('errors when not connected', async () =>
  {
    expect((await build_list_views_result(host({}, [], false))).isError).toBe(true);
  });
});

describe('go_to_view', () =>
{
  it('forwards the name and defaults', async () =>
  {
    const calls: Call[] = [];
    await build_go_to_view_result(host({ go_to_view: { requested: 'transition', current: 'transition', change_url: true, skip: false } }, calls), {
      name: 'transition'
    });

    expect(calls[0]).toEqual({ cmd: 'go_to_view', args: { name: 'transition' } });
  });

  it('forwards change_url and skip when given', async () =>
  {
    const calls: Call[] = [];
    await build_go_to_view_result(host({ go_to_view: { requested: 'transition', current: 'transition' } }, calls), {
      name: 'transition',
      change_url: false,
      skip: true
    });

    expect(calls[0].args).toEqual({ name: 'transition', change_url: false, skip: true });
  });

  it('returns the resulting image when capture is requested', async () =>
  {
    const result = await build_go_to_view_result(
      host({ go_to_view: { requested: 'transition', current: 'transition' }, capture_viewport: shot }),
      { name: 'transition', capture: true }
    );

    expect(result.content.some((c) => c.type === 'image')).toBe(true);
  });

  it('warns when the transition has not settled on the requested view', async () =>
  {
    const text = text_of(await build_go_to_view_result(
      host({ go_to_view: { requested: 'transition', current: 'home' } }),
      { name: 'transition' }
    ));

    expect(text.toLowerCase()).toContain('still');
  });

  it('surfaces not_found with the available views', async () =>
  {
    const result = await build_go_to_view_result(
      host({ go_to_view: new BridgeError('not_found', 'Unknown view. Available views: home, transition.') }),
      { name: 'ghost' }
    );

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('transition');
  });
});
