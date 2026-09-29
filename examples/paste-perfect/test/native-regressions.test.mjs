import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('compiled macOS native helper regressions', { skip: process.platform !== 'darwin' }, async (suite) => {
  const directory = await mkdtemp(join(tmpdir(), 'paste-perfect-native-test-'));
  suite.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'NativeRegression.swift');
  const executable = join(directory, 'NativeRegression');
  const [production, harness] = await Promise.all([
    readFile(new URL('../native/PastePerfectNative.swift', import.meta.url), 'utf8'),
    readFile(new URL('./native-regressions.swift', import.meta.url), 'utf8'),
  ]);
  await writeFile(source, `${production}\n${harness}`);
  execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-D', 'PASTE_PERFECT_NATIVE_TESTS',
    '-module-cache-path', join(directory, 'ModuleCache'),
    '-framework', 'AppKit', '-framework', 'ApplicationServices', '-framework', 'CoreGraphics',
    source, '-o', executable], { timeout: 60_000, maxBuffer: 256_000 });

  function events(name) {
    return execFileSync(executable, [name], { encoding: 'utf8', timeout: 10_000 })
      .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  }

  for (const name of ['launcher-environment', 'valid-data-directory', 'symlink-data-directory', 'invalid-data-directory', 'invalid-redirect-port']) {
    await suite.test(`${name} rejects execution-controlling launcher configuration`, () => assert.deepEqual(events(name), []));
  }

  await suite.test('all 100 custom recipes remain available after built-in and invalid entries are filtered', () => {
    assert.equal(events('recipes').filter((event) => event.type === 'status').length, 2);
  });
  for (const [name, id] of [
    ['cancel-running', 'running-request'],
    ['discard-ready', 'completed-result'],
    ['stale-cancel', 'replacement-request'],
    ['menu-discard', 'menu-result'],
    ['late-result', 'cancelled-request'],
  ]) {
    await suite.test(`${name} reports only the discarded invocation ID`, () => {
      assert.deepEqual(events(name), [{ type: 'cancelled', id }]);
    });
  }
  await suite.test('cancel without a pending result emits no event that could cancel a newer invocation', () => {
    assert.deepEqual(events('cancel-empty'), []);
  });
});
