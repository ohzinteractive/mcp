import { describe, expect, it } from 'vitest';
import { BridgeError } from '../../src/bridge/BridgeError.js';
import { build_capture_result } from '../../src/tools/capture.js';

const payload = {
  mode: 'fast',
  mime_type: 'image/png',
  width: 1280,
  height: 720,
  bytes: 40321,
  data: 'iVBORw0KGgo='
};

interface Sent
{
  cmd?: string;
  args?: Record<string, unknown>;
  timeout?: number;
}

function host_returning(result: unknown, sent: Sent = {}, connected = true)
{
  return {
    connected,
    send: async (cmd: string, args?: Record<string, unknown>, timeout_ms?: number) =>
    {
      sent.cmd = cmd;
      sent.args = args;
      sent.timeout = timeout_ms;

      if (result instanceof Error)
      {
        throw result;
      }

      return result;
    }
  };
}

describe('build_capture_result', () =>
{
  it('returns image content plus a text summary', async () =>
  {
    const result = await build_capture_result(host_returning(payload), {});

    expect(result.isError).toBeUndefined();

    const image = result.content.find((c) => c.type === 'image');
    expect(image).toBeDefined();
    expect(image).toMatchObject({ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' });

    const text = result.content.find((c) => c.type === 'text');
    expect(text && 'text' in text ? text.text : '').toContain('1280x720');
  });

  it('sends capture_viewport with the capture timeout, not the default', async () =>
  {
    const sent: Sent = {};
    await build_capture_result(host_returning(payload, sent), { mode: 'hires', width: 2560 });

    expect(sent.cmd).toBe('capture_viewport');
    expect(sent.args).toEqual({ mode: 'hires', width: 2560 });
    expect(sent.timeout).toBe(15000);
  });

  it('omits undefined args rather than sending explicit undefined', async () =>
  {
    const sent: Sent = {};
    await build_capture_result(host_returning(payload, sent), {});

    expect(sent.args).toEqual({});
  });

  it('reports an error when the app is not connected', async () =>
  {
    const result = await build_capture_result(host_returning(payload, {}, false), {});

    expect(result.isError).toBe(true);
    const text = result.content[0];
    expect('text' in text ? text.text : '').toContain('not connected');
    expect(result.content.some((c) => c.type === 'image')).toBe(false);
  });

  it('surfaces the bridge error code when the capture fails', async () =>
  {
    const error = new BridgeError('no_camera', 'CameraManager.current is not set yet.');
    const result = await build_capture_result(host_returning(error), { mode: 'hires' });

    expect(result.isError).toBe(true);
    const text = result.content[0];
    expect('text' in text ? text.text : '').toContain('no_camera');
    expect('text' in text ? text.text : '').toContain('CameraManager.current');
  });

  it('reports a malformed payload instead of emitting empty image content', async () =>
  {
    const result = await build_capture_result(host_returning({ mode: 'fast' }), {});

    expect(result.isError).toBe(true);
    expect(result.content.some((c) => c.type === 'image')).toBe(false);
  });
});
