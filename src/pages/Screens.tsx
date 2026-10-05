import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, BriefcaseBusiness, CalendarDays, Check, CircleAlert, Clock3, FileText, Info, Layers, Link2, ListTodo, Play, Rows3, Search, Sparkles, UserRound, Users, Wand2 } from 'lucide-react';
import { useApp, type ThemeChoice } from '../App.tsx';
import { CompleteTaskModal, TaskForm, TaskRow } from '../components/workspace/Tasks.tsx';
import { taskBucket } from '../domain/workspace.ts';
import { KonturConnection } from '../components/KonturConnection.tsx';
import { TalkMeeting } from '../components/TalkMeeting.tsx';
import { meetingCrmLabel } from '../domain/matching.ts';
import { artifactLabel } from '../domain/kontur.ts';
import { CrmConnection } from '../components/CrmConnection.tsx';
import { noteText } from '../components/crmNoteText.ts';
import type { Client, Deal, Meeting, Task } from '../domain/models.ts';
import { activeDeal, dayKey, formatDate, formatDuration, formatMoney } from '../domain/models.ts';
import { Avatar, BackLink, Badge, EmptyState, Modal, Notice, PageHeader, SearchField, Section, Segmented, Select, StageBadge, StatusBadge, stageTone, type Tone } from '../components/ui.tsx';

const todayKey = () => dayKey(new Date().toISOString());
const clientLabel = (client?: Client) => client?.companyName || client?.name || 'Не указан';
const dateSort = (a: Task, b: Task) => (a.dueAt || '9999').localeCompare(b.dueAt || '9999');
const upcomingTask = (tasks: Task[], clientId: string) => tasks.filter(task => task.clientId === clientId && !task.completed).sort(dateSort)[0];
const dealForClient = (deals: Deal[], clientId: string) => deals.find(deal => deal.clientId === clientId && activeDeal(deal));
const sumAmount = (deals: Deal[]) => deals.reduce((total, deal) => total + (deal.amount ?? 0), 0);
const currencyOf = (deals: Deal[]) => deals.find(deal => deal.currency)?.currency ?? null;
const compactMoney = (amount: number, currency: string | null) => { const unit = currency === 'RUB' ? ' ₽' : currency ? ' ' + currency : ''; return amount >= 1e6 ? `${(amount / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн${unit}` : amount >= 1e3 ? `${Math.round(amount / 1e3).toLocaleString('ru-RU')} тыс.${unit}` : `${amount.toLocaleString('ru-RU')}${unit}`; };
const needsReview = (meeting: Meeting) => !meeting.crmLink?.confirmed && meeting.matchingStatus !== 'linked' || meeting.crmLink?.status === 'needs_review';
const meetingWhen = (meeting: Meeting) => meeting.source === 'kontur_talk' && !meeting.startedAt ? 'Время начала неизвестно' : formatDate(meeting.startedAt);
const plural = (n: number, forms: [string, string, string]) => forms[n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2];
const stageRank = (stage: string) => ({ info: 0, violet: 1, accent: 2, warning: 3, neutral: 2.5, success: 4, danger: 5 } as Record<Tone, number>)[stageTone(stage)];
const linkTone = (meeting: Meeting): Tone => meeting.crmLink?.confirmed ? 'success' : meeting.crmLink?.status === 'needs_review' ? 'warning' : meeting.crmLink?.candidates.length ? 'accent' : 'danger';
function MeetingLinkBadge({ meeting }: { meeting: Meeting }) { return meeting.source === 'kontur_talk' ? <Badge tone={linkTone(meeting)} dot>{meeting.crmLink?.confirmed ? 'Привязана' : meetingCrmLabel(meeting)}</Badge> : <StatusBadge status={meeting.matchingStatus}/>; }
function DateTile({ iso }: { iso: string | null }) { const d = iso ? new Date(iso) : null; return <div className="date-tile" aria-hidden="true"><strong>{d ? d.toLocaleDateString('ru-RU', { day: '2-digit' }) : '—'}</strong><span>{d ? d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '') : 'дата'}</span></div>; }

function greeting(name: string) { const h = new Date().getHours(); return `${h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'}, ${name.split(/\s+/)[0]}`; }

export function Dashboard() {
  const { data } = useApp();
  const today = todayKey(); const now = new Date().toISOString();
  const active = data.deals.filter(activeDeal);
  const meetingsToday = data.meetings.filter(meeting => meeting.startedAt && dayKey(meeting.startedAt) === today).length;
  const overdue = data.tasks.filter(task => !task.completed && task.dueAt && task.dueAt < now);
  const dueToday = data.tasks.filter(task => !task.completed && task.dueAt && dayKey(task.dueAt) === today).length;
  const review = data.meetings.filter(needsReview);
  const linked = data.meetings.length - review.length;
  const tasks = data.tasks.filter(task => !task.completed).sort(dateSort).slice(0, 5);
  const currency = currencyOf(active); const pipeline = sumAmount(active);
  const summary = [review.length ? `${review.length} ${plural(review.length, ['встреча ждёт', 'встречи ждут', 'встреч ждут'])} привязки к клиенту` : 'Все встречи разобраны', overdue.length ? `${overdue.length} ${plural(overdue.length, ['задача просрочена', 'задачи просрочены', 'задач просрочено'])}` : 'просроченных задач нет'].join(' · ');
  return <>
    <h1 className="visually-hidden">Главная</h1>
    <section className="hero">
      <div className="hero-grid" aria-hidden="true"/>
      <div className="hero-main">
        <span className="hero-date">{new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <h2>{greeting(data.profile.displayName)}</h2>
        <p>{summary}</p>
        <div className="hero-actions">{review.length ? <Link className="btn btn-glow btn-lg" to="/meetings">Разобрать встречи <ArrowRight size={18}/></Link> : <Link className="btn btn-glow btn-lg" to="/meetings">Открыть встречи <ArrowRight size={18}/></Link>}<Link className="btn btn-lg hero-secondary" to="/tasks">Задачи на сегодня{dueToday ? ` · ${dueToday}` : ''}</Link></div>
      </div>
      <div className="hero-flow" aria-label="Путь встречи к сделке">
        <div className="flow-step"><span className="flow-icon"><CalendarDays size={18}/></span><strong>{data.meetings.length}</strong><small>встреч записано</small></div>
        <span className="flow-arrow" aria-hidden="true"/>
        <div className="flow-step"><span className="flow-icon"><Link2 size={18}/></span><strong>{linked}</strong><small>привязано к CRM</small></div>
        <span className="flow-arrow" aria-hidden="true"/>
        <div className="flow-step"><span className="flow-icon"><BriefcaseBusiness size={18}/></span><strong>{active.length}</strong><small>сделок в работе</small></div>
      </div>
    </section>
    <div className="kpi-row">
      <Link to="/deals" className="kpi"><span className="kpi-icon accent"><BriefcaseBusiness size={18}/></span><span className="kpi-label">Активные сделки</span><strong className="kpi-value">{active.length}</strong><small>{pipeline ? `в работе на ${compactMoney(pipeline, currency)}` : 'В работе сейчас'}</small></Link>
      <Link to="/meetings" className="kpi"><span className="kpi-icon info"><CalendarDays size={18}/></span><span className="kpi-label">Встречи сегодня</span><strong className="kpi-value">{meetingsToday}</strong><small>Всего в базе: {data.meetings.length}</small></Link>
      <Link to="/tasks" className={`kpi${overdue.length ? ' alert' : ''}`}><span className={`kpi-icon ${overdue.length ? 'danger' : 'success'}`}>{overdue.length ? <CircleAlert size={18}/> : <Check size={18}/>}</span><span className="kpi-label">Просроченные задачи</span><strong className="kpi-value">{overdue.length}</strong><small>{overdue.length ? 'Нужны действия' : 'Всё в срок'}{dueToday ? ` · сегодня ${dueToday}` : ''}</small></Link>
      <Link to="/meetings" className={`kpi${review.length ? ' warn' : ''}`}><span className={`kpi-icon ${review.length ? 'warning' : 'success'}`}><Link2 size={18}/></span><span className="kpi-label">Требуют внимания</span><strong className="kpi-value">{review.length}</strong><small>Встречи без точной привязки</small></Link>
    </div>
    <div className="grid-2-1">
      <Pipeline deals={active}/>
      <Section title="Ближайшие задачи" icon={ListTodo} flush action={<Link className="link-btn" to="/tasks">Все задачи <ArrowUpRight size={15}/></Link>}>
        {tasks.length ? <div className="list">{tasks.map(task => { const late = !!task.dueAt && task.dueAt < now; return <div className="list-row" key={task.id}><span className={`task-mark${late ? ' late' : ''}`}/><div className="grow"><span className="title">{task.title}</span><span className="meta">{clientLabel(data.clients.find(client => client.id === task.clientId))}</span></div><span className={`date-note${late ? ' overdue' : ''}`}>{formatDate(task.dueAt)}</span></div>; })}</div> : <EmptyState compact icon={Check} title="Задач пока нет"/>}
      </Section>
    </div>
    <div className="grid-2">
      <Section title="Последние встречи" icon={CalendarDays} flush action={<Link className="link-btn" to="/meetings">Все встречи <ArrowUpRight size={15}/></Link>}>
        {data.meetings.length ? <div className="list">{data.meetings.slice(0, 5).map(meeting => <Link className="list-row" to={`/meetings/${meeting.id}`} key={meeting.id}><DateTile iso={meeting.startedAt}/><div className="grow"><span className="title">{meeting.title}</span><span className="meta">{meeting.crmLink?.confirmed?.clientLabel ?? clientLabel(data.clients.find(client => client.id === meeting.clientId))} · {formatDuration(meeting.durationSeconds)}</span></div><MeetingLinkBadge meeting={meeting}/></Link>)}</div> : <EmptyState compact title="Встреч пока нет" detail="Подключите Контур.Толк в настройках"/>}
      </Section>
      <Section title="Сделки в работе" icon={BriefcaseBusiness} flush action={<Link className="link-btn" to="/deals">Все сделки <ArrowUpRight size={15}/></Link>}>
        {active.length ? <div className="list">{[...active].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, 5).map(deal => { const client = data.clients.find(item => item.id === deal.clientId); return <Link className="list-row" to={`/clients/${deal.clientId}?deal=${encodeURIComponent(deal.id)}`} key={deal.id}><Avatar name={clientLabel(client)}/><div className="grow"><span className="title">{deal.title}</span><span className="meta">{clientLabel(client)}</span></div><div className="deal-trail"><span className="amount">{formatMoney(deal.amount, deal.currency)}</span><StageBadge stage={deal.stageName}/></div></Link>; })}</div> : <EmptyState compact title="Активных сделок нет"/>}
      </Section>
    </div>
  </>;
}

function Pipeline({ deals }: { deals: Deal[] }) {
  const stages = useMemo(() => { const map = new Map<string, Deal[]>(); for (const deal of deals) map.set(deal.stageName, [...(map.get(deal.stageName) ?? []), deal]); return [...map.entries()].map(([stage, items]) => ({ stage, count: items.length, amount: sumAmount(items) })).sort((a, b) => stageRank(a.stage) - stageRank(b.stage)); }, [deals]);
  const max = Math.max(1, ...stages.map(s => s.amount)); const currency = currencyOf(deals); const total = sumAmount(deals);
  return <Section className="pipeline-panel" title="Воронка сделок" icon={Layers} action={<span className="pipeline-total"><span className="eyebrow">Итого</span><strong>{formatMoney(total, currency)}</strong></span>}>
    {stages.length ? <div className="pipeline" role="table" aria-label="Активные сделки по этапам">{stages.map(s => <div className="pipeline-row" role="row" key={s.stage} title={`${s.stage}: ${s.count} ${plural(s.count, ['сделка', 'сделки', 'сделок'])}, ${formatMoney(s.amount, currency)}`}>
      <span className="pipeline-stage" role="cell">{s.stage}</span>
      <span className="pipeline-track" role="cell"><span className="pipeline-bar" style={{ width: `${Math.max(3, s.amount / max * 100)}%` }}/></span>
      <span className="pipeline-count" role="cell">{s.count}</span>
      <span className="pipeline-amount" role="cell">{compactMoney(s.amount, currency)}</span>
    </div>)}</div> : <EmptyState compact title="Нет активных сделок"/>}
    {deals.length > 0 && <div className="pipeline-foot"><div><span className="eyebrow">Средний чек</span><strong>{compactMoney(Math.round(total / Math.max(1, deals.filter(d => d.amount).length)), currency)}</strong></div><div><span className="eyebrow">Крупнейшая</span><strong>{compactMoney(Math.max(...deals.map(d => d.amount ?? 0)), currency)}</strong></div><div><span className="eyebrow">Без суммы</span><strong>{deals.filter(d => !d.amount).length}</strong></div></div>}
  </Section>;
}

export function ClientsPage() {
  const { data } = useApp();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'name' | 'responsible'>('name');
  const clients = useMemo(() => data.clients.filter(client => `${client.companyName} ${client.name} ${client.responsibleName}`.toLowerCase().includes(search.toLowerCase())).sort((a,b) => (sort === 'name' ? clientLabel(a).localeCompare(clientLabel(b), 'ru') : (a.responsibleName || '').localeCompare(b.responsibleName || '', 'ru'))), [data.clients, search, sort]);
  return <><PageHeader eyebrow="CRM" title="Клиенты" subtitle={`${data.clients.length} ${plural(data.clients.length, ['клиент', 'клиента', 'клиентов'])} в рабочем пространстве`}/>
    <div className="toolbar"><SearchField value={search} onChange={setSearch} placeholder="Компания, контакт или менеджер"/><Select value={sort} onChange={value => setSort(value as 'name' | 'responsible')} label="Сортировка клиентов" icon={Rows3}><option value="name">По названию</option><option value="responsible">По менеджеру</option></Select><span className="spacer"/>{search && <span className="toolbar-note">Найдено: {clients.length}</span>}</div>
    {clients.length ? <div className="table"><div className="t-head clients-grid"><span>Клиент</span><span>Ответственный</span><span>Активная сделка</span><span>Этап</span><span>Следующая задача</span></div>{clients.map(client => { const deal = dealForClient(data.deals, client.id); const task = upcomingTask(data.tasks, client.id); return <Link className="t-row clients-grid" to={`/clients/${client.id}`} key={client.id}><div className="primary"><Avatar name={clientLabel(client)}/><div className="grow"><strong>{clientLabel(client)}</strong><small>{[client.companyName ? client.name : null, client.phone, client.email].filter(Boolean).join(' · ') || 'Нет контактных данных'}</small></div></div><span className="cell-clip">{client.responsibleName || '—'}</span><span className="cell-clip">{deal?.title || <span className="muted">Нет активной сделки</span>}</span><span>{deal ? <StageBadge stage={deal.stageName}/> : <span className="muted">—</span>}</span><span className="cell-clip">{task ? <span className="next-task"><Clock3 size={14}/><span className="truncate">{task.title}</span></span> : <span className="muted">Нет задач</span>}</span></Link>; })}<div className="t-foot">Показано {clients.length} из {data.clients.length}</div></div> : <div className="panel"><EmptyState icon={Search} title="Клиенты не найдены" detail="Попробуйте изменить поисковый запрос"/></div>}</>;
}

export { ClientWorkspace as ClientDetailsPage } from '../components/workspace/ClientWorkspace.tsx';

export function DealsPage() {
  const { data } = useApp(); const [search, setSearch] = useState(''); const [stage, setStage] = useState('all'); const [owner, setOwner] = useState('all'); const [pipeline,setPipeline]=useState('all'); const [view, setView] = useState<'table'|'board'>('table');
  const stages = [...new Set(data.deals.map(deal => deal.stageName))].sort((a, b) => stageRank(a) - stageRank(b)); const owners = [...new Set(data.deals.map(deal => deal.responsibleName).filter((value): value is string => !!value))];
  const real = data.settings.data_mode === 'amocrm';
  const deals = data.deals.filter(deal => { const client = data.clients.find(item => item.id === deal.clientId); return (pipeline==='all'||deal.pipelineName===pipeline) && (stage === 'all' || deal.stageName === stage) && (owner === 'all' || deal.responsibleName === owner) && `${deal.title} ${clientLabel(client)}`.toLowerCase().includes(search.toLowerCase()); });
  const currency = currencyOf(deals);
  return <><PageHeader eyebrow="CRM" title="Сделки" subtitle={`${data.deals.length} ${plural(data.deals.length, ['сделка', 'сделки', 'сделок'])} · ${data.deals.filter(activeDeal).length} в работе`}/>
    <div className="toolbar"><SearchField value={search} onChange={setSearch} placeholder="Найти сделку или клиента"/>
      <Select value={stage} onChange={setStage} label="Фильтр по этапу"><option value="all">Все этапы</option>{stages.map(value => <option key={value}>{value}</option>)}</Select>
      <Select value={pipeline} onChange={setPipeline} label="Фильтр по воронке"><option value="all">Все воронки</option>{[...new Set(data.deals.map(d=>d.pipelineName).filter((v):v is string=>!!v))].map(v=><option key={v}>{v}</option>)}</Select>
      {!real&&<Select value={owner} onChange={setOwner} label="Фильтр по менеджеру"><option value="all">Все менеджеры</option>{owners.map(value => <option key={value}>{value}</option>)}</Select>}
      <span className="spacer"/>
      <Segmented label="Вид" value={view} onChange={setView} options={[{ key: 'table', label: 'Таблица' }, { key: 'board', label: 'Доска' }]}/>
    </div>
    <div className="summary-strip"><span><strong>{deals.length}</strong> {plural(deals.length, ['сделка', 'сделки', 'сделок'])}</span><span className="dot-sep"/><span>в работе <strong>{deals.filter(activeDeal).length}</strong></span><span className="dot-sep"/><span>сумма <strong className="mono">{formatMoney(sumAmount(deals), currency)}</strong></span></div>
    {!deals.length ? <div className="panel"><EmptyState icon={Search} title="Сделки не найдены" detail="Попробуйте изменить фильтры"/></div>
      : view === 'board' ? <div className="board">{stages.filter(s => deals.some(d => d.stageName === s)).map(s => { const items = deals.filter(d => d.stageName === s); return <div className="board-col" key={s}><div className="board-head"><StageBadge stage={s}/><span className="count"><span>{items.length}</span></span><span className="board-sum mono">{compactMoney(sumAmount(items), currency)}</span></div><div className="board-cards">{items.map(deal => <Link to={`/clients/${deal.clientId}?deal=${encodeURIComponent(deal.id)}`} className="board-card" key={deal.id}><span className="eyebrow">{clientLabel(data.clients.find(c => c.id === deal.clientId))}</span><strong>{deal.title}</strong><div className="board-card-foot"><span className="amount">{formatMoney(deal.amount, deal.currency)}</span>{deal.responsibleName && <Avatar name={deal.responsibleName} size="sm" round/>}</div></Link>)}</div></div>; })}</div>
      : <div className="table"><div className="t-head deals-grid"><span>Сделка и клиент</span><span>Этап</span><span>Ответственный</span><span className="right">Сумма</span><span>{real?'Последнее примечание':'Последняя встреча'}</span><span>Следующая задача</span></div>{deals.map(deal => { const meeting = data.meetings.find(item => item.dealId === deal.id); const task = data.tasks.filter(item => item.dealId === deal.id && !item.completed).sort(dateSort)[0]; return <Link className={`t-row deals-grid${activeDeal(deal) ? '' : ' closed'}`} to={`/clients/${deal.clientId}?deal=${encodeURIComponent(deal.id)}`} key={deal.id}><div className="primary"><Avatar name={clientLabel(data.clients.find(client => client.id === deal.clientId))}/><div className="grow"><strong>{deal.title}</strong><small>{deal.availability==='unavailable'?'Нет в последней синхронизации':clientLabel(data.clients.find(client => client.id === deal.clientId))}</small></div></div><span><StageBadge stage={deal.stageName}/></span><span className="cell-clip">{deal.responsibleName || '—'}</span><span className="amount">{formatMoney(deal.amount, deal.currency)}</span><span className="clamp-2 muted" title={real?noteText(data.crm?.notes.find(n=>Number(n.entity_id)===Number(deal.externalId))):undefined}>{real?noteText(data.crm?.notes.find(n=>Number(n.entity_id)===Number(deal.externalId))):meeting ? formatDate(meeting.startedAt) : '—'}</span><span className="cell-clip">{task?.title || <span className="muted">—</span>}</span></Link>; })}</div>}
  </>;
}

export function MeetingsPage() {
  const { data,busy,mutate } = useApp(); const [filter, setFilter] = useState<'all'|'linked'|'review'|'unlinked'>('all');const [finding,setFinding]=useState(false),[result,setResult]=useState('');
  const match = (meeting: Meeting, key: string) => key==='all'||key==='linked'&&meeting.matchingStatus==='linked'||key==='review'&&(meeting.matchingStatus==='review'||meeting.crmLink?.status==='needs_review')||key==='unlinked'&&meeting.matchingStatus==='unlinked';
  const options = ([['all','Все'],['linked','Привязаны'],['review','Нужно проверить'],['unlinked','Не привязаны']] as const).map(([key, label]) => ({ key, label, count: data.meetings.filter(m => match(m, key)).length }));
  const meetings = data.meetings.filter(meeting => match(meeting, filter));
  const findAll=async()=>{setFinding(true);setResult('');try{await mutate(async api=>{const next=await api.findMeetingClients();const items=next.meetings.filter(m=>!m.crmLink?.confirmed);const found=items.filter(m=>m.crmLink?.candidates.length).length;setResult(`${items.length} встречи обработаны · ${found} с предложениями · ${items.length-found} нужно выбрать вручную`);return next;});}finally{setFinding(false);}};
  const groups = useMemo(() => { const map = new Map<string, Meeting[]>(); for (const m of meetings) { const key = m.startedAt ? new Date(m.startedAt).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) : 'Без даты'; map.set(key, [...(map.get(key) ?? []), m]); } return [...map.entries()]; }, [meetings]);
  return <><PageHeader eyebrow={data.kontur ? 'Контур.Толк' : 'Встречи'} title="Встречи" subtitle={data.kontur?`${data.kontur.meetingCount} ${plural(data.kontur.meetingCount, ['встреча', 'встречи', 'встреч'])} из Контур.Толка · свяжите каждую с клиентом и сделкой`:"История разговоров с клиентами"} action={data.kontur&&<button className="btn btn-primary" disabled={busy||data.settings.data_mode!=='amocrm'} onClick={()=>void findAll()}>{finding?<><span className="spinner"/>Ищем клиента в CRM...</>:<><Wand2 size={16}/>Найти клиентов для непривязанных встреч</>}</button>}/>
    {result&&<div className="page-alert"><Notice tone="success" icon={Check} role="status" onClose={() => setResult('')}>{result}</Notice></div>}
    <div className="toolbar"><Segmented label="Фильтр встреч" value={filter} onChange={setFilter} options={options}/></div>
    {meetings.length ? groups.map(([month, items]) => <section className="meeting-group" key={month}><h2 className="group-title eyebrow">{month}</h2><div className="meeting-list">{items.map(meeting => { const client = data.clients.find(item => item.id === meeting.clientId); const deal = data.deals.find(item => item.id === meeting.dealId); return <Link className={`meeting-card tone-${meeting.source === 'kontur_talk' ? linkTone(meeting) : ({ linked: 'success', review: 'warning', unlinked: 'danger' } as const)[meeting.matchingStatus]}`} key={meeting.id} to={`/meetings/${meeting.id}`}><DateTile iso={meeting.startedAt}/><div className="grow"><div className="meeting-title"><strong>{meeting.title}</strong><MeetingLinkBadge meeting={meeting}/></div><div className="meeting-meta"><span><Clock3 size={15}/>{meetingWhen(meeting)} · {formatDuration(meeting.durationSeconds)}</span>{meeting.participants.length > 0 && <span className="participants"><span className="avatar-stack">{meeting.participants.slice(0, 4).map((p, i) => <Avatar key={i} name={p} size="sm" round/>)}</span>{meeting.participants.slice(0, 2).join(', ')}{meeting.participants.length > 2 ? ` и ещё ${meeting.participants.length - 2}` : ''}</span>}</div>{meeting.source==='kontur_talk'?<div className="meeting-artifacts">{meeting.crmLink?.confirmed&&<span>{meetingCrmLabel(meeting)}</span>}<span className={`artifact-chip ${meeting.artifactStates?.transcript ?? 'not_available'}`}>Транскрипция: {artifactLabel(meeting.artifactStates?.transcript??'not_available')}</span><span className={`artifact-chip ${meeting.artifactStates?.protocol ?? 'not_available'}`}>Протокол: {artifactLabel(meeting.artifactStates?.protocol??'not_available')}</span></div>:<div className="meeting-artifacts"><span>{clientLabel(client)}{deal ? ` · ${deal.title}` : ''}</span></div>}</div><ArrowUpRight className="card-arrow" size={18}/></Link>; })}</div></section>)
      : <div className="panel"><EmptyState icon={CalendarDays} title="Встреч пока нет" detail={data.settings.data_mode==='amocrm'&&!data.meetings.length?'Встречи появятся после подключения Контур.Толк.':'Для этого фильтра ничего не найдено'}/></div>}</>;
}

export function MeetingDetailsPage() {
  const { id } = useParams(); const { data } = useApp(); const [tab, setTab] = useState<'summary' | 'transcript' | 'recording'>('summary');
  const meeting = data.meetings.find(item => item.id === id);
  if (!meeting) return <><BackLink to="/meetings" label="К списку встреч"/><PageHeader title="Встреча не найдена"/></>;
  const header = <><BackLink to="/meetings" label="Встречи"/><header className="entity-header meeting-header"><DateTile iso={meeting.startedAt}/><div className="grow"><span className="eyebrow">{meeting.source === 'kontur_talk' ? 'Встреча · Контур.Толк' : 'Встреча'}</span><h1>{meeting.title}</h1><div className="entity-meta"><span><CalendarDays size={15}/>{meetingWhen(meeting)}</span><span><Clock3 size={15}/>{formatDuration(meeting.durationSeconds)}</span>{meeting.participants.length > 0 && <span><Users size={15}/>{meeting.participants.length} {plural(meeting.participants.length, ['участник', 'участника', 'участников'])}</span>}</div></div><MeetingLinkBadge meeting={meeting}/></header></>;
  if(meeting.source==='kontur_talk')return <>{header}<TalkMeeting meeting={meeting}/></>;
  const client = data.clients.find(item => item.id === meeting.clientId); const deal = data.deals.find(item => item.id === meeting.dealId);
  const tabs = [['summary', 'Резюме'], ['transcript', 'Транскрипция'], ['recording', 'Запись']] as const;
  return <>{header}
    <div className="meeting-layout"><div className="meeting-content">
      <div className="tabs" role="tablist" aria-label="Содержание встречи">{tabs.map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</div>
      <div className="panel tab-panel" role="tabpanel">{tab === 'summary' && <><h2>Краткое резюме</h2><p className="long-copy">{meeting.summary || 'Резюме пока нет.'}</p><Notice tone="info" icon={Info}>Демонстрационные данные встречи. Анализ появится после подключения сервиса.</Notice></>}
        {tab === 'transcript' && <><h2>Транскрипция</h2>{meeting.transcript.length ? <div className="transcript">{meeting.transcript.map((line,index) => <div className="transcript-line" key={`${line.time}-${index}`}><Avatar name={line.speaker} size="sm" round/><div className="grow"><div className="line-head"><strong>{line.speaker}</strong><time>{line.time}</time></div><p>{line.text}</p></div></div>)}</div> : <EmptyState compact title="Транскрипции пока нет"/>}</>}
        {tab === 'recording' && <><h2>Запись встречи</h2><div className="recording-placeholder"><span className="recording-play"><Play size={22}/></span><strong>Запись появится после подключения Контур.Толк</strong><span>В этой версии воспроизведение недоступно</span></div></>}</div>
    </div><aside className="meeting-side">
      <Section title="Клиент и сделка" icon={Link2}><div className="side-facts"><div className="kv"><span>Клиент</span><strong>{client ? <Link className="link-btn" to={`/clients/${client.id}`}>{clientLabel(client)}</Link> : 'Не указан'}</strong></div><div className="kv"><span>Сделка</span><strong>{deal?.title || 'Не привязана'}</strong></div>{deal && <div className="kv"><span>Этап</span><StageBadge stage={deal.stageName}/></div>}<div className="kv"><span>Статус</span><StatusBadge status={meeting.matchingStatus}/></div></div></Section>
      <Section title="Участники" icon={Users} flush><div className="list">{meeting.participants.map(p => <div className="list-row" key={p}><Avatar name={p} size="sm" round/><span className="title">{p}</span></div>)}</div></Section>
      <button className="btn btn-block" disabled title="Появится в следующей версии"><Sparkles size={16}/>Подготовить заполнение CRM</button>
    </aside></div>
  </>;
}

export function TasksPage() {
  const { data } = useApp(); const real = data.settings.data_mode === 'amocrm';
  const [completing, setCompleting] = useState<Task | null>(null); const [editing, setEditing] = useState<Task | null>(null);
  const groups = (['overdue', 'today', 'upcoming', 'done'] as const).map(key => ({ key, title: { overdue: 'Просроченные', today: 'Сегодня', upcoming: 'Предстоящие', done: 'Выполненные' }[key], tone: { overdue: 'danger', today: 'warning', upcoming: 'accent', done: 'success' }[key], tasks: data.tasks.filter(task => taskBucket(task) === key).sort(dateSort) }));
  return <><PageHeader eyebrow="План" title="Задачи" subtitle={real?'Задачи amoCRM: выполнение и изменения сохраняются прямо в amoCRM.':'Следующие шаги по клиентам и сделкам'}/>
    <div className="task-summary">{groups.map(group => <div className={`task-stat ${group.tone}`} key={group.key}><span className="eyebrow">{group.title}</span><strong>{group.tasks.length}</strong></div>)}</div>
    <div className="stack-lg">{groups.map(group => <section key={group.key} className={`panel task-group ${group.tone}`}><div className="panel-head"><h2><span className={`group-dot ${group.tone}`}/>{group.title}</h2><span className="count" aria-hidden="true"><span>{group.tasks.length}</span></span></div><div className="task-list">{group.tasks.length ? group.tasks.map(task => { const client = data.clients.find(item => item.id === task.clientId); const deal = data.deals.find(item => item.id === task.dealId); return <TaskRow key={task.id} task={task} context={[clientLabel(client), deal?.title].filter(Boolean).join(' · ')} onEdit={setEditing} onComplete={setCompleting} showClient={client ? { id: client.id, label: clientLabel(client) } : undefined}/>; }) : <EmptyState compact icon={Check} title={group.key === 'done' ? 'Выполненных задач пока нет' : 'Задач нет'}/>}</div></section>)}</div>
    {completing && <CompleteTaskModal task={completing} onClose={() => setCompleting(null)}/>}
    {editing && <TaskForm task={editing} targets={[]} onClose={() => setEditing(null)}/>}</>;
}

export function TemplatesPage() {
  const { data } = useApp(); const [selected, setSelected] = useState(data.templates[0]?.id);
  const template = data.templates.find(item => item.id === selected);
  return <><PageHeader eyebrow="Автоматизация" title="Шаблоны" subtitle="Какие поля CRM заполнять после встречи"/>
    <div className="templates-layout"><div className="template-list">{data.templates.map(item => <button key={item.id} className={`template-choice${item.id === selected ? ' selected' : ''}`} onClick={() => setSelected(item.id)}><span className="list-icon accent"><FileText size={18}/></span><span className="grow"><strong>{item.title}</strong><small>{item.description}</small></span><span className="count" aria-hidden="true"><span>{item.fields.length}</span></span></button>)}</div>
      <div className="panel template-detail">{template ? <><div className="template-detail-head"><span className="eyebrow">Шаблон встречи</span><h2>{template.title}</h2><p>{template.description}</p></div>
        <div className="template-flow" aria-hidden="true"><span><CalendarDays size={16}/>Встреча</span><ArrowRight size={16}/><span><Sparkles size={16}/>Извлечение</span><ArrowRight size={16}/><span><Check size={16}/>Проверка</span><ArrowRight size={16}/><span><BriefcaseBusiness size={16}/>amoCRM</span></div>
        <div className="field-list">{template.fields.map((field,index) => <div key={field.key}><span className="field-index">{String(index + 1).padStart(2,'0')}</span><strong>{field.title}</strong></div>)}</div>
        <Notice icon={Info}>Редактирование шаблонов появится в следующей версии.</Notice></> : <EmptyState title="Шаблон не найден"/>}</div></div></>;
}

export function SettingsPage() {
  const { data, mutate, busy, theme, setTheme } = useApp();
  const [name, setName] = useState(data.profile.displayName);
  const [reset, setReset] = useState(false);
  const ai = data.integrations.find(i => i.type === 'AI');
  return <><PageHeader eyebrow="Система" title="Настройки" subtitle="Подключения, профиль и данные приложения"/>
    <div className="settings-layout"><div className="settings-main">
      <section className="settings-section"><div className="settings-section-head"><h2>Подключения</h2><p>Источники данных рабочего пространства. Пароли вводятся только на официальных сайтах.</p></div>
        <div className="integration-stack"><CrmConnection/><KonturConnection/>
          <div className="integration-card"><div className="integration-head"><span className="integration-logo ai"><Sparkles size={20}/></span><div className="grow"><strong>AI-помощник</strong><small>{ai?.status ?? 'Не настроено'}</small></div><Badge tone="violet" small>Скоро</Badge></div><p className="integration-copy">Извлечение договорённостей и полей CRM из встреч появится в следующих версиях.</p></div>
        </div></section>
    </div><aside className="settings-side">
      <Section title="Профиль" icon={UserRound}><form className="profile-form" onSubmit={event => { event.preventDefault(); void mutate(api => api.updateProfile(name)); }}><div className="profile-preview"><Avatar name={name || data.profile.displayName} size="lg" round/><div><strong>{data.profile.displayName}</strong><small className="muted">Отображается в приложении</small></div></div><label className="field">Отображаемое имя<input value={name} maxLength={100} onChange={event => setName(event.target.value)} required/></label><button className="btn btn-primary" disabled={busy || name.trim() === data.profile.displayName}>Сохранить</button></form></Section>
      <Section title="Оформление" icon={Layers}><Segmented<ThemeChoice> label="Тема оформления" value={theme} onChange={setTheme} options={[{ key: 'system', label: 'Как в системе' }, { key: 'light', label: 'Светлая' }, { key: 'dark', label: 'Тёмная' }]}/><p className="muted settings-hint">Быстрый поиск по всему приложению: <kbd>Ctrl</kbd> <kbd>K</kbd></p></Section>
      <Section title="Приложение" icon={Info}><div className="kv"><span>Версия</span><strong className="mono">{data.version}</strong></div><div className="kv"><span>Демо-режим</span><strong>{data.settings.data_mode==='amocrm'||data.kontur?'Выключен':'Включён'}</strong></div><div className="kv"><span>Уведомления</span><label className="switch"><input type="checkbox" aria-label="Уведомления" checked={data.settings.notifications === 'on'} disabled={busy} onChange={event => void mutate(api => api.setSetting('notifications', event.target.checked ? 'on' : 'off'))}/><span/></label></div><div className="setting-block"><span className="eyebrow">Локальная база данных</span><code>{data.databaseLocation}</code></div><button className="btn btn-danger-soft btn-block" onClick={() => setReset(true)}>Сбросить демо-данные</button></Section>
    </aside></div>
    {reset && <Modal title="Сбросить демо-данные?" icon={CircleAlert} onClose={() => setReset(false)}><p>Демонстрационные клиенты, сделки, встречи и задачи восстановятся в исходном виде. Профиль, настройки и кэш amoCRM сохранятся.</p><div className="modal-actions"><button className="btn" onClick={() => setReset(false)}>Отмена</button><button className="btn btn-danger" disabled={busy} onClick={() => { void mutate(api => api.resetDemo()); setReset(false); }}>Сбросить данные</button></div></Modal>}
  </>;
}

