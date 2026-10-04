import {randomUUID} from 'node:crypto';
import type {Database} from 'sql.js';
import {execute,query} from './crmPersistence.ts';
import type {KonturAccount,TalkImport,MeetingArtifacts,TranscriptPage,ArtifactState,TalkArtifact} from '../src/domain/kontur.ts';
import type {Meeting} from '../src/domain/models.ts';
import {mergeCrmLinks,readLink} from './matching/persistence.ts';
import {sourceRetellingText} from '../src/domain/sourceText.ts';
const optional=(v:unknown):string|null=>v===null||v===undefined?null:String(v);
export function konturAccount(db:Database):KonturAccount|null {
  const row=query(db,"SELECT a.*,(SELECT COUNT(*) FROM meetings m WHERE m.account_id=a.id AND m.source='kontur_talk') AS meeting_count FROM kontur_accounts a JOIN app_settings s ON s.key='active_kontur_account' AND s.value=a.id")[0];
  return row?{id:String(row.id),domain:String(row.domain),mode:row.mode==='api'?'api':'session',externalUserId:optional(row.external_user_id),displayName:optional(row.display_name),state:String(row.state) as KonturAccount['state'],lastSyncAt:optional(row.last_sync_at),error:optional(row.error),meetingCount:Number(row.meeting_count)}:null;
}
export function saveKonturAccount(db:Database,a:KonturAccount):void {
  execute(db,'INSERT INTO kontur_accounts VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET domain=excluded.domain,mode=excluded.mode,external_user_id=excluded.external_user_id,display_name=excluded.display_name,state=excluded.state,error=excluded.error',[a.id,a.domain,a.mode,a.externalUserId,a.displayName,a.state,a.lastSyncAt,a.error]);
  execute(db,"INSERT INTO app_settings VALUES('active_kontur_account',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[a.id]);
}
function mergeMeetings(db:Database,keep:string,remove:string):void {
  mergeCrmLinks(db,keep,remove);
  for(const table of ['meeting_artifacts','transcript_segments']){
    execute(db,`UPDATE OR IGNORE ${table} SET meeting_id=? WHERE meeting_id=?`,[keep,remove]);
  }
  execute(db,'UPDATE meeting_participants SET meeting_id=? WHERE meeting_id=?',[keep,remove]);
  execute(db,'UPDATE meeting_source_ids SET meeting_id=? WHERE meeting_id=?',[keep,remove]);
  execute(db,'DELETE FROM meetings WHERE id=?',[remove]);
}
export function putKonturMeetings(db:Database,account:KonturAccount,items:TalkImport[]):void {
  const now=new Date().toISOString();
  for(const item of items){
    if(!item.recordingExternalId)throw new Error('Missing source identity');
    const aliases:[string,string][]=[['recording',item.recordingExternalId],...(item.meetingExternalId?[['meeting',item.meetingExternalId] as [string,string]]:[])];
    const found=aliases.flatMap(([kind,id])=>query(db,'SELECT meeting_id FROM meeting_source_ids WHERE account_id=? AND kind=? AND external_id=?',[account.id,kind,id]).map(r=>String(r.meeting_id)));
    const id=found[0]??`talk:${randomUUID()}`;
    for(const duplicate of new Set(found.slice(1)))if(duplicate!==id)mergeMeetings(db,id,duplicate);
    const old=query(db,'SELECT * FROM meetings WHERE id=?',[id])[0];
    if(!old) execute(db,"INSERT INTO meetings(id,external_id,title,started_at,duration_seconds,participants_json,matching_status,created_at,updated_at,source,account_id,integration_mode,external_meeting_id,external_recording_id) VALUES(?,?,?,?,?,?,'unlinked',?,?,'kontur_talk',?,?,?,?)",[id,item.recordingExternalId,item.title,item.startedAt??'',item.durationSeconds,'[]',now,now,account.id,account.mode,item.meetingExternalId,item.recordingExternalId]);
    // Missing source fields do not invent a meeting start from upload time.
    execute(db,'UPDATE meetings SET title=?,started_at=CASE WHEN ? IS NULL THEN started_at ELSE ? END,duration_seconds=COALESCE(?,duration_seconds),ended_at=COALESCE(?,ended_at),organizer=COALESCE(?,organizer),external_meeting_id=COALESCE(?,external_meeting_id),source_created_at=COALESCE(?,source_created_at),source_updated_at=COALESCE(?,source_updated_at),last_seen_at=?,synchronized_at=?,updated_at=?,integration_mode=? WHERE id=?',[item.title,item.startedAt,item.startedAt,item.durationSeconds,item.endedAt,item.organizer,item.meetingExternalId,item.sourceCreatedAt,item.sourceUpdatedAt,now,now,now,account.mode,id]);
    for(const [kind,external] of aliases)execute(db,'INSERT INTO meeting_source_ids VALUES(?,?,?,?) ON CONFLICT(account_id,kind,external_id) DO UPDATE SET meeting_id=excluded.meeting_id',[account.id,kind,external,id]);
    execute(db,'DELETE FROM meeting_participants WHERE meeting_id=? AND recording_id=?',[id,item.recordingExternalId]);
    for(const p of item.participants)execute(db,'INSERT INTO meeting_participants(id,meeting_id,recording_id,external_id,display_name,email,role,organizer,phone) VALUES(?,?,?,?,?,?,?,?,?)',[randomUUID(),id,item.recordingExternalId,p.externalId,p.displayName,p.email,p.role,p.organizer===null?null:p.organizer?1:0,p.phone??null]);
    for(const a of item.artifacts){
      const previous=query(db,'SELECT state FROM meeting_artifacts WHERE meeting_id=? AND recording_id=? AND type=?',[id,a.recordingId,a.type])[0];
      // A temporary missing artifact never erases previously downloaded text.
      if(previous?.state==='ready'&&a.state!=='ready'&&!a.suppressed)continue;
      execute(db,'INSERT INTO meeting_artifacts VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(meeting_id,recording_id,type) DO UPDATE SET state=excluded.state,external_id=excluded.external_id,version=excluded.version,generated_at=excluded.generated_at,text=excluded.text,sections_json=excluded.sections_json,source_url=excluded.source_url',[id,a.recordingId,a.type,a.state,a.externalId,a.version,a.generatedAt,a.text,JSON.stringify(a.sections),a.sourceUrl]);
      if(a.type==='transcript'&&a.state==='ready'){
        const incoming=item.segments.filter(s=>s.recordingId===a.recordingId);
        const stored=query(db,'SELECT * FROM transcript_segments WHERE meeting_id=? AND recording_id=? ORDER BY sequence',[id,a.recordingId]);
        const unchanged=stored.length===incoming.length&&incoming.every((s,i)=>{const old=stored[i];return old.external_id===s.externalId&&old.speaker_id===s.speakerId&&old.speaker_name===s.speakerName&&old.start_ms===s.startMs&&old.end_ms===s.endMs&&old.text===s.text;});
        if(!unchanged){const oldIds=new Map(stored.map(s=>[s.external_id?`external:${s.external_id}`:`sequence:${s.sequence}`,String(s.id)]));
          execute(db,'DELETE FROM transcript_segments WHERE meeting_id=? AND recording_id=?',[id,a.recordingId]);
          incoming.forEach((s,sequence)=>execute(db,'INSERT INTO transcript_segments VALUES(?,?,?,?,?,?,?,?,?,?)',[oldIds.get(s.externalId?`external:${s.externalId}`:`sequence:${sequence}`)??randomUUID(),id,s.recordingId,sequence,s.externalId,s.speakerId,s.speakerName,s.startMs,s.endMs,s.text]));
        }
      }
    }
    const states=query(db,'SELECT state FROM meeting_artifacts WHERE meeting_id=?',[id]).map(r=>String(r.state));
    const state:ArtifactState=states.includes('processing')?'processing':states.includes('failed')?'failed':states.includes('ready')?'ready':'not_available';
    execute(db,'UPDATE meetings SET processing_status=? WHERE id=?',[state,id]);
  }
  execute(db,"UPDATE kontur_accounts SET state='connected',last_sync_at=?,error=NULL WHERE id=?",[now,account.id]);
}
export function konturMeetings(db:Database,account:KonturAccount):Meeting[] {
  const rows=query(db,"SELECT * FROM meetings WHERE source='kontur_talk' AND account_id=? ORDER BY COALESCE(NULLIF(started_at,''),source_created_at) DESC,id",[account.id]);
  return rows.map(r=>{
    const crmLink=readLink(db,String(r.id));
    const artifacts=query(db,'SELECT type,state,source_url FROM meeting_artifacts WHERE meeting_id=?',[String(r.id)]);
    const artifactStates:NonNullable<Meeting['artifactStates']>={};
    const priority={not_available:0,failed:1,processing:2,ready:3};
    for(const a of artifacts){const type=String(a.type) as TalkArtifact['type'];const state=String(a.state) as ArtifactState;if(priority[state]>=(priority[artifactStates[type]??'not_available']))artifactStates[type]=state;}
    return {id:String(r.id),externalId:optional(r.external_id),dealId:crmLink.confirmed?.dealId??null,clientId:crmLink.confirmed?.clientId??null,crmLink,sourceSummaryPreview:query(db,"SELECT text,sections_json FROM meeting_artifacts WHERE meeting_id=? AND type='summary' AND state='ready' ORDER BY recording_id LIMIT 1",[String(r.id)]).map(a=>(JSON.parse(String(a.sections_json)).length?JSON.parse(String(a.sections_json)).map((v:{text:string})=>sourceRetellingText(v.text)).join(" "):sourceRetellingText(optional(a.text)??"")).slice(0,280))[0]??null,title:String(r.title),startedAt:String(r.started_at),durationSeconds:r.duration_seconds===null?null:Number(r.duration_seconds),participants:[...new Set(query(db,'SELECT display_name FROM meeting_participants WHERE meeting_id=?',[String(r.id)]).map(p=>String(p.display_name)))],summary:null,transcript:[],recordingUrl:optional(artifacts.find(a=>a.type==='recording')?.source_url),matchingStatus:crmLink.confirmed?'linked':crmLink.candidates.length?'review':'unlinked',createdAt:String(r.created_at),updatedAt:String(r.updated_at),source:'kontur_talk',integrationMode:r.integration_mode==='api'?'api':'session',externalMeetingId:optional(r.external_meeting_id),externalRecordingId:optional(r.external_recording_id),endedAt:optional(r.ended_at),organizer:optional(r.organizer),sourceCreatedAt:optional(r.source_created_at),sourceUpdatedAt:optional(r.source_updated_at),lastSeenAt:optional(r.last_seen_at),synchronizedAt:optional(r.synchronized_at),processingStatus:String(r.processing_status) as ArtifactState,artifactStates};
  });
}
export function meetingArtifacts(db:Database,id:string):MeetingArtifacts {
  return {participants:query(db,'SELECT DISTINCT external_id,display_name,email,phone,role,organizer FROM meeting_participants WHERE meeting_id=?',[id]).map(p=>({externalId:optional(p.external_id),displayName:String(p.display_name),email:optional(p.email),phone:optional(p.phone),role:optional(p.role),organizer:p.organizer===null?null:p.organizer===1})),artifacts:query(db,'SELECT * FROM meeting_artifacts WHERE meeting_id=? ORDER BY recording_id,type',[id]).map(a=>({recordingId:String(a.recording_id),type:String(a.type) as TalkArtifact['type'],state:String(a.state) as ArtifactState,externalId:optional(a.external_id),version:optional(a.version),generatedAt:optional(a.generated_at),text:optional(a.text),sections:JSON.parse(String(a.sections_json)) as TalkArtifact['sections'],sourceUrl:optional(a.source_url)}))};
}
export function transcriptPage(db:Database,id:string,offset:number,limit:number,search:string):TranscriptPage {
  if(typeof id!=='string'||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||typeof search!=='string'||search.length>500)throw new Error('Invalid transcript page');
  db.create_function('unicode_lower',value=>String(value??'').toLocaleLowerCase('ru-RU'));
  const params=[id,search];const where="meeting_id=? AND (?='' OR instr(unicode_lower(text),unicode_lower(?))>0)";
  const total=Number(query(db,`SELECT COUNT(*) AS n FROM transcript_segments WHERE ${where}`,[...params,search])[0].n);
  const segments=query(db,`SELECT * FROM transcript_segments WHERE ${where} ORDER BY recording_id,sequence LIMIT ? OFFSET ?`,[...params,search,Math.min(limit,200),offset]).map(r=>({id:String(r.id),meetingId:String(r.meeting_id),recordingId:String(r.recording_id),sequence:Number(r.sequence),externalId:optional(r.external_id),speakerId:optional(r.speaker_id),speakerName:String(r.speaker_name),startMs:r.start_ms===null?null:Number(r.start_ms),endMs:r.end_ms===null?null:Number(r.end_ms),text:String(r.text)}));
  return {segments,total,offset};
}
