import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, readSync, realpathSync, writeSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

// Electron 41+ pins the Info.plist ASAR hashes in its signed Framework binary.
// Format and digest algorithm: Electron Packager's writeIntegrityDigest and
// setIntegrityDigest, https://github.com/electron/packager/blob/main/src/mac.ts
// This build uses one arm64 or x64 Electron slice; unexpected formats fail closed.
const sentinel = Buffer.from('AGbevlPCksUGKNL8TSn7wGmJEuJsXb2A');
const payloadLength = 34;

function integrityDigest(integrity) {
  if (!integrity || typeof integrity !== 'object' || Array.isArray(integrity)) {
    throw new Error('ASAR integrity must be a nonempty dictionary.');
  }
  const keys = Object.keys(integrity).sort();
  if (!keys.length) throw new Error('ASAR integrity must be a nonempty dictionary.');
  const hash = createHash('sha256');
  for (const key of keys) {
    const entry = integrity[key];
    if (!/^Resources\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.asar$/.test(key) ||
        key.split('/').some(part => part === '.' || part === '..') ||
        !entry || typeof entry !== 'object' || Array.isArray(entry) ||
        entry.algorithm !== 'SHA256' || !/^[a-f0-9]{64}$/.test(entry.hash)) {
      throw new Error('ASAR integrity contains an invalid path, algorithm, or SHA256 hash.');
    }
    hash.update(key).update(entry.algorithm).update(entry.hash);
  }
  return hash.digest();
}

/** Return a validated positional patch without modifying the source buffer. */
export function asarIntegrityPatch(binary, integrity) {
  const digest = integrityDigest(integrity);
  if (!Buffer.isBuffer(binary) || binary.length < 32 || binary.readUInt32LE(0) !== 0xfeedfacf ||
      ![0x01000007, 0x0100000c].includes(binary.readUInt32LE(4)) || binary.readUInt32LE(12) !== 6) {
    throw new Error('ASAR integrity requires a single arm64 or x64 Mach-O Framework.');
  }
  const index = binary.indexOf(sentinel);
  if (index < 0 || binary.indexOf(sentinel, index + 1) !== -1) {
    throw new Error('Expected exactly one Electron ASAR integrity slot.');
  }
  const offset = index + sentinel.length;
  if (offset + payloadLength > binary.length) throw new Error('Electron ASAR integrity slot is truncated.');
  const previous = binary.subarray(offset, offset + payloadLength);
  const payload = Buffer.concat([Buffer.from([1, 1]), digest]);
  // A fresh Electron binary has an unused zero-filled slot. Permit an identical
  // repeat, but never silently replace an unknown layout or a different pin.
  if (!previous.every(byte => byte === 0) && !previous.equals(payload)) {
    throw new Error('Electron ASAR integrity slot has an unexpected or different digest.');
  }
  return { offset, payload, digest: digest.toString('hex') };
}

/** Patch before code signing; changing these bytes invalidates the old signature. */
export function embedAsarIntegrity(appPath, integrity) {
  const app = realpathSync(appPath);
  const framework = realpathSync(join(app, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework'));
  const within = relative(app, framework);
  if (within.startsWith('..') || isAbsolute(within)) throw new Error('Electron Framework must be inside the app bundle.');
  const descriptor = openSync(framework, 'r+');
  try {
    const { offset, payload, digest } = asarIntegrityPatch(readFileSync(descriptor), integrity);
    let written = 0;
    while (written < payload.length) {
      const count = writeSync(descriptor, payload, written, payload.length - written, offset + written);
      if (!count) throw new Error('Could not write the Electron ASAR integrity digest.');
      written += count;
    }
    const observed = Buffer.alloc(payload.length);
    if (readSync(descriptor, observed, 0, observed.length, offset) !== observed.length || !observed.equals(payload)) {
      throw new Error('Could not verify the embedded Electron ASAR integrity digest.');
    }
    return digest;
  } finally {
    closeSync(descriptor);
  }
}
