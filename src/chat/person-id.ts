/**
 * The `personId` this app sends on every InboundMessage.
 *
 * Contract semantics (canonical spec, invariant 4 + "explicitly unspecified"
 * item 6): personId is VESTIGIAL BUT REQUIRED. It is NOT identity — the bearer
 * token is identity. The agent checks it equals its configured owner id and
 * rejects mismatches with 403, and the contract deliberately defines NO route
 * that reveals the owner id: it is configured out of band, exactly like the
 * token.
 *
 * Stage 4 pins it to the canonical example's owner id (`owner-nightshift`,
 * examples/inbound-message.json). Operators must configure their agent's owner
 * id to match (mock: `npx mock-agent --owner-id owner-nightshift`). Making it
 * per-connection user input belongs to a later connections change, not the
 * chat round-trip stage; this module is the single place that decision lands.
 */

export const OWNER_PERSON_ID = 'owner-nightshift';
