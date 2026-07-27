/**
 * Connections provider: the app-wide seam stages 4 and 5 consume.
 *
 * Exposes the connection list, an `activeConnection` (id, baseUrl,
 * capabilities, uiHome, and a token *accessor* — the token itself is never
 * held in React state), CRUD via the handshake module, and the health state
 * of the active connection (foreground-only polling, ~30s + on-focus refresh).
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';

import { getHealth } from '../api/client';
import { addOrUpdateConnection, deleteConnection } from './handshake';
import {
  HEALTH_POLL_INTERVAL_MS,
  type HealthEvent,
  type HealthState,
  reduceHealth,
  shouldPoll,
} from './health';
import { secureTokenVault } from './secure-token-vault';
import { getSqliteConnectionStore } from './sqlite-store';
import type { ConnectionRecord, ConnectionStore, TokenVault } from './types';

/** The active connection as consumed by downstream features (stages 4-5). */
export interface ActiveConnection {
  id: string;
  baseUrl: string;
  agentName: string;
  agentVersion: string;
  capabilities: readonly string[];
  uiHome: string | null;
  /** Token accessor — reads from the vault on demand; never cached in state. */
  getToken: () => Promise<string | null>;
}

export interface ConnectionsContextValue {
  /** True until the initial load from sqlite completes. */
  loading: boolean;
  connections: ConnectionRecord[];
  active: ActiveConnection | null;
  /** Health of the active connection (unknown when there is none). */
  health: HealthState;
  /** Add (no id) or edit (with id): handshake first, persist only on success. */
  saveConnection: (input: { id?: string; baseUrl: string; token: string }) => Promise<void>;
  /** Removes the sqlite row AND the vault token. */
  removeConnection: (id: string) => Promise<void>;
  setActive: (id: string) => Promise<void>;
}

const ConnectionsContext = createContext<ConnectionsContextValue | null>(null);

export interface ConnectionsProviderProps {
  children: ReactNode;
  /** Injectable for tests / previews; default to the native-backed stores. */
  store?: () => Promise<ConnectionStore>;
  vault?: TokenVault;
}

export function ConnectionsProvider({
  children,
  store: storeFactory = getSqliteConnectionStore,
  vault = secureTokenVault,
}: ConnectionsProviderProps) {
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [health, setHealth] = useState<HealthState>('unknown');
  const storeRef = useRef<Promise<ConnectionStore> | null>(null);

  const getStore = useCallback((): Promise<ConnectionStore> => {
    if (storeRef.current === null) storeRef.current = storeFactory();
    return storeRef.current;
  }, [storeFactory]);

  const refresh = useCallback(async () => {
    const store = await getStore();
    setConnections(await store.list());
  }, [getStore]);

  useEffect(() => {
    refresh()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refresh]);

  const activeRecord = useMemo(() => connections.find((c) => c.isActive) ?? null, [connections]);

  const active = useMemo<ActiveConnection | null>(() => {
    if (activeRecord === null) return null;
    const id = activeRecord.id;
    return {
      id,
      baseUrl: activeRecord.baseUrl,
      agentName: activeRecord.agentName,
      agentVersion: activeRecord.agentVersion,
      capabilities: activeRecord.capabilities,
      uiHome: activeRecord.uiHome,
      getToken: () => vault.getToken(id),
    };
  }, [activeRecord, vault]);

  // Foreground-only health polling for the active connection.
  const activeId = activeRecord?.id ?? null;
  const activeBaseUrl = activeRecord?.baseUrl ?? null;
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const dispatch = (event: HealthEvent) => {
      if (!cancelled) setHealth((prev) => reduceHealth(prev, event));
    };

    dispatch({ type: 'reset' });
    if (activeId === null || activeBaseUrl === null) return;

    const poll = async () => {
      try {
        const token = await vault.getToken(activeId);
        if (token === null) throw new Error('token missing from vault');
        const result = await getHealth({ baseUrl: activeBaseUrl, token });
        dispatch({ type: 'result', ok: result.ok });
      } catch {
        dispatch({ type: 'error' });
      }
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      if (timer === null) {
        void poll(); // on-focus / on-switch immediate refresh
        timer = setInterval(() => void poll(), HEALTH_POLL_INTERVAL_MS);
      }
    };

    const apply = (appState: string) => {
      if (shouldPoll(appState, true)) start();
      else stop();
    };
    apply(AppState.currentState);
    const subscription = AppState.addEventListener('change', apply);

    return () => {
      cancelled = true;
      stop();
      subscription.remove();
    };
  }, [activeId, activeBaseUrl, vault]);

  const saveConnection = useCallback(
    async (input: { id?: string; baseUrl: string; token: string }) => {
      const store = await getStore();
      await addOrUpdateConnection(input, { store, vault });
      await refresh();
    },
    [getStore, vault, refresh],
  );

  const removeConnection = useCallback(
    async (id: string) => {
      const store = await getStore();
      await deleteConnection(id, { store, vault });
      await refresh();
    },
    [getStore, vault, refresh],
  );

  const setActive = useCallback(
    async (id: string) => {
      const store = await getStore();
      await store.setActive(id);
      await refresh();
    },
    [getStore, refresh],
  );

  const value = useMemo<ConnectionsContextValue>(
    () => ({ loading, connections, active, health, saveConnection, removeConnection, setActive }),
    [loading, connections, active, health, saveConnection, removeConnection, setActive],
  );

  return <ConnectionsContext.Provider value={value}>{children}</ConnectionsContext.Provider>;
}

export const useConnections = (): ConnectionsContextValue => {
  const value = useContext(ConnectionsContext);
  if (value === null) {
    throw new Error('useConnections must be used inside a ConnectionsProvider');
  }
  return value;
};

/** Convenience selector for downstream features. */
export const useActiveConnection = (): ActiveConnection | null => useConnections().active;
