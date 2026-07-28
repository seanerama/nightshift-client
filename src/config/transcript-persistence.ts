/**
 * TRANSCRIPT_PERSISTENCE_ENABLED, resolved once at module load from app config
 * (`expo.extra.transcriptPersistenceEnabled` in app.json). Semantics, the
 * recorded default-ON deviation, and rationale live with the tested resolver
 * in ./flags.ts; this thin module exists only because expo-constants cannot
 * load in the pure-TS unit environment (same pattern as ./apps-tab.ts).
 */

import Constants from 'expo-constants';

import { resolveTranscriptPersistenceEnabled } from './flags';

/** The stage-9 kill-switch (see docs/ui-smoke/stage-9-durability.md). */
export const TRANSCRIPT_PERSISTENCE_ENABLED: boolean = resolveTranscriptPersistenceEnabled(
  Constants.expoConfig?.extra?.transcriptPersistenceEnabled,
);
