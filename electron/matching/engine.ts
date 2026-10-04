import type {Client,Deal} from '../../src/domain/models.ts';
import {activeDeal} from '../../src/domain/models.ts';
import type {CrmCache,CrmRecord} from '../../src/domain/crm.ts';
import type {MatchCandidate,MatchConfidence,MatchEvidence,MatchInput} from '../../src/domain/matching.ts';

export const normalizeText=(s:string):string=>s.toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
export const normalizeEmail=(s:string|null|undefined):string|null=>{const value=s?.trim().toLowerCase();return value&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)?value:null;};
export const normalizePhone=(s:string|null|undefined):string|null=>{if(!s||/[^\d\s+().-]/.test(s))return null;let digits=s.replace(/\D/g,'');if(digits.length===11&&digits[0]==='8')digits='7'+digits.slice(1);return digits.length>=10&&digits.length<=15?digits:null;};
export const normalizeCompany=(s:string):string=>normalizeText(s).replace(/^(?:ооо|ип|пао|ао)\s+/,'');
const genericCompany=new Set(['сервис','технологии','групп','компания','компани','group','service']);
const genericTitle=new Set(['встреча','созвон','новая запись','запись','meeting','обсуждение','проект','сделка','тест']);
const words=(s:string)=>normalizeText(s).split(' ').filter(Boolean);
function near(a:string,b:string):boolean {if(a.length<5||b.length<5||Math.abs(a.length-b.length)>1)return false;let errors=0,i=0,j=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++errors>1)return false;if(a[i]===b[j+1]&&a[i+1]===b[j]){i+=2;j+=2;}else if(a.length>b.length)i++;else if(a.length<b.length)j++;else{i++;j++;}}return errors+(i<a.length||j<b.length?1:0)<=1;}
export function comparePerson(a:string,b:string):'full'|'initials'|'fuzzy'|null {
  const left=words(a),right=words(b);if(left.length<2||right.length<2)return null;
  const common=left.filter(w=>w.length>1&&right.includes(w));
  if(common.length>=2)return 'full';
  if(common.length&&left.some(w=>w.length===1&&right.some(r=>r.length>1&&r.startsWith(w)))||common.length&&right.some(w=>w.length===1&&left.some(l=>l.length>1&&l.startsWith(w))))return 'initials';
  if(common.length&&left.some(l=>!right.includes(l)&&right.some(r=>!left.includes(r)&&near(l,r))))return 'fuzzy';
  return null;
}
export function fieldValues(r:CrmRecord,code:string):string[]{const fields=r.custom_fields_values;if(!Array.isArray(fields))return[];return fields.flatMap(f=>{if(!f||typeof f!=='object'||f.field_code!==code||!Array.isArray(f.values))return[];return f.values.flatMap((v:unknown)=>v&&typeof v==='object'&&'value'in v&&typeof v.value==='string'?[v.value]:[]);});}
type Entity={kind:'contact'|'company'|'deal';id:number;name:string;clientIds:Set<string>;dealIds:Set<string>};
type Hit={entity:Entity;evidence:MatchEvidence;weight:number;signal:string};
const confidence=(score:number,strong:boolean):MatchConfidence=>score>=80&&strong?'high':score>=40?'medium':'low';
export interface MatchingWorkspace {clients:Client[];deals:Deal[];crm:CrmCache}

/** Built once per local CRM revision. Text lookup visits known token anchors, not every CRM record. */
export class MatchingIndex {
  private entities:Entity[]=[];
  private tokens=new Map<string,Set<Entity>>();
  private phrases=new Map<string,Array<{entity:Entity;phrase:string}>>();
  private emails=new Map<string,Set<Entity>>();
  private phones=new Map<string,Set<Entity>>();
  private clients:Map<string,Client>;
  private deals:Map<string,Deal>;
  private dealsByClient=new Map<string,Deal[]>();
  private contactsByDeal=new Map<string,Array<{id:number;primary:boolean}>>();
  constructor(private workspace:MatchingWorkspace){
    this.clients=new Map(workspace.clients.map(c=>[c.id,c]));this.deals=new Map(workspace.deals.map(d=>[d.id,d]));
    const relations=workspace.crm.relations??[];
    const accessibleContacts=new Set(workspace.crm.contacts.filter(c=>c.cacheAvailability!=='unavailable'&&!c.is_deleted).map(c=>c.id));
    const byExternal=new Map(workspace.deals.filter(d=>d.availability!=='unavailable').map(d=>[Number(d.externalId),d]));
    const entityDeals=new Map<string,Set<string>>();
    for(const d of workspace.deals){const values=this.dealsByClient.get(d.clientId)??[];values.push(d);this.dealsByClient.set(d.clientId,values);}
    for(const r of relations){const d=byExternal.get(r.leadId);if(!d)continue;const key=`${r.entityType}:${r.entityId}`,ids=entityDeals.get(key)??new Set<string>();ids.add(d.id);entityDeals.set(key,ids);if(r.entityType==='contacts'&&accessibleContacts.has(r.entityId)){const values=this.contactsByDeal.get(d.id)??[];values.push({id:r.entityId,primary:r.primary});this.contactsByDeal.set(d.id,values);}}
    const add=(kind:Entity['kind'],r:CrmRecord,dealIds:Set<string>)=>{
      if(!dealIds.size||r.cacheAvailability==='unavailable'||r.is_deleted)return;
      const clientIds=new Set([...dealIds].flatMap(id=>this.deals.get(id)?.clientId??[]));
      const entity:Entity={kind,id:r.id,name:r.name??'',clientIds,dealIds};this.entities.push(entity);
      const name=kind==='company'?normalizeCompany(entity.name):normalizeText(entity.name);
      for(const token of words(name)){const set=this.tokens.get(token)??new Set<Entity>();set.add(entity);this.tokens.set(token,set);}
      const variants=kind==='contact'&&words(name).length>=2?[name,[...words(name)].reverse().join(' '),...(words(name).length===3?[words(name).slice(0,2).join(' '),[words(name)[1],words(name)[0]].join(' ')]:[])]:[name];
      for(const phrase of new Set(variants)){if(!phrase||kind==='contact'&&words(phrase).length<2)continue;const anchor=words(phrase)[0];const values=this.phrases.get(anchor)??[];values.push({entity,phrase});this.phrases.set(anchor,values);}
      if(kind!=='contact')return;
      for(const [index,values] of [[this.emails,fieldValues(r,'EMAIL').map(normalizeEmail)],[this.phones,fieldValues(r,'PHONE').map(normalizePhone)]] as const){for(const value of values){if(!value)continue;const entries=index.get(value)??new Set<Entity>();entries.add(entity);index.set(value,entries);}}
    };
    for(const kind of ['contact','company'] as const)for(const r of kind==='contact'?workspace.crm.contacts:workspace.crm.companies)add(kind,r,entityDeals.get(`${kind==='contact'?'contacts':'companies'}:${r.id}`)??new Set());
    for(const d of workspace.deals){if(d.availability==='unavailable')continue;add('deal',{id:Number(d.externalId),name:d.title},new Set([d.id]));}
  }
  match(input:MatchInput):MatchCandidate[]{
    if(!this.workspace.crm.account)return[];const hits:Hit[]=[];
    const evidence=(type:string,source:MatchEvidence['source'],description:string,weight:number,record:string|null=null,segment:string|null=null,timestamp:number|null=null):MatchEvidence=>({type,source,description,strength:weight>=55?'strong':weight>=20?'medium':'weak',sourceRecordId:record,transcriptSegmentId:segment,timestampMs:timestamp});
    for(const p of input.participants){
      const email=normalizeEmail(p.email),phone=normalizePhone(p.phone);
      for(const [index,key,type,label] of [[this.emails,email,'participant_email_exact','Совпал email участника'],[this.phones,phone,'participant_phone_exact','Совпал номер телефона']] as const){if(key)for(const entity of index.get(key)??[])hits.push({entity,weight:90,signal:type,evidence:evidence(type,'participant',label,90,p.recordingId??p.externalId)});}
      const possible=new Set(words(p.displayName).flatMap(t=>[...(this.tokens.get(t)??[])]));
      for(const entity of possible){if(entity.kind!=='contact')continue;const result=comparePerson(p.displayName,entity.name);if(!result)continue;const weight=result==='full'?40:result==='initials'?20:15;hits.push({entity,weight,signal:'participant_name',evidence:evidence('participant_name_match','participant',result==='full'?'Совпало полное имя участника':result==='initials'?'Совпали фамилия и инициалы':'Имя участника похоже; требуется проверка',weight,p.recordingId??p.externalId)});}
    }
    const scan=(text:string,source:'title'|'retelling'|'transcript',record:string|null,segment:string|null=null,timestamp:number|null=null)=>{
      const normalized=normalizeText(text);if(!normalized||source==='title'&&genericTitle.has(normalized))return;
      const found=new Set<Entity>();for(const token of new Set(words(normalized)))for(const entry of this.phrases.get(token)??[]){if(found.has(entry.entity)||!(` ${normalized} `).includes(` ${entry.phrase} `))continue;
        const {entity}=entry;found.add(entity);let weight=entity.kind==='company'?(source==='title'?65:source==='retelling'?35:30):entity.kind==='deal'?(source==='title'?75:source==='retelling'?65:55):20;
        if(entity.kind==='company'&&(genericCompany.has(entry.phrase)||entry.phrase.length<4)||entity.kind==='deal'&&(genericTitle.has(entry.phrase)||entry.phrase.length<5||/^сделка(?: \d+)?$/.test(entry.phrase)))weight=10;
        const type=`${entity.kind}_name_in_${source}`;const label=entity.kind==='company'?'Название компании':entity.kind==='deal'?'Название сделки':'Имя контакта';
        hits.push({entity,weight,signal:`${entity.kind}_text`,evidence:evidence(type,source,`${label} ${source==='title'?'есть в названии встречи':source==='retelling'?'упоминается в пересказе':'упоминается в разговоре'}`,weight,record,segment,timestamp)});
      }
    };
    scan(input.meeting.title,'title',input.meeting.id);
    for(const a of input.artifacts)if(a.type==='summary'&&a.state==='ready')scan([a.text??'',...a.sections.map(s=>s.text)].join('\n'),'retelling',a.recordingId);
    for(const s of input.segments)scan(s.text,'transcript',s.recordingId,s.id,s.startMs);
    const candidateClients=new Set(hits.flatMap(h=>[...h.entity.clientIds]));const candidates:MatchCandidate[]=[];
    const strongClients=new Set(hits.filter(h=>h.weight>=55).flatMap(h=>[...h.entity.clientIds]));
    if(hits.some(h=>h.signal==='participant_email_exact'||h.signal==='participant_phone_exact'))for(const h of hits.filter(h=>h.entity.kind==='company'&&h.weight>=30))for(const id of h.entity.clientIds)strongClients.add(id);
    // Multiple unrelated strong identities are a contradiction, not additive confidence.
    const conflict=strongClients.size>1;
    for(const clientId of candidateClients){const client=this.clients.get(clientId);if(!client)continue;
      const clientDeals=this.dealsByClient.get(clientId)??[];
      const relatedDeals=clientDeals.filter(d=>d.availability!=='unavailable'&&activeDeal(d));
      const explicitClosed=clientDeals.filter(d=>d.availability!=='unavailable'&&!activeDeal(d)&&hits.some(h=>h.entity.kind==='deal'&&h.weight>=55&&h.entity.dealIds.has(d.id)));
      const options: Array<Deal|null>=relatedDeals.length||explicitClosed.length?[...relatedDeals,...explicitClosed]:[null];
      for(const deal of options){
        const relevant=hits.filter(h=>h.entity.clientIds.has(clientId)&&(h.entity.kind!=='deal'||deal&&h.entity.dealIds.has(deal.id))&&(h.entity.kind!=='contact'||!deal||h.entity.dealIds.has(deal.id)));
        if(!relevant.length)continue;
        const byType=new Map<string,Hit>();for(const h of relevant){const key=`${h.evidence.type}:${h.entity.kind}:${h.entity.id}`;const old=byType.get(key);if(!old||h.weight>old.weight)byType.set(key,h);}
        const weights=new Map<string,number>();for(const h of byType.values())weights.set(h.signal,Math.max(weights.get(h.signal)??0,h.weight));
        // Strong identifiers for one person form one identity signal; repeated modalities do not inflate it.
        if(weights.has('participant_email_exact')&&weights.has('participant_phone_exact'))weights.delete('participant_phone_exact');
        const clientHits=[...byType.values()].filter(h=>h.entity.kind!=='deal');const strong=clientHits.some(h=>h.weight>=55)||relevant.some(h=>h.entity.kind==='deal'&&h.weight>=55);
        const clientWeights=new Map<string,number>();for(const h of clientHits)clientWeights.set(h.signal,Math.max(clientWeights.get(h.signal)??0,h.weight));
        if(clientWeights.has('participant_email_exact')&&clientWeights.has('participant_phone_exact'))clientWeights.delete('participant_phone_exact');
        const clientScore=Math.min(100,[...clientWeights.values()].reduce((a,b)=>a+b,0));
        const directDeal=relevant.some(h=>h.entity.kind==='deal'&&h.weight>=55);
        const reasons=[...byType.values()].map(h=>h.evidence);
        const active=deal&&activeDeal(deal);
        if(active){reasons.push(evidence('active_deal','crm','Сделка находится в работе',3,deal.id));if(relatedDeals.length===1)reasons.push(evidence('only_active_deal','crm','У клиента одна активная сделка',6,deal.id));}
        let score=Math.min(100,[...weights.values()].reduce((a,b)=>a+b,0)+(active?3:0)+(active&&relatedDeals.length===1?6:0));
        const ambiguous=relatedDeals.length>1&&!directDeal;if(ambiguous)score=Math.min(score,69);if(conflict){score=Math.min(score,39);reasons.push(evidence('conflicting_identity','crm','Сильные признаки указывают на разных клиентов. Проверьте связь вручную.',0));}
        const contact=relevant.filter(h=>h.entity.kind==='contact').sort((a,b)=>b.weight-a.weight||a.entity.id-b.entity.id)[0]?.entity;
        const relatedContacts=(deal?[deal]:clientDeals).flatMap(d=>this.contactsByDeal.get(d.id)??[]);
        const contactId=contact?.id??relatedContacts.find(r=>r.primary)?.id??relatedContacts[0]?.id??null;
        const contactLabel=contact?.name??this.workspace.crm.contacts.find(c=>c.id===contactId)?.name??null;
        candidates.push({key:`${clientId}|${deal?.id??''}|${contactId??''}`,crmAccountId:this.workspace.crm.account.id,clientId,contactId,companyId:client.companyId??null,dealId:deal?.id??null,clientLabel:client.companyName??client.name,contactLabel,companyLabel:client.companyName,dealLabel:deal?.title??null,stageLabel:deal?.stageName??null,score,confidence:confidence(score,strong),clientConfidence:confidence(conflict?39:clientScore,clientHits.some(h=>h.weight>=55)),dealConfidence:deal?confidence(score,directDeal||relatedDeals.length===1&&strong):null,needsReview:conflict||ambiguous,evidence:reasons.slice(0,20)});
      }
    }
    return candidates.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key)).slice(0,10);
  }
}
