import { describe, expect, it } from 'vitest';
import { BridgeError } from '../../src/bridge/BridgeError.js';
import { build_status_report } from '../../src/tools/status.js';

const app_info = {
  core_version: '13.3.0',
  components_version: '4.1.0',
  pit_version: '5.0.4',
  active_view: 'home',
  has_camera: true,
  canvas: { width: 1280, height: 720, dpr: 2 }
};

describe('build_status_report', () =>
{
  it('reports not connected without throwing', async () =>
  {
    const report = await build_status_report({
      connected: false,
      app_info: null,
      send: async () =>
      {
        throw new BridgeError('app_not_connected', 'nope');
      }
    });

    expect(report).toContain('not connected');
    expect(report).toContain('yarn start');
  });

  it('reports live status from the app', async () =>
  {
    const report = await build_status_report({
      connected: true,
      app_info,
      send: async () => ({ active_view: 'landing', has_camera: true, canvas: { width: 800, height: 600, dpr: 1 } })
    });

    expect(report).toContain('connected');
    expect(report).toContain('landing');
    expect(report).toContain('13.3.0');
  });

  it('falls back to handshake info when the live probe fails', async () =>
  {
    const report = await build_status_report({
      connected: true,
      app_info,
      send: async () =>
      {
        throw new BridgeError('timeout', 'too slow');
      }
    });

    expect(report).toContain('home');
    expect(report).toContain('timeout');
  });
});
