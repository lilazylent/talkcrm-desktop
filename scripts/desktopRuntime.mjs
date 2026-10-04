import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export function localElectronDist() {
  const candidates = [path.join(root, 'node_modules', 'electron'), path.join(root, '..', 'node_modules', 'electron')];
  const required = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  for (const packagePath of candidates) {
    const executable = path.join(packagePath, 'dist', 'electron.exe');
    const manifest = path.join(packagePath, 'package.json');
    if (fs.existsSync(executable) && fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).version === required) return path.dirname(executable);
  }
  return null;
}
