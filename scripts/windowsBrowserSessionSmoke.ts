import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { ElectronCredentialStore } from '../electron/credentialStore.ts';
import { ElectronBrowserAccess } from '../electron/amocrm/browserAccess.ts';
import { browserCredentialKey, cookieBundle } from '../electron/amocrm/browserPolicy.ts';
const root=process.env.TALKCRM_QA_ROOT!;const directory=path.join(root,'release','browser-session-qa');fs.mkdirSync(directory,{recursive:true});app.setPath('userData',directory);
app.whenReady().then(async()=>{
  const domain='test.amocrm.ru';const key=browserCredentialKey('smoke_test');const sentinel='COOKIE_DPAPI_SMOKE_SENTINEL';const store=new ElectronCredentialStore(path.join(directory,'credentials'));const browser=new ElectronBrowserAccess(store);
  try{
    const fixture=cookieBundle({domain,cookies:[{name:'talkcrm_synthetic_test',value:sentinel,domain,path:'/',secure:true,httpOnly:true,hostOnly:true,sameSite:'lax'}]},domain);await store.set(key,JSON.stringify(fixture));
    // Constructing the client restores encrypted cookies; no network request or login window is opened.
    await browser.client(domain,'smoke_test');await browser.persist(domain,'smoke_test');const recovered=cookieBundle(JSON.parse((await store.get(key))!),domain);
    const cookies=recovered.cookies;const report={platform:process.platform,roundTrip:cookies.length===1&&cookies[0].value===sentinel,hostOnly:cookies[0]?.hostOnly===true,httpOnly:cookies[0]?.httpOnly===true,secure:cookies[0]?.secure===true,plaintextOnDisk:fs.readdirSync(path.join(directory,'credentials')).some(file=>fs.readFileSync(path.join(directory,'credentials',file)).toString().includes(sentinel)),networkRequests:0};
    if(!report.roundTrip||!report.hostOnly||!report.httpOnly||!report.secure||report.plaintextOnDisk)throw new Error('Browser session smoke failed');fs.writeFileSync(path.join(root,'docs','validation','windows-browser-session.json'),JSON.stringify(report,null,2));
  }finally{await browser.clear();await store.delete(key);}
  app.quit();
}).catch(error=>{fs.writeFileSync(path.join(root,'docs','validation','windows-browser-session-error.json'),JSON.stringify({error:error instanceof Error?error.message:'unknown'},null,2));app.exit(1);});
