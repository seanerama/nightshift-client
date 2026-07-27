/**
 * Integration: boot the mock agent shipped by agent-app-contract@v1.0.0 and
 * exercise the API client against it over real HTTP (node runtime).
 *
 * The mock-agent CLI: --token <t> is required, --port 0 picks a free port and
 * the ready line printed on stdout reports it. Per the CLI's own guidance we
 * still poll GET /app/v1/health for readiness rather than trusting the line.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

import { ApiClientError, getHealth, getManifest } from '../../src/api/client';

const TOKEN = 'integration-test-token';
const CLI = path.resolve(
  __dirname,
  '../../node_modules/agent-app-contract/packages/mock-agent/dist/cli.js',
);

let child: ChildProcess;
let baseUrl: string;

const connection = () => ({ baseUrl, token: TOKEN });

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

const pollHealthUntilReady = async (): Promise<void> => {
  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      await getHealth(connection());
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
};

beforeAll(async () => {
  child = spawn(process.execPath, [CLI, '--token', TOKEN, '--port', '0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const port = await waitForReadyLine(child);
  baseUrl = `http://127.0.0.1:${port}`;
  await pollHealthUntilReady();
});

afterAll(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
});

it('manifest round-trip: contract is app-ingress v1', async () => {
  const manifest = await getManifest(connection());

  expect(manifest.contract).toEqual({ name: 'app-ingress', version: 1 });
  expect(manifest.schema).toBe(1);
  expect(manifest.agent.name).toBeTruthy();
  expect(manifest.capabilities).toContain('chat');
});

it('health round-trip: authenticated health returns ok', async () => {
  const health = await getHealth(connection());

  expect(health.ok).toBe(true);
  expect(typeof health.version).toBe('string');
  expect(health.uptimeSec).toBeGreaterThanOrEqual(0);
});

it('fails closed against the real server when the token is wrong', async () => {
  const bad = getHealth({ baseUrl, token: 'wrong-token' });

  await expect(bad).rejects.toBeInstanceOf(ApiClientError);
  await expect(bad).rejects.toMatchObject({ kind: 'http', status: 401 });
});
