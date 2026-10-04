import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { localElectronDist, root } from './desktopRuntime.mjs';

const cli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
const dist = localElectronDist();
const args = [cli, '--win', 'nsis'];
if (dist) args.push(`-c.electronDist=${dist}`);
const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
