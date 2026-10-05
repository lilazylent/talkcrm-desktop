import type { CrmAccount, CrmCache, CrmRecord, CrmRelation } from '../../src/domain/crm.ts';
import type { Client, Deal, Task } from '../../src/domain/models.ts';
import { CrmError, record } from './security.ts';
export const localId = (account: string, kind: string, id: number): string => `amocrm:${account}:${kind}:${id}`;
export const isoTime = (seconds: unknown): string => typeof seconds === 'number' && seconds > 0 && Number.isFinite(seconds) ? new Date(seconds*1000).toISOString() : '1970-01-01T00:00:00.000Z';
export const text = (value: unknown): string | null => typeof value === 'string' ? value : null;
export const phoneOrEmail = (entity: CrmRecord | undefined, code: string): string | null => {
  if (!Array.isArray(entity?.custom_fields_values)) return null;
  for (const value of entity.custom_fields_values) { const field=record(value); if (field.field_code !== code || !Array.isArray(field.values)) continue; for (const entry of field.values) { const item=record(entry); if (typeof item.value === 'string' && item.value) return item.value; } }
  return null;
};
export function projectRecord(entity: CrmRecord): CrmRecord {
  const keys=['id','name','text','created_at','updated_at','responsible_user_id','pipeline_id','status_id','price','closed_at','is_deleted','custom_fields_values','_embedded','params','note_type','entity_id','entity_type','complete_till','is_completed','task_type_id','type','code','sort','enums','is_required','is_predefined','color','result','group_id','is_api_only','required_statuses','is_computed','created_by','updated_by','first_name','last_name','account_id','duration'];
  return Object.fromEntries(keys.filter(key=>entity[key]!==undefined).map(key=>[key,entity[key]])) as CrmRecord;
}
export function mapWorkspace(account: CrmAccount, leads: CrmRecord[], cache: CrmCache, relations: CrmRelation[], taskRecords: CrmRecord[]): {clients: Client[]; deals: Deal[]; tasks: Task[]} {
  const clients = new Map<string,Client>(); const leadClients = new Map<number,string>();
  const owner = `Пользователь #${account.currentUserId}`;
  const stages = new Map<number,{name:string;pipeline:string}>();
  for (const pipeline of cache.pipelines) { const embedded=pipeline._embedded ? record(pipeline._embedded) : {}; if (!Array.isArray(embedded.statuses)) continue; for (const raw of embedded.statuses) {const stage=record(raw); if(typeof stage.id==='number') stages.set(stage.id,{name:text(stage.name)??`Этап #${stage.id}`,pipeline:pipeline.name??`Воронка #${pipeline.id}`});} }
  const deals: Deal[] = leads.map(lead=> {
    if (lead.responsible_user_id !== account.currentUserId) throw new CrmError('scope','В кэш попала сделка другого ответственного.');
    const related=relations.filter(r=>r.leadId===lead.id);
    const companyId=related.find(r=>r.entityType==='companies')?.entityId;
    const contactId=related.find(r=>r.entityType==='contacts'&&r.primary)?.entityId ?? related.find(r=>r.entityType==='contacts')?.entityId;
    const company=cache.companies.find(c=>c.id===companyId); const contact=cache.contacts.find(c=>c.id===contactId);
    // An inaccessible entity is not fabricated; a deal can have its own workspace.
    const clientId=company?localId(account.id,'company',company.id):contact?localId(account.id,'contact',contact.id):localId(account.id,'workspace',lead.id);
    leadClients.set(lead.id,clientId);
    const client: Client={id:clientId,externalId:company?String(company.id):contact?String(contact.id):null,source:'amocrm',primaryContactId:contact?.id??null,companyId:company?.id??null,availability:String(lead.cacheAvailability??'active'),name:contact?.name??(company?'Контакт не указан':lead.name??`Сделка #${lead.id}`),companyName:company?.name??null,phone:phoneOrEmail(contact,'PHONE')??phoneOrEmail(company,'PHONE'),email:phoneOrEmail(contact,'EMAIL')??phoneOrEmail(company,'EMAIL'),responsibleName:owner,createdAt:isoTime((company??contact??lead).created_at),updatedAt:isoTime((company??contact??lead).updated_at)};
    const existing=clients.get(clientId);
    const availability=existing?.availability==='active'||client.availability==='active'?'active':client.availability;
    if (!existing || contact) clients.set(clientId,{...client,availability});
    else existing.availability=availability;
    const stage=stages.get(Number(lead.status_id));
    return {remoteUpdatedAt:typeof lead.updated_at==='number'?lead.updated_at:null,source:'amocrm',pipelineId:Number(lead.pipeline_id),statusId:Number(lead.status_id),availability:String(lead.cacheAvailability??'active'),lastSeenAt:typeof lead.lastSeenAt==='string'?lead.lastSeenAt:undefined,closedAt:typeof lead.closed_at==='number'&&lead.closed_at>0?isoTime(lead.closed_at):null,id:localId(account.id,'lead',lead.id),externalId:String(lead.id),clientId,title:lead.name??`Сделка #${lead.id}`,pipelineName:stage?.pipeline??`Воронка #${lead.pipeline_id}`,stageName:lead.status_id===142?'Успешно реализовано':lead.status_id===143?'Закрыта и не реализована':stage?.name??`Этап #${lead.status_id}`,responsibleName:owner,amount:typeof lead.price==='number'?lead.price:null,currency:account.currency??null,createdAt:isoTime(lead.created_at),updatedAt:isoTime(lead.updated_at)};
  });
  const tasks: Task[]=taskRecords.filter(t=>t.responsible_user_id===account.currentUserId).map(t=>{
    const entityId=Number(t.entity_id); const lead=t.entity_type==='leads'?leads.find(l=>l.id===entityId):undefined;
    const relation=t.entity_type==='contacts'||t.entity_type==='companies'?relations.find(r=>r.entityType===t.entity_type&&r.entityId===entityId):undefined;
    const result=t.result&&typeof t.result==='object'?record(t.result).text:null;
    return {taskTypeId:typeof t.task_type_id==='number'?t.task_type_id:null,entityType:text(t.entity_type)??undefined,entityExternalId:Number.isSafeInteger(entityId)?entityId:undefined,resultText:typeof result==='string'?result:null,remoteUpdatedAt:typeof t.updated_at==='number'?t.updated_at:null,id:localId(account.id,'task',t.id),externalId:String(t.id),source:'amocrm',dealId:lead?localId(account.id,'lead',lead.id):null,clientId:leadClients.get(lead?.id??relation?.leadId??0)??null,title:text(t.text)??'Задача amoCRM',dueAt:typeof t.complete_till==='number'&&t.complete_till>0?isoTime(t.complete_till):null,completed:t.is_completed===true,createdAt:isoTime(t.created_at),updatedAt:isoTime(t.updated_at)};
  });
  return {clients:[...clients.values()],deals,tasks};
}
