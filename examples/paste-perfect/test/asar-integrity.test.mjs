import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { asarIntegrityPatch, embedAsarIntegrity } from '../native/asar-integrity.mjs';

const sentinel = Buffer.from('AGbevlPCksUGKNL8TSn7wGmJEuJsXb2A');
const integrity = { 'Resources/app.asar': { algorithm: 'SHA256', hash: 'a'.repeat(64) } };

function framework(cpu = 0x0100000c) {
  const binary = Buffer.alloc(160);
  binary.writeUInt32LE(0xfeedfacf, 0);
  binary.writeUInt32LE(cpu, 4);
  binary.writeUInt32LE(6, 12);
  sentinel.copy(binary, 48);
  return binary;
}

test('embeds the vendor-format integrity pin without changing other bytes', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'paste-perfect-asar-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const frameworkDirectory = join(root, 'Contents/Frameworks/Electron Framework.framework');
  mkdirSync(frameworkDirectory, { recursive: true });
  const file = join(frameworkDirectory, 'Electron Framework');
  const before = framework();
  writeFileSync(file, before);
  const expected = '6f22b7a4f82a2d9f48798c779ac3eec57d2cf91e549ce42866b193dd2ea3ec67';
  const actual = embedAsarIntegrity(root, integrity);
  assert.equal(actual, expected);
  const after = readFileSync(file);
  const offset = 48 + sentinel.length;
  assert.deepEqual(after.subarray(0, offset), before.subarray(0, offset));
  assert.deepEqual(after.subarray(offset, offset + 2), Buffer.from([1, 1]));
  assert.equal(after.subarray(offset + 2, offset + 34).toString('hex'), expected);
  assert.deepEqual(after.subarray(offset + 34), before.subarray(offset + 34));
  assert.equal(embedAsarIntegrity(root, integrity), expected, 'Identical repeated packaging is safe');
});

test('sorts ASAR entries and supports the other single-architecture build', () => {
  const entries = { 'Resources/extra.asar': { algorithm: 'SHA256', hash: 'b'.repeat(64) }, ...integrity };
  assert.equal(asarIntegrityPatch(framework(0x01000007), entries).digest,
    'fbb894ecdfdbcd0fea10cd2679f496f30d58a42a748797b9852dafdf86fe18cd');
});

test('rejects absent, repeated, truncated, or unknown integrity slots', () => {
  const missing = framework(); missing.fill(0, 48, 48 + sentinel.length);
  const duplicate = Buffer.concat([framework(), sentinel, Buffer.alloc(34)]);
  const truncated = framework().subarray(0, 48 + sentinel.length + 33);
  const unknown = framework(); unknown[48 + sentinel.length] = 2;
  const unsupportedVersion = framework(); unsupportedVersion[48 + sentinel.length + 1] = 2;
  const dirtyUnused = framework(); dirtyUnused[48 + sentinel.length + 7] = 1;
  for (const bytes of [missing, duplicate, truncated, unknown, unsupportedVersion, dirtyUnused]) {
    const before = Buffer.from(bytes);
    assert.throws(() => asarIntegrityPatch(bytes, integrity));
    assert.deepEqual(bytes, before, 'Invalid input must not be mutated');
  }
});

test('rejects a different existing pin and unsupported Framework formats', () => {
  const bytes = framework();
  const patch = asarIntegrityPatch(bytes, integrity); patch.payload.copy(bytes, patch.offset);
  assert.throws(() => asarIntegrityPatch(bytes, { 'Resources/app.asar': { algorithm: 'SHA256', hash: 'b'.repeat(64) } }), /different digest/);
  const fat = framework(); fat.writeUInt32LE(0xcafebabe, 0);
  const unsupportedCpu = framework(7);
  const executable = framework(); executable.writeUInt32LE(2, 12);
  for (const invalid of [Buffer.alloc(20), fat, unsupportedCpu, executable]) {
    assert.throws(() => asarIntegrityPatch(invalid, integrity), /single arm64 or x64/);
  }
});

test('rejects malformed or unsafe integrity metadata', () => {
  for (const invalid of [null, [], {}, { 'Resources/../app.asar': integrity['Resources/app.asar'] },
    { '/Resources/app.asar': integrity['Resources/app.asar'] }, { 'Resources/app.asar': null },
    { 'Resources/app.asar': { algorithm: 'sha256', hash: 'a'.repeat(64) } },
    { 'Resources/app.asar': { algorithm: 'SHA256', hash: 'not-a-digest' } }]) {
    assert.throws(() => asarIntegrityPatch(framework(), invalid));
  }
});

test('does not patch a Framework symlink outside the app bundle', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'paste-perfect-asar-link-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = join(root, 'App.app');
  const directory = join(app, 'Contents/Frameworks/Electron Framework.framework');
  mkdirSync(directory, { recursive: true });
  const outside = join(root, 'outside-framework');
  const before = framework(); writeFileSync(outside, before);
  symlinkSync(outside, join(directory, 'Electron Framework'));
  assert.throws(() => embedAsarIntegrity(app, integrity), /inside the app bundle/);
  assert.deepEqual(readFileSync(outside), before);
});
