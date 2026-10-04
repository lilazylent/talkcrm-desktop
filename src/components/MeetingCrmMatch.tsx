import {useState} from 'react';
import {Link} from 'react-router-dom';
import {AtSign, BriefcaseBusiness, Building2, CircleAlert, CircleCheck, FileText, Link2, MessageSquareQuote, Search, Sparkles, UserRound, Wand2, type LucideIcon} from 'lucide-react';
import {useApp} from '../App.tsx';
import type {Meeting} from '../domain/models.ts';
import {confidenceLabel,emptyCrmLink,type MatchCandidate,type MatchEvidence,type MatchSelection} from '../domain/matching.ts';
import {formatTimestamp} from '../domain/kontur.ts';
import {Avatar,Badge,Modal,Notice,StageBadge,type Tone} from './ui.tsx';

const confidenceTone:Record<string,Tone>={high:'success',medium:'warning',low:'neutral'};
const sourceIcon:Record<MatchEvidence['source'],LucideIcon>={participant:AtSign,title:FileText,retelling:Sparkles,transcript:MessageSquareQuote,crm:BriefcaseBusiness};
export function MeetingCrmMatch({meeting,onEvidence}:{meeting:Meeting;onEvidence:(segmentId:string)=>void}){
  const {data,busy,mutate}=useApp();const link=meeting.crmLink??emptyCrmLink(meeting.id);
  const [selector,setSelector]=useState(false),[unlink,setUnlink]=useState(false),[search,setSearch]=useState(''),[selection,setSelection]=useState<MatchSelection|null>(null),[finding,setFinding]=useState(false);
  const available=data.settings.data_mode==='amocrm'&&!!data.crm?.account;
  const choose=()=>{setSelection(null);setSearch('');setSelector(true);};
  const confirm=(value:MatchSelection)=>void mutate(async api=>{const result=await api.confirmMeetingClient(meeting.id,value);setSelector(false);return result;});
  const find=async()=>{setFinding(true);try{await mutate(api=>api.findMeetingClients(meeting.id));}finally{setFinding(false);}};
  const candidate=(c:MatchCandidate)=><div className="match-candidate" key={c.key}>
    <div className="match-candidate-head"><Avatar name={c.clientLabel}/><div className="grow"><strong>{c.clientLabel}</strong><small>{c.contactLabel}{c.companyLabel&&c.companyLabel!==c.clientLabel?` · ${c.companyLabel}`:c.companyLabel?'':' · Компания не указана'}</small></div></div>
    <div className="match-score"><Badge tone={confidenceTone[c.confidence]} dot small>{confidenceLabel(c.confidence)}</Badge><span className="score-track" aria-hidden="true"><span className={`score-fill ${c.confidence}`} style={{width:`${Math.max(4,Math.min(100,c.score))}%`}}/></span></div>
    <div className="match-deal"><BriefcaseBusiness size={15}/><span className="grow">{c.dealLabel??'Сделка не определена'}</span>{c.stageLabel&&<StageBadge stage={c.stageLabel}/>}</div>
    {c.dealId&&c.clientConfidence!==c.dealConfidence&&<p className="match-split">Клиент: {confidenceLabel(c.clientConfidence).toLowerCase()} · Сделка: {confidenceLabel(c.dealConfidence??'low').toLowerCase()}</p>}
    <div className="match-reasons"><span className="eyebrow">На чём основано</span><ul>{c.evidence.map((e,i)=>{const Icon=sourceIcon[e.source]??Link2;return <li key={i} className={`strength-${e.strength}`}><Icon size={14}/>{e.transcriptSegmentId?<button className="evidence-link" onClick={()=>onEvidence(e.transcriptSegmentId!)}>{e.description}{e.timestampMs!==null?` · ${formatTimestamp(e.timestampMs)}`:''}</button>:<span>{e.description}</span>}</li>;})}</ul></div>
    <button className="btn btn-primary btn-block" disabled={busy||!available} onClick={()=>confirm({clientId:c.clientId,dealId:c.dealId,contactId:c.contactId,candidateKey:c.key})}><CircleCheck size={16}/>Подтвердить связь</button>
  </div>;
  const relatedText=(clientId:string,dealId?:string)=>{const leads=data.deals.filter(d=>d.clientId===clientId&&(!dealId||d.id===dealId));const ids=new Set(data.crm?.relations?.filter(r=>r.entityType==='contacts'&&leads.some(d=>Number(d.externalId)===r.leadId)).map(r=>r.entityId));return data.crm?.contacts.filter(c=>ids.has(c.id)).map(c=>c.name??'').join(' ')??'';};
  const query=search.trim().toLocaleLowerCase('ru-RU').replace(/ё/g,'е');
  const contains=(value:string)=>value.toLocaleLowerCase('ru-RU').replace(/ё/g,'е').includes(query);
  const clients=data.clients.filter(c=>c.availability!=='unavailable'&&contains(`${c.companyName??''} ${c.name} ${c.email??''} ${c.phone??''} ${relatedText(c.id)} ${data.deals.filter(d=>d.clientId===c.id).map(d=>d.title).join(' ')}`));
  const deals=data.deals.filter(d=>d.availability!=='unavailable'&&contains(`${d.title} ${data.clients.find(c=>c.id===d.clientId)?.companyName??''} ${relatedText(d.clientId,d.id)}`));
  const selectedClient=data.clients.find(c=>c.id===selection?.clientId);
  const state=link.confirmed?'confirmed':link.candidates.length?'proposed':'empty';
  return <section className={`panel match-panel state-${state}`}>
    <div className="panel-head"><h2><span className="panel-icon"><Link2 size={16}/></span>Связь с CRM</h2><span className="spacer"/>{!link.confirmed&&<button className="btn btn-sm" disabled={busy||!available} onClick={()=>void find()}>{finding?<><span className="spinner"/>Ищем клиента в CRM...</>:<><Wand2 size={14}/>Найти клиента</>}</button>}</div>
    <div className="panel-body">
    {!available&&<Notice icon={CircleAlert}>Подключите amoCRM в настройках, чтобы выбрать клиента.</Notice>}
    {link.warning&&<Notice tone="warning" icon={CircleAlert} role="alert">{link.warning}</Notice>}
    {link.confirmed?<><div className="confirmed-match"><div className="confirmed-top"><span className="confirmed-icon"><CircleCheck size={18}/></span><span className="confirmed-label">Связь подтверждена</span></div><h3>{link.confirmed.clientLabel}</h3><div className="confirmed-facts"><div><UserRound size={15}/><span>Контакт: {link.confirmed.contactLabel??'Не указан'}</span></div><div><Building2 size={15}/><span>Компания: {link.confirmed.companyLabel??'Не указана'}</span></div><div><BriefcaseBusiness size={15}/><span>Сделка: {link.confirmed.dealLabel??'Не выбрана'}</span></div>{link.confirmed.stageLabel&&<div className="confirmed-stage"><span>Этап:</span><StageBadge stage={data.deals.find(d=>d.id===link.confirmed?.dealId)?.stageName??link.confirmed.stageLabel}/></div>}</div></div>
      <div className="match-actions">{data.clients.some(c=>c.id===link.confirmed?.clientId)&&<Link className="btn btn-primary" to={`/clients/${link.confirmed.clientId}`}>Открыть клиента</Link>}<button className="btn" disabled={busy||!available} onClick={choose}>Изменить связь</button><button className="btn btn-ghost" disabled={busy} onClick={()=>setUnlink(true)}>Убрать связь</button></div></>:<>
      {link.candidates.length?<><p className="match-lead">{link.candidates.length===1?`Похоже, это встреча с ${link.candidates[0].clientLabel}`:'Найдены возможные сделки'}</p><div className="match-candidates">{link.candidates.map(candidate)}</div><button className="btn btn-ghost btn-block" disabled={busy||!available} onClick={choose}><Search size={15}/>Выбрать другую</button></>
        :<div className="match-empty"><span className="match-empty-icon"><Search size={20}/></span><strong>Не удалось определить клиента</strong><p>В участниках и разговоре нет точных совпадений с CRM. Выберите клиента и сделку сами.</p><button className="btn btn-primary" disabled={busy||!available} onClick={choose}>Выбрать вручную</button></div>}
      <p className="match-hint">Связь появится в карточке клиента после вашего подтверждения.</p>
    </>}
    </div>
    {selector&&<Modal wide icon={Link2} title="Выбрать клиента и сделку" onClose={()=>{if(!busy)setSelector(false);}}>
      <label className="field">Поиск по компании, контакту или сделке<span className="search"><Search size={17}/><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Название или имя"/></span></label>
      {selection&&selectedClient?<div className="match-selection"><div className="row"><Avatar name={selectedClient.companyName??selectedClient.name}/><div className="grow"><strong>{selectedClient.companyName??selectedClient.name}</strong><small className="muted">{selectedClient.name}</small></div><button className="link-btn" onClick={()=>setSelection(null)}>Выбрать другого клиента</button></div><label className="field">Сделка<span className="select"><select aria-label="Сделка для встречи" value={selection.dealId??''} onChange={e=>setSelection({...selection,dealId:e.target.value||null})}><option value="">Только клиент, без сделки</option>{data.deals.filter(d=>d.clientId===selection.clientId&&d.availability!=='unavailable').map(d=><option value={d.id} key={d.id}>{d.title} · {d.stageName}</option>)}</select></span></label></div>
        :<div className="match-options"><div className="match-col"><h3 className="eyebrow">Клиенты · {clients.length}</h3>{clients.slice(0,30).map(c=><button className="match-option" key={c.id} onClick={()=>setSelection({clientId:c.id,dealId:null})}><strong>{c.companyName??c.name}</strong><span>{c.name}</span></button>)}</div><div className="match-col"><h3 className="eyebrow">Сделки · {deals.length}</h3>{deals.slice(0,30).map(d=><button className="match-option" key={d.id} onClick={()=>setSelection({clientId:d.clientId,dealId:d.id})}><strong>{d.title}</strong><span>{data.clients.find(c=>c.id===d.clientId)?.companyName??data.clients.find(c=>c.id===d.clientId)?.name} · {d.stageName}</span></button>)}</div>{clients.length+deals.length===0&&<p className="muted">Совпадений нет. Измените запрос.</p>}{clients.length>30||deals.length>30?<p className="muted">Уточните поиск, чтобы увидеть остальные варианты.</p>:null}</div>}
      <div className="modal-actions"><button className="btn" disabled={busy} onClick={()=>setSelector(false)}>Отмена</button><button className="btn btn-primary" disabled={busy||!selection} onClick={()=>selection&&confirm(selection)}>Подтвердить связь</button></div>
    </Modal>}
    {unlink&&<Modal icon={CircleAlert} title="Убрать связь с CRM?" onClose={()=>{if(!busy)setUnlink(false);}}><p>Встреча исчезнет из карточки клиента. Встреча, записи и данные amoCRM сохранятся.</p><div className="modal-actions"><button className="btn" disabled={busy} onClick={()=>setUnlink(false)}>Отмена</button><button className="btn btn-danger" disabled={busy} onClick={()=>void mutate(async api=>{const result=await api.unlinkMeetingClient(meeting.id);setUnlink(false);return result;})}>Убрать связь</button></div></Modal>}
  </section>;
}
