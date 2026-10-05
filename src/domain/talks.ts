// Presentation helpers for amoCRM Talks (official API metadata only).
import type { CrmTalk } from './crm.ts';

const CHANNELS: [RegExp, string][] = [
  [/whats|wapp|wazzup|chatapp|radist/i, 'WhatsApp'], [/telegram|tg\b/i, 'Telegram'], [/viber/i, 'Viber'], [/insta/i, 'Instagram'],
  [/vk|vkontakte/i, 'ВКонтакте'], [/avito/i, 'Авито'], [/facebook|fb\b|messenger/i, 'Facebook'], [/sms/i, 'SMS'], [/mail|email/i, 'Почта'],
  [/max\b|oneme/i, 'MAX'], [/ok\b|odnoklassniki/i, 'Одноклассники'], [/site|widget|jivo|online/i, 'Чат на сайте']
];
/** Recognizable channel name; unknown origins show a neutral label rather than internal codes. */
export const channelLabel = (origin: string | null): string => (origin && CHANNELS.find(([re]) => re.test(origin))?.[1]) || 'Другой канал';
export const statusLabel = (talk: CrmTalk): string => talk.isInWork ? 'В работе' : ({ closed: 'Закрыта', nps_scheduled: 'Ожидает оценки', nps_in_progress: 'Оценка клиента', with_error: 'Ошибка канала' } as Record<string, string>)[talk.status ?? ''] ?? 'Закрыта';
export const activeTalks = (talks: CrmTalk[] = []): CrmTalk[] => talks.filter(t => t.availability !== 'unavailable').sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || b.talkId - a.talkId);
export const talksForContacts = (talks: CrmTalk[] = [], contactIds: number[]): CrmTalk[] => activeTalks(talks).filter(t => t.contactId !== null && contactIds.includes(t.contactId));
export const unreadCount = (talks: CrmTalk[] = []): number => activeTalks(talks).filter(t => !t.isRead).length;
/** Several talks of the same messenger are distinguished by their amoCRM source instead of being merged. */
export function talkTitle(talk: CrmTalk, all: CrmTalk[]): string {
  const label = channelLabel(talk.origin); const sources = new Set(all.filter(t => channelLabel(t.origin) === label).map(t => t.sourceId ?? 0));
  return sources.size > 1 && talk.sourceId ? `${label} · источник ${[...sources].sort().indexOf(talk.sourceId) + 1}` : label;
}
export const talkTime = (seconds: number | null): string => { if (!seconds) return '—'; const d = new Date(seconds * 1000); const today = new Date(); return d.toDateString() === today.toDateString() ? `Сегодня, ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric', hour: '2-digit', minute: '2-digit' }); };
