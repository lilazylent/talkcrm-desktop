import type { AppSnapshot } from '../domain/models.ts';
import type { DesktopApi } from './contracts.ts';
import type {MeetingArtifacts,TranscriptSegment} from '../domain/kontur.ts';
import {MatchingIndex} from '../../electron/matching/engine.ts';
import {emptyCrmLink,type MatchCandidate} from '../domain/matching.ts';
import {previewWrite} from './previewWrites.ts';

let snapshot: AppSnapshot | null = null;
let preview:{snapshot:AppSnapshot;materials:MeetingArtifacts;segments:TranscriptSegment[];materialsByMeeting?:Record<string,MeetingArtifacts>}|null=null;
const load = async (): Promise<AppSnapshot> => {
  if (!snapshot) {
    if(import.meta.env.DEV&&['kontur','matching'].includes(new URLSearchParams(location.search).get('preview')??'')){
      const response=await fetch(new URLSearchParams(location.search).get('preview')==='matching'?'/matching-preview.json':'/kontur-preview.json');if(!response.ok)throw new Error('Preview fixture missing');preview=await response.json();snapshot=preview!.snapshot;return snapshot;
    }
    const response = await fetch('/demo-preview.json');
    if (!response.ok) throw new Error('Demo preview missing');
    snapshot = await response.json() as AppSnapshot;
  }
  return snapshot!;
};
const api: DesktopApi = {
  async findMeetingClients(id){const data=await load();if(!preview||!data.crm)throw new Error('Desktop required');const index=new MatchingIndex({...data,crm:data.crm});snapshot={...data,meetings:data.meetings.map(m=>{if(id&&m.id!==id||!id&&m.crmLink?.confirmed)return m;const materials=preview!.materialsByMeeting?.[m.id]??preview!.materials;const link=m.crmLink??emptyCrmLink(m.id);const candidates=index.match({meeting:m,...materials,segments:preview!.segments.filter(s=>s.meetingId===m.id)});return{...m,crmLink:{...link,candidates,status:link.confirmed?'confirmed':candidates.length?'proposed':'unlinked'},matchingStatus:link.confirmed?'linked':candidates.length?'review':'unlinked'};})};return snapshot;},
  async confirmMeetingClient(id,selection){const data=await load();if(!preview||!data.crm?.account)throw new Error('Desktop required');const client=data.clients.find(c=>c.id===selection.clientId)!;const deal=data.deals.find(d=>d.id===selection.dealId);snapshot={...data,meetings:data.meetings.map(m=>{if(m.id!==id)return m;const link=m.crmLink??emptyCrmLink(id);const proposed=link.candidates.find(c=>c.key===selection.candidateKey);const confirmed:MatchCandidate=proposed??{key:client.id,crmAccountId:data.crm!.account!.id,clientId:client.id,contactId:client.primaryContactId??null,companyId:client.companyId??null,dealId:deal?.id??null,clientLabel:client.companyName??client.name,companyLabel:client.companyName,contactLabel:client.name,dealLabel:deal?.title??null,stageLabel:deal?.stageName??null,score:0,confidence:'low',clientConfidence:'low',dealConfidence:null,needsReview:false,evidence:[]};return{...m,clientId:client.id,dealId:deal?.id??null,matchingStatus:'linked',crmLink:{...link,confirmed,status:'confirmed',warning:null,confirmedAt:new Date().toISOString(),confirmedByUser:'synthetic-preview',matchMethod:proposed?'candidate':'manual'}};})};return snapshot;},
  async unlinkMeetingClient(id){const data=await load();if(!preview)throw new Error('Desktop required');snapshot={...data,meetings:data.meetings.map(m=>m.id===id?{...m,crmLink:emptyCrmLink(id),clientId:null,dealId:null,matchingStatus:'unlinked'}:m)};return snapshot;},
  async getTranscriptLocation(id,segmentId){await load();const at=preview?.segments.filter(s=>s.meetingId===id).findIndex(s=>s.id===segmentId)??-1;if(at<0)throw new Error('Unavailable segment');return at;},
  getSnapshot: load,
  async setTaskCompleted(id, completed) { const data = await load(); snapshot = { ...data, tasks: data.tasks.map(task => task.id === id ? { ...task, completed } : task) }; return snapshot; },
  async updateProfile(displayName) { const data = await load(); snapshot = { ...data, profile: { ...data.profile, displayName } }; return snapshot; },
  async setSetting(key, value) { const data = await load(); snapshot = { ...data, settings: { ...data.settings, [key]: value } }; return snapshot; },
  async resetDemo() { snapshot = null; return load(); },
  async connectCrm(){return{ok:false,message:'Подключение доступно в установленном TalkCRM Desktop.'};},
  async openCrmBrowser(){return{ok:false,message:'Вход через браузер доступен в установленном TalkCRM Desktop.'};},
  async verifyCrmBrowser(){return{ok:false,message:'Проверка доступна в установленном TalkCRM Desktop.'};},
  async syncCrm(){return{ok:false,message:'Синхронизация доступна в установленном TalkCRM Desktop.'};},
  async disconnectCrm(){return{ok:false,message:'Подключение доступно в установленном TalkCRM Desktop.'};},
  async writeCrm(command){const data=await load();await new Promise(r=>setTimeout(r,450));const {snapshot:next,result}=previewWrite(data,command);snapshot=next;return result;},
  async refreshWorkspace(){await load();await new Promise(r=>setTimeout(r,500));return{ok:!!preview,message:preview?'Карточка обновлена (предпросмотр).':'Обновление доступно в установленном TalkCRM Desktop.'};},
  async getTimeline(){const data=await load();return{events:(data.crm as {events?:import('../domain/crm.ts').CrmRecord[]}|undefined)?.events??[],loadedAt:preview?new Date().toISOString():null,error:null};},
  async openKontur(){return{ok:false,message:'Вход доступен в установленном TalkCRM Desktop.'};},
  async connectKontur(){return{ok:false,message:'Подключение доступно в установленном TalkCRM Desktop.'};},
  async syncKontur(){return{ok:false,message:'Синхронизация доступна в установленном TalkCRM Desktop.'};},
  async disconnectKontur(){return{ok:false,message:'Подключение доступно в установленном TalkCRM Desktop.'};},
  async getMeetingArtifacts(id){await load();return preview?.materialsByMeeting?.[id]??preview?.materials??{participants:[],artifacts:[]};},
  async getTranscriptPage(id,offset,limit,search){await load();const segments=(preview?.segments??[]).filter(s=>s.meetingId===id&&s.text.toLocaleLowerCase('ru-RU').includes(search.toLocaleLowerCase('ru-RU')));return{segments:segments.slice(offset,offset+Math.min(limit,200)),total:segments.length,offset};},
  async openTalkRecording(){return{ok:false,message:'Запись доступна в установленном TalkCRM Desktop.'};},
  onKonturProgress(){return()=>{};},
  onSyncProgress(){return()=>{};}
};
export const getBrowserDemoApi = (): DesktopApi => api;
