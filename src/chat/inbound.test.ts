/**
 * InboundMessage construction — validated against the CANONICAL JSON Schema
 * (agent-app-contract schemas/v1/inbound-message.json) with ajv, which is a
 * dependency of agent-app-contract (test-only use here, per the stage spec).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

import { buildInboundMessage } from './inbound';
import { OWNER_PERSON_ID } from './person-id';

// ajv-formats is CJS with both `module.exports = plugin` and `exports.default`;
// normalize to the callable (same dance the contract's own mock server does).
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as (ajv: unknown) => void;

const schema = JSON.parse(
  readFileSync(require.resolve('agent-app-contract/schemas/v1/inbound-message.json'), 'utf8'),
) as Record<string, unknown>;

const ajv = new Ajv2020({ strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

const deps = { newUuid: () => randomUUID(), now: () => new Date('2026-07-27T12:00:00.000Z') };

it('builds a message that validates against the canonical schema', () => {
  const message = buildInboundMessage({ text: 'ping', personId: OWNER_PERSON_ID }, deps);

  expect(validate(message)).toBe(true);
  expect(message).toMatchObject({
    schema: 1,
    personId: OWNER_PERSON_ID,
    text: 'ping',
    attachments: [],
    receivedAt: '2026-07-27T12:00:00.000Z',
  });
});

it('uses the injected UUID source for the dedup key', () => {
  const message = buildInboundMessage(
    { text: 'x', personId: OWNER_PERSON_ID },
    { ...deps, newUuid: () => '9f2c1e64-8b3a-4d21-9f7e-2c5a1b0d6e83' },
  );
  expect(message.messageId).toBe('9f2c1e64-8b3a-4d21-9f7e-2c5a1b0d6e83');
  expect(validate(message)).toBe(true);
});

it('generates a fresh UUID per message, but reuses an explicit one (retry path)', () => {
  const a = buildInboundMessage({ text: 'x', personId: OWNER_PERSON_ID }, deps);
  const b = buildInboundMessage({ text: 'x', personId: OWNER_PERSON_ID }, deps);
  expect(a.messageId).not.toBe(b.messageId);

  const retry = buildInboundMessage(
    { text: 'x', personId: OWNER_PERSON_ID, messageId: a.messageId },
    deps,
  );
  expect(retry.messageId).toBe(a.messageId);
  expect(validate(retry)).toBe(true);
});

it('an empty text with no attachments still validates (schema allows it)', () => {
  const message = buildInboundMessage({ text: '', personId: OWNER_PERSON_ID }, deps);
  expect(validate(message)).toBe(true);
});

it('a non-UUID messageId FAILS the canonical schema (guards the format assertion)', () => {
  const message = buildInboundMessage(
    { text: 'x', personId: OWNER_PERSON_ID, messageId: 'not-a-uuid' },
    deps,
  );
  expect(validate(message)).toBe(false);
});
