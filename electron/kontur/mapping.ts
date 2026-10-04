import type {ArtifactState,TalkArtifact,TalkImport,TalkParticipant} from '../../src/domain/kontur.ts';
import {KonturError,sourceKey,sourceRecordingUrl} from './security.ts';
export type JsonObject=Record<string,unknown>;
export const object=(v:unknown):JsonObject=>{if(v===null||typeof v!=='object'||Array.isArray(v))throw new KonturError('schema','Формат данных Толка изменился. Обновление остановлено.');return v as JsonObject;};
const optionalObject=(v:unknown):JsonObject=>v===null||v===undefined?{}:object(v);
export const string=(v:unknown):string|null=>typeof v==='string'?v:null;
export const number=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
export const array=(v:unknown):unknown[]=>v===undefined||v===null?[]:Array.isArray(v)?v:(()=>{throw new KonturError('schema','Неверный формат списка Толка.');})();
export const date=(v:unknown):string|null=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
export function participant(value:unknown):TalkParticipant {
  const ref=object(value);const user=optionalObject(ref.userInfo??(ref.key?ref:null));
  const name=string(ref.anonymousName)??[user.firstname,user.surname,user.patronymic].filter(x=>typeof x==='string'&&x).join(' ');
  return {externalId:string(user.key)??string(ref.anonymousId),displayName:name||'Неизвестный участник',email:string(user.email),role:null,organizer:null};
}
export function readiness(v:unknown):ArtifactState {
  if(['success','complete'].includes(String(v)))return 'ready';
  if(['inProgress','processing','waiting','recording','recreateInProgress'].includes(String(v)))return 'processing';
  if(['failed','error','serviceError'].includes(String(v)))return 'failed';
  if(v===null||v===undefined||['notFound','notAvailable','cancelled'].includes(String(v)))return 'not_available';
  throw new KonturError('schema','Толк вернул неизвестный статус обработки. Обновление остановлено.');
}
function artifact(type:TalkArtifact['type'],recordingId:string,value:unknown):TalkArtifact {
  const dto=optionalObject(value);const hidden=dto.hidden===true;const sections=hidden?[]:array(dto.chunks).filter(x=>optionalObject(optionalObject(x).hiddenStatus).isHidden!==true).map(v=>{const c=object(v);return {type:string(c.type),text:string(c.text)??'',timestampMs:number(c.timestamp)===null?null:number(c.timestamp)!*1000,version:c.version===null||c.version===undefined?null:String(c.version)};});
  return {recordingId,type,state:hidden?'not_available':readiness(dto.status),suppressed:hidden,externalId:string(dto.summaryId??dto.transcriptId),version:sections.length?sections.map(s=>s.version??'').join('|'):null,generatedAt:null,text:sections.length?sections.map(s=>s.text).join('\n\n'):null,sections,sourceUrl:null};
}
// Official OpenAPI models; this mapper has no transport/auth assumptions.
export function normalizeRecording(metadata:unknown,composite:unknown,domain:string,sourceUrl:unknown=null):TalkImport {
  const r=object(metadata);const recordingId=sourceKey(r.key??r.id);const a=optionalObject(composite);const transcript=optionalObject(a.transcriptionV2);const transcripts=artifact('transcript',recordingId,transcript);
  const segments:TalkImport['segments']=[];
  if(transcripts.state==='ready')for(const trackValue of array(transcript.tracks)){
    const track=object(trackValue);
    for(const chunkValue of array(track.chunks)){const chunk=object(chunkValue);const person=participant(chunk.diarizedSpeaker??track.diarizedSpeaker??track.speaker??{});const text=string(chunk.text);if(text===null)throw new KonturError('schema','В транскрипции отсутствует текст сегмента.');
      segments.push({recordingId,externalId:string(chunk.chunkId),speakerId:person.externalId,speakerName:person.displayName,startMs:number(chunk.startTimeOffsetInMillis??chunk.timeOffsetInMillis),endMs:number(chunk.endTimeOffsetInMillis),text});
    }
  }
  segments.sort((x,y)=>(x.startMs??Infinity)-(y.startMs??Infinity));
  const recording:TalkArtifact={recordingId,type:'recording',state:readiness(r.status),externalId:recordingId,version:null,generatedAt:null,text:null,sections:[],sourceUrl:sourceRecordingUrl(sourceUrl,domain)};
  return {meetingExternalId:string(r.conferenceKey),recordingExternalId:recordingId,title:string(r.title)??'Встреча без названия',startedAt:date(r.startedAt),endedAt:date(r.endedAt),durationSeconds:number(r.duration),organizer:null,sourceCreatedAt:date(r.createdDate),sourceUpdatedAt:date(r.modifiedDate),participants:array(r.participants).map(participant),artifacts:[recording,transcripts,artifact('summary',recordingId,a.shortSummaryV2),artifact('protocol',recordingId,a.protocolV2)],segments};
}
