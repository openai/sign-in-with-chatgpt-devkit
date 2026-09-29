import assert from 'node:assert/strict';
import test from 'node:test';
import { createElectronCredentialEncryption } from '../electron/credential-encryption.ts';

function fakeStorage(overrides = {}) {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value) => Buffer.from(`test:${value}`),
    decryptString: (value) => value.toString().slice(5),
    ...overrides,
  };
}

test('adapter waits for Electron readiness and rejects unavailable OS encryption', () => {
  for (const [ready, available] of [[false, true], [true, false]]) {
    const adapter = createElectronCredentialEncryption(fakeStorage({ isEncryptionAvailable: () => available }), () => ready, 'darwin');
    assert.equal(adapter.isAvailable(), false);
    assert.throws(() => adapter.encrypt('secret'));
    assert.throws(() => adapter.decrypt(new Uint8Array()));
  }
});

test('Linux requires a recognized OS secret store and refuses basic_text', () => {
  for (const backend of ['basic_text', 'unknown', 'future-unverified-backend', 'gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']) {
    const adapter = createElectronCredentialEncryption(fakeStorage({ getSelectedStorageBackend: () => backend }), () => true, 'linux');
    const allowed = ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(backend);
    assert.equal(adapter.isAvailable(), allowed);
    if (!allowed) assert.throws(() => adapter.encrypt('secret'));
  }
});

test('main-process adapter delegates to safeStorage and rechecks availability on each operation', () => {
  let available = true;
  const storage = fakeStorage({ isEncryptionAvailable: () => available });
  const adapter = createElectronCredentialEncryption(storage, () => true, 'darwin');
  assert.equal(adapter.id, 'electron-safe-storage-v1');
  const encrypted = adapter.encrypt('synthetic-secret');
  assert.equal(adapter.decrypt(encrypted), 'synthetic-secret');
  available = false;
  assert.throws(() => adapter.encrypt('synthetic-secret'));
  assert.throws(() => adapter.decrypt(encrypted));
});
