/**
 * Bridge session router/plumbing (contracts/ui-bridge.md, FROZEN v1):
 * allowlist-first tools/call, -32601 on violation with the MCP client NEVER
 * invoked, 30s timeout → -32000 (injectable clock), exactly one response per
 * id, malformed frames dropped+counted, ui/ready + ui/close signals.
 */

import { createBridgeSession } from './bridge';

/** Manual scheduler: fire timers on demand — the injectable clock. */
const makeScheduler = () => {
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  return {
    schedule: (fn: () => void, ms: number): unknown => {
      const handle = next;
      next += 1;
      timers.set(handle, { fn, ms });
      return handle;
    },
    cancel: (handle: unknown): void => {
      timers.delete(handle as number);
    },
    fire: (handle: number): void => {
      const timer = timers.get(handle);
      timers.delete(handle);
      timer?.fn();
    },
    pending: () => [...timers.keys()],
    lastMs: () => [...timers.values()].at(-1)?.ms,
  };
};

interface Deferred {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

const makeHarness = (options?: { allowlist?: string[]; timeoutMs?: number }) => {
  const posted: string[] = [];
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const deferreds: Deferred[] = [];
  const scheduler = makeScheduler();
  const events: string[] = [];
  const callTool = jest.fn((name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return new Promise((resolve, reject) => {
      deferreds.push({ resolve, reject });
    });
  });
  const session = createBridgeSession({
    allowlist: new Set(options?.allowlist ?? ['status']),
    callTool,
    post: (frame) => posted.push(frame),
    onReady: () => events.push('ready'),
    onClose: () => events.push('close'),
    timeoutMs: options?.timeoutMs,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });
  return { session, posted, calls, deferreds, scheduler, events, callTool };
};

const request = (id: number | string, method: string, params?: Record<string, unknown>) =>
  JSON.stringify(
    params === undefined ? { jsonrpc: '2.0', id, method } : { jsonrpc: '2.0', id, method, params },
  );

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('tools/call routing', () => {
  it('forwards an allowlisted call and delivers exactly one success response', async () => {
    const h = makeHarness();
    h.session.handleFrame(request(1, 'tools/call', { name: 'status', arguments: { a: 1 } }));

    expect(h.calls).toEqual([{ name: 'status', args: { a: 1 } }]);
    h.deferreds[0]?.resolve({ content: [{ type: 'text', text: 'ok' }] });
    await flush();

    expect(h.posted).toHaveLength(1);
    expect(JSON.parse(h.posted[0] as string)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: 'ok' }] },
    });
    // The timeout timer was cancelled when the call settled.
    expect(h.scheduler.pending()).toHaveLength(0);
  });

  it('missing arguments default to {}', () => {
    const h = makeHarness();
    h.session.handleFrame(request(1, 'tools/call', { name: 'status' }));
    expect(h.calls).toEqual([{ name: 'status', args: {} }]);
  });

  it('refuses a non-allowlisted tool with -32601 and NEVER invokes the MCP client', () => {
    const h = makeHarness({ allowlist: ['status'] });
    h.session.handleFrame(request(2, 'tools/call', { name: 'jobs_kill', arguments: {} }));

    expect(h.callTool).not.toHaveBeenCalled(); // never forwarded — the spy proves it
    expect(h.posted).toHaveLength(1);
    expect(JSON.parse(h.posted[0] as string)).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      error: { code: -32601 },
    });
    expect(h.session.counts()).toEqual({ malformed: 0, violations: 1 });
  });

  it('an EMPTY allowlist refuses every tool (fail closed)', () => {
    const h = makeHarness({ allowlist: [] });
    h.session.handleFrame(request(3, 'tools/call', { name: 'status' }));
    expect(h.callTool).not.toHaveBeenCalled();
    expect(JSON.parse(h.posted[0] as string)).toMatchObject({ error: { code: -32601 } });
  });

  it('a tools/call whose params lack a string name is a -32601 violation, not a forward', () => {
    const h = makeHarness();
    h.session.handleFrame(request(4, 'tools/call', { arguments: {} }));
    expect(h.callTool).not.toHaveBeenCalled();
    expect(JSON.parse(h.posted[0] as string)).toMatchObject({ error: { code: -32601 } });
  });

  it('non-object arguments are answered -32602 without forwarding', () => {
    const h = makeHarness();
    h.session.handleFrame(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'status', arguments: [1, 2] },
      }),
    );
    expect(h.callTool).not.toHaveBeenCalled();
    expect(JSON.parse(h.posted[0] as string)).toMatchObject({ error: { code: -32602 } });
  });

  it('a tools/call notification (no id) is dropped and counted — it could never be answered', () => {
    const h = makeHarness();
    h.session.handleFrame(
      JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'status' } }),
    );
    expect(h.callTool).not.toHaveBeenCalled();
    expect(h.posted).toHaveLength(0);
    expect(h.session.counts().malformed).toBe(1);
  });

  it('a failed forwarded call is answered with exactly one error response', async () => {
    const h = makeHarness();
    h.session.handleFrame(request(6, 'tools/call', { name: 'status' }));
    h.deferreds[0]?.reject(new Error('agent exploded: secret-detail'));
    await flush();

    expect(h.posted).toHaveLength(1);
    const frame = JSON.parse(h.posted[0] as string);
    expect(frame).toMatchObject({ id: 6, error: { code: -32001 } });
    // Agent-side error detail must not leak into the WebView.
    expect(h.posted[0]).not.toContain('secret-detail');
  });
});

describe('timeout → -32000 (injectable clock)', () => {
  it('answers -32000 when the shell timeout fires first', () => {
    const h = makeHarness({ timeoutMs: 30_000 });
    h.session.handleFrame(request(7, 'tools/call', { name: 'status' }));
    expect(h.scheduler.lastMs()).toBe(30_000); // contract v1: 30s

    h.scheduler.fire(h.scheduler.pending()[0] as number);
    expect(h.posted).toHaveLength(1);
    expect(JSON.parse(h.posted[0] as string)).toMatchObject({ id: 7, error: { code: -32000 } });
  });

  it('exactly one response per id: a late result after timeout is dropped', async () => {
    const h = makeHarness();
    h.session.handleFrame(request(8, 'tools/call', { name: 'status' }));
    h.scheduler.fire(h.scheduler.pending()[0] as number); // timeout answered first

    h.deferreds[0]?.resolve({ content: [] }); // tool resolves too late
    await flush();

    expect(h.posted).toHaveLength(1); // still only the -32000 frame
    expect(JSON.parse(h.posted[0] as string)).toMatchObject({ error: { code: -32000 } });
  });

  it('string id "1" and number id 1 are distinct in-flight requests', async () => {
    const h = makeHarness();
    h.session.handleFrame(request(1, 'tools/call', { name: 'status' }));
    h.session.handleFrame(request('1', 'tools/call', { name: 'status' }));
    expect(h.calls).toHaveLength(2);

    h.deferreds[0]?.resolve({ content: [] });
    h.deferreds[1]?.resolve({ content: [] });
    await flush();
    expect(h.posted).toHaveLength(2);
  });

  it('a duplicate in-flight id is dropped as malformed, preserving one-response-per-id', () => {
    const h = makeHarness();
    h.session.handleFrame(request(9, 'tools/call', { name: 'status' }));
    h.session.handleFrame(request(9, 'tools/call', { name: 'status' }));
    expect(h.calls).toHaveLength(1);
    expect(h.session.counts().malformed).toBe(1);
  });
});

describe('malformed frames', () => {
  it('drops and counts them without any response or side effect', () => {
    const h = makeHarness();
    h.session.handleFrame('not json {');
    h.session.handleFrame(JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'tools/call' }));
    h.session.handleFrame(JSON.stringify({ jsonrpc: '2.0', id: null, method: 'tools/call' }));

    expect(h.posted).toHaveLength(0);
    expect(h.callTool).not.toHaveBeenCalled();
    expect(h.session.counts()).toEqual({ malformed: 3, violations: 0 });
  });

  it('reports counts through onCounts after every increment', () => {
    const seen: Array<{ malformed: number; violations: number }> = [];
    const session = createBridgeSession({
      allowlist: new Set(),
      callTool: jest.fn(),
      post: () => {},
      onCounts: (counts) => seen.push(counts),
    });
    session.handleFrame('garbage');
    session.handleFrame(request(1, 'tools/call', { name: 'nope' }));
    expect(seen).toEqual([
      { malformed: 1, violations: 0 },
      { malformed: 1, violations: 1 },
    ]);
    session.dispose();
  });
});

describe('ui/ready, ui/close, unknown methods', () => {
  it('ui/ready notification signals the shell without a response', () => {
    const h = makeHarness();
    h.session.handleFrame(JSON.stringify({ jsonrpc: '2.0', method: 'ui/ready' }));
    expect(h.events).toEqual(['ready']);
    expect(h.posted).toHaveLength(0);
  });

  it('ui/ready sent as a request still gets its one response', () => {
    const h = makeHarness();
    h.session.handleFrame(request(10, 'ui/ready'));
    expect(h.events).toEqual(['ready']);
    expect(JSON.parse(h.posted[0] as string)).toEqual({ jsonrpc: '2.0', id: 10, result: null });
  });

  it('ui/close asks the shell to dismiss', () => {
    const h = makeHarness();
    h.session.handleFrame(JSON.stringify({ jsonrpc: '2.0', method: 'ui/close' }));
    expect(h.events).toEqual(['close']);
  });

  it('an unknown method request is answered -32601 and counted as a violation', () => {
    const h = makeHarness();
    h.session.handleFrame(request(11, 'fs/read', { path: '/etc/passwd' }));
    expect(JSON.parse(h.posted[0] as string)).toMatchObject({ id: 11, error: { code: -32601 } });
    expect(h.session.counts().violations).toBe(1);
  });
});

describe('theme push and dispose', () => {
  it('pushTheme posts the ui/theme notification', () => {
    const h = makeHarness();
    h.session.pushTheme({ scheme: 'light', insets: { top: 1, right: 2, bottom: 3, left: 4 } });
    expect(JSON.parse(h.posted[0] as string)).toEqual({
      jsonrpc: '2.0',
      method: 'ui/theme',
      params: { scheme: 'light', insets: { top: 1, right: 2, bottom: 3, left: 4 } },
    });
  });

  it('dispose cancels pending timers and silences the session', async () => {
    const h = makeHarness();
    h.session.handleFrame(request(12, 'tools/call', { name: 'status' }));
    h.session.dispose();
    expect(h.scheduler.pending()).toHaveLength(0);

    h.deferreds[0]?.resolve({ content: [] });
    await flush();
    h.session.handleFrame(request(13, 'tools/call', { name: 'status' }));
    h.session.pushTheme({ scheme: 'dark', insets: { top: 0, right: 0, bottom: 0, left: 0 } });
    expect(h.posted).toHaveLength(0);
    expect(h.calls).toHaveLength(1); // no new forward after dispose
  });
});
