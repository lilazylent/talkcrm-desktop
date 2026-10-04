import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import { ElectronCredentialStore } from '../electron/credentialStore.ts';
const root=process.env.TALKCRM_QA_ROOT!;
const directory=path.join(root,'release','credential-qa');
app.setPath('userData',directory);
app.whenReady().then(async()=>{
  const secret='DPAPI_SMOKE_SENTINEL';const store=new ElectronCredentialStore(path.join(directory,'credentials'));const key='amocrm:smoke:oauth';
  const available=safeStorage.isEncryptionAvailable();await store.set(key,secret);const recovered=await store.get(key);const files=fs.readdirSync(path.join(directory,'credentials'));const plaintext=files.some(file=>fs.readFileSync(path.join(directory,'credentials',file)).toString().includes(secret));await store.delete(key);
  const report={platform:process.platform,encryptionAvailable:available,roundTrip:recovered===secret,plaintextOnDisk:plaintext,deleted:await store.get(key)===null};
  if(!report.roundTrip||plaintext||!report.deleted)throw new Error('Credential smoke failed');fs.writeFileSync(path.join(root,'docs','validation','windows-credentials.json'),JSON.stringify(report,null,2));app.quit();
}).catch(()=>{app.exit(1);});
