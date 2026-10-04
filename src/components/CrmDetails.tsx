import { useApp } from '../App.tsx';
import type { CrmRecord } from '../domain/crm.ts';
import { formatDate } from '../domain/models.ts';
import { Section, EmptyState } from './ui.tsx';
export const noteText=(note:CrmRecord|undefined):string=>{const p=note?.params;if(p&&typeof p==='object'&&'text'in p&&typeof p.text==='string')return p.text;return typeof note?.text==='string'?note.text:note?`Примечание: ${String(note.note_type??'событие')}`:'—';};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
export function CrmDetails({clientId}:{clientId:string}){
  const {data}=useApp();const crm=data.crm;if(data.settings.data_mode!=='amocrm'||!crm)return null;
  const dealIds=new Set(data.deals.filter(d=>d.clientId===clientId).map(d=>Number(d.externalId)));
  const relations=crm.relations?.filter(r=>dealIds.has(r.leadId))??[];
  const contacts=crm.contacts.filter(c=>relations.some(r=>r.entityType==='contacts'&&r.entityId===c.id));const companies=crm.companies.filter(c=>relations.some(r=>r.entityType==='companies'&&r.entityId===c.id));const leads=crm.leads?.filter(l=>dealIds.has(l.id))??[];
  const notes=crm.notes.filter(n=>dealIds.has(Number(n.entity_id))).sort((a,b)=>Number(b.created_at??0)-Number(a.created_at??0));
  const entities=[...leads.map(value=>({kind:'leads',value})),...contacts.map(value=>({kind:'contacts',value})),...companies.map(value=>({kind:'companies',value}))];
  return <><Section title="Связанные контакты и компании"><div className="stack">{[...companies,...contacts].map(entity=><div className="simple-row" key={`${companies.includes(entity)?'company':'contact'}:${entity.id}`}><div className="grow"><strong>{entity.name??`#${entity.id}`}</strong><small>{companies.includes(entity)?'Компания':'Контакт'} · amoCRM #{entity.id}{entity.cacheAvailability==='unavailable'?' · Нет в последней синхронизации':''}</small></div></div>)}</div>{!contacts.length&&!companies.length&&<EmptyState title="Контакты и компании не привязаны"/>}</Section>
    <Section title="Примечания amoCRM">{notes.length?<div className="crm-notes">{notes.slice(0,20).map(n=><div key={n.id}><small>{formatDate(typeof n.created_at==='number'?new Date(n.created_at*1000).toISOString():null)} · Сделка #{String(n.entity_id)}</small><p>{noteText(n)}</p></div>)}{notes.length>20&&<small>Показаны последние 20 из {notes.length} сохранённых примечаний.</small>}</div>:<EmptyState title="Примечаний пока нет"/>}</Section>
    <Section title="Пользовательские поля amoCRM">{entities.map(({kind,value})=><div className="crm-fields" key={`${kind}:${value.id}`}><h3>{value.name??`#${value.id}`}</h3>{Array.isArray(value.custom_fields_values)&&value.custom_fields_values.length?value.custom_fields_values.map((raw,index)=>{const field=object(raw);const definition=crm.fields.find(f=>f.entity===kind&&f.definition.id===field.field_id)?.definition;const values=Array.isArray(field.values)?field.values.map(entry=>{const v=object(entry).value;return typeof v==='object'?JSON.stringify(v):String(v??'—');}).join(', '):'—';return <div className="setting-line" key={index}><span>{String(field.field_name??definition?.name??field.field_code??`Поле #${field.field_id}`)}</span><strong>{values}</strong></div>;}):<p className="muted-copy">Нет заполненных полей</p>}</div>)}</Section></>;
}
