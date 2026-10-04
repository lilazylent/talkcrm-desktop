import {useState} from 'react';
import {Link} from 'react-router-dom';
import {useApp} from '../App.tsx';
import type {Meeting} from '../domain/models.ts';
import {confidenceLabel,emptyCrmLink,type MatchCandidate,type MatchSelection} from '../domain/matching.ts';
import {formatTimestamp} from '../domain/kontur.ts';
import {Modal,Section} from './ui.tsx';

export function MeetingCrmMatch({meeting,onEvidence}:{meeting:Meeting;onEvidence:(segmentId:string)=>void}){
  const {data,busy,mutate}=useApp();const link=meeting.crmLink??emptyCrmLink(meeting.id);
  const [selector,setSelector]=useState(false),[unlink,setUnlink]=useState(false),[search,setSearch]=useState(''),[selection,setSelection]=useState<MatchSelection|null>(null),[finding,setFinding]=useState(false);
  const available=data.settings.data_mode==='amocrm'&&!!data.crm?.account;
  const choose=()=>{setSelection(null);setSearch('');setSelector(true);};
  const confirm=(value:MatchSelection)=>void mutate(async api=>{const result=await api.confirmMeetingClient(meeting.id,value);setSelector(false);return result;});
  const find=async()=>{setFinding(true);try{await mutate(api=>api.findMeetingClients(meeting.id));}finally{setFinding(false);}};
  const candidate=(c:MatchCandidate)=><div className="match-candidate" key={c.key}>
    <div className="match-candidate-head"><div><strong>{c.clientLabel}</strong><p>{c.contactLabel}{c.companyLabel?` · ${c.companyLabel}`:' · Компания не указана'}</p><p>{c.dealLabel??'Сделка не определена'}{c.stageLabel?` · ${c.stageLabel}`:''}</p></div><span className={`status confidence-${c.confidence}`}>{confidenceLabel(c.confidence)}</span></div>
    {c.dealId&&c.clientConfidence!==c.dealConfidence&&<p className="muted-cell">Клиент: {confidenceLabel(c.clientConfidence).toLowerCase()} · Сделка: {confidenceLabel(c.dealConfidence??'low').toLowerCase()}</p>}
    <ul className="match-reasons">{c.evidence.map((e,i)=><li key={i}>{e.transcriptSegmentId?<button className="text-link" onClick={()=>onEvidence(e.transcriptSegmentId!)}>{e.description}{e.timestampMs!==null?` · ${formatTimestamp(e.timestampMs)}`:''}</button>:e.description}</li>)}</ul>
    <button className="button primary" disabled={busy||!available} onClick={()=>confirm({clientId:c.clientId,dealId:c.dealId,contactId:c.contactId,candidateKey:c.key})}>Подтвердить связь</button>
  </div>;
  const relatedText=(clientId:string,dealId?:string)=>{const leads=data.deals.filter(d=>d.clientId===clientId&&(!dealId||d.id===dealId));const ids=new Set(data.crm?.relations?.filter(r=>r.entityType==='contacts'&&leads.some(d=>Number(d.externalId)===r.leadId)).map(r=>r.entityId));return data.crm?.contacts.filter(c=>ids.has(c.id)).map(c=>c.name??'').join(' ')??'';};
  const query=search.trim().toLocaleLowerCase('ru-RU').replace(/ё/g,'е');
  const contains=(value:string)=>value.toLocaleLowerCase('ru-RU').replace(/ё/g,'е').includes(query);
  const clients=data.clients.filter(c=>c.availability!=='unavailable'&&contains(`${c.companyName??''} ${c.name} ${c.email??''} ${c.phone??''} ${relatedText(c.id)} ${data.deals.filter(d=>d.clientId===c.id).map(d=>d.title).join(' ')}`));
  const deals=data.deals.filter(d=>d.availability!=='unavailable'&&contains(`${d.title} ${data.clients.find(c=>c.id===d.clientId)?.companyName??''} ${relatedText(d.clientId,d.id)}`));
  const selectedClient=data.clients.find(c=>c.id===selection?.clientId);
  return <Section title="Связь с CRM" action={<button className="button secondary" disabled={busy||!available} onClick={()=>void find()}>{finding?'Ищем клиента в CRM...':'Найти клиента'}</button>}>
    {!available&&<p className="muted-cell">Подключите amoCRM в настройках, чтобы выбрать клиента.</p>}
    {link.warning&&<p className="match-warning" role="alert">{link.warning}</p>}
    {link.confirmed?<><div className="confirmed-match"><span className="status status-linked">Связь подтверждена</span><h3>{link.confirmed.clientLabel}</h3><p>Контакт: {link.confirmed.contactLabel??'Не указан'}</p><p>Компания: {link.confirmed.companyLabel??'Не указана'}</p><p>Сделка: {link.confirmed.dealLabel??'Не выбрана'}</p>{link.confirmed.stageLabel&&<p>Этап: {data.deals.find(d=>d.id===link.confirmed?.dealId)?.stageName??link.confirmed.stageLabel}</p>}</div><div className="kontur-actions">{data.clients.some(c=>c.id===link.confirmed?.clientId)&&<Link className="button secondary" to={`/clients/${link.confirmed.clientId}`}>Открыть клиента</Link>}<button className="button secondary" disabled={busy||!available} onClick={choose}>Изменить связь</button><button className="button secondary" disabled={busy} onClick={()=>setUnlink(true)}>Убрать связь</button></div></>:<>
      {link.candidates.length?<><p>{link.candidates.length===1?`Похоже, это встреча с ${link.candidates[0].clientLabel}`:'Найдены возможные сделки'}</p><div className="match-candidates">{link.candidates.map(candidate)}</div><button className="button secondary" disabled={busy||!available} onClick={choose}>Выбрать другую</button></>:<><p>Не удалось определить клиента</p><button className="button primary" disabled={busy||!available} onClick={choose}>Выбрать вручную</button></>}
      <p className="muted-cell">Связь появится в карточке клиента после вашего подтверждения.</p>
    </>}
    {selector&&<Modal title="Выбрать клиента и сделку" onClose={()=>{if(!busy)setSelector(false);}}>
      <label className="match-search">Поиск по компании, контакту или сделке<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Название или имя"/></label>
      {selection&&selectedClient?<div className="match-selection"><strong>{selectedClient.companyName??selectedClient.name}</strong><p>{selectedClient.name}</p><label>Сделка<select aria-label="Сделка для встречи" value={selection.dealId??''} onChange={e=>setSelection({...selection,dealId:e.target.value||null})}><option value="">Только клиент, без сделки</option>{data.deals.filter(d=>d.clientId===selection.clientId&&d.availability!=='unavailable').map(d=><option value={d.id} key={d.id}>{d.title} · {d.stageName}</option>)}</select></label><button className="text-link" onClick={()=>setSelection(null)}>Выбрать другого клиента</button></div>:<div className="match-options"><h3>Клиенты · {clients.length}</h3>{clients.slice(0,30).map(c=><button className="match-option" key={c.id} onClick={()=>setSelection({clientId:c.id,dealId:null})}><strong>{c.companyName??c.name}</strong><span>{c.name}</span></button>)}<h3>Сделки · {deals.length}</h3>{deals.slice(0,30).map(d=><button className="match-option" key={d.id} onClick={()=>setSelection({clientId:d.clientId,dealId:d.id})}><strong>{d.title}</strong><span>{data.clients.find(c=>c.id===d.clientId)?.companyName??data.clients.find(c=>c.id===d.clientId)?.name} · {d.stageName}</span></button>)}{clients.length+deals.length===0&&<p>Совпадений нет. Измените запрос.</p>}{clients.length>30||deals.length>30?<p>Уточните поиск, чтобы увидеть остальные варианты.</p>:null}</div>}
      <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={()=>setSelector(false)}>Отмена</button><button className="button primary" disabled={busy||!selection} onClick={()=>selection&&confirm(selection)}>Подтвердить связь</button></div>
    </Modal>}
    {unlink&&<Modal title="Убрать связь с CRM?" onClose={()=>{if(!busy)setUnlink(false);}}><p>Встреча исчезнет из карточки клиента. Встреча, записи и данные amoCRM сохранятся.</p><div className="modal-actions"><button className="button secondary" disabled={busy} onClick={()=>setUnlink(false)}>Отмена</button><button className="button danger" disabled={busy} onClick={()=>void mutate(async api=>{const result=await api.unlinkMeetingClient(meeting.id);setUnlink(false);return result;})}>Убрать связь</button></div></Modal>}
  </Section>;
}
