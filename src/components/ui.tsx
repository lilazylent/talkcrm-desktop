import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronDown, Inbox, Search, X, type LucideIcon } from 'lucide-react';
import type { MatchingStatus } from '../domain/models.ts';
import { matchingLabel } from '../domain/models.ts';

export type Tone = 'neutral'|'accent'|'success'|'warning'|'danger'|'info'|'violet';

export function PageHeader({ title, subtitle, eyebrow, action }: { title: string; subtitle?: ReactNode; eyebrow?: string; action?: ReactNode }) {
  return <header className="page-header"><div className="titles">{eyebrow&&<span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action&&<div className="actions">{action}</div>}</header>;
}
export function BackLink({ to, label }: { to: string; label: string }) { return <Link className="back-link" to={to}><ArrowLeft size={16}/>{label}</Link>; }
export function Section({ title, icon: Icon, action, children, flush, className }: { title: string; icon?: LucideIcon; action?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return <section className={`panel${className?' '+className:''}`}><div className="panel-head"><h2>{Icon&&<span className="panel-icon"><Icon size={16}/></span>}{title}</h2><span className="spacer"/>{action}</div><div className={`panel-body${flush?' flush':''}`}>{children}</div></section>;
}
export function EmptyState({ title, detail, icon: Icon = Inbox, action, compact }: { title: string; detail?: string; icon?: LucideIcon; action?: ReactNode; compact?: boolean }) {
  return <div className={`empty${compact?' compact':''}`}><div className="empty-icon"><Icon size={22}/></div><strong>{title}</strong>{detail && <span>{detail}</span>}{action}</div>;
}
export function SearchField({ value, onChange, placeholder = 'Поиск', label }: { value: string; onChange: (value: string) => void; placeholder?: string; label?: string }) {
  return <label className="search"><Search size={17}/><input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} aria-label={label}/></label>;
}
export function Select({ value, onChange, label, children, icon: Icon, disabled }: { value: string; onChange: (value: string) => void; label: string; children: ReactNode; icon?: LucideIcon; disabled?: boolean }) {
  return <label className={`select${Icon?' with-icon':''}`}>{Icon&&<Icon className="lead-icon" size={16}/>}<select value={value} disabled={disabled} onChange={event => onChange(event.target.value)} aria-label={label}>{children}</select><ChevronDown size={16}/></label>;
}
export function Badge({ tone = 'neutral', dot, small, children }: { tone?: Tone; dot?: boolean; small?: boolean; children: ReactNode }) {
  return <span className={`badge tone-${tone}${dot?' dot':''}${small?' sm':''}`}><span>{children}</span></span>;
}
const statusTone: Record<MatchingStatus, Tone> = { linked: 'success', review: 'warning', unlinked: 'danger' };
export function StatusBadge({ status }: { status: MatchingStatus }) { return <Badge tone={statusTone[status]} dot>{matchingLabel(status)}</Badge>; }
export function stageTone(stage: string): Tone {
  const s = stage.toLocaleLowerCase('ru-RU');
  if (/успешн|реализовано$|выигр/.test(s) && !/не реализ/.test(s)) return 'success';
  if (/не реализ|отказ|закрыт|проигр/.test(s)) return 'danger';
  if (/нов|первич|входящ/.test(s)) return 'info';
  if (/квалиф/.test(s)) return 'violet';
  if (/соглас|договор|счёт|счет|оплат/.test(s)) return 'warning';
  if (/перегов|презент|демо|встреч/.test(s)) return 'accent';
  return 'neutral';
}
export function StageBadge({ stage }: { stage: string }) { return <Badge tone={stageTone(stage)} dot>{stage}</Badge>; }

const avatarHues = ['#5b5cf0','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6'];
export const initials = (name: string): string => name.replace(/[«»"'()]/g, '').replace(/^(ООО|ИП|АО|ПАО|ЗАО)\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('ru-RU') || '•';
export function Avatar({ name, size, round }: { name: string; size?: 'sm'|'lg'; round?: boolean }) {
  let hash = 0; for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return <span aria-hidden="true" className={`avatar${size?' '+size:''}${round?' round':''}`} style={{ ['--av' as string]: avatarHues[hash % avatarHues.length] }}>{initials(name)}</span>;
}
export function Modal({ title, children, onClose, icon: Icon, wide }: { title: string; children: ReactNode; onClose: () => void; icon?: LucideIcon; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input:not([disabled]),select')?.focus?.();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { close.current(); return; }
      if (event.key !== 'Tab' || !ref.current) return;
      const focusable = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, []);
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><div ref={ref} className={`modal${wide?' wide':''}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={event => event.stopPropagation()}><div className="modal-heading">{Icon&&<span className="modal-icon"><Icon size={20}/></span>}<h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={18}/></button></div><div className="modal-body">{children}</div></div></div>;
}
export function Notice({ tone, icon: Icon, children, onClose, role }: { tone?: 'info'|'warning'|'danger'|'success'; icon?: LucideIcon; children: ReactNode; onClose?: () => void; role?: 'status'|'alert' }) {
  return <div className={`notice${tone?' '+tone:''}`} role={role}>{Icon&&<Icon size={18}/>}<div className="grow">{children}</div>{onClose&&<button className="icon-btn" onClick={onClose} aria-label="Скрыть сообщение"><X size={16}/></button>}</div>;
}
export function Segmented<T extends string>({ options, value, onChange, label }: { options: { key: T; label: string; count?: number }[]; value: T; onChange: (value: T) => void; label: string }) {
  return <div className="segmented" role="group" aria-label={label}>{options.map(option => <button key={option.key} type="button" aria-pressed={value === option.key} className={value === option.key ? 'selected' : ''} onClick={() => onChange(option.key)}>{option.label}{option.count !== undefined && <span className="count" aria-hidden="true"><span>{option.count}</span></span>}</button>)}</div>;
}
export function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return <div className="facts">{items.map(item => <div key={item.label}><span className="eyebrow">{item.label}</span><strong>{item.value}</strong></div>)}</div>;
}
