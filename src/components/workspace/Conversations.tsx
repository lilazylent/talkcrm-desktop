import { useState } from 'react';
import { ExternalLink, Info, MessagesSquare } from 'lucide-react';
import { useApp } from '../../App.tsx';
import type { CrmTalk } from '../../domain/crm.ts';
import type { Deal } from '../../domain/models.ts';
import { channelLabel, statusLabel, talkTime, talkTitle } from '../../domain/talks.ts';
import { Badge, EmptyState, Notice } from '../ui.tsx';

/** Opens the official amoCRM card, where the manager reads and sends messages. */
export function useOpenInAmo() {
  const { api } = useApp(); const [error, setError] = useState<string | null>(null);
  const open = async (kind: 'lead'|'contact', id: number) => { setError(null); const r = await api.openInAmo?.(kind, id).catch(() => null); if (!r?.ok) setError(r?.message ?? 'Открыть amoCRM можно в установленном TalkCRM Desktop.'); };
  return { open, error };
}

export function TalkRow({ talk, all, deal, onOpen, client }: { talk: CrmTalk; all: CrmTalk[]; deal?: Deal; onOpen: () => void; client?: string }) {
  return <div className={`talk-row${talk.isRead ? '' : ' unread'}`}>
    <span className={`channel-mark ch-${channelLabel(talk.origin).replace(/\s/g, '')}`} aria-hidden="true"><MessagesSquare size={17}/></span>
    <div className="grow"><div className="talk-head">{client && <strong className="talk-client">{client}</strong>}<strong>{talkTitle(talk, all)}</strong>{!talk.isRead && <Badge tone="accent" dot small>Непрочитано</Badge>}<Badge tone={talk.isInWork ? 'success' : talk.status === 'with_error' ? 'danger' : 'neutral'} small>{statusLabel(talk)}</Badge></div>
      <span className="meta">Обновлено: {talkTime(talk.updatedAt)} · начата {talkTime(talk.createdAt)}{deal ? ` · Сделка «${deal.title}»` : ''}</span></div>
    <button className="btn btn-sm" onClick={onOpen}><ExternalLink size={14}/>Открыть в amoCRM</button>
  </div>;
}

/** Client «Чат» tab: conversations from the official Talks API, separate from notes, tasks and history. */
export function ChatTab({ talks, deals, contactId }: { talks: CrmTalk[]; deals: Deal[]; contactId: number | null }) {
  const { open, error } = useOpenInAmo();
  const dealOf = (t: CrmTalk) => t.entityType === 'lead' && t.entityId ? deals.find(d => Number(d.externalId) === t.entityId) : undefined;
  const openTalk = (t: CrmTalk) => { const deal = dealOf(t); if (deal) void open('lead', Number(deal.externalId)); else if (t.contactId) void open('contact', t.contactId); };
  return <div className="stack-lg">
    <Notice icon={Info}>Здесь видны переписки клиента из amoCRM: каналы, статус и непрочитанные. Текст сообщений и отправка доступны в amoCRM: кнопка «Открыть в amoCRM» ведёт прямо в карточку. Примечания и задачи остаются в своих разделах.</Notice>
    {error && <Notice tone="warning" role="status">{error}</Notice>}
    {talks.length ? <section className="panel"><div className="panel-head"><h2>Переписки · {talks.length}</h2></div><div className="talk-list">{talks.map(t => <TalkRow key={t.talkId} talk={t} all={talks} deal={dealOf(t)} onOpen={() => openTalk(t)}/>)}</div></section>
      : <div className="panel"><EmptyState icon={MessagesSquare} title="Переписок с клиентом пока нет." detail={contactId ? 'Когда клиент напишет в подключённый в amoCRM канал, переписка появится здесь после обновления.' : 'У клиента нет контакта в amoCRM — переписки привязываются к контакту.'}/></div>}
  </div>;
}
