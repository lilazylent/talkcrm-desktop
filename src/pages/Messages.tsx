import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, MessagesSquare, Search } from 'lucide-react';
import { useApp } from '../App.tsx';
import { activeTalks, channelLabel } from '../domain/talks.ts';
import { TalkRow, useOpenInAmo } from '../components/workspace/Conversations.tsx';
import { EmptyState, Notice, PageHeader, SearchField, Segmented, Select } from '../components/ui.tsx';

/** Inbox of all conversations of the manager's clients (official Talks API metadata). */
export function MessagesPage() {
  const { data } = useApp(); const { open, error } = useOpenInAmo();
  const [filter, setFilter] = useState<'all'|'unread'>('all'); const [channel, setChannel] = useState('all'); const [search, setSearch] = useState('');
  const real = data.settings.data_mode === 'amocrm' && !!data.crm?.account; const talks = useMemo(() => activeTalks(data.crm?.talks), [data.crm?.talks]);
  const clientOf = (contactId: number | null) => data.clients.find(c => c.primaryContactId === contactId);
  const channels = [...new Set(talks.map(t => channelLabel(t.origin)))];
  const q = search.trim().toLocaleLowerCase('ru-RU');
  const list = talks.filter(t => (filter === 'all' || !t.isRead) && (channel === 'all' || channelLabel(t.origin) === channel) && (!q || `${clientOf(t.contactId)?.name ?? ''} ${clientOf(t.contactId)?.companyName ?? ''}`.toLocaleLowerCase('ru-RU').includes(q)));
  return <><PageHeader eyebrow="amoCRM" title="Сообщения" subtitle={real ? `${talks.length} переписок с вашими клиентами` : 'Переписки появятся после подключения amoCRM'}/>
    {real && <div className="page-alert"><Notice icon={Info}>Список переписок из amoCRM. Текст сообщений и отправка — в карточке amoCRM; в TalkCRM они не копируются.</Notice></div>}
    {error && <div className="page-alert"><Notice tone="warning" role="status">{error}</Notice></div>}
    <div className="toolbar"><SearchField value={search} onChange={setSearch} placeholder="Клиент или контакт"/><Segmented label="Фильтр переписок" value={filter} onChange={setFilter} options={[{ key: 'all', label: 'Все', count: talks.length }, { key: 'unread', label: 'Непрочитанные', count: talks.filter(t => !t.isRead).length }]}/>{channels.length > 1 && <Select value={channel} onChange={setChannel} label="Канал"><option value="all">Все каналы</option>{channels.map(c => <option key={c}>{c}</option>)}</Select>}</div>
    {list.length ? <section className="panel"><div className="talk-list">{list.map(t => { const client = clientOf(t.contactId); const deal = data.deals.find(d => t.entityType === 'lead' && Number(d.externalId) === t.entityId); return <div key={t.talkId} className="inbox-item"><TalkRow talk={t} all={talks.filter(x => x.contactId === t.contactId)} deal={deal} client={client ? client.companyName || client.name : 'Контакт вне вашей области'} onOpen={() => { if (deal) void open('lead', Number(deal.externalId)); else if (t.contactId) void open('contact', t.contactId); }}/>{client && <Link className="link-btn inbox-link" to={`/clients/${client.id}?tab=chat`}>Карточка клиента</Link>}</div>; })}</div></section>
      : <div className="panel"><EmptyState icon={q ? Search : MessagesSquare} title={q || filter !== 'all' || channel !== 'all' ? 'Ничего не найдено' : 'Переписок пока нет'} detail={real ? 'Переписки загружаются при синхронизации amoCRM.' : undefined}/></div>}</>;
}
