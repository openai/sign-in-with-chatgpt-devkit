import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import vm from 'node:vm';
import { transform } from 'esbuild';
import test from 'node:test';

const { code } = await transform(await readFile(new URL('../electron/native.ts', import.meta.url), 'utf8'), {
  loader: 'ts', format: 'cjs', platform: 'node', target: 'node22',
});

function transport() {
  const input = new EventEmitter();
  input.setEncoding = () => input;
  input.pause = () => input;
  const output = new EventEmitter();
  output.writable = true;
  const commands = [];
  output.write = (line) => { commands.push(JSON.parse(line)); return true; };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    process: { platform: 'darwin', env: { PASTE_PERFECT_NATIVE_HOST: '1' }, stdin: input, stdout: output },
  });
  const events = [];
  let disconnected = 0;
  const native = new module.exports.NativePaste((event) => events.push(event), () => disconnected++);
  native.start();
  return { native, input, commands, events, disconnected: () => disconnected,
    receive: (value) => input.emit('data', `${JSON.stringify(value)}\n`) };
}

// Values live only in this process. Assertions deliberately avoid printing
// protocol envelopes or credentials into failure diagnostics.
const firstToken = randomBytes(32).toString('hex');
const secondToken = randomBytes(32).toString('hex');

test('commands cannot be emitted before the private stdin authentication message', () => {
  const instance = transport();
  assert.equal(instance.native.send({ type: 'arm' }), false);
  assert.equal(instance.commands.length, 0);
});

test('authentication stays in the main transport and flushes only the latest pending configuration', () => {
  const instance = transport();
  instance.native.configure([{ id: 'old', name: 'Old recipe' }], false);
  instance.native.configure([{ id: 'new', name: 'Current recipe' }], true);
  assert.equal(instance.commands.length, 0);
  const message = `${JSON.stringify({ type: 'transport-auth', token: firstToken })}\n`;
  instance.input.emit('data', message.slice(0, 24));
  assert.equal(instance.commands.length, 0);
  instance.input.emit('data', message.slice(24));
  assert.equal(instance.commands.length, 1);
  const command = instance.commands[0];
  assert.equal(command.type, 'configure');
  assert.equal(command.connected, true);
  assert.equal(command.recipes.length, 1);
  assert.equal(command.recipes[0].id, 'new');
  assert.ok(command.token === firstToken, 'Only the private stdin token authenticates commands');
  assert.ok(instance.events.every(event => !Object.hasOwn(event, 'token')), 'Bootstrap credentials never reach UI callbacks');
});

test('every command carries the established token and callers cannot override it', () => {
  const instance = transport();
  instance.receive({ type: 'transport-auth', token: firstToken });
  assert.equal(instance.native.send({ type: 'arm', token: secondToken }), true);
  assert.equal(instance.native.send({ type: 'cancel', id: 'synthetic-request' }), true);
  assert.equal(instance.commands.length, 2);
  assert.ok(instance.commands.every(command => command.token === firstToken), 'All commands use the private bootstrap token');
});

test('malformed authentication messages never enable commands', () => {
  for (const token of [undefined, null, 1, '', '1'.repeat(63), '1'.repeat(65), 'z'.repeat(64)]) {
    const instance = transport();
    instance.receive({ type: 'transport-auth', token });
    assert.equal(instance.native.send({ type: 'arm' }), false);
    assert.equal(instance.commands.length, 0);
  }
});

test('a second authentication message cannot replace the established credential', () => {
  const instance = transport();
  instance.receive({ type: 'transport-auth', token: firstToken });
  instance.receive({ type: 'transport-auth', token: secondToken });
  instance.native.send({ type: 'arm' });
  assert.ok(instance.commands.every(command => command.token === firstToken), 'A second message cannot rotate the accepted token');
  assert.ok(instance.events.every(event => !Object.hasOwn(event, 'token')), 'Duplicate bootstrap credentials never reach UI callbacks');
});

test('native channel closure prevents authenticated commands from being sent', () => {
  const instance = transport();
  instance.receive({ type: 'transport-auth', token: firstToken });
  instance.input.emit('end');
  assert.equal(instance.disconnected(), 1);
  assert.equal(instance.native.send({ type: 'arm' }), false);
  assert.equal(instance.commands.length, 0);
});

test('compiled native command guard rejects inherited stdout without the current launch credential', {
  skip: process.platform !== 'darwin', timeout: 60_000,
}, async (suite) => {
  const directory = await mkdtemp('/private/tmp/paste-perfect-command-auth-');
  suite.after(() => rm(directory, { recursive: true, force: true }));
  const production = await readFile(new URL('../native/PastePerfectNative.swift', import.meta.url), 'utf8');
  const source = join(directory, 'AuthenticationRegression.swift');
  const executable = join(directory, 'AuthenticationRegression');
  await writeFile(source, `${production}\n
func regressionToken() -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    precondition(SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess)
    return bytes.map { String(format: "%02x", $0) }.joined()
}
let currentToken = regressionToken()
let previousToken = regressionToken()
for action in ["configure", "arm", "result", "quit", "desktop-ready"] {
    precondition(!commandHasValidAuthentication(["type": action], token: currentToken), "Missing credential must fail")
    precondition(!commandHasValidAuthentication(["type": action, "token": previousToken], token: currentToken), "Another launch's credential must fail")
    precondition(commandHasValidAuthentication(["type": action, "token": currentToken], token: currentToken), "Current credential must succeed")
}
for invalid in [NSNull(), 1, true, "", String(repeating: "1", count: 63), String(repeating: "1", count: 65), String(repeating: "z", count: 64)] as [Any] {
    precondition(!commandHasValidAuthentication(["type": "arm", "token": invalid], token: currentToken), "Invalid credentials must fail")
}
print("PASS: missing, malformed, and cross-launch credentials are rejected; current-launch commands are accepted")
`);
  execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-D', 'PASTE_PERFECT_NATIVE_TESTS',
    '-module-cache-path', join(directory, 'ModuleCache'),
    '-framework', 'AppKit', '-framework', 'ApplicationServices', '-framework', 'CoreGraphics', '-framework', 'Security',
    source, '-o', executable], { timeout: 50_000, maxBuffer: 256_000 });
  const result = execFileSync(executable, [], { encoding: 'utf8', timeout: 5_000 });
  assert.match(result, /^PASS: missing, malformed, and cross-launch credentials are rejected;/);
});
