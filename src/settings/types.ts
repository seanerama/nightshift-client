/**
 * App-level settings seam (stage 12). "App-level" means NOT per-connection:
 * these belong to the phone, not to an agent.
 *
 * A tiny key/value interface on purpose — the native implementation is the one
 * thing unit tests cannot load, so everything above it talks to this.
 */
export interface AppSettingsStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}
