/**
 * Integration (stage 10): TWO mock agents with DIFFERENT --owner-id values,
 * over real HTTP — the multi-agent switcher's correctness claims:
 *
 * 1. per-connection personId end to end: the handshake persists the form's
 *    person id (stored for agent A, blank→null for agent B), resolution is
 *    stored ?? OWNER_PERSON_ID, and a send to EACH agent carrying its
 *    resolved personId is accepted (202 + ack);
 * 2. a deliberately wrong personId is refused with 403 — ApiClientError kind
 *    'http', NOT 'network' — so it takes the failed/tap-to-retry path and is
 *    NEVER placed in the offline compose queue;
 * 3. switching mid-session keeps transcripts isolated per connection
 *    (extends the stage-9 restart/catch-up scenarios across two live
 *    connections sharing one database backing).
 *
 * Same pattern as durability.test.ts: the production wiring in miniature
 * (pure reducer + durable write-through subscriber) stands in for the React
 * hook; the personId plumbing of the hook itself is locked by
 * src/chat/use-chat-session.test.tsx.
 */
import { randomUUID } from 'node:crypto';

import { ApiClientError, getOutbox, postMessage } from '../../src/api/client';
import { runCatchUp } from '../../src/chat/catch-up';
import { createDurableChat, type DurableChat } from '../../src/chat/durable-chat';
import { buildInboundMessage } from '../../src/chat/inbound';
import {
  type ChatStoreBacking,
  createChatStoreBacking,
  MemoryChatStore,
} from '../../src/chat/memory';
import { OWNER_PERSON_ID, resolvePersonId } from '../../src/chat/person-id';
import {
  emptyTranscript,
  type TranscriptAction,
  type TranscriptState,
  transcriptReducer,
} from '../../src/chat/transcript';
import { addOrUpdateConnection } from '../../src/connections/handshake';
import { MemoryConnectionStore, MemoryTokenVault } from '../../src/connections/memory';
import type { ConnectionRecord } from '../../src/connections/types';
import { type MockAgent, startMockAgent } from './mock-agent-harness';

const TOKEN_A = 'integration-token-alpha';
const TOKEN_B = 'integration-token-beta';
/** Agent A's owner id — stored per-connection via the form field. */
const OWNER_A = 'owner-alpha';
/** Agent B runs on the APP DEFAULT owner id — its connection stores NULL and
 * exercises the null → OWNER_PERSON_ID resolution path. */
const OWNER_B = OWNER_PERSON_ID;

const deps = { newUuid: () => randomUUID() };

let agentA: MockAgent;
let agentB: MockAgent;

beforeEach(async () => {
  // TWO harness instances with DIFFERENT --owner-id values.
  [agentA, agentB] = await Promise.all([
    startMockAgent(TOKEN_A, { ownerId: OWNER_A }),
    startMockAgent(TOKEN_B, { ownerId: OWNER_B }),
  ]);
});

afterEach(async () => {
  await Promise.all([agentA?.stop(), agentB?.stop()]);
});

/** Handshake both agents through the REAL form→handshake path: A with a
 * per-connection person id, B with the field left blank. */
const addBothConnections = async () => {
  const store = new MemoryConnectionStore();
  const vault = new MemoryTokenVault();
  const recordA = await addOrUpdateConnection(
    { baseUrl: agentA.baseUrl, token: TOKEN_A, personId: OWNER_A },
    { store, vault },
  );
  const recordB = await addOrUpdateConnection(
    { baseUrl: agentB.baseUrl, token: TOKEN_B, personId: '' },
    { store, vault },
  );
  return { store, vault, recordA, recordB };
};

const connFor = (agent: MockAgent) => ({ baseUrl: agent.baseUrl, token: agent.token });

/** The hook's reducer+subscriber wiring, minus React (as in durability.test.ts). */
const makeSession = (durable: DurableChat, initial: TranscriptState = emptyTranscript) => {
  let state = initial;
  return {
    apply(action: TranscriptAction) {
      const prev = state;
      state = transcriptReducer(prev, action);
      durable.handle(action, prev, state);
    },
    get state() {
      return state;
    },
  };
};

const makeDurable = (backing: ChatStoreBacking, connectionId: string): DurableChat =>
  createDurableChat({
    enabled: true,
    connectionId,
    storeFactory: async () => new MemoryChatStore(backing),
  });

type Session = ReturnType<typeof makeSession>;

/** Poll /outbox (the catch-up path — no SSE needed here) into the session's
 * reducer until the predicate holds. Re-applying is dedup-safe by design. */
const pollEventsInto = async (
  conn: { baseUrl: string; token: string },
  session: Session,
  predicate: (state: TranscriptState) => boolean,
  what: string,
): Promise<void> => {
  const deadline = Date.now() + 10_000;
  for (;;) {
    await runCatchUp({
      after: null,
      fetchPage: (after) => getOutbox(conn, after),
      apply: (envelope) => session.apply({ type: 'event', envelope }),
    });
    if (predicate(session.state)) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

const hasReply = (state: TranscriptState, text: string): boolean =>
  state.items.some((i) => i.kind === 'agent' && i.text === `mock-agent received: ${text}`);

const sendThrough = async (
  session: Session,
  conn: { baseUrl: string; token: string },
  text: string,
  personId: string,
) => {
  const message = buildInboundMessage({ text, personId }, deps);
  session.apply({ type: 'send', messageId: message.messageId, text, at: message.receivedAt });
  const accepted = await postMessage(conn, message);
  expect(accepted).toEqual({ ok: true, messageId: message.messageId });
  session.apply({ type: 'send-accepted', messageId: message.messageId });
  return message;
};

it('per-connection personId: the handshake stores it, resolution falls back to the default, and each agent accepts its own resolved id', async () => {
  const { recordA, recordB } = await addBothConnections();

  // Stored vs null — exactly what migration v3 + the form field produce.
  expect(recordA.personId).toBe(OWNER_A);
  expect(recordB.personId).toBeNull();

  // Resolution: stored ?? OWNER_PERSON_ID (what ActiveConnection.personId is).
  const resolvedA = resolvePersonId(recordA.personId);
  const resolvedB = resolvePersonId(recordB.personId);
  expect(resolvedA).toBe(OWNER_A);
  expect(resolvedB).toBe(OWNER_PERSON_ID);
  expect(resolvedA).not.toBe(resolvedB); // genuinely different owner ids

  // Each agent accepts a send carrying ITS connection's resolved personId —
  // 202 + ack (+ reply) end to end.
  const sessionA = makeSession(makeDurable(createChatStoreBacking(), recordA.id));
  const sessionB = makeSession(makeDurable(createChatStoreBacking(), recordB.id));
  const mA = await sendThrough(sessionA, connFor(agentA), 'hello alpha', resolvedA);
  const mB = await sendThrough(sessionB, connFor(agentB), 'hello beta', resolvedB);

  await pollEventsInto(connFor(agentA), sessionA, (s) => hasReply(s, mA.text), 'reply from A');
  await pollEventsInto(connFor(agentB), sessionB, (s) => hasReply(s, mB.text), 'reply from B');
  expect(sessionA.state.items[0]).toMatchObject({ kind: 'user', sendState: 'accepted' });
  expect(sessionB.state.items[0]).toMatchObject({ kind: 'user', sendState: 'accepted' });

  // The OTHER connection's id against agent A is a contract 403 (mismatch).
  await expect(
    postMessage(
      connFor(agentA),
      buildInboundMessage({ text: 'wrong id', personId: resolvedB }, deps),
    ),
  ).rejects.toMatchObject({ kind: 'http', status: 403 });
}, 25000);

it('wrong personId → 403 (kind http, NOT network) → the failed/retry path; NEVER the offline queue', async () => {
  const { recordA } = await addBothConnections();
  const backing = createChatStoreBacking();
  const durable = makeDurable(backing, recordA.id);
  const session = makeSession(durable);

  const message = buildInboundMessage({ text: 'wrong person', personId: 'owner-wrong' }, deps);
  session.apply({
    type: 'send',
    messageId: message.messageId,
    text: message.text,
    at: message.receivedAt,
  });

  // The exact decision the hook makes: only kind 'network' may enqueue.
  let queued = false;
  try {
    await postMessage(connFor(agentA), message);
    throw new Error('the mock accepted a mismatched personId — contract violation');
  } catch (err) {
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ kind: 'http', status: 403 });
    const unreachable = err instanceof ApiClientError && err.kind === 'network';
    queued =
      unreachable &&
      (await durable.enqueue({
        messageId: message.messageId,
        text: message.text,
        attachments: [],
        queuedAt: message.receivedAt,
      }));
    session.apply(
      queued
        ? { type: 'send-queued', messageId: message.messageId }
        : { type: 'send-failed', messageId: message.messageId },
    );
  }

  expect(queued).toBe(false);
  expect(session.state.items).toMatchObject([{ kind: 'user', sendState: 'failed' }]);
  await durable.flush();
  expect(await new MemoryChatStore(backing).listQueue(recordA.id)).toHaveLength(0);

  // Tap-to-retry with the CORRECTED id re-POSTs the SAME messageId and succeeds.
  const retried = buildInboundMessage(
    {
      text: message.text,
      personId: resolvePersonId(recordA.personId),
      messageId: message.messageId,
    },
    deps,
  );
  await expect(postMessage(connFor(agentA), retried)).resolves.toEqual({
    ok: true,
    messageId: message.messageId,
  });
}, 25000);

it('switch mid-session: transcripts stay isolated per connection across switches (shared database backing)', async () => {
  const { store, recordA, recordB } = await addBothConnections();
  const backing = createChatStoreBacking(); // ONE database file for both

  const activeRecord = async (): Promise<ConnectionRecord> => {
    const active = (await store.list()).find((r) => r.isActive);
    if (active === undefined) throw new Error('no active connection');
    return active;
  };

  // First connection auto-activated (stage-3 semantics).
  expect((await activeRecord()).id).toBe(recordA.id);

  // --- Session on A: one full exchange, write-through persisted.
  const durableA = makeDurable(backing, recordA.id);
  const sessionA = makeSession(durableA);
  const mA = await sendThrough(
    sessionA,
    connFor(agentA),
    'alpha before switch',
    resolvePersonId(recordA.personId),
  );
  await pollEventsInto(connFor(agentA), sessionA, (s) => hasReply(s, mA.text), 'reply on A');
  await durableA.flush();

  // --- Switch to B (existing context call under the switcher). The resolved
  // personId follows the ACTIVE record — this is what the header/switcher key.
  await store.setActive(recordB.id);
  expect((await activeRecord()).id).toBe(recordB.id);
  expect(resolvePersonId((await activeRecord()).personId)).toBe(OWNER_PERSON_ID);

  // B's session hydrates ITS OWN (empty) history — nothing of A leaks in.
  const durableB = makeDurable(backing, recordB.id);
  const hydratedB = await durableB.hydrate();
  if (hydratedB === null) throw new Error('unreachable');
  expect(hydratedB.state.items).toHaveLength(0);

  const sessionB = makeSession(durableB, hydratedB.state);
  const mB = await sendThrough(
    sessionB,
    connFor(agentB),
    'beta after switch',
    resolvePersonId(recordB.personId),
  );
  await pollEventsInto(connFor(agentB), sessionB, (s) => hasReply(s, mB.text), 'reply on B');
  await durableB.flush();
  const textsB = sessionB.state.items.map((i) => i.text);
  expect(textsB).toContain('beta after switch');
  expect(textsB.join('\n')).not.toContain('alpha');

  // --- Switch BACK to A: its transcript hydrates intact and untouched by B.
  await store.setActive(recordA.id);
  expect(resolvePersonId((await activeRecord()).personId)).toBe(OWNER_A);
  const durableA2 = makeDurable(backing, recordA.id);
  const hydratedA = await durableA2.hydrate();
  if (hydratedA === null) throw new Error('unreachable');
  expect(hydratedA.state.items).toEqual(sessionA.state.items);
  expect(hydratedA.state.items.map((i) => i.text).join('\n')).not.toContain('beta');

  // And the resumed A session still sends with A's stored personId.
  const sessionA2 = makeSession(durableA2, hydratedA.state);
  const mA2 = await sendThrough(
    sessionA2,
    connFor(agentA),
    'alpha after switching back',
    resolvePersonId(recordA.personId),
  );
  await pollEventsInto(connFor(agentA), sessionA2, (s) => hasReply(s, mA2.text), 'reply on A #2');
  const kinds = sessionA2.state.items.map((i) => i.kind);
  // A's transcript: both exchanges (user+reply each, acks are not items).
  expect(kinds.filter((k) => k === 'user')).toHaveLength(2);
  expect(sessionA2.state.items.map((i) => i.text)).toEqual(
    expect.arrayContaining([
      'alpha before switch',
      `mock-agent received: alpha before switch`,
      'alpha after switching back',
      `mock-agent received: alpha after switching back`,
    ]),
  );
}, 25000);
