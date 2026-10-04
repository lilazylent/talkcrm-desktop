import type {KonturTalkAdapter} from '../../src/services/contracts.ts';
import type {TalkImport} from '../../src/domain/kontur.ts';
import {array,date,normalizeRecording,object,participant,string} from './mapping.ts';
import {KonturError,sourceKey} from './security.ts';
export type TalkGet=(path:string)=>Promise<unknown>;
async function material(get:TalkGet,id:string):Promise<unknown>{try{return await get(`/api/recordings/v2/${id}/summary`);}catch(error){if(error instanceof KonturError&&(error.status===403||error.status===404))return{transcriptionV2:{status:'notAvailable'},shortSummaryV2:{status:'notAvailable'},protocolV2:{status:'notAvailable'}};throw error;}}
export interface TalkIdentity {externalUserId:string|null;displayName:string|null}
export type TalkAdapter=KonturTalkAdapter;
export class SessionTalkAdapter implements TalkAdapter {
  constructor(private domain:string,private get:TalkGet){}
  async identify():Promise<TalkIdentity>{const context=object(await this.get('/api/context'));const user=object(context.user);return{externalUserId:sourceKey(user.key),displayName:participant(user).displayName};}
  async fetchMeetings(start:string,end:string,progress?:(done:number,total:number)=>void):Promise<TalkImport[]> {
    const records=new Map<string,unknown>();
    let previousDate:string|null=null;let reachedOlder=false;
    for(let skip=0;skip<5000;skip+=100){const page=object(await this.get(`/api/recordings?skip=${skip}&top=100&initiator=false`));if(!Array.isArray(page.recordings))throw new KonturError('schema','Толк изменил формат списка записей.');const list=array(page.recordings);for(const raw of list){const r=object(raw);const created=date(r.createdDate);if(!created)throw new KonturError('schema','У записи отсутствует дата источника.');if(previousDate&&created>previousDate)throw new KonturError('pagination','Порядок списка записей Толка изменился. Обновление остановлено.');previousDate=created;if(created<start)reachedOlder=true;if(created>=start&&created<=end)records.set(sourceKey(r.id),r);}if(reachedOlder||list.length<100)break;if(skip===4900)throw new KonturError('limit','Доступно слишком много записей. Импорт остановлен без изменения кэша.');}
    const conferences=new Map<string,Record<string,unknown>>();
    for(const raw of array(await this.get('/api/conferencesHistory/recent'))){const c=object(object(raw).conference);conferences.set(sourceKey(c.key),c);}
    const result:TalkImport[]=[];
    for(const id of records.keys()){
      const metadata=await this.get(`/api/recordings/${id}`);const composite=await material(this.get,id);
      const item=normalizeRecording(metadata,composite,this.domain,`https://${this.domain}/recordings/${id}`);
      const conference=item.meetingExternalId?conferences.get(item.meetingExternalId):undefined;
      if(conference){item.startedAt=date(conference.startTime);item.endedAt=date(conference.endTime);if(item.startedAt&&item.endedAt&&item.endedAt>=item.startedAt)item.durationSeconds=(Date.parse(item.endedAt)-Date.parse(item.startedAt))/1000;}
      result.push(item);progress?.(result.length,records.size);
    }return result;
  }
}
export class ApiTalkAdapter implements TalkAdapter {
  constructor(private domain:string,private get:TalkGet){}
  async identify():Promise<TalkIdentity>{await this.get('/api/Domain/recordings/v2?top=1');return{externalUserId:null,displayName:this.domain};}
  async fetchMeetings(start:string,end:string,progress?:(done:number,total:number)=>void):Promise<TalkImport[]> {
    const records=new Map<string,unknown>();const cursors=new Set<string>();let cursor:string|null=null;
    for(let pageIndex=0;pageIndex<100;pageIndex++){
      const params=new URLSearchParams({startFrom:start,startTo:end,top:'100',orderMode:'byTimeNewFirst'});if(cursor)params.set('pageToken',cursor);
      const page=object(await this.get('/api/Domain/recordings/v2?'+params));if(!Array.isArray(page.entities))throw new KonturError('schema','Неверный формат списка записей API Толка.');for(const raw of array(page.entities)){const r=object(raw);records.set(sourceKey(r.key),r);}
      cursor=string(page.nextPageToken);if(!cursor)break;if(cursors.has(cursor)||pageIndex===99)throw new KonturError('pagination','Некорректная пагинация Толка.');cursors.add(cursor);
    }
    const result:TalkImport[]=[];for(const [id,metadata] of records){const composite=await material(this.get,id);const item=normalizeRecording(metadata,composite,this.domain,`https://${this.domain}/recordings/${id}`);const people:unknown[]=[];for(let skip=0;skip<5000;skip+=100){const dto=await this.get(`/api/Domain/recordings/${id}/participants?skip=${skip}&top=100`);const list=Array.isArray(dto)?dto:array(object(dto).entities);people.push(...list);if(list.length<100)break;if(skip===4900)throw new KonturError('limit','Слишком много участников записи.');}item.participants=people.map(participant);result.push(item);progress?.(result.length,records.size);}return result;
  }
}
