/**
 * The DEFAULT `personId` for InboundMessages — used only when a connection
 * has no stored per-connection person id (stage 10, migration v3).
 *
 * Contract semantics (canonical spec, invariant 4 + "explicitly unspecified"
 * item 6): personId is VESTIGIAL BUT REQUIRED. It is NOT identity — the bearer
 * token is identity. The agent checks it equals its configured owner id and
 * rejects mismatches with 403, and the contract deliberately defines NO route
 * that reveals the owner id: it is configured out of band, exactly like the
 * token (but it is NOT a secret — it lives in a plain sqlite column).
 *
 * Stage 4 pinned this app-wide to the canonical example's owner id
 * (`owner-nightshift`, examples/inbound-message.json). Stage 10 made it
 * per-connection: the connection form's optional "Owner person id" field is
 * stored on the record, and `resolvePersonId` falls back to this constant so
 * existing connections keep working unchanged. NO send site may use the
 * constant directly — every send path takes the ACTIVE connection's resolved
 * personId (ActiveConnection.personId).
 */

export const OWNER_PERSON_ID = 'owner-nightshift';

/** Resolve a connection's stored person id: stored value ?? the app default.
 * Blank/whitespace input is normalized to null at persist time (handshake),
 * but resolve defensively anyway so a stray empty string cannot produce an
 * empty personId on the wire. */
export const resolvePersonId = (stored: string | null | undefined): string => {
  const trimmed = stored?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : OWNER_PERSON_ID;
};
