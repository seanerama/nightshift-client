/**
 * InboundMessage construction (contracts/app-ingress.md, POST /app/v1/messages).
 *
 * Pure builder: UUID + clock are injected. Production wiring passes
 * expo-crypto's randomUUID (see use-chat-session.ts); unit tests pass Node's.
 * The unit suite validates the output against the canonical JSON Schema
 * (schemas/v1/inbound-message.json) with ajv, so shape drift fails a test,
 * not a device smoke.
 */

import type { InboundMessage } from 'agent-app-contract/types';

export interface BuildInboundMessageInput {
  text: string;
  /** Out-of-band owner id — see person-id.ts for the stage-4 decision. */
  personId: string;
  /** Retry-with-same-dedup-key path: reuse the ORIGINAL messageId. */
  messageId?: string;
  /** Upload ids. Stage 4 sends none; the parameter exists for the files stage. */
  attachments?: readonly string[];
}

export interface BuildInboundMessageDeps {
  /** UUID v4 source. Production: expo-crypto randomUUID. */
  newUuid: () => string;
  /** Clock, for receivedAt. Defaults to the real one. */
  now?: () => Date;
}

export const buildInboundMessage = (
  input: BuildInboundMessageInput,
  deps: BuildInboundMessageDeps,
): InboundMessage => ({
  schema: 1,
  // Client-generated dedup key: re-POSTing the same id is a no-op by contract
  // invariant 5, which is what makes at-least-once send (and tap-to-retry
  // with the SAME id) safe.
  messageId: input.messageId ?? deps.newUuid(),
  personId: input.personId,
  text: input.text,
  attachments: [...(input.attachments ?? [])],
  receivedAt: (deps.now?.() ?? new Date()).toISOString(),
});
