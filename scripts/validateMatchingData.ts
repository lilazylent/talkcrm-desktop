import fs from 'node:fs';
import path from 'node:path';
import {SqliteRepository} from '../electron/repository.ts';
const qa=path.resolve('release/phase4-real-cache');fs.mkdirSync(qa,{recursive:true});const database=path.join(qa,'talkcrm.sqlite');
fs.copyFileSync(path.join(process.env.APPDATA!,'TalkCRM Desktop/talkcrm.sqlite'),database);
const repository=new SqliteRepository(database,path.resolve('migrations'),process.cwd(),'0.4.0');await repository.initialize();const snapshot=await repository.findMeetingClients();
const counts={meetings:snapshot.meetings.length,recordings:0,segments:0,retellings:0,confirmed:0};
const meetings=snapshot.meetings.map(m=>{const materials=repository.getMeetingArtifacts(m.id);counts.recordings+=materials.artifacts.filter(a=>a.type==='recording').length;counts.retellings+=materials.artifacts.filter(a=>a.type==='summary'&&a.state==='ready').length;counts.segments+=repository.getTranscriptPage(m.id,0,1,'').total;if(m.crmLink?.confirmed)counts.confirmed++;return{title:m.title,status:m.crmLink?.status,candidates:m.crmLink?.candidates.map(c=>({client:c.clientLabel,deal:c.dealLabel,confidence:c.confidence,clientConfidence:c.clientConfidence,dealConfidence:c.dealConfidence,needsReview:c.needsReview,evidenceTypes:c.evidence.map(e=>e.type)}))};});
const report={version:'0.4.0',localOnly:true,scope:'cached-current-manager',counts,meetings,checkedAt:new Date().toISOString()};repository.close();fs.writeFileSync('docs/validation/matching-real.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
