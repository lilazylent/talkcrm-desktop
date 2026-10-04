import { safeStorage } from 'electron';
import { EncryptedFileStore } from './encryptedStore.ts';

export class ElectronCredentialStore extends EncryptedFileStore {
  constructor(directory: string) { super(directory,{available:()=>process.platform === 'win32' && safeStorage.isEncryptionAvailable(),encrypt:value=>safeStorage.encryptString(value),decrypt:value=>safeStorage.decryptString(value)}); }
}
