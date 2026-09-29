import { app, safeStorage } from 'electron';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createChatGPT } from '../../../packages/local/dist/index.js';
import { ConnectionStore } from '../../../packages/local/dist/storage.js';
import { createElectronCredentialEncryption } from '../electron/credential-encryption.ts';

const [phase, root, appName] = process.argv.slice(2);
if (!phase || !root || !appName || !appName.startsWith('SIWC Storage Smoke ')) throw new Error('Run through credential-storage-runtime.mjs');
app.setName(appName);
app.setPath('userData', join(root, 'electron-user-data'));
app.setPath('sessionData', join(root, 'electron-user-data'));
app.disableHardwareAcceleration();
if (process.platform === 'darwin') app.setActivationPolicy('prohibited');
globalThis.fetch = () => { throw new Error('Network disabled in credential storage smoke test'); };

const state = () => ({
  version: 2, activeProfileId: 'synthetic-profile', pendingRegistrations: [],
  profiles: [{
    version: 1, id: 'synthetic-profile', label: 'Synthetic test profile',
    clientId: 'synthetic_test_client', status: 'connected', scopes: ['openid', 'chatgpt.tokens.use.direct'],
    savedAt: '2026-01-01T00:00:00.000Z', subject: 'synthetic-test-subject',
    identity: { email: 'synthetic-test@example.invalid' }, profileIdToken: 'synthetic-id-token-never-valid',
    credentials: { accessToken: 'synthetic-access-token-never-valid', refreshToken: 'synthetic-refresh-token-never-valid', expiresAt: 4102444800000 },
  }],
});
const filename = (name) => join(root, name, 'chatgpt-auth.json');
const bytes = (name) => readFile(filename(name));
const digest = (data) => createHash('sha256').update(data).digest('hex');
const read = (store) => store.withLock(() => store.read());
const codeIs = (code) => (error) => error?.code === code;
const names = ['fresh', 'legacy-v1', 'legacy-v2'];

async function run() {
  await app.whenReady();
  const provider = createElectronCredentialEncryption(safeStorage, () => app.isReady());
  assert.equal(provider.isAvailable(), true, 'Real OS encryption is unavailable; no fallback is allowed');
  const store = (name, encryption = provider) => new ConnectionStore(join(root, name), encryption);
  const client = (name, encryption = provider) => createChatGPT({
    appName, appId: 'siwc-storage-smoke', redirectPort: 0, storageDir: join(root, name), credentialEncryption: encryption,
    openBrowser: () => { throw new Error('Browser login disabled in storage smoke test'); },
  });
  const result = { phase, status: 'passed', platform: process.platform, arch: process.arch, electron: process.versions.electron, provider: provider.id, realProviderAvailable: true, checks: [] };
  if (phase === 'prepare') {
    result.files = {};
    for (const name of names) {
      const connectionStore = store(name);
      if (name === 'fresh') {
        await connectionStore.withLock(() => connectionStore.write(state()));
      } else {
        await mkdir(join(root, name), { mode: 0o700 });
        const legacy = name === 'legacy-v2' ? state() : (({ id, label, ...record }) => record)(state().profiles[0]);
        await writeFile(filename(name), JSON.stringify(legacy), { mode: 0o600 });
      }
      const saved = await read(connectionStore);
      assert.deepEqual(saved.profiles[0].credentials, state().profiles[0].credentials);
      if (name === 'legacy-v1') assert.equal(saved.profiles[0].requiresNewRegistration, true);
      const raw = await bytes(name);
      assert.equal(JSON.parse(raw).version, 3);
      assert.equal(raw.includes(Buffer.from('synthetic-access-token-never-valid')), false);
      assert.equal(raw.includes(Buffer.from('synthetic-refresh-token-never-valid')), false);
      assert.equal(raw.includes(Buffer.from('synthetic-id-token-never-valid')), false);
      assert.deepEqual(await readdir(join(root, name)), ['chatgpt-auth.json']);
      if (process.platform !== 'win32') assert.equal((await stat(filename(name))).mode & 0o777, 0o600);
      result.files[name] = { digest: digest(raw), profileId: saved.activeProfileId };
    }
    result.checks.push('Real OS encryption and decryption', 'Fresh encrypted write', 'Legacy v1 and v2 migration without extra files', 'No token sentinels in encrypted files', 'Owner-only credential files');
  } else {
    const [prepared] = JSON.parse(await readFile(join(root, 'receipts.json'), 'utf8'));
    if (phase === 'restart-and-failures') {
      for (const name of names) {
        const saved = await read(store(name));
        assert.deepEqual(saved.profiles[0].credentials, state().profiles[0].credentials);
        assert.equal(saved.activeProfileId, prepared.files[name].profileId);
        assert.equal(digest(await bytes(name)), prepared.files[name].digest);
      }
      result.checks.push('Real decryption of all three files after process restart', 'Reads preserve encrypted bytes and profile IDs');
      for (const [condition, encryption, expected] of [
        ['availability=false (injected)', { ...provider, isAvailable: () => false }, 'storage_encryption_unavailable'],
        ['decrypt throw (injected)', { ...provider, decrypt: () => { throw new Error('Synthetic decrypt failure'); } }, 'storage_decryption_failed'],
        ['provider mismatch (injected)', { ...provider, id: 'synthetic-other-provider' }, 'storage_provider_mismatch'],
      ]) {
        const account = client('fresh', encryption);
        await assert.rejects(account.signIn({ newProfile: true }), codeIs(expected));
        await assert.rejects(account.disconnect(), codeIs(expected));
        assert.equal(digest(await bytes('fresh')), prepared.files.fresh.digest);
        assert.deepEqual(await readdir(join(root, 'fresh')), ['chatgpt-auth.json']);
        result.checks.push(`${condition}: sign-in and sign-out preserve original ciphertext`);
      }
      await mkdir(join(root, 'corrupt'), { mode: 0o700 });
      const envelope = JSON.parse(await bytes('fresh'));
      const damaged = Buffer.from(envelope.ciphertext, 'base64');
      damaged.fill(0, 0, Math.min(8, damaged.length));
      envelope.ciphertext = damaged.toString('base64');
      const corrupt = JSON.stringify(envelope);
      await writeFile(filename('corrupt'), corrupt, { mode: 0o600 });
      await assert.rejects(client('corrupt').signIn({ newProfile: true }), codeIs('storage_decryption_failed'));
      assert.equal(await readFile(filename('corrupt'), 'utf8'), corrupt);
      result.checks.push('Real safeStorage rejects damaged ciphertext without resetting the file');
    } else if (phase === 'sign-out') {
      assert.deepEqual((await read(store('fresh'))).profiles[0].credentials, state().profiles[0].credentials);
      await assert.rejects(client('fresh').disconnect(), codeIs('revocation_failed'));
      const profile = (await read(store('fresh'))).profiles[0];
      assert.equal(profile.credentials, undefined);
      assert.equal(profile.profileIdToken, undefined);
      assert.equal(profile.clientId, 'synthetic_test_client');
      assert.equal(profile.status, 'disconnected');
      assert.equal(JSON.parse(await bytes('fresh')).version, 3);
      result.checks.push('Fresh process decrypts original credentials after injected failures', 'Sign-out removes tokens despite deliberately disabled network', 'Registration remains encrypted');
    } else if (phase === 'restart-after-sign-out') {
      const profile = (await read(store('fresh'))).profiles[0];
      assert.equal(profile.credentials, undefined);
      assert.equal(profile.profileIdToken, undefined);
      assert.equal(profile.status, 'disconnected');
      for (const name of ['legacy-v1', 'legacy-v2']) {
        assert.deepEqual((await read(store(name))).profiles[0].credentials, state().profiles[0].credentials);
        assert.equal(digest(await bytes(name)), prepared.files[name].digest);
      }
      result.checks.push('Token removal persists after process restart', 'Migrated files remain readable and unchanged after additional restarts');
    } else throw new Error('Unknown smoke test phase');
  }
  return result;
}

run().then((result) => {
  console.log(`SIWC_SMOKE_RESULT ${JSON.stringify(result)}`);
  app.exit(0);
}).catch((error) => {
  console.log(`SIWC_SMOKE_RESULT ${JSON.stringify({ phase, status: 'failed', code: error.code, message: error.message })}`);
  app.exit(1);
});
