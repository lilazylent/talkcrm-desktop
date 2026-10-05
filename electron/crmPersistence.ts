import { randomUUID } from 'node:crypto';
import type { Database, SqlValue } from 'sql.js';
import type { CrmAccount, CrmCache, CrmRecord, CrmRelation, SyncBatch, SyncState } from '../src/domain/crm.ts';
import { localId, mapWorkspace, projectRecord } from './amocrm/mapping.ts';
type Row=Record<string,SqlValue>;
export function query(db:Database,sql:string,params:SqlValue[]=[]):Row[]{const s=db.prepare(sql);try{s.bind(params);const result:Row[]=[];while(s.step())result.push(s.getAsObject());return result;}finally{s.free();}}
export function execute(db:Database,sql:string,params:SqlValue[]=[]):void{const s=db.prepare(sql);try{s.run(params);}finally{s.free();}}
export const hasTable=(db:Database,name:string):boolean=>query(db,"SELECT name FROM sqlite_master WHERE type='table' AND name=?",[name]).length===1;
export function accountFromRow(r:Row):CrmAccount{return{id:String(r.id),externalId:Number(r.external_id),domain:String(r.domain),name:String(r.name),currentUserId:Number(r.current_user_id),authorized:r.authorized===1,expiresAt:Number(r.expires_at),lastSyncAt:r.last_sync_at?String(r.last_sync_at):null,state:String(r.state) as SyncState,error:r.error?String(r.error):null,currency:r.currency?String(r.currency):null,authMode:r.auth_mode==='browser'?'browser':'oauth'};}
export function saveAccount(db:Database,a:CrmAccount):void{execute(db,'INSERT INTO crm_accounts(id,external_id,domain,name,current_user_id,authorized,expires_at,last_sync_at,state,error,currency,auth_mode) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,current_user_id=excluded.current_user_id,authorized=excluded.authorized,expires_at=excluded.expires_at,last_sync_at=excluded.last_sync_at,state=excluded.state,error=excluded.error,currency=excluded.currency,auth_mode=excluded.auth_mode',[a.id,a.externalId,a.domain,a.name,a.currentUserId,a.authorized?1:0,a.expiresAt,a.lastSyncAt,a.state,a.error,a.currency??null,a.authMode??'oauth']);}
export function crmSnapshot(db:Database,account:CrmAccount|null):CrmCache & ReturnType<typeof mapWorkspace>{
  const empty={account,contacts:[],companies:[],pipelines:[],notes:[],fields:[],clients:[],deals:[],tasks:[]};if(!account)return empty;
  const records=(kind:string)=>query(db,'SELECT payload_json,availability,last_seen_at FROM crm_entities WHERE account_id=? AND kind=? ORDER BY external_updated_at DESC',[account.id,kind]).map(r=>({...JSON.parse(String(r.payload_json)),cacheAvailability:r.availability,lastSeenAt:r.last_seen_at}) as CrmRecord);
  const editableNotes=hasTable(db,'crm_operations')?query(db,"SELECT entity_type,result_external_id FROM crm_operations WHERE account_id=? AND operation_type='note.create' AND status='confirmed' AND result_external_id IS NOT NULL",[account.id]).map(r=>`${r.entity_type}:${r.result_external_id}`):[];
  const fieldGroups=hasTable(db,'crm_field_groups')?query(db,'SELECT * FROM crm_field_groups WHERE account_id=? ORDER BY sort',[account.id]).map(r=>({entity:String(r.entity),id:String(r.group_id),name:String(r.name),sort:Number(r.sort)})):[];
  const cache:CrmCache={account,editableNotes,fieldGroups,taskTypes:records('task_type'),contactNotes:records('contact_note'),companyNotes:records('company_note'),contacts:records('contact'),companies:records('company'),pipelines:records('pipeline'),notes:records('note'),fields:query(db,'SELECT entity,payload_json FROM crm_fields WHERE account_id=?',[account.id]).map(r=>({entity:String(r.entity),definition:JSON.parse(String(r.payload_json)) as CrmRecord}))};
  const relations:CrmRelation[]=query(db,'SELECT * FROM crm_relations WHERE account_id=?',[account.id]).map(r=>({leadId:Number(r.lead_id),entityId:Number(r.entity_id),entityType:String(r.entity_type) as CrmRelation['entityType'],primary:r.is_primary===1}));
  const leads=records('lead').filter(l=>l.responsible_user_id===account.currentUserId);
  return {...cache,leads,relations,...mapWorkspace(account,leads,cache,relations,records('task'))};
}
export function commitSync(db:Database,b:SyncBatch,runId:string):void{
  const now=new Date().toISOString();db.run('BEGIN');
  try {
    const put=(kind:string,items:CrmRecord[])=>{execute(db,"UPDATE crm_entities SET availability='unavailable' WHERE account_id=? AND kind=?",[b.account.id,kind]);for(const item of items)execute(db,"INSERT INTO crm_entities VALUES(?,?,?,?,?,?,?,'active') ON CONFLICT(account_id,kind,external_id) DO UPDATE SET payload_json=excluded.payload_json,external_updated_at=excluded.external_updated_at,last_seen_at=excluded.last_seen_at,availability='active'",[b.account.id,kind,item.id,localId(b.account.id,kind,item.id),JSON.stringify(projectRecord(item)),typeof item.updated_at==='number'?item.updated_at:null,now]);};
    put('lead',b.leads);put('contact',b.contacts);put('company',b.companies);put('pipeline',b.pipelines);
    // Replace relations only for leads returned in this complete scope; missing leads retain their historical links.
    for(const lead of b.leads)execute(db,'DELETE FROM crm_relations WHERE account_id=? AND lead_id=?',[b.account.id,lead.id]);
    for(const r of b.relations)execute(db,'INSERT INTO crm_relations VALUES(?,?,?,?,?)',[b.account.id,r.leadId,r.entityType,r.entityId,r.primary?1:0]);
    if(b.tasks)put('task',b.tasks);if(b.notes)put('note',b.notes);if(b.contactNotes)put('contact_note',b.contactNotes);if(b.companyNotes)put('company_note',b.companyNotes);if(b.taskTypes)put('task_type',b.taskTypes);
    if(b.fieldGroups&&hasTable(db,'crm_field_groups')){execute(db,'DELETE FROM crm_field_groups WHERE account_id=?',[b.account.id]);for(const g of b.fieldGroups)execute(db,'INSERT OR REPLACE INTO crm_field_groups VALUES(?,?,?,?,?)',[b.account.id,g.entity,g.id,g.name,g.sort]);}
    if(b.fields){execute(db,'DELETE FROM crm_fields WHERE account_id=?',[b.account.id]);for(const f of b.fields)execute(db,'INSERT INTO crm_fields VALUES(?,?,?,?)',[b.account.id,f.entity,f.definition.id,JSON.stringify(projectRecord(f.definition))]);}
    saveAccount(db,{...b.account,lastSyncAt:now,state:b.warnings.length?'partial_error':'success',error:b.warnings.join('\n')||null});
    execute(db,'UPDATE sync_runs SET finished_at=?,state=?,warnings_json=?,counts_json=? WHERE id=?',[now,b.warnings.length?'partial_error':'success',JSON.stringify(b.warnings),JSON.stringify({leads:b.leads.length,contacts:b.contacts.length,companies:b.companies.length,tasks:b.tasks?.length??null}),runId]);db.run('COMMIT');
  }catch(error){db.run('ROLLBACK');throw error;}
}
export function beginSync(db:Database,accountId:string):string{const id=randomUUID();execute(db,'INSERT INTO sync_runs(id,account_id,started_at,state) VALUES(?,?,?,?)',[id,accountId,new Date().toISOString(),'running']);execute(db,"UPDATE crm_accounts SET state='running',error=NULL WHERE id=?",[accountId]);return id;}


const putOne=(db:Database,accountId:string,kind:string,item:CrmRecord,now:string)=>execute(db,"INSERT INTO crm_entities VALUES(?,?,?,?,?,?,?,'active') ON CONFLICT(account_id,kind,external_id) DO UPDATE SET payload_json=excluded.payload_json,external_updated_at=excluded.external_updated_at,last_seen_at=excluded.last_seen_at,availability='active'",[accountId,kind,item.id,localId(accountId,kind,item.id),JSON.stringify(projectRecord(item)),typeof item.updated_at==='number'?item.updated_at:null,now]);
/** Replaces one cached entity with the version amoCRM returned after a confirmed write. */
export function upsertEntity(db:Database,accountId:string,kind:string,item:CrmRecord):void{putOne(db,accountId,kind,item,new Date().toISOString());}
export interface ScopedBatch {leads:CrmRecord[];contacts:CrmRecord[];companies:CrmRecord[];tasks:CrmRecord[];notes:CrmRecord[];contactNotes:CrmRecord[];companyNotes:CrmRecord[];relations:CrmRelation[]}
/** Entity-level refresh for one workspace. Unlike a full sync it never marks unrelated records unavailable. */
export function upsertScoped(db:Database,accountId:string,b:ScopedBatch):void{
  const now=new Date().toISOString();db.run('BEGIN');
  try{
    for(const [kind,items] of [['lead',b.leads],['contact',b.contacts],['company',b.companies],['task',b.tasks],['note',b.notes],['contact_note',b.contactNotes],['company_note',b.companyNotes]] as const)for(const item of items)putOne(db,accountId,kind,item,now);
    for(const lead of b.leads){execute(db,'DELETE FROM crm_relations WHERE account_id=? AND lead_id=?',[accountId,lead.id]);for(const r of b.relations.filter(x=>x.leadId===lead.id))execute(db,'INSERT INTO crm_relations VALUES(?,?,?,?,?)',[accountId,r.leadId,r.entityType,r.entityId,r.primary?1:0]);}
    db.run('COMMIT');
  }catch(error){db.run('ROLLBACK');throw error;}
}
