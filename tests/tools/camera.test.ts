import { describe, expect, it } from 'vitest';
import { BridgeError } from '../../src/bridge/BridgeError.js';
import { build_frame_result, build_get_camera_result, build_set_camera_result } from '../../src/tools/camera.js';

const state = {
  position: [0, 0, 10],
  fov: 60,
  near: 0.1,
  far: 200,
  clear_color: '#181818',
  clear_alpha: 1,
  controller: { tilt: 30, orientation: 45, azimuth: 0, zoom: 0.5, min_zoom: 1, max_zoom: 40, target: [0, 0, 0] }
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

const shot = { mode: 'fast', mime_type: 'image/png', width: 10, height: 10, bytes: 3, data: 'AAA=' };

describe('get_camera', () =>
{
  it('renders the projection and clear colour', async () =>
  {
    const text = text_of(await build_get_camera_result(host({ get_camera: state }), {}));

    expect(text).toContain('0, 0, 10');
    expect(text).toContain('60');
    expect(text).toContain('#181818');
  });

  it('renders the orbital state and says the angles are degrees', async () =>
  {
    const text = text_of(await build_get_camera_result(host({ get_camera: state }), {}));

    expect(text).toContain('30');
    expect(text).toContain('45');
    expect(text.toLowerCase()).toContain('degrees');
  });

  it('says plainly when no controller drives the camera', async () =>
  {
    const text = text_of(await build_get_camera_result(host({ get_camera: { ...state, controller: null } }), {}));

    expect(text.toLowerCase()).toContain('no camera controller');
  });

  it('surfaces a no_camera code', async () =>
  {
    const result = await build_get_camera_result(
      host({ get_camera: new BridgeError('no_camera', 'CameraManager.current is not set yet.') }),
      {}
    );

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('no_camera');
  });

  it('errors when not connected', async () =>
  {
    expect((await build_get_camera_result(host({}, [], false), {})).isError).toBe(true);
  });
});

describe('set_camera', () =>
{
  it('forwards only the values supplied', async () =>
  {
    const calls: Call[] = [];
    await build_set_camera_result(host({ set_camera: { ...state, changed: ['tilt'] } }, calls), { tilt: 70 });

    expect(calls[0]).toEqual({ cmd: 'set_camera', args: { tilt: 70 } });
  });

  it('forwards an explicit zero rather than dropping it', async () =>
  {
    const calls: Call[] = [];
    await build_set_camera_result(host({ set_camera: { ...state, changed: ['tilt'] } }, calls), { tilt: 0 });

    expect(calls[0].args).toEqual({ tilt: 0 });
  });

  it('reports what changed', async () =>
  {
    const text = text_of(await build_set_camera_result(
      host({ set_camera: { ...state, changed: ['tilt', 'zoom'] } }),
      { tilt: 70, zoom: 0.2 }
    ));

    expect(text).toContain('tilt');
    expect(text).toContain('zoom');
  });

  it('returns the resulting image when capture is requested', async () =>
  {
    const calls: Call[] = [];
    const result = await build_set_camera_result(
      host({ set_camera: { ...state, changed: ['tilt'] }, capture_viewport: shot }, calls),
      { tilt: 70, capture: true }
    );

    expect(calls.map((c) => c.cmd)).toEqual(['set_camera', 'capture_viewport']);
    expect(result.content.some((c) => c.type === 'image')).toBe(true);
  });

  it('explains the controller_owns_camera refusal', async () =>
  {
    const result = await build_set_camera_result(
      host({ set_camera: new BridgeError('controller_owns_camera', 'A CameraController is driving this camera.') }),
      { position: [1, 2, 3] }
    );

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('controller_owns_camera');
  });
});

describe('frame_object', () =>
{
  it('forwards the selector and scale', async () =>
  {
    const calls: Call[] = [];
    await build_frame_result(host({ frame_object: { ...state, changed: ['framed'] } }, calls), { name: 'cube', scale: 1.5 });

    expect(calls[0]).toEqual({ cmd: 'frame_object', args: { name: 'cube', scale: 1.5 } });
  });

  it('returns the resulting image when capture is requested', async () =>
  {
    const result = await build_frame_result(
      host({ frame_object: { ...state, changed: ['framed'] }, capture_viewport: shot }),
      { name: 'cube', capture: true }
    );

    expect(result.content.some((c) => c.type === 'image')).toBe(true);
  });

  it('surfaces a not_found code', async () =>
  {
    const result = await build_frame_result(
      host({ frame_object: new BridgeError('not_found', "No object matching name 'ghost'") }),
      { name: 'ghost' }
    );

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('not_found');
  });

  it('surfaces a no_controller code', async () =>
  {
    const result = await build_frame_result(
      host({ frame_object: new BridgeError('no_controller', 'The active scene has no camera_controller.') }),
      { name: 'cube' }
    );

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('no_controller');
  });
});
