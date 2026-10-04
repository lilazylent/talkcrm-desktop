import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { localElectronDist, root } from './desktopRuntime.mjs';

const dist = localElectronDist();
if (!dist) { console.error('Electron binary is missing. Run npm install or provide a matching local Electron distribution.'); process.exit(1); }
const result = spawnSync(path.join(dist, 'electron.exe'), ['.'], { cwd: root, env: { ...process.env, TALKCRM_DEV_URL: 'http://127.0.0.1:5173' }, stdio: 'inherit' });
process.exit(result.status ?? 1);
