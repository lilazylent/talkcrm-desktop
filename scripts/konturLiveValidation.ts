import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {app} from 'electron';
import {SqliteRepository} from '../electron/repository.ts';
import {TalkSession} from '../electron/kontur/session.ts';
import {KonturService} from '../electron/kontur/service.ts';
import {ElectronCredentialStore} from '../electron/credentialStore.ts';
const root=process.env.TALKCRM_QA_ROOT!;const userData=path.join(app.getPath('appData'),'TalkCRM Desktop');app.setPath('userData',userData);
const output=path.join(root,'docs/validation/kontur-live.json');
app.whenReady().then(async()=>{let repository:SqliteRepository|null=null;let session:TalkSession|null=null;try{
  const qa=path.join(root,'release/kontur-qa');fs.mkdirSync(qa,{recursive:true});const installed=process.argv.includes('--installed');const database=installed?path.join(userData,'talkcrm.sqlite'):path.join(qa,'talkcrm.sqlite');if(!installed&&!process.argv.includes('--restart'))fs.copyFileSync(path.join(userData,'talkcrm.sqlite'),database);
  repository=new SqliteRepository(database,path.join(root,'migrations'),root,'0.3.0');await repository.initialize();const before=await repository.snapshot();
  const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');const protectedData=digest({profile:before.profile,settings:before.settings,crm:before.crm});
  session=new TalkSession();const service=new KonturService(repository,new ElectronCredentialStore(path.join(userData,'credentials')),session);
  const connected=await service.connect({mode:'session',domain:'samosale-app.ktalk.ru'});if(!connected.ok)throw new Error(connected.message);
  const sync=await service.sync();if(!sync.ok)throw new Error(sync.message);const first=await repository.snapshot();const firstIds=first.meetings.map(m=>m.id).sort();
  const repeat=await service.sync();if(!repeat.ok)throw new Error(repeat.message);const after=await repository.snapshot();
  const counts={recordings:0,segments:0,summary:0,protocol:0};for(const m of after.meetings){for(const a of repository.getMeetingArtifacts(m.id).artifacts){if(a.type==='recording')counts.recordings++;if(a.type==='summary'&&a.state==='ready')counts.summary++;if(a.type==='protocol'&&a.state==='ready')counts.protocol++;}counts.segments+=repository.getTranscriptPage(m.id,0,1,'').total;}
  const report={installed,connected:true,mode:'session',meetings:after.meetings.length,...counts,repeatStableIds:JSON.stringify(firstIds)===JSON.stringify(after.meetings.map(m=>m.id).sort()),protectedDataPreserved:protectedData===digest({profile:after.profile,settings:Object.fromEntries(Object.keys(before.settings).map(k=>[k,after.settings[k]])),crm:after.crm}),allUnlinked:after.meetings.every(m=>m.clientId===null&&m.dealId===null),restart:process.argv.includes('--restart'),restartIdsPreserved:!process.argv.includes('--restart')||JSON.stringify(before.meetings.map(m=>m.id).sort())===JSON.stringify(firstIds),checkedAt:new Date().toISOString()};if(!report.repeatStableIds||!report.restartIdsPreserved||!report.protectedDataPreserved||!report.allUnlinked||!counts.recordings)throw new Error('Live validation failed: '+JSON.stringify(report));fs.writeFileSync(output,JSON.stringify(report,null,2));
}catch(error){fs.writeFileSync(output,JSON.stringify({ok:false,message:error instanceof Error?error.message:'Validation failed'},null,2));app.exitCode=1;}finally{session?.close();repository?.close();app.quit();}});
