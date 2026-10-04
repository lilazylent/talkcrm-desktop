import type { CrmAccount, CrmRecord, CrmRelation, SyncBatch, SyncProgress } from '../../src/domain/crm.ts';
import { AmoClient } from './client.ts';
import { CrmError, positiveId, record, safeMessage } from './security.ts';
export async function collectSync(client: AmoClient, previous: CrmAccount, progress: (p: SyncProgress)=>void): Promise<SyncBatch> {
  const report=(stage:string,completed=0,total:number|null=null)=>progress({state:'running',stage,completed,total});
  report('Проверяем аккаунт');
  const dto=await client.get('/api/v4/account'); const currentUserId=positiveId(dto.current_user_id); const externalId=positiveId(dto.id);
  if (externalId!==previous.externalId) throw new CrmError('account','Ответ amoCRM относится к другому аккаунту.');
  const account={...previous,name:typeof dto.name==='string'?dto.name:previous.name,currentUserId,currency:typeof dto.currency==='string'?dto.currency:null};
  report('Загружаем воронки'); const pipelines=await client.all('/api/v4/leads/pipelines','pipelines');
  report('Загружаем ваши сделки'); let allLeads: CrmRecord[];
  try { allLeads=await client.all('/api/v4/leads','leads',{'with':'contacts','filter[responsible_user_id][0]':String(currentUserId)},count=>report('Загружаем ваши сделки',count)); }
  catch(error) { if (!(error instanceof CrmError) || ![400,422].includes(error.status??0)) throw error; allLeads=await client.all('/api/v4/leads','leads',{with:'contacts'},count=>report('Проверяем ответственных',count)); }
  for(const lead of allLeads)positiveId(lead.responsible_user_id);
  const leads=allLeads.filter(lead=>lead.responsible_user_id===currentUserId);
  const relations: CrmRelation[]=[];
  const add=(leadId:number,entityType:'contacts'|'companies',entityId:number,primary=false)=>{ if(!relations.some(r=>r.leadId===leadId&&r.entityType===entityType&&r.entityId===entityId)) relations.push({leadId,entityType,entityId,primary}); };
  for (const [index,lead] of leads.entries()) {
    const embedded=lead._embedded?record(lead._embedded):{};
    for (const kind of ['contacts','companies'] as const) if(Array.isArray(embedded[kind])) for(const raw of embedded[kind]) {const entity=record(raw);add(lead.id,kind,positiveId(entity.id),entity.is_main===true);}
    if (!Array.isArray(embedded.contacts) || !Array.isArray(embedded.companies)) {
      report('Проверяем связи сделок',index+1,leads.length);
      const links=await client.all(`/api/v4/leads/${lead.id}/links`,'links');
      for(const link of links) if(link.to_entity_type==='contacts'||link.to_entity_type==='companies') { const meta=link.metadata?record(link.metadata):{}; add(lead.id,link.to_entity_type,positiveId(link.to_entity_id),meta.main_contact===true); }
    }
  }
  report('Загружаем контакты и компании');
  const contactIds=[...new Set(relations.filter(r=>r.entityType==='contacts').map(r=>r.entityId))]; const companyIds=[...new Set(relations.filter(r=>r.entityType==='companies').map(r=>r.entityId))];
  const contacts=await client.byIds('contacts',contactIds); const companies=await client.byIds('companies',companyIds);
  const warnings:string[]=[];
  if(contactIds.some(id=>!contacts.some(c=>c.id===id))||companyIds.some(id=>!companies.some(c=>c.id===id))) warnings.push('Некоторые связанные контакты или компании недоступны.');
  const batch:SyncBatch={account,leads,contacts,companies,pipelines,relations,warnings};
  const optional=async(label:string,work:()=>Promise<void>)=>{report(label);try{await work();}catch(error){if(error instanceof CrmError&&(error.status===401||error.code.startsWith('oauth_')))throw error;warnings.push(`${label}: ${safeMessage(error)}`);} };
  await optional('Загружаем задачи',async()=>{let tasks:CrmRecord[];try{tasks=await client.all('/api/v4/tasks','tasks',{'filter[responsible_user_id][0]':String(currentUserId)});}catch(error){if(!(error instanceof CrmError)||![400,422].includes(error.status??0))throw error;tasks=await client.all('/api/v4/tasks','tasks');}batch.tasks=tasks.filter(t=>t.responsible_user_id===currentUserId);});
  await optional('Загружаем примечания',async()=>{const notes:CrmRecord[]=[];for(const [index,lead] of leads.entries()){report('Загружаем примечания',index+1,leads.length);for(const note of await client.all(`/api/v4/leads/${lead.id}/notes`,'notes'))notes.push({...note,entity_id:lead.id});}batch.notes=notes;});
  await optional('Загружаем пользовательские поля',async()=>{const fields:NonNullable<SyncBatch['fields']>=[];for(const entity of ['leads','contacts','companies'])for(const definition of await client.all(`/api/v4/${entity}/custom_fields`,'custom_fields'))fields.push({entity,definition});batch.fields=fields;});
  report('Сохраняем кэш'); return batch;
}
