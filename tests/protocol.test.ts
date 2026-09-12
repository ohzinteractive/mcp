import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, parse_hello, parse_reply } from '../src/protocol.js';
import { resolve_port } from '../src/config.js';

const valid_hello = {
  event: 'hello',
  protocol: 1,
  app: {
    core_version: '13.3.0',
    components_version: '4.1.0',
    pit_version: '5.0.4',
    active_view: 'home',
    has_camera: true,
    canvas: { width: 1280, height: 720, dpr: 2 }
  }
};

describe('PROTOCOL_VERSION', () =>
{
  it('is 1', () =>
  {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});

describe('parse_hello', () =>
{
  it('accepts a well formed hello', () =>
  {
    expect(parse_hello(valid_hello)?.app.active_view).toBe('home');
  });

  it('rejects a payload that is not a hello event', () =>
  {
    expect(parse_hello({ event: 'welcome', protocol: 1 })).toBeNull();
  });

  it('rejects a hello with a non numeric protocol', () =>
  {
    expect(parse_hello({ ...valid_hello, protocol: 'one' })).toBeNull();
  });

  it('rejects a hello with no app payload', () =>
  {
    expect(parse_hello({ event: 'hello', protocol: 1 })).toBeNull();
  });

  it('rejects non object input', () =>
  {
    expect(parse_hello(null)).toBeNull();
    expect(parse_hello('hello')).toBeNull();
  });
});

describe('parse_reply', () =>
{
  it('accepts a success reply', () =>
  {
    const reply = parse_reply({ id: 'c1', ok: true, result: { a: 1 } });
    expect(reply).toEqual({ id: 'c1', ok: true, result: { a: 1 } });
  });

  it('accepts an error reply', () =>
  {
    const reply = parse_reply({ id: 'c1', ok: false, error: { code: 'no_camera', message: 'nope' } });
    expect(reply?.ok).toBe(false);
  });

  it('rejects a reply with no id', () =>
  {
    expect(parse_reply({ ok: true, result: 1 })).toBeNull();
  });

  it('rejects an error reply with a malformed error object', () =>
  {
    expect(parse_reply({ id: 'c1', ok: false, error: 'boom' })).toBeNull();
  });
});

describe('resolve_port', () =>
{
  it('defaults to 7317', () =>
  {
    expect(resolve_port({})).toBe(7317);
  });

  it('reads OHZI_MCP_PORT', () =>
  {
    expect(resolve_port({ OHZI_MCP_PORT: '9000' })).toBe(9000);
  });

  it('falls back to the default for a non numeric value', () =>
  {
    expect(resolve_port({ OHZI_MCP_PORT: 'abc' })).toBe(7317);
  });

  it('falls back to the default for an out of range port', () =>
  {
    expect(resolve_port({ OHZI_MCP_PORT: '70000' })).toBe(7317);
  });
});
