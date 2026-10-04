// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {SqliteRepository} from '../electron/repository.ts';
import type {KonturAccount,TalkImport} from '../src/domain/kontur.ts';
let folder:string;let repo:SqliteRepository;
const account:KonturAccount={id:'test-talk',domain:'test.ktalk.ru',mode:'session',externalUserId:'u1',displayName:'Тест',state:'connected',lastSyncAt:null,error:null,meetingCount:0};
const meeting=(recording='r1',conference:string|null='conference1'):TalkImport=>({meetingExternalId:conference,recordingExternalId:recording,title:'Синтетическая встреча',startedAt:'2026-10-03T12:00:00Z',endedAt:null,durationSeconds:42,organizer:null,sourceCreatedAt:null,sourceUpdatedAt:null,participants:[{displayName:'Дмитрий',externalId:'u1',email:null,role:null,organizer:null}],artifacts:[{recordingId:recording,type:'transcript',state:'ready',externalId:'t1',version:null,generatedAt:null,text:null,sections:[],sourceUrl:null}],segments:[{recordingId:recording,externalId:'s1',speakerId:'u1',speakerName:'Дмитрий',startMs:42123,endMs:42567,text:'Тестовая реплика'}]});
beforeEach(async()=>{folder=fs.mkdtempSync(path.join(os.tmpdir(),'talk-persistence-'));repo=new SqliteRepository(path.join(folder,'db.sqlite'),path.join(process.cwd(),'migrations'),process.cwd());await repo.initialize();await repo.connectKontur(account);});
afterEach(()=>{repo.close();fs.rmSync(folder,{recursive:true,force:true});});
it('deduplicates conference recordings and preserves precise segments across refresh',async()=>{
  await repo.commitKonturMeetings(account,[meeting(),meeting('r2')]);const first=await repo.snapshot();expect(first.meetings).toHaveLength(1);const id=first.meetings[0].id;expect(first.meetings[0].matchingStatus).toBe('unlinked');expect(first.meetings[0].transcript).toEqual([]);
  await repo.commitKonturMeetings(account,[meeting()]);expect((await repo.snapshot()).meetings[0].id).toBe(id);const p=repo.getTranscriptPage(id,0,100,'реплика');expect(p.total).toBe(2);expect(p.segments[0].startMs).toBe(42123);expect(p.segments[0].speakerName).toBe('Дмитрий');
});
it('keeps artifacts and imported meetings on disconnect and demo reset',async()=>{
  await repo.commitKonturMeetings(account,[meeting()]);await repo.resetDemo();expect((await repo.snapshot()).meetings).toHaveLength(1);await repo.disconnectKontur(false);expect((await repo.snapshot()).meetings).toHaveLength(1);expect(repo.getKonturAccount()?.state).toBe('disconnected');
});
it('merges late conference identity without dropping recording artifacts',async()=>{
  await repo.commitKonturMeetings(account,[meeting('r1',null),meeting('r2',null)]);expect((await repo.snapshot()).meetings).toHaveLength(2);await repo.commitKonturMeetings(account,[meeting('r1'),meeting('r2')]);const data=await repo.snapshot();expect(data.meetings).toHaveLength(1);expect(repo.getMeetingArtifacts(data.meetings[0].id).artifacts).toHaveLength(2);
});
it('does not destroy ready cached artifact on temporary absence; processing later becomes ready',async()=>{
  const initial=meeting();initial.artifacts[0].state='processing';initial.segments=[];await repo.commitKonturMeetings(account,[initial]);await repo.commitKonturMeetings(account,[meeting()]);const absent=meeting();absent.artifacts[0].state='not_available';absent.segments=[];await repo.commitKonturMeetings(account,[absent]);const id=(await repo.snapshot()).meetings[0].id;expect(repo.getTranscriptPage(id,0,100,'').total).toBe(1);expect(repo.getMeetingArtifacts(id).artifacts[0].state).toBe('ready');
});
it('uses bounded transcript pages and literal local search',async()=>{
  const large=meeting();large.segments=Array.from({length:20000},(_,i)=>({...large.segments[0],externalId:String(i),startMs:i*1234,text:i===15420?'Искомая 100% реплика':'Обычная реплика'}));await repo.commitKonturMeetings(account,[large]);const id=(await repo.snapshot()).meetings[0].id;expect(repo.getTranscriptPage(id,0,5000,'').segments).toHaveLength(200);const found=repo.getTranscriptPage(id,0,100,'100%');expect(found.total).toBe(1);expect(found.segments[0].startMs).toBe(15420*1234);expect(()=>repo.getTranscriptPage(id,-1,100,'')).toThrow();
});
it('retains segment IDs during unchanged and corrected imports, supports Cyrillic case-insensitive search',async()=>{await repo.commitKonturMeetings(account,[meeting()]);const id=(await repo.snapshot()).meetings[0].id;const segment=repo.getTranscriptPage(id,0,100,'ТЕСТОВАЯ').segments[0];expect(segment).toBeDefined();await repo.commitKonturMeetings(account,[meeting()]);expect(repo.getTranscriptPage(id,0,100,'').segments[0].id).toBe(segment.id);const correction=meeting();correction.segments[0].text='Исправленная реплика';await repo.commitKonturMeetings(account,[correction]);expect(repo.getTranscriptPage(id,0,100,'').segments[0].id).toBe(segment.id);});
it('removes content explicitly hidden at source while preserving temporary missing cache',async()=>{const first=meeting();first.artifacts.push({recordingId:'r1',type:'summary',state:'ready',externalId:'summary1',version:'1',generatedAt:null,text:'Сохранённый текст',sections:[],sourceUrl:null});await repo.commitKonturMeetings(account,[first]);const hidden=meeting();hidden.artifacts.push({...first.artifacts[1],state:'not_available',suppressed:true,text:null,sections:[]});await repo.commitKonturMeetings(account,[hidden]);const id=(await repo.snapshot()).meetings[0].id;expect(repo.getMeetingArtifacts(id).artifacts.find(a=>a.type==='summary')?.text).toBeNull();});
