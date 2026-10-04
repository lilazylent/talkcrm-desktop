import {randomUUID} from 'node:crypto';
import type {Database} from 'sql.js';
import {query,execute,crmSnapshot} from '../crmPersistence.ts';
import {konturMeetings,meetingArtifacts} from '../konturPersistence.ts';
import type {CrmAccount} from '../../src/domain/crm.ts';
import type {KonturAccount,TranscriptSegment} from '../../src/domain/kontur.ts';
import type {MeetingCrmLink,MatchCandidate,MatchSelection} from '../../src/domain/matching.ts';
import {emptyCrmLink} from '../../src/domain/matching.ts';
import {MatchingIndex} from './engine.ts';

export const hasMatching=(db:Database):boolean=>query(db,"SELECT name FROM sqlite_master WHERE name='meeting_crm_links'").length>0;
export function readLink(db:Database,meetingId:string):MeetingCrmLink {
  if(!hasMatching(db))return emptyCrmLink(meetingId);
  const r=query(db,'SELECT * FROM meeting_crm_links WHERE meeting_id=?',[meetingId])[0];
  return r?{meetingId,status:String(r.status) as MeetingCrmLink['status'],confirmed:r.confirmed_json?JSON.parse(String(r.confirmed_json)):null,candidates:JSON.parse(String(r.candidates_json)),confirmedAt:r.confirmed_at?String(r.confirmed_at):null,confirmedByUser:r.confirmed_by_user?String(r.confirmed_by_user):null,matchMethod:r.match_method as MeetingCrmLink['matchMethod'],updatedAt:String(r.updated_at),warning:r.warning?String(r.warning):null}:emptyCrmLink(meetingId);
}
function saveLink(db:Database,link:MeetingCrmLink):void {
  const c=link.confirmed,now=new Date().toISOString();
  execute(db,`INSERT INTO meeting_crm_links(id,meeting_id,crm_account_id,client_id,contact_id,company_id,deal_id,status,confidence,candidate_score,match_method,confirmed_by_user,confirmed_at,confirmed_json,candidates_json,warning,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(meeting_id) DO UPDATE SET crm_account_id=excluded.crm_account_id,client_id=excluded.client_id,contact_id=excluded.contact_id,company_id=excluded.company_id,deal_id=excluded.deal_id,status=excluded.status,confidence=excluded.confidence,candidate_score=excluded.candidate_score,match_method=excluded.match_method,confirmed_by_user=excluded.confirmed_by_user,confirmed_at=excluded.confirmed_at,confirmed_json=excluded.confirmed_json,candidates_json=excluded.candidates_json,warning=excluded.warning,updated_at=excluded.updated_at`,
  [randomUUID(),link.meetingId,c?.crmAccountId??null,c?.clientId??null,c?.contactId??null,c?.companyId??null,c?.dealId??null,link.status,c?.confidence??link.candidates[0]?.confidence??null,c?.score??null,link.matchMethod,link.confirmedByUser,link.confirmedAt,c?JSON.stringify(c):null,JSON.stringify(link.candidates),link.warning,now,now]);
}
export function recalculateLinks(db:Database,crmAccount:CrmAccount|null,talkAccount:KonturAccount|null,meetingId?:string,onlyUnconfirmed=false):number {
  if(!hasMatching(db)||!talkAccount)return 0;
  const cache=crmSnapshot(db,crmAccount),index=new MatchingIndex({...cache,crm:cache});
  const meetings=konturMeetings(db,talkAccount).filter(m=>!meetingId||m.id===meetingId);let processed=0;
  for(const meeting of meetings){
    if(onlyUnconfirmed&&readLink(db,meeting.id).confirmed)continue;
    const segments:TranscriptSegment[]=query(db,'SELECT * FROM transcript_segments WHERE meeting_id=? ORDER BY recording_id,sequence',[meeting.id]).map(r=>({id:String(r.id),meetingId:meeting.id,recordingId:String(r.recording_id),sequence:Number(r.sequence),externalId:r.external_id?String(r.external_id):null,speakerId:r.speaker_id?String(r.speaker_id):null,speakerName:String(r.speaker_name),startMs:r.start_ms===null?null:Number(r.start_ms),endMs:r.end_ms===null?null:Number(r.end_ms),text:String(r.text)}));
    const materials=meetingArtifacts(db,meeting.id);
    const participants=query(db,'SELECT * FROM meeting_participants WHERE meeting_id=? ORDER BY recording_id,id',[meeting.id]).map(r=>({externalId:r.external_id?String(r.external_id):null,recordingId:String(r.recording_id),displayName:String(r.display_name),email:r.email?String(r.email):null,phone:r.phone?String(r.phone):null,role:null,organizer:null}));
    const candidates=index.match({meeting,participants,artifacts:materials.artifacts,segments}),old=readLink(db,meeting.id);
    let warning=old.warning?.startsWith('Записи объединены')?old.warning:null;
    if(old.confirmed){
      const c=old.confirmed;
      const unavailable=crmAccount?.id!==c.crmAccountId||!cache.clients.some(client=>client.id===c.clientId&&client.availability!=='unavailable')||c.dealId&&!cache.deals.some(d=>d.id===c.dealId&&d.availability!=='unavailable')||c.contactId!==null&&!cache.contacts.some(contact=>contact.id===c.contactId&&contact.cacheAvailability!=='unavailable'&&!contact.is_deleted);
      const conflicting=candidates.some(p=>(p.clientId!==c.clientId||p.dealId&&p.dealId!==c.dealId)&&p.evidence.some(e=>e.strength==='strong'));
      if(unavailable)warning='Связанные клиент, контакт или сделка сейчас недоступны в CRM. Подтверждённая связь сохранена.';
      else if(conflicting&&!warning)warning='Появились новые данные. Возможно, связь стоит проверить.';
      saveLink(db,{...old,candidates,status:warning?'needs_review':'confirmed',warning});
    }else saveLink(db,{...old,candidates,status:candidates.length?(candidates.some(c=>c.needsReview)?'needs_review':'proposed'):'unlinked',warning:null});
    processed++;
  }
  return processed;
}
function history(db:Database,old:MeetingCrmLink,action:string,actor:string):void {execute(db,'INSERT INTO meeting_crm_link_history VALUES(?,?,?,?,?,?)',[randomUUID(),old.meetingId,action,JSON.stringify(old),actor,new Date().toISOString()]);}
export function confirmLink(db:Database,meetingId:string,selection:MatchSelection,account:CrmAccount|null):void {
  if(!selection||typeof selection.clientId!=='string'||selection.clientId.length>200||selection.dealId!==null&&typeof selection.dealId!=='string'||selection.contactId!==undefined&&selection.contactId!==null&&!Number.isSafeInteger(selection.contactId)||selection.candidateKey!==undefined&&typeof selection.candidateKey!=='string')throw new Error('Invalid selection');
  const cache=crmSnapshot(db,account),client=cache.clients.find(c=>c.id===selection.clientId&&c.availability!=='unavailable');
  if(!account||!client)throw new Error('Client unavailable');
  const deal=selection.dealId?cache.deals.find(d=>d.id===selection.dealId&&d.clientId===client.id&&d.availability!=='unavailable'):null;
  if(selection.dealId&&!deal)throw new Error('Deal outside client scope');
  const accessibleContacts=new Set(cache.contacts.filter(c=>c.cacheAvailability!=='unavailable'&&!c.is_deleted).map(c=>c.id));
  const relations=cache.relations?.filter(r=>r.entityType==='contacts'&&accessibleContacts.has(r.entityId)&&cache.deals.some(d=>d.availability!=='unavailable'&&d.clientId===client.id&&(!deal||d.id===deal.id)&&Number(d.externalId)===r.leadId))??[];
  const contactId=selection.contactId!==undefined?selection.contactId:relations.find(r=>r.primary)?.entityId??relations[0]?.entityId??null;
  const contact=cache.contacts.find(c=>c.id===contactId&&accessibleContacts.has(c.id));
  if(contactId!==null&&(!contact||!relations.some(r=>r.entityId===contactId)))throw new Error('Contact outside selection scope');
  const old=readLink(db,meetingId),candidate=selection.candidateKey?old.candidates.find(c=>c.key===selection.candidateKey):null;
  if(selection.candidateKey&&(!candidate||candidate.clientId!==client.id||candidate.dealId!==(deal?.id??null)||candidate.contactId!==contactId||candidate.crmAccountId!==account.id))throw new Error('Stale candidate');
  const now=new Date().toISOString(),actor=`amocrm:${account.id}:user:${account.currentUserId}`;
  const confirmed:MatchCandidate={key:candidate?.key??`${client.id}|${deal?.id??''}|${contactId??''}`,crmAccountId:account.id,clientId:client.id,contactId,companyId:client.companyId??null,dealId:deal?.id??null,clientLabel:client.companyName??client.name,contactLabel:contact?.name??null,companyLabel:client.companyName,dealLabel:deal?.title??null,stageLabel:deal?.stageName??null,score:candidate?.score??0,confidence:candidate?.confidence??'low',clientConfidence:candidate?.clientConfidence??'low',dealConfidence:deal?candidate?.dealConfidence??'low':null,needsReview:false,evidence:candidate?.evidence??[]};
  history(db,old,old.confirmed?'reassign':'confirm',actor);
  saveLink(db,{...old,confirmed,status:'confirmed',matchMethod:candidate?'candidate':'manual',confirmedAt:now,confirmedByUser:actor,updatedAt:now,warning:null});
}
export function unlinkMeeting(db:Database,meetingId:string,account:CrmAccount|null):void {
  const old=readLink(db,meetingId);history(db,old,'unlink',account?`amocrm:${account.id}:user:${account.currentUserId}`:'local-user');saveLink(db,emptyCrmLink(meetingId));
}
export function mergeCrmLinks(db:Database,keep:string,remove:string):void {
  if(!hasMatching(db))return;
  const a=readLink(db,keep),b=readLink(db,remove);
  execute(db,'UPDATE meeting_crm_link_history SET meeting_id=? WHERE meeting_id=?',[keep,remove]);
  if(b.confirmed&&!a.confirmed)saveLink(db,{...b,meetingId:keep});
  else if(a.confirmed&&b.confirmed&&(a.confirmed.clientId!==b.confirmed.clientId||a.confirmed.dealId!==b.confirmed.dealId)){
    history(db,{...b,meetingId:keep},'merge_conflict',b.confirmedByUser??'local-user');
    saveLink(db,{...a,status:'needs_review',warning:'Записи объединены: ранее были подтверждены разные связи. Проверьте выбранную сделку.'});
  }
}
