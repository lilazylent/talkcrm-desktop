import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BriefcaseBusiness, CalendarDays, CornerDownLeft, FileText, LayoutDashboard, ListTodo, MessagesSquare, Search, Settings, Users, type LucideIcon } from 'lucide-react';
import type { AppSnapshot } from '../domain/models.ts';
import { formatMoney } from '../domain/models.ts';

interface Item { id: string; group: string; title: string; detail?: string; icon: LucideIcon; tone?: string; to: string; haystack: string }
const fold = (value: string) => value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');

export function CommandPalette({ data, onClose }: { data: AppSnapshot; onClose: () => void }) {
  const [query, setQuery] = useState(''); const [active, setActive] = useState(0);
  const navigate = useNavigate(); const input = useRef<HTMLInputElement>(null); const list = useRef<HTMLDivElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const items = useMemo<Item[]>(() => {
    const client = (id: string | null) => data.clients.find(c => c.id === id);
    const pages: Item[] = [['/', 'Главная', LayoutDashboard], ['/meetings', 'Встречи', CalendarDays], ['/messages', 'Сообщения', MessagesSquare], ['/clients', 'Клиенты', Users], ['/deals', 'Сделки', BriefcaseBusiness], ['/tasks', 'Задачи', ListTodo], ['/templates', 'Шаблоны', FileText], ['/settings', 'Настройки', Settings]].map(([to, title, icon]) => ({ id: 'page:' + to, group: 'Разделы', title: title as string, icon: icon as LucideIcon, to: to as string, haystack: fold(title as string) }));
    return [...pages,
      ...data.meetings.map(m => ({ id: 'm:' + m.id, group: 'Встречи', title: m.title, detail: [m.crmLink?.confirmed?.clientLabel ?? client(m.clientId)?.companyName, m.participants.slice(0, 3).join(', ')].filter(Boolean).join(' · '), icon: CalendarDays, tone: 'accent', to: `/meetings/${m.id}`, haystack: fold(`${m.title} ${m.participants.join(' ')}`) })),
      ...data.clients.map(c => ({ id: 'c:' + c.id, group: 'Клиенты', title: c.companyName || c.name, detail: [c.name, c.phone, c.email].filter(Boolean).join(' · '), icon: Users, tone: 'info', to: `/clients/${c.id}`, haystack: fold(`${c.companyName ?? ''} ${c.name} ${c.email ?? ''} ${c.phone ?? ''}`) })),
      ...data.deals.map(d => ({ id: 'd:' + d.id, group: 'Сделки', title: d.title, detail: `${client(d.clientId)?.companyName ?? client(d.clientId)?.name ?? ''} · ${d.stageName} · ${formatMoney(d.amount, d.currency)}`, icon: BriefcaseBusiness, tone: 'success', to: `/clients/${d.clientId}`, haystack: fold(`${d.title} ${client(d.clientId)?.companyName ?? ''}`) }))];
  }, [data]);
  const results = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return items.filter(item => item.group === 'Разделы' || item.group === 'Встречи').slice(0, 12);
    return items.filter(item => q.split(/\s+/).every(part => item.haystack.includes(part))).slice(0, 40);
  }, [items, query]);
  const current = Math.min(active, Math.max(0, results.length - 1));
  useEffect(() => { list.current?.querySelector('.palette-item.active')?.scrollIntoView?.({ block: 'nearest' }); }, [current]);
  const go = (item: Item | undefined) => { if (!item) return; navigate(item.to); onClose(); };
  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(Math.min(current + 1, results.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(Math.max(current - 1, 0)); }
    else if (event.key === 'Enter') { event.preventDefault(); go(results[current]); }
    else if (event.key === 'Escape') { event.preventDefault(); onClose(); }
  };
  let lastGroup = '';
  return <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
    <div className="palette" role="dialog" aria-modal="true" aria-label="Быстрый поиск" onMouseDown={event => event.stopPropagation()} onKeyDown={onKey}>
      <div className="palette-input"><Search size={20}/><input ref={input} value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} placeholder="Клиент, сделка, встреча или раздел" aria-label="Быстрый поиск" role="combobox" aria-expanded="true" aria-controls="palette-results"/><kbd>Esc</kbd></div>
      <div className="palette-list" id="palette-results" role="listbox" ref={list}>
        {results.length ? results.map((item, index) => { const header = item.group !== lastGroup; lastGroup = item.group; return <div key={item.id}>{header && <div className="palette-group eyebrow">{item.group}</div>}<button role="option" aria-selected={index === current} className={`palette-item${index === current ? ' active' : ''}`} onMouseMove={() => setActive(index)} onClick={() => go(item)}><span className={`list-icon ${item.tone ?? ''}`}><item.icon size={16}/></span><span className="grow"><strong>{item.title}</strong>{item.detail && <small>{item.detail}</small>}</span>{index === current && <CornerDownLeft size={15} className="muted"/>}</button></div>; })
          : <div className="empty compact"><strong>Ничего не найдено</strong><span>Попробуйте название компании, имя контакта или сделку</span></div>}
      </div>
      <div className="palette-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> выбрать</span><span><kbd>Enter</kbd> открыть</span><span><kbd>Esc</kbd> закрыть</span></div>
    </div>
  </div>;
}
