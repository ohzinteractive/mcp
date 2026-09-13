import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { BridgeHost } from '../../src/bridge/BridgeHost.js';
import { PROTOCOL_VERSION } from '../../src/protocol.js';

const app_payload = {
  core_version: '14.0.0',
  components_version: '4.1.0',
  pit_version: '5.0.4',
  active_view: 'home',
  has_camera: true,
  canvas: { width: 1280, height: 720, dpr: 2 }
};

let host: BridgeHost;
let port: number;
const sockets: WebSocket[] = [];

function open_client(): Promise<WebSocket>
{
  return new Promise((resolve, reject) =>
  {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.push(socket);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function next_message(socket: WebSocket): Promise<any>
{
  return new Promise((resolve) =>
  {
    socket.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

async function connect_valid_client(): Promise<WebSocket>
{
  const socket = await open_client();
  socket.send(JSON.stringify({ event: 'hello', protocol: PROTOCOL_VERSION, app: app_payload }));
  const welcome = await next_message(socket);
  expect(welcome.event).toBe('welcome');
  return socket;
}

beforeEach(async () =>
{
  host = new BridgeHost();
  port = await host.start(0);
});

afterEach(async () =>
{
  for (const socket of sockets)
  {
    socket.close();
  }
  sockets.length = 0;
  await host.stop();
});

describe('BridgeHost handshake', () =>
{
  it('accepts a matching protocol and exposes the app info', async () =>
  {
    await connect_valid_client();

    expect(host.connected).toBe(true);
    expect(host.app_info?.active_view).toBe('home');
    expect(host.app_info?.core_version).toBe('14.0.0');
  });

  it('refuses a mismatched protocol and names both versions', async () =>
  {
    const socket = await open_client();
    socket.send(JSON.stringify({ event: 'hello', protocol: 99, app: app_payload }));

    const refused = await next_message(socket);

    expect(refused.event).toBe('refused');
    expect(refused.server_protocol).toBe(PROTOCOL_VERSION);
    expect(refused.client_protocol).toBe(99);
    expect(host.connected).toBe(false);
  });

  it('refuses a first message that is not a hello', async () =>
  {
    const socket = await open_client();
    socket.send(JSON.stringify({ id: 'c1', ok: true, result: 1 }));

    const refused = await next_message(socket);

    expect(refused.event).toBe('refused');
    expect(host.connected).toBe(false);
  });

  it('replaces an existing connection when the app reloads', async () =>
  {
    const first = await connect_valid_client();
    const closed = new Promise<void>((resolve) => first.once('close', () => resolve()));

    await connect_valid_client();
    await closed;

    expect(host.connected).toBe(true);
  });
});

describe('BridgeHost send', () =>
{
  it('resolves with the result matching the command id', async () =>
  {
    const socket = await connect_valid_client();

    socket.on('message', (data) =>
    {
      const command = JSON.parse(data.toString());
      socket.send(JSON.stringify({ id: command.id, ok: true, result: { echoed: command.cmd } }));
    });

    await expect(host.send('status')).resolves.toEqual({ echoed: 'status' });
  });

  it('rejects with app_not_connected when nothing is connected', async () =>
  {
    await expect(host.send('status')).rejects.toMatchObject({ code: 'app_not_connected' });
  });

  it('rejects with the error code the app reported', async () =>
  {
    const socket = await connect_valid_client();

    socket.on('message', (data) =>
    {
      const command = JSON.parse(data.toString());
      socket.send(JSON.stringify({
        id: command.id,
        ok: false,
        error: { code: 'no_camera', message: 'CameraManager.current is undefined' }
      }));
    });

    await expect(host.send('get_camera')).rejects.toMatchObject({ code: 'no_camera' });
  });

  it('rejects with timeout when the app never replies', async () =>
  {
    await connect_valid_client();

    await expect(host.send('status', {}, 50)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('rejects pending commands with disconnected when the socket closes', async () =>
  {
    const socket = await connect_valid_client();
    const pending = host.send('status', {}, 5000);

    socket.close();

    await expect(pending).rejects.toMatchObject({ code: 'disconnected' });
  });

  it('correlates concurrent commands independently', async () =>
  {
    const socket = await connect_valid_client();

    socket.on('message', (data) =>
    {
      const command = JSON.parse(data.toString());
      const delay = command.cmd === 'slow' ? 40 : 0;
      setTimeout(() =>
      {
        socket.send(JSON.stringify({ id: command.id, ok: true, result: command.cmd }));
      }, delay);
    });

    const [slow, fast] = await Promise.all([host.send('slow'), host.send('fast')]);

    expect(slow).toBe('slow');
    expect(fast).toBe('fast');
  });
});
