import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { SecureCredentialStore } from '../src/services/contracts.ts';
export interface Cipher { available(): boolean; encrypt(value: string): Buffer; decrypt(value: Buffer): string }
export class EncryptedFileStore implements SecureCredentialStore {
  constructor(private readonly directory: string, private readonly cipher: Cipher) {}
  private file(key: string): string { if (!/^amocrm:[a-z0-9_-]+:(oauth|browser)$/i.test(key)&&!/^kontur:[a-f0-9]{64}:api$/.test(key)) throw new Error('Invalid credential namespace'); return path.join(this.directory,createHash('sha256').update(key).digest('hex')+'.credential'); }
  async set(key: string, secret: string): Promise<void> {
    if (!this.cipher.available()) throw new Error('OS encryption unavailable');
    const file = this.file(key); fs.mkdirSync(this.directory,{recursive:true}); const temp = file+'.tmp';
    try { fs.writeFileSync(temp,this.cipher.encrypt(secret),{mode:0o600}); fs.renameSync(temp,file); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  async get(key: string): Promise<string|null> { const file=this.file(key); if (!fs.existsSync(file)) return null; if (!this.cipher.available()) throw new Error('OS encryption unavailable'); return this.cipher.decrypt(fs.readFileSync(file)); }
  async delete(key: string): Promise<void> { const file=this.file(key); if (fs.existsSync(file)) fs.unlinkSync(file); }
}
