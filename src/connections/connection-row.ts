/**
 * Pure row ↔ record mapping for the sqlite connections table (stage 10 pulled
 * this out of sqlite-store.ts so the mapping — including the nullable
 * person_id column added by migration v3 — unit-tests in jest's node
 * environment; sqlite-store.ts itself imports expo-sqlite and cannot load
 * there). No token column exists in either shape, by design.
 */

import type { ConnectionRecord } from './types';

/** Raw shape of a `connections` row as sqlite returns it (post-v3 schema). */
export interface ConnectionRow {
  id: string;
  base_url: string;
  agent_name: string;
  agent_version: string;
  capabilities: string;
  ui_home: string | null;
  is_active: number;
  created_at: string;
  /** NULL = "use the app default" (see migration v3). */
  person_id: string | null;
}

export const rowToRecord = (row: ConnectionRow): ConnectionRecord => ({
  id: row.id,
  baseUrl: row.base_url,
  agentName: row.agent_name,
  agentVersion: row.agent_version,
  capabilities: JSON.parse(row.capabilities) as string[],
  uiHome: row.ui_home,
  isActive: row.is_active === 1,
  createdAt: row.created_at,
  personId: row.person_id,
});
