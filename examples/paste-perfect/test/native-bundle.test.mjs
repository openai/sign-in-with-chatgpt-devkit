import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { getCurrentFuseWire, FuseV1Options, FuseState } from '@electron/fuses';
import test from 'node:test';

const enabled = process.platform === 'darwin' && process.env.PASTE_PERFECT_BUNDLE_TESTS === '1';
const app = fileURLToPath(new URL('../native/build/PastePerfectNative.app', import.meta.url));
const relativeExecutable = 'Contents/MacOS/PastePerfectNative';
const relativeDesktop = 'Contents/Frameworks/Paste Perfect Desktop.app';

test('sealed native app package', { skip: !enabled, timeout: 120_000 }, async (suite) => {
  const directory = await mkdtemp('/private/tmp/paste-perfect-bundle-test-');
  suite.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const copy = join(directory, 'PastePerfectNative.app');
  await cp(app, copy, { recursive: true, verbatimSymlinks: true });
  const executable = join(copy, relativeExecutable);
  const desktop = join(copy, relativeDesktop);
  const verify = () => spawnSync(executable, ['--verify-bundle'], {
    input: '{"type":"arm","timeoutMs":8000}\n', encoding: 'utf8', timeout: 20_000,
  });

  await suite.test('resource seal and native code identity validate; launcher stdin is not an IPC response channel', () => {
    const result = verify();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  });
  await suite.test('Electron cannot enable alternate scripts, Node options, or the inspector', async () => {
    const wire = await getCurrentFuseWire(desktop);
    for (const option of [FuseV1Options.RunAsNode, FuseV1Options.EnableNodeOptionsEnvironmentVariable,
      FuseV1Options.EnableNodeCliInspectArguments, FuseV1Options.GrantFileProtocolExtraPrivileges]) {
      assert.equal(wire[option], FuseState.DISABLE);
    }
    for (const option of [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseV1Options.OnlyLoadAppFromAsar]) {
      assert.equal(wire[option], FuseState.ENABLE);
    }
  });
  for (const relative of [
    `${relativeDesktop}/Contents/Resources/app.asar`,
    `${relativeDesktop}/Contents/Info.plist`,
    `${relativeDesktop}/Contents/MacOS/Electron`,
  ]) {
    await suite.test(`tampered ${relative.split('/').at(-1)} fails before app startup`, async () => {
      const path = join(copy, relative);
      const original = await readFile(path);
      try {
        await writeFile(path, Buffer.concat([original, Buffer.from('tampered')]));
        assert.notEqual(verify().status, 0);
      } finally { await writeFile(path, original); }
    });
  }
  await suite.test('normal startup uses the fixed child and terminates it when the native parent exits', async () => {
    // macOS may retain invalidated vnode signature state after a Mach-O was
    // modified, even when the original bytes are restored. Use fresh inodes.
    await rm(copy, { recursive: true, force: true });
    await cp(app, copy, { recursive: true, verbatimSymlinks: true });
    const state = await mkdtemp(join(directory, 'synthetic-state-'));
    const child = spawn(executable, ['--inspect=9229', '/untrusted-launcher.js'], {
      env: { ...process.env, PASTE_PERFECT_DATA_DIR: state, NODE_OPTIONS: '--require=/untrusted-launcher.js',
        ELECTRON_RUN_AS_NODE: '1', DYLD_INSERT_LIBRARIES: '/untrusted-launcher.dylib' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let diagnostics = '';
    child.stderr.on('data', (data) => { diagnostics += data; });
    child.stdout.resume();
    child.stdin.on('error', () => {});
    // These bytes go to the native launcher's ignored stdin. They never enter
    // the command pipe that it creates for its own child.
    child.stdin.write('{"type":"quit"}\n{"type":"arm"}\n');
    let desktopPid;
    try {
      for (let attempt = 0; attempt < 300 && !diagnostics.includes('Paste Perfect desktop ready.'); attempt++) {
        assert.equal(child.exitCode, null, diagnostics);
        assert.equal(child.signalCode, null, diagnostics);
        await delay(100);
      }
      assert.equal(child.exitCode, null, diagnostics);
      assert.equal(child.signalCode, null, diagnostics);
      assert.ok(diagnostics.includes('Paste Perfect desktop ready.'), `Dashboard, preload and tray must finish startup: ${diagnostics}`);
      const childPids = execFileSync('/usr/bin/pgrep', ['-P', String(child.pid)], { encoding: 'utf8' }).trim().split('\n');
      desktopPid = Number(childPids[0]);
      assert.ok(desktopPid > 0);
      const command = execFileSync('/bin/ps', ['-p', String(desktopPid), '-o', 'comm='], { encoding: 'utf8' }).trim();
      assert.equal(await realpath(command), await realpath(join(desktop, 'Contents/MacOS/Electron')));
      child.kill('SIGTERM');
      for (let attempt = 0; attempt < 50 && child.exitCode === null && child.signalCode === null; attempt++) await delay(100);
      assert.ok(child.exitCode !== null || child.signalCode !== null, 'Native app must exit after SIGTERM');
      for (let attempt = 0; attempt < 50; attempt++) {
        try { process.kill(desktopPid, 0); } catch { desktopPid = undefined; break; }
        await delay(100);
      }
      assert.equal(desktopPid, undefined, 'Electron child must not outlive its native command channel');
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        for (let attempt = 0; attempt < 50 && child.exitCode === null && child.signalCode === null; attempt++) await delay(100);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
      if (desktopPid) {
        try { process.kill(desktopPid, 'SIGTERM'); } catch { /* Already exited. */ }
        for (let attempt = 0; attempt < 50; attempt++) {
          try { process.kill(desktopPid, 0); } catch { break; }
          await delay(100);
        }
      }
    }
  });
});
