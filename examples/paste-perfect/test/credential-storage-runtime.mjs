// Opt-in OS credential-store smoke test. Run after building @siwc/local:
// node examples/paste-perfect/test/credential-storage-runtime.mjs [--electron /path/to/Electron]
// Uses synthetic credentials only. safeStorage may create an OS encryption key;
// this test never deletes or locks OS keychain entries.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--electron')) {
  throw new Error('Usage: node credential-storage-runtime.mjs [--electron /path/to/Electron]');
}
const require = createRequire(import.meta.url);
const executable = args[1] ?? require('electron');
const root = await mkdtemp(join(tmpdir(), 'siwc-credential-smoke-'));
const appName = `SIWC Storage Smoke ${basename(root)}`;
const results = [];

async function runPhase(phase, worker) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [worker, phase, root, appName], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 15_000);
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('error', (error) => { spawnError = error; });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      try {
        if (spawnError) throw spawnError;
        if (timedOut) throw new Error(`${phase} exceeded 15 seconds. The OS credential store may require approval; no prompt was answered.`);
        const line = stdout.split('\n').find((entry) => entry.startsWith('SIWC_SMOKE_RESULT '));
        const result = line ? JSON.parse(line.slice('SIWC_SMOKE_RESULT '.length)) : undefined;
        if (code !== 0 || !result || result.status !== 'passed') {
          throw new Error(JSON.stringify({ phase, code, signal, result, stderr: stderr.slice(-3000) }));
        }
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  });
}

try {
  await mkdir(join(root, 'electron-user-data'), { mode: 0o700 });
  const worker = join(root, 'credential-storage-runtime-worker.cjs');
  await build({
    entryPoints: [fileURLToPath(new URL('./credential-storage-runtime-worker.mjs', import.meta.url))],
    outfile: worker, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent',
  });
  for (const phase of ['prepare', 'restart-and-failures', 'sign-out', 'restart-after-sign-out']) {
    const result = await runPhase(phase, worker);
    results.push(result);
    await writeFile(join(root, 'receipts.json'), JSON.stringify(results), { mode: 0o600 });
    console.log(JSON.stringify(result));
  }
  console.log(JSON.stringify({ status: 'passed', phases: results.length, syntheticDataOnly: true, temporaryFilesRemovedOnExit: true, testAppName: appName }));
} catch (error) {
  console.error(JSON.stringify({ status: 'blocked-or-failed', completedPhases: results, message: error.message, testAppName: appName }));
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}
