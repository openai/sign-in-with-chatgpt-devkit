import type { CredentialEncryption } from '@siwc/local';
import type { SafeStorage } from 'electron';

type StorageAPI = Pick<SafeStorage, 'isEncryptionAvailable' | 'encryptString' | 'decryptString' | 'getSelectedStorageBackend'>;

/** Keep this adapter in the Electron main process; it never exposes keys over IPC. */
export function createElectronCredentialEncryption(
  storage: StorageAPI,
  isReady: () => boolean,
  platform: NodeJS.Platform = process.platform,
): CredentialEncryption {
  const isAvailable = () => {
    if (!isReady() || !storage.isEncryptionAvailable()) return false;
    // Electron's Linux basic_text backend uses a hardcoded key. Refuse it.
    return platform !== 'linux' || ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(storage.getSelectedStorageBackend());
  };
  const requireAvailable = () => {
    if (!isAvailable()) throw new Error('OS credential encryption is unavailable.');
  };
  return {
    id: 'electron-safe-storage-v1',
    isAvailable,
    encrypt(plaintext) {
      requireAvailable();
      return storage.encryptString(plaintext);
    },
    decrypt(ciphertext) {
      requireAvailable();
      return storage.decryptString(Buffer.from(ciphertext));
    },
  };
}
