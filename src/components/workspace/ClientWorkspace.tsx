import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, BriefcaseBusiness, Building2, CalendarDays, Clock3, ListTodo, Mail, MessageSquareText, Phone, Plus, RefreshCw, StickyNote, UserRound } from 'lucide-react';
import { useApp } from '../../App.tsx';
import type { Client, Deal, Meeting, Task } from '../../domain/models.ts';
import { activeDeal, formatDate, formatDuration, formatMoney } from '../../domain/models.ts';
import type { CrmRecord } from '../../domain/crm.ts';
import type { CrmEntityKind, TimelineData, TimelineItem } from '../../domain/crmWrite.ts';
import { composeTimeline } from '../../domain/timeline.ts';
import { fieldViews, importantFields, taskBucket } from '../../domain/workspace.ts';
import { artifactLabel } from '../../domain/kontur.ts';
import { Avatar, Badge, EmptyState, Notice, PageHeader, Section, StageBadge } from '../ui.tsx';
import { EntityCard } from './EntityCard.tsx';
import { StageControl } from './StageControl.tsx';
import { CompleteTaskModal, TaskForm, TaskGroups, TaskRow, type TaskTarget } from './Tasks.tsx';
import { NoteComposer, TimelineFeed, type NoteTarget } from './Timeline.tsx';
import { FieldDisplay } from './FieldEditor.tsx';

type Tab = 'overview'|'history'|'tasks'|'meetings';
const STALE_MS = 10 * 60 * 1000;
const clientTitle = (c: Client) => c.companyName || c.name;
/** Only confirmed Phase 4 links (or linked demo meetings) count as client history. */
const confirmedFor = (meetings: Meeting[], clientId: string) => meetings.filter(m => m.clientId === clientId && (m.crmLink?.confirmed || (m.source !== 'kontur_talk' && m.matchingStatus === 'linked')));

export function ClientWorkspace() {
  const { id } = useParams(); const [params, setParams] = useSearchParams(); const navigate = useNavigate();
  const { data, api, reload, canWrite, writeBlock, guard } = useApp();
  const client = data.clients.find(c => c.id === id);
  const [tab, setTab] = useState<Tab>('overview'); const [timeline, setTimeline] = useState<TimelineData>({ events: [], loadedAt: null, error: null });
  const [refreshing, setRefreshing] = useState(false); const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState<{ task?: Task } | null>(null); const [completing, setCompleting] = useState<Task | null>(null); const [noteForm, setNoteForm] = useState<{ id?: number; text?: string; target?: NoteTarget } | null>(null);
  const crm = data.crm; const real = data.settings.data_mode === 'amocrm' && !!crm?.account;
  const deals = useMemo(() => data.deals.filter(d => d.clientId === id).sort((a, b) => Number(activeDeal(b)) - Number(activeDeal(a)) || b.updatedAt.localeCompare(a.updatedAt)), [data.deals, id]);
  const deal: Deal | undefined = deals.find(d => d.id === params.get('deal')) ?? deals[0];
  const lead = real && deal ? crm!.leads?.find(l => l.id === Number(deal.externalId)) : undefined;
  const contact = real && client?.primaryContactId ? crm!.contacts.find(c => c.id === client.primaryContactId) : undefined;
  const company = real && client?.companyId ? crm!.companies.find(c => c.id === client.companyId) : undefined;
  const tasks = data.tasks.filter(t => t.clientId === id);
  const meetings = client ? confirmedFor(data.meetings, client.id) : [];
  const loadTimeline = useCallback(async () => { if (!id) return; try { setTimeline(await api.getTimeline(id)); } catch { /* cache stays as is */ } }, [api, id]);
  const refresh = useCallback(async () => {
    if (!id || refreshing) return; setRefreshing(true); setRefreshNote(null);
    try { const r = await api.refreshWorkspace(id); setRefreshNote(r.ok ? null : r.message); await reload(); await loadTimeline(); } catch { setRefreshNote('Не удалось обновить карточку. Показаны сохранённые данные.'); } finally { setRefreshing(false); }
  }, [api, id, refreshing, reload, loadTimeline]);
  useEffect(() => { void (async () => { if (!id || !real) return; let current: TimelineData | null = null; try { current = await api.getTimeline(id); setTimeline(current); } catch { /* ignore */ }
    const stale = !current?.loadedAt || Date.now() - Date.parse(current.loadedAt) > STALE_MS; if (stale && canWrite) await refresh(); })(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, real]);
  if (!client) return <><Link className="back-link" to="/clients"><ArrowLeft size={16}/>К списку клиентов</Link><PageHeader title="Клиент не найден"/></>;

  const leadIds = new Set(deals.map(d => Number(d.externalId)));
  const notes = real ? [
    ...crm!.notes.filter(n => leadIds.has(Number(n.entity_id)) && (n.entity_type === undefined || n.entity_type === 'leads')).map(note => ({ note, entity: 'leads' as const })),
    ...(crm!.contactNotes ?? []).filter(n => Number(n.entity_id) === client.primaryContactId).map(note => ({ note, entity: 'contacts' as const })),
    ...(crm!.companyNotes ?? []).filter(n => Number(n.entity_id) === client.companyId).map(note => ({ note, entity: 'companies' as const }))
  ].map(n => ({ ...n, editable: (crm!.editableNotes ?? []).includes(`${n.entity}:${n.note.id}`) })) : [];
  const items = composeTimeline({ events: timeline.events, notes, tasks, meetings, lookup: { pipelines: crm?.pipelines ?? [], fields: crm?.fields ?? [] } });
  const dealLabel = (leadId: number | null | undefined) => leadId && deals.length > 1 ? deals.find(d => Number(d.externalId) === leadId)?.title ?? null : null;
  const targets: TaskTarget[] = [...(deal && lead ? [{ entity: 'leads' as CrmEntityKind, entityId: lead.id, label: `Сделка «${deal.title}»` }] : []), ...(contact ? [{ entity: 'contacts' as CrmEntityKind, entityId: contact.id, label: `Контакт ${contact.name ?? ''}` }] : []), ...(company ? [{ entity: 'companies' as CrmEntityKind, entityId: company.id, label: `Компания ${company.name ?? ''}` }] : [])];
  const noteTarget: NoteTarget | undefined = targets[0] ? { entity: targets[0].entity, entityId: targets[0].entityId, label: targets[0].entity === 'leads' ? deal!.title : String((contact ?? company)?.name ?? '') } : undefined;
  const nextTask = tasks.filter(t => !t.completed).sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'))[0];
  const openTasks = tasks.filter(t => !t.completed).length; const lastMeeting = meetings.slice().sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const contextOf = (t: Task) => t.dealId ? (deals.length > 1 ? data.deals.find(d => d.id === t.dealId)?.title : undefined) : t.entityType === 'contacts' ? 'Контакт' : undefined;
  const selectDeal = (d: Deal) => guard(() => setParams({ deal: d.id }, { replace: true }));
  const editNote = (item: TimelineItem) => item.noteId && item.entity && item.entityId && setNoteForm({ id: item.noteId, text: item.text ?? '', target: { entity: item.entity, entityId: item.entityId, label: item.entity === 'leads' ? deals.find(d => Number(d.externalId) === item.entityId)?.title ?? 'Сделка' : String(contact?.name ?? company?.name ?? '') } });
  const tabs: { key: Tab; label: string; count?: number }[] = [{ key: 'overview', label: 'Обзор' }, { key: 'history', label: 'История' }, { key: 'tasks', label: 'Задачи', count: openTasks }, { key: 'meetings', label: 'Встречи', count: meetings.length }];
  const accountName = crm?.account ? `Пользователь #${crm.account.currentUserId}` : client.responsibleName;

  return <div className="workspace">
    <button className="back-link" onClick={() => guard(() => navigate('/clients'))}><ArrowLeft size={16}/>Клиенты</button>
    <header className="ws-header">
      <Avatar name={clientTitle(client)} size="lg"/>
      <div className="grow">
        <span className="eyebrow">{company ? 'Компания' : 'Клиент'}{client.source === 'amocrm' ? ' · amoCRM' : ''}</span>
        <h1>{clientTitle(client)}</h1>
        <div className="entity-meta">{client.companyName && <span><UserRound size={15}/>{client.name}</span>}{client.phone && <span><Phone size={15}/>{client.phone}</span>}{client.email && <span><Mail size={15}/>{client.email}</span>}{accountName && <span><UserRound size={15}/>Ответственный: {accountName}</span>}</div>
      </div>
      <div className="ws-actions">
        {real && <button className="btn btn-ghost btn-sm" disabled={refreshing || !canWrite} title={writeBlock ?? 'Обновить карточку из amoCRM'} onClick={() => void refresh()}><RefreshCw size={15} className={refreshing ? 'spin' : ''}/>{refreshing ? 'Обновляем…' : 'Обновить'}</button>}
        <button className="btn" disabled={!real || !canWrite || !noteTarget} title={writeBlock ?? undefined} onClick={() => setNoteForm({ target: noteTarget })}><StickyNote size={16}/>Добавить примечание</button>
        <button className="btn btn-primary" disabled={!real || !canWrite || !targets.length} title={writeBlock ?? undefined} onClick={() => setTaskForm({})}><Plus size={16}/>Добавить задачу</button>
      </div>
    </header>
    {refreshNote && <div className="page-alert"><Notice tone="warning" role="status" onClose={() => setRefreshNote(null)}>{refreshNote}</Notice></div>}
    {deals.length > 1 && <div className="deal-switch" role="group" aria-label="Сделки клиента"><span className="eyebrow">Сделки клиента · {deals.length}</span><div className="deal-chips">{deals.map(d => <button key={d.id} aria-pressed={d.id === deal?.id} className={`deal-chip${d.id === deal?.id ? ' active' : ''}${activeDeal(d) ? '' : ' closed'}`} onClick={() => selectDeal(d)}><strong>{d.title}</strong><StageBadge stage={d.stageName}/></button>)}</div></div>}
    <div className="ws-facts">
      <div><span className="eyebrow">Сделка</span><strong>{deal?.title ?? 'Нет сделки'}</strong></div>
      <div><span className="eyebrow">Этап</span>{deal ? <StageBadge stage={deal.stageName}/> : <strong>—</strong>}</div>
      <div><span className="eyebrow">Воронка</span><strong>{deal?.pipelineName ?? '—'}</strong></div>
      <div><span className="eyebrow">Бюджет</span><strong className="mono">{deal ? formatMoney(deal.amount, deal.currency) : '—'}</strong></div>
      <div><span className="eyebrow">Следующая задача</span><strong className={nextTask && taskBucket(nextTask) === 'overdue' ? 'text-danger' : ''}>{nextTask ? `${formatDate(nextTask.dueAt)} · ${nextTask.title}` : 'Нет задач'}</strong></div>
    </div>
    <div className="tabs ws-tabs" role="tablist" aria-label="Разделы клиента">{tabs.map(t => <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}{!!t.count && <span className="count" aria-hidden="true"><span>{t.count}</span></span>}</button>)}</div>

    {tab === 'overview' && <div className="detail-layout ws-overview"><div className="detail-main">
      {deal && (lead ? <EntityCard key={`lead-${lead.id}`} entity="leads" record={lead} title={deals.length > 1 ? `Сделка · ${deal.title}` : 'Сделка'} icon={BriefcaseBusiness} currency={crm?.account?.currency ?? deal.currency} onRefresh={refresh} headerExtra={<StageControl lead={lead} onRefresh={refresh}/>}/> : <Section title="Сделка" icon={BriefcaseBusiness}><div className="kv"><span>Название</span><strong>{deal.title}</strong></div><div className="kv"><span>Этап</span><StageBadge stage={deal.stageName}/></div><div className="kv"><span>Бюджет</span><strong className="mono">{formatMoney(deal.amount, deal.currency)}</strong></div>{!real && <p className="muted small-copy">{writeBlock}</p>}</Section>)}
      {deal && meetings.some(m => m.dealId === deal.id) && <Section title="Встречи по сделке" icon={CalendarDays} flush><div className="list">{meetings.filter(m => m.dealId === deal.id).map(m => <div className="list-row" key={m.id}><span className="list-icon accent"><CalendarDays size={16}/></span><div className="grow"><Link className="link-btn" to={`/meetings/${m.id}`}>Встреча: {m.title}</Link><span className="meta">{formatDate(m.startedAt)} · {formatDuration(m.durationSeconds)}</span></div></div>)}</div></Section>}
      {contact ? <EntityCard key={`contact-${contact.id}`} entity="contacts" record={contact} title="Контакт" icon={UserRound} primaryCodes={['PHONE', 'EMAIL']} onRefresh={refresh}/> : real ? <Section title="Контакт" icon={UserRound}><EmptyState compact icon={UserRound} title="К сделке не привязан контакт" detail="Привяжите контакт в amoCRM — после обновления он появится здесь."/></Section>
        : <Section title="О клиенте" icon={UserRound}><div className="kv"><span>Контакт</span><strong>{client.name}</strong></div><div className="kv"><span>Телефон</span><strong>{client.phone ?? 'Не указан'}</strong></div><div className="kv"><span>Почта</span><strong>{client.email ?? 'Не указана'}</strong></div></Section>}
      {company && <EntityCard key={`company-${company.id}`} entity="companies" record={company} title="Компания" icon={Building2} primaryCodes={['PHONE', 'EMAIL']} onRefresh={refresh}/>}
    </div><aside className="detail-side">
      <ImportantFields lead={lead}/>
      <Section title="Последняя встреча" icon={CalendarDays}>{lastMeeting ? <div className="meeting-feature"><div className="feature-meta"><span><CalendarDays size={15}/>{formatDate(lastMeeting.startedAt)}</span><span><Clock3 size={15}/>{formatDuration(lastMeeting.durationSeconds)}</span></div><h3>{lastMeeting.title}</h3>{(lastMeeting.sourceSummaryPreview ?? lastMeeting.summary) && <p>{lastMeeting.sourceSummaryPreview ?? lastMeeting.summary}</p>}<Link className="btn btn-primary" to={`/meetings/${lastMeeting.id}`}>Открыть встречу <ArrowUpRight size={16}/></Link></div> : <EmptyState compact icon={CalendarDays} title="Подтверждённых встреч пока нет." detail="Свяжите встречу с клиентом на странице встречи."/>}</Section>
      <Section title="Ближайшие задачи" icon={ListTodo} flush action={<button className="link-btn" onClick={() => setTab('tasks')}>Все</button>}>{tasks.filter(t => !t.completed).length ? <div className="task-list">{tasks.filter(t => !t.completed).sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999')).slice(0, 3).map(t => <TaskRow key={t.id} task={t} context={contextOf(t)} onEdit={task => setTaskForm({ task })} onComplete={setCompleting}/>)}</div> : <EmptyState compact icon={ListTodo} title="У клиента пока нет задач."/>}</Section>
      <Section title="Последние действия" icon={MessageSquareText} action={<button className="link-btn" onClick={() => setTab('history')}>Вся история</button>}><TimelineFeed compact items={items} limit={5} loading={refreshing && !timeline.loadedAt} dealLabel={dealLabel} onEditNote={editNote}/></Section>
    </aside></div>}
    {tab === 'history' && <div className="panel ws-panel"><TimelineFeed items={items} loading={refreshing} error={timeline.error} loadedAt={timeline.loadedAt} onRefresh={real ? () => void refresh() : undefined} dealLabel={dealLabel} onEditNote={editNote}/></div>}
    {tab === 'tasks' && <TaskGroups tasks={tasks} contextOf={contextOf} onAdd={real ? () => setTaskForm({}) : undefined} onEdit={task => setTaskForm({ task })} onComplete={setCompleting} emptyText="У клиента пока нет задач."/>}
    {tab === 'meetings' && <MeetingsTab meetings={meetings} deals={deals}/>}

    {taskForm && <TaskForm task={taskForm.task} targets={targets} defaultTarget={0} onClose={() => setTaskForm(null)}/>}
    {completing && <CompleteTaskModal task={completing} onClose={() => setCompleting(null)}/>}
    {noteForm?.target && <NoteComposer target={noteForm.target} note={noteForm.id ? { id: noteForm.id, text: noteForm.text ?? '' } : undefined} onClose={() => { setNoteForm(null); void loadTimeline(); }}/>}
  </div>;
}

function ImportantFields({ lead }: { lead?: CrmRecord }) {
  const { data } = useApp(); if (!lead || !data.crm) return null;
  const fields = importantFields(fieldViews(data.crm, 'leads', lead));
  if (!fields.length) return null;
  return <Section title="Важные поля" icon={BriefcaseBusiness}><div className="important-fields">{fields.map(f => <div key={f.id}><span className="eyebrow">{f.name}</span><FieldDisplay view={f}/></div>)}</div></Section>;
}

function MeetingsTab({ meetings, deals }: { meetings: Meeting[]; deals: Deal[] }) {
  if (!meetings.length) return <div className="panel"><EmptyState icon={CalendarDays} title="Подтверждённых встреч пока нет." detail="Встречи появляются здесь только после того, как вы подтвердите связь на странице встречи."/></div>;
  const groups = [...deals.map(d => ({ key: d.id, title: `Сделка «${d.title}»`, list: meetings.filter(m => m.dealId === d.id) })), { key: 'client', title: 'По клиенту, без сделки', list: meetings.filter(m => !m.dealId || !deals.some(d => d.id === m.dealId)) }].filter(g => g.list.length);
  return <div className="stack-lg">{groups.map(g => <section key={g.key} className="panel"><div className="panel-head"><h2>{g.title}</h2></div><div className="panel-body ws-meetings">{g.list.map(m => <div className="ws-meeting" key={m.id}><div className="date-tile" aria-hidden="true"><strong>{new Date(m.startedAt).toLocaleDateString('ru-RU', { day: '2-digit' })}</strong><span>{new Date(m.startedAt).toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')}</span></div><div className="grow"><strong>{m.title}</strong><span className="meta">{formatDate(m.startedAt)} · {formatDuration(m.durationSeconds)}{m.artifactStates?.recording ? ` · Запись: ${artifactLabel(m.artifactStates.recording).toLowerCase()}` : ''}</span>{(m.sourceSummaryPreview ?? m.summary) && <p>{m.sourceSummaryPreview ?? m.summary}</p>}</div><Link className="btn btn-sm" to={`/meetings/${m.id}`}>Открыть встречу</Link></div>)}</div></section>)}<Badge tone="neutral" small>Показаны только подтверждённые встречи</Badge></div>;
}
