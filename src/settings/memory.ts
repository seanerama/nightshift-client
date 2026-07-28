/** In-memory AppSettingsStore for unit tests and previews. */
import type { AppSettingsStore } from './types';

export class MemoryAppSettingsStore implements AppSettingsStore {
  private readonly rows = new Map<string, string>();

  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [key, value] of Object.entries(initial)) this.rows.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    return this.rows.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.rows.set(key, value);
  }
}
