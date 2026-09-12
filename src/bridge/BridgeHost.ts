import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { DEFAULT_TIMEOUT_MS } from '../config.js';
import type { AppInfo } from '../protocol.js';
import { PROTOCOL_VERSION, parse_hello, parse_reply } from '../protocol.js';
import { BridgeError } from './BridgeError.js';

interface PendingCommand
{
  resolve: (value: unknown) => void;
  reject: (error: BridgeError) => void;
  timer: NodeJS.Timeout;
}

export class BridgeHost
{
  private server: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private info: AppInfo | null = null;
  private pending = new Map<string, PendingCommand>();
  private next_id = 0;

  get connected(): boolean
  {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  get app_info(): AppInfo | null
  {
    return this.info;
  }

  start(port: number): Promise<number>
  {
    return new Promise((resolve, reject) =>
    {
      const server = new WebSocketServer({ host: '127.0.0.1', port });

      server.on('connection', (socket) => this.on_connection(socket));
      server.on('error', reject);
      server.on('listening', () =>
      {
        this.server = server;
        resolve((server.address() as AddressInfo).port);
      });
    });
  }

  async stop(): Promise<void>
  {
    this.reject_pending('disconnected', 'Bridge host stopped');

    this.socket?.close();
    this.socket = null;
    this.info = null;

    const server = this.server;
    this.server = null;

    if (server === null)
    {
      return;
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  send(cmd: string, args: Record<string, unknown> = {}, timeout_ms = DEFAULT_TIMEOUT_MS): Promise<unknown>
  {
    if (!this.connected)
    {
      return Promise.reject(new BridgeError(
        'app_not_connected',
        'No OHZI app is connected. Start the dev server (yarn start) and load the page.'
      ));
    }

    const id = `c${++this.next_id}`;

    return new Promise((resolve, reject) =>
    {
      const timer = setTimeout(() =>
      {
        this.pending.delete(id);
        reject(new BridgeError('timeout', `Command '${cmd}' timed out after ${timeout_ms}ms`));
      }, timeout_ms);

      this.pending.set(id, { resolve, reject, timer });
      this.socket?.send(JSON.stringify({ id, cmd, args }));
    });
  }

  private on_connection(socket: WebSocket): void
  {
    let handshaken = false;

    socket.on('message', (data) =>
    {
      let payload: unknown;

      try
      {
        payload = JSON.parse(data.toString());
      }
      catch
      {
        return;
      }

      if (!handshaken)
      {
        handshaken = this.try_handshake(socket, payload);
        return;
      }

      this.on_reply(payload);
    });

    socket.on('close', () =>
    {
      if (this.socket === socket)
      {
        this.socket = null;
        this.info = null;
        this.reject_pending('disconnected', 'The OHZI app disconnected');
      }
    });

    socket.on('error', () => socket.close());
  }

  private try_handshake(socket: WebSocket, payload: unknown): boolean
  {
    const hello = parse_hello(payload);

    if (hello === null)
    {
      this.refuse(socket, 'First message must be a valid hello event', null);
      return false;
    }

    if (hello.protocol !== PROTOCOL_VERSION)
    {
      this.refuse(
        socket,
        'Protocol mismatch. Update ohzi-mcp or ohzi-core so both speak the same version.',
        hello.protocol
      );
      return false;
    }

    // A reload opens a new socket before the old one closes. The newest wins.
    if (this.socket !== null && this.socket !== socket)
    {
      const stale = this.socket;
      this.socket = null;
      stale.close();
    }

    this.socket = socket;
    this.info = hello.app;

    socket.send(JSON.stringify({ event: 'welcome', protocol: PROTOCOL_VERSION }));

    return true;
  }

  private refuse(socket: WebSocket, reason: string, client_protocol: number | null): void
  {
    socket.send(JSON.stringify({
      event: 'refused',
      reason,
      server_protocol: PROTOCOL_VERSION,
      client_protocol
    }));

    socket.close();
  }

  private on_reply(payload: unknown): void
  {
    const reply = parse_reply(payload);

    if (reply === null)
    {
      return;
    }

    const pending = this.pending.get(reply.id);

    if (pending === undefined)
    {
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(reply.id);

    if (reply.ok)
    {
      pending.resolve(reply.result);
    }
    else
    {
      pending.reject(new BridgeError(reply.error.code as never, reply.error.message));
    }
  }

  private reject_pending(code: 'disconnected', message: string): void
  {
    for (const pending of this.pending.values())
    {
      clearTimeout(pending.timer);
      pending.reject(new BridgeError(code, message));
    }

    this.pending.clear();
  }
}
