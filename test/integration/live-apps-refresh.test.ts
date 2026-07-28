/**
 * Stage-11 integration: the live refresh path against the REAL mock agent
 * shipped by agent-app-contract@v1.0.0 (real HTTP, real MCP).
 *
 * SCOPE LIMIT, recorded honestly: the canonical mock agent cannot change its
 * resource list at runtime, so a genuine mid-session publish is NOT covered
 * here. That case lands with the upstream `--mutate-resources` hook —
 * seanerama/agent-app-contract#14. What IS covered, and is the closest real
 * approximation available today:
 *
 * - the refresh path really talks to an agent (initialize → resources/list);
 * - debounce really collapses a burst into ONE round-trip;
 * - restarting the agent with DIFFERENT `--capabilities` mid-session changes
 *   what resources/list answers, and the app reconciles WITHOUT reconnecting —
 *   the reducer state is never rebuilt across the whole scenario;
 * - an agent that degrades (restarted without `mcp-apps-ui`) makes the refresh
 *   fail, and the last known list SURVIVES.
 */

import { createRefreshController, REFRESH_DEBOUNCE_MS } from '../../src/apps/refresh-controller';
import {
  INITIAL_RESOURCE_LIST_STATE,
  type ResourceListState,
  reduceResourceList,
} from '../../src/apps/resource-list';
import { initialize, listResources, type McpConnection } from '../../src/mcp/client';
import { type MockAgent, startMockAgent } from './mock-agent-harness';

const TOKEN = 'integration-test-token';
const WITH_UI = ['chat', 'mcp-tools', 'mcp-apps-ui'];
const WITHOUT_UI = ['chat', 'mcp-tools'];
/** The one resource the mock publishes (mock-agent source, UI_RESOURCE). */
const MOCK_UI_RESOURCE = 'ui://mock-agent/home@v1';

let agent: MockAgent;
let fetchCount = 0;

/**
 * The app-side state, built ONCE and never rebuilt — restarting the agent
 * below must not require reconnecting or remounting anything here. That is
 * what "without reconnect" means concretely.
 */
let state: ResourceListState = INITIAL_RESOURCE_LIST_STATE;
let settled: (() => void) | null = null;

const connection = (): McpConnection => ({
  baseUrl: agent.baseUrl,
  getToken: async () => TOKEN,
});

const controller = createRefreshController({
  fetchList: async () => {
    fetchCount += 1;
    const target = connection();
    await initialize(target);
    return listResources(target);
  },
  onStarted: () => {
    state = reduceResourceList(state, { type: 'refresh-started' });
  },
  onSucceeded: (resources) => {
    state = reduceResourceList(state, { type: 'refresh-succeeded', resources });
    settled?.();
  },
  onFailed: (detail) => {
    state = reduceResourceList(state, { type: 'refresh-failed', detail });
    settled?.();
  },
});

/** Resolve once the next refresh has fully settled into the reducer. */
const nextSettle = (): Promise<void> =>
  new Promise((resolve) => {
    settled = () => {
      settled = null;
      resolve();
    };
  });

const readyState = (): Extract<ResourceListState, { status: 'ready' }> => {
  if (state.status !== 'ready') throw new Error(`expected a ready list, got ${state.status}`);
  return state;
};

const restartAgent = async (capabilities: string[]): Promise<void> => {
  await agent.stop();
  agent = await startMockAgent(TOKEN, { capabilities });
};

beforeAll(async () => {
  agent = await startMockAgent(TOKEN, { capabilities: WITH_UI });
});

afterAll(async () => {
  controller.dispose();
  await agent?.stop();
});

describe('live apps refresh against the real mock agent', () => {
  it('1. the refresh path populates the list from a real agent', async () => {
    const done = nextSettle();
    controller.request({ immediate: true });
    await done;

    const ready = readyState();
    expect(ready.resources.map((r) => r.uri)).toContain(MOCK_UI_RESOURCE);
    expect(ready.staleError).toBeNull();
    expect(fetchCount).toBe(1);
  });

  it('2. a burst of triggers collapses into ONE round-trip to the agent', async () => {
    const before = fetchCount;
    const done = nextSettle();
    // Gesture + focus + poll all firing at once is entirely realistic.
    for (let i = 0; i < 8; i += 1) controller.request();
    await done;

    expect(fetchCount).toBe(before + 1);
    expect(readyState().resources.map((r) => r.uri)).toContain(MOCK_UI_RESOURCE);
  });

  it('3. a no-op refresh reconciles to the SAME array reference', async () => {
    const before = readyState().resources;
    const done = nextSettle();
    controller.request({ immediate: true });
    await done;

    // A fresh process, a fresh HTTP response, fresh descriptor objects — and
    // still no downstream churn, because nothing actually changed.
    expect(readyState().resources).toBe(before);
  });

  it('4. the agent restarting DEGRADED leaves the last known list intact', async () => {
    const known = readyState().resources;
    await restartAgent(WITHOUT_UI);

    const done = nextSettle();
    controller.request({ immediate: true });
    await done;

    const ready = readyState(); // still ready — never blanked
    expect(ready.resources).toBe(known); // byte-for-byte the same list
    expect(ready.staleError).not.toBeNull();
    expect(ready.refreshing).toBe(false);
  });

  it('5. the agent restarting healthy reconciles and clears the stale flag — no reconnect', async () => {
    await restartAgent(WITH_UI);

    const done = nextSettle();
    controller.request({ immediate: true });
    await done;

    const ready = readyState();
    expect(ready.resources.map((r) => r.uri)).toContain(MOCK_UI_RESOURCE);
    expect(ready.staleError).toBeNull();
  });

  it('6. debounce is real time, not a no-op', async () => {
    const before = fetchCount;
    controller.request();
    await new Promise((resolve) => setTimeout(resolve, REFRESH_DEBOUNCE_MS / 2));
    expect(fetchCount).toBe(before);

    const done = nextSettle();
    await done;
    expect(fetchCount).toBe(before + 1);
  });
});
