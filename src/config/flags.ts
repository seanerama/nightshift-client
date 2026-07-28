/**
 * App-config-driven feature flags (stage-5 kill-switch requirement) — pure
 * resolution logic. The module that reads the actual app config lives in
 * ./apps-tab.ts (it imports expo-constants, which the pure-TS unit test
 * environment cannot load; the decision logic is fully tested here instead).
 *
 * APPS_TAB_ENABLED — dark-launch switch for the net-new Apps surface:
 * - Source of truth: `expo.extra.appsTabEnabled` in app.json (a boolean).
 *   Flipping it to `false` and rebuilding removes the Apps tab entirely
 *   (expo-router `href: null`), independent of what any agent advertises.
 * - When the key is ABSENT the flag defaults per the stage spec: ON in dev
 *   builds, OFF otherwise (dark-launch default-off for release builds).
 * - The tab ADDITIONALLY self-gates on the agent's `mcp-apps-ui` capability
 *   (src/app/apps.tsx) — the flag never widens what an agent offers.
 *
 * Documented for operators in docs/ui-smoke/stage-5-apps.md.
 */

/** Pure resolver: explicit boolean wins; absent → dev default. */
export const resolveAppsTabEnabled = (extraValue: unknown, isDev: boolean): boolean => {
  if (extraValue === true) return true;
  if (extraValue === false) return false;
  // Any non-boolean value is treated as absent — fail toward the default,
  // never toward accidentally enabling in release.
  return isDev;
};

/**
 * TRANSCRIPT_PERSISTENCE_ENABLED — stage-9 kill-switch for durable history,
 * outbox catch-up, and the offline compose queue.
 *
 * Recorded planner DEVIATION from the default-OFF template: default is ON.
 * The installed cohort is the single owner and config flips require a new APK
 * anyway (sideload), so OFF-by-default would ship the release inert — this
 * flag exists to KILL persistence in one config release if it misbehaves, not
 * to dark-launch it. OFF restores stage-4 in-memory behavior exactly (no
 * store reads or writes); migration v2 is NOT gated (additive schema is safe
 * standing alone).
 */
export const resolveTranscriptPersistenceEnabled = (extraValue: unknown): boolean => {
  // Only an explicit `false` kills the feature; absent or junk values fail
  // toward the default — which for THIS flag is ON (deviation above).
  return extraValue !== false;
};
