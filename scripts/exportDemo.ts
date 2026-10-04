import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteRepository } from '../electron/repository.ts';

async function main() {
  const root = process.cwd();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'talkcrm-preview-'));
  try {
    const repository = new SqliteRepository(path.join(temp, 'preview.sqlite'), path.join(root, 'migrations'), root);
    await repository.initialize();
    const snapshot = await repository.snapshot();
    fs.mkdirSync(path.join(root, 'public'), { recursive: true });
    fs.writeFileSync(path.join(root, 'public', 'demo-preview.json'), JSON.stringify(snapshot, null, 2));
    repository.close();
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
void main();
