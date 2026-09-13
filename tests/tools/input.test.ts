import { describe, expect, it } from 'vitest';
import { BridgeError } from '../../src/bridge/BridgeError.js';
import { build_drag_result, build_key_result, build_pointer_result, build_scroll_result } from '../../src/tools/input.js';

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

describe('pointer', () =>
{
  it('forwards the action, coordinates and button', async () =>
  {
    const calls: Call[] = [];
    await build_pointer_result(host({ pointer: { dispatched: ['mousemove', 'mousedown', 'mouseup'], at: [110, 70] } }, calls), {
      action: 'click', x: 10, y: 20, button: 'right'
    });

    expect(calls[0]).toEqual({ cmd: 'pointer', args: { action: 'click', x: 10, y: 20, button: 'right' } });
  });

  it('reports the events actually dispatched', async () =>
  {
    const text = text_of(await build_pointer_result(
      host({ pointer: { dispatched: ['mousemove', 'mousedown', 'mouseup'], at: [110, 70] } }),
      { action: 'click', x: 10, y: 20 }
    ));

    expect(text).toContain('mousedown');
    expect(text).toContain('110, 70');
  });

  it('returns the resulting image when capture is requested', async () =>
  {
    const result = await build_pointer_result(
      host({ pointer: { dispatched: ['mousemove'] }, capture_viewport: shot }),
      { action: 'move', x: 1, y: 2, capture: true }
    );

    expect(result.content.some((c) => c.type === 'image')).toBe(true);
  });

  it('surfaces a bad_request code', async () =>
  {
    const result = await build_pointer_result(
      host({ pointer: new BridgeError('bad_request', 'x and y must be numbers.') }),
      { action: 'click', x: 0, y: 0 }
    );

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('bad_request');
  });

  it('errors when not connected', async () =>
  {
    expect((await build_pointer_result(host({}, [], false), { action: 'click', x: 0, y: 0 })).isError).toBe(true);
  });
});

describe('drag', () =>
{
  it('forwards endpoints and shaping options', async () =>
  {
    const calls: Call[] = [];
    await build_drag_result(host({ drag: { dispatched: [], from: [0, 0], to: [80, 40] } }, calls), {
      from: [0, 0], to: [80, 40], steps: 4, duration_ms: 300
    });

    expect(calls[0].args).toEqual({ from: [0, 0], to: [80, 40], steps: 4, duration_ms: 300 });
  });

  it('reports the path travelled', async () =>
  {
    const text = text_of(await build_drag_result(
      host({ drag: { dispatched: ['mousedown', 'mousemove', 'mouseup'], from: [100, 50], to: [180, 90] } }),
      { from: [0, 0], to: [80, 40] }
    ));

    expect(text).toContain('100, 50');
    expect(text).toContain('180, 90');
  });
});

describe('scroll and key', () =>
{
  it('forwards the scroll delta', async () =>
  {
    const calls: Call[] = [];
    await build_scroll_result(host({ scroll: { dispatched: ['wheel'], delta: -120 } }, calls), { delta: -120 });

    expect(calls[0]).toEqual({ cmd: 'scroll', args: { delta: -120 } });
  });

  it('forwards the key code and action', async () =>
  {
    const calls: Call[] = [];
    await build_key_result(host({ key: { dispatched: ['keydown', 'keyup'], code: 'Space' } }, calls), { code: 'Space', action: 'press' });

    expect(calls[0]).toEqual({ cmd: 'key', args: { code: 'Space', action: 'press' } });
  });

  it('reports the key that was driven', async () =>
  {
    const text = text_of(await build_key_result(
      host({ key: { dispatched: ['keydown', 'keyup'], code: 'Space' } }),
      { code: 'Space' }
    ));

    expect(text).toContain('Space');
    expect(text).toContain('keyup');
  });
});
