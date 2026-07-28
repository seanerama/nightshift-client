/**
 * Mandatory fallback triggers (contracts/ui-bridge.md + ADR 0004): on load
 * failure, bridge violation storm, render crash, or resources/read failure
 * the shell replaces the WebView with a plain markdown rendering (an error
 * card / the underlying tool result). A broken resource never takes the app
 * down. Pure decision logic; the screen consumes it.
 */

export type FallbackReason =
  /** resources/read rejected or returned no usable text/html. */
  | 'read-failed'
  /** WebView load error (onError). */
  | 'load-error'
  /** WebView content/render process died (onRenderProcessGone /
   * onContentProcessDidTerminate). */
  | 'render-crash'
  /** Bridge violation storm: the resource keeps sending malformed or
   * non-allowlisted frames — treat it as hostile/broken. */
  | 'violation-storm';

/** One-off violations are answered and tolerated (a buggy resource retrying
 * is normal); a storm is not. Threshold counts malformed + violations. */
export const VIOLATION_STORM_THRESHOLD = 10;

export const isViolationStorm = (counts: { malformed: number; violations: number }): boolean =>
  counts.malformed + counts.violations >= VIOLATION_STORM_THRESHOLD;

/** Human-readable card title per reason (rendered by the fallback card). */
export const fallbackTitle = (reason: FallbackReason): string => {
  switch (reason) {
    case 'read-failed':
      return 'Could not load this app';
    case 'load-error':
      return 'This app failed to load';
    case 'render-crash':
      return 'This app crashed';
    case 'violation-storm':
      return 'This app was stopped';
  }
};

/** Resource-view state machine — pure, so the screen reducer is testable. */
export type ResourceViewState =
  | { phase: 'loading' }
  | { phase: 'rendering'; html: string; ready: boolean }
  | { phase: 'fallback'; reason: FallbackReason; detail: string };

export type ResourceViewEvent =
  | { type: 'html'; html: string }
  | { type: 'ready' }
  | { type: 'read-failed'; detail: string }
  | { type: 'load-error'; detail: string }
  | { type: 'render-crash'; detail: string }
  | { type: 'counts'; malformed: number; violations: number };

export const reduceResourceView = (
  state: ResourceViewState,
  event: ResourceViewEvent,
): ResourceViewState => {
  // Fallback is terminal for the view: nothing upgrades a broken resource
  // back to a WebView except reopening it from scratch.
  if (state.phase === 'fallback') return state;

  switch (event.type) {
    case 'html':
      return { phase: 'rendering', html: event.html, ready: false };
    case 'ready':
      return state.phase === 'rendering' ? { ...state, ready: true } : state;
    case 'read-failed':
      return { phase: 'fallback', reason: 'read-failed', detail: event.detail };
    case 'load-error':
      return { phase: 'fallback', reason: 'load-error', detail: event.detail };
    case 'render-crash':
      return { phase: 'fallback', reason: 'render-crash', detail: event.detail };
    case 'counts':
      return isViolationStorm(event)
        ? {
            phase: 'fallback',
            reason: 'violation-storm',
            detail: `The app sent ${event.malformed} malformed and ${event.violations} disallowed bridge frames and was disabled.`,
          }
        : state;
  }
};
