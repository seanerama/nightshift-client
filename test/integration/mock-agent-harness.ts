/**
 * Shared harness: boot the mock agent shipped by agent-app-contract@v1.0.0 on
 * a free port and wait until it serves authenticated health.
 *
 * The mock-agent CLI: --token <t> is required, --port 0 picks a free port and
 * the ready line printed on stdout reports it. Per the CLI's own guidance we
 * still poll GET /app/v1/health for readiness rather than trusting the line.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

import { getHealth } from '../../src/api/client';

const CLI = path.resolve(
  __dirname,
  '../../node_modules/agent-app-contract/packages/mock-agent/dist/cli.js',
);

export interface MockAgent {
  baseUrl: string;
  token: string;
  stop(): Promise<void>;
}

export interface MockAgentOptions {
  /** Owner id every inbound personId is checked against (contract invariant 4).
   * Defaults to the CLI's own default ('owner-mock') when omitted. */
  ownerId?: string;
  /** Extra capabilities to declare; 'chat' is always declared. */
  capabilities?: readonly string[];
}

const waitForReadyLine = (proc: ChildProcess): Promise<number> =>
  new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      reject(new Error(`mock-agent did not print a ready line. stdout: ${stdout}`));
    }, 15000);
    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      const match = stdout.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`mock-agent exited early (code ${code}). stderr: ${stderr}`));
    });
  });

const pollHealthUntilReady = async (baseUrl: string, token: string): Promise<void> => {
  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      await getHealth({ baseUrl, token });
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
};

export const startMockAgent = async (
  token: string,
  options: MockAgentOptions = {},
): Promise<MockAgent> => {
  const args = [CLI, '--token', token, '--port', '0'];
  if (options.ownerId !== undefined) args.push('--owner-id', options.ownerId);
  if (options.capabilities !== undefined && options.capabilities.length > 0) {
    args.push('--capabilities', options.capabilities.join(','));
  }
  const child = spawn(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const port = await waitForReadyLine(child);
  const baseUrl = `http://127.0.0.1:${port}`;
  await pollHealthUntilReady(baseUrl, token);
  return {
    baseUrl,
    token,
    stop: async () => {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        // The mock's graceful shutdown waits for open connections (e.g. an
        // SSE stream a failing test never closed). Escalate rather than hang.
        const killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
        await once(child, 'exit');
        clearTimeout(killTimer);
      }
    },
  };
};
