import { describe, expect, it } from 'vitest';
import { BridgeError } from '../../src/bridge/BridgeError.js';
import { build_console_result } from '../../src/tools/console.js';

const payload = {
  entries: [
    { seq: 12, level: 'log', message: 'hello', at: 1 },
    { seq: 13, level: 'warn', message: 'careful', at: 2 },
    { seq: 14, level: 'error', message: 'Uncaught TypeError: x is not a function', at: 3 }
  ],
  dropped: 4,
  total: 14,
  capacity: 200
};

interface Sent
{
  cmd?: string;
  args?: Record<string, unknown>;
}

function host_returning(result: unknown, sent: Sent = {}, connected = true)
{
  return {
    connected,
    send: async (cmd: string, args?: Record<string, unknown>) =>
    {
      sent.cmd = cmd;
      sent.args = args;

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
  return result.content.map((c) => c.text ?? '').join('\n');
}

describe('build_console_result', () =>
{
  it('lists entries with their seq and level', async () =>
  {
    const text = text_of(await build_console_result(host_returning(payload), {}));

    expect(text).toContain('[14]');
    expect(text).toContain('error');
    expect(text).toContain('x is not a function');
    expect(text).toContain('hello');
  });

  it('reports dropped entries so silent loss is visible', async () =>
  {
    const text = text_of(await build_console_result(host_returning(payload), {}));

    expect(text).toContain('4');
    expect(text.toLowerCase()).toContain('dropped');
  });

  it('defaults to a bounded limit so it cannot flood the context', async () =>
  {
    const sent: Sent = {};
    await build_console_result(host_returning(payload, sent), {});

    expect(sent.cmd).toBe('get_console');
    expect(sent.args).toEqual({ limit: 50 });
  });

  it('forwards level, limit and since', async () =>
  {
    const sent: Sent = {};
    await build_console_result(host_returning(payload, sent), { level: 'error', limit: 10, since: 7 });

    expect(sent.args).toEqual({ level: 'error', limit: 10, since: 7 });
  });

  it('says so clearly when there is nothing logged', async () =>
  {
    const empty = { entries: [], dropped: 0, total: 0, capacity: 200 };
    const text = text_of(await build_console_result(host_returning(empty), {}));

    expect(text.toLowerCase()).toContain('no console');
  });

  it('reports an error when the app is not connected', async () =>
  {
    const result = await build_console_result(host_returning(payload, {}, false), {});

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('not connected');
  });

  it('surfaces the bridge error code', async () =>
  {
    const result = await build_console_result(host_returning(new BridgeError('timeout', 'too slow')), {});

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('timeout');
  });

  it('reports a malformed payload rather than rendering nothing', async () =>
  {
    const result = await build_console_result(host_returning({ nope: true }), {});

    expect(result.isError).toBe(true);
  });

  it('skips malformed individual entries without discarding the rest', async () =>
  {
    const mixed = {
      entries: [
        { seq: 1, level: 'log', message: 'kept', at: 1 },
        { seq: 'x', level: 'log', message: 'dropped' },
        null
      ],
      dropped: 0,
      total: 3,
      capacity: 200
    };

    const result = await build_console_result(host_returning(mixed), {});

    expect(result.isError).toBeUndefined();
    expect(text_of(result)).toContain('kept');
  });
});
