/**
 * Pure list model for the quick-switcher sheet (stage 10): what each row
 * shows and which row carries the active check. The QuickSwitcher component
 * is a thin renderer over this — the model unit-tests in the node
 * environment.
 */

import type { ConnectionRecord } from '../connections/types';

export interface SwitcherRow {
  id: string;
  /** Agent name from the manifest snapshot. */
  name: string;
  baseUrl: string;
  /** Exactly one row is active (or none). */
  isActive: boolean;
}

/** Rows in the store's stable order (createdAt, id — same as the
 * Connections tab), each reduced to what the sheet renders. */
export const buildSwitcherRows = (connections: readonly ConnectionRecord[]): SwitcherRow[] =>
  connections.map((record) => ({
    id: record.id,
    name: record.agentName,
    baseUrl: record.baseUrl,
    isActive: record.isActive,
  }));

/** Tap semantics: switching to the already-active row is a no-op switch (the
 * sheet still closes); any other row dispatches setActive. Returns whether a
 * switch dispatch is needed — keeps the component branch-free and testable. */
export const shouldDispatchSwitch = (row: SwitcherRow): boolean => !row.isActive;
