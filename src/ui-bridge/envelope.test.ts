/**
 * ui-bridge envelope validation (contracts/ui-bridge.md §Schema/wire):
 * strict JSON-RPC 2.0; anything else classifies malformed so the session can
 * drop-and-count it without partial processing.
 */

import { buildErrorFrame, buildResponseFrame, buildThemeFrame, parseBridgeFrame } from './envelope';

describe('parseBridgeFrame — strict JSON-RPC 2.0', () => {
  it('accepts a request with a number id', () => {
    const frame = parseBridgeFrame(
      JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'status' } }),
    );
    expect(frame).toEqual({
      kind: 'request',
      id: 7,
      method: 'tools/call',
      params: { name: 'status' },
    });
  });

  it('accepts a request with a string id and no params', () => {
    const frame = parseBridgeFrame(
      JSON.stringify({ jsonrpc: '2.0', id: 'a-1', method: 'ui/ready' }),
    );
    expect(frame).toEqual({ kind: 'request', id: 'a-1', method: 'ui/ready', params: undefined });
  });

  it('classifies an id-less frame as a notification', () => {
    const frame = parseBridgeFrame(JSON.stringify({ jsonrpc: '2.0', method: 'ui/close' }));
    expect(frame).toEqual({ kind: 'notification', method: 'ui/close', params: undefined });
  });

  it.each([
    ['non-string input', 42 as unknown],
    ['invalid JSON', 'not json {'],
    ['a JSON array', '[1,2,3]'],
    ['a JSON scalar', '"hello"'],
    ['missing jsonrpc', JSON.stringify({ id: 1, method: 'tools/call' })],
    ['wrong jsonrpc version', JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'tools/call' })],
    ['jsonrpc non-string', JSON.stringify({ jsonrpc: 2, id: 1, method: 'tools/call' })],
    ['missing method', JSON.stringify({ jsonrpc: '2.0', id: 1 })],
    ['empty method', JSON.stringify({ jsonrpc: '2.0', id: 1, method: '' })],
    ['method non-string', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 5 })],
    ['null id (unusable for responses)', JSON.stringify({ jsonrpc: '2.0', id: null, method: 'x' })],
    ['object id', JSON.stringify({ jsonrpc: '2.0', id: {}, method: 'x' })],
    ['params non-object', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'x', params: 'p' })],
    ['params array', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'x', params: [1] })],
  ])('classifies %s as malformed', (_label, raw) => {
    expect(parseBridgeFrame(raw).kind).toBe('malformed');
  });
});

describe('outgoing frame builders', () => {
  it('builds a valid success response envelope', () => {
    expect(JSON.parse(buildResponseFrame(3, { ok: true }))).toEqual({
      jsonrpc: '2.0',
      id: 3,
      result: { ok: true },
    });
  });

  it('normalizes an undefined result to null (a response always has a result)', () => {
    expect(JSON.parse(buildResponseFrame('x', undefined))).toEqual({
      jsonrpc: '2.0',
      id: 'x',
      result: null,
    });
  });

  it('builds a valid error envelope', () => {
    expect(JSON.parse(buildErrorFrame(9, -32601, 'nope'))).toEqual({
      jsonrpc: '2.0',
      id: 9,
      error: { code: -32601, message: 'nope' },
    });
  });

  it('builds the ui/theme event as a notification with scheme + insets', () => {
    const frame = JSON.parse(
      buildThemeFrame({ scheme: 'dark', insets: { top: 42, right: 0, bottom: 12, left: 0 } }),
    );
    expect(frame).toEqual({
      jsonrpc: '2.0',
      method: 'ui/theme',
      params: { scheme: 'dark', insets: { top: 42, right: 0, bottom: 12, left: 0 } },
    });
    expect('id' in frame).toBe(false);
  });
});
