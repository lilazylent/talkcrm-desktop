import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Search } from 'lucide-react';
import type { MatchingStatus } from '../domain/models.ts';
import { matchingLabel } from '../domain/models.ts';

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="page-header"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}
export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="section"><div className="section-heading"><h2>{title}</h2>{action}</div>{children}</section>;
}
export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return <div className="empty-state"><div className="empty-symbol">○</div><strong>{title}</strong>{detail && <span>{detail}</span>}</div>;
}
export function SearchField({ value, onChange, placeholder = 'Поиск' }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="search-field"><Search size={17}/><input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder}/></label>;
}
export function StatusBadge({ status }: { status: MatchingStatus }) {
  return <span className={`status status-${status}`}>{matchingLabel(status)}</span>;
}
export function StageBadge({ stage }: { stage: string }) { return <span className="stage">{stage}</span>; }
export function RowLink({ to, children }: { to: string; children: ReactNode }) { return <Link className="row-link" to={to}>{children}<ChevronRight size={17}/></Link>; }
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Закрыть">×</button></div>{children}</div></div>;
}
