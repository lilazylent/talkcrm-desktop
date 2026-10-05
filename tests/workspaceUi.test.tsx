import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../src/App.tsx';
import demo from '../public/demo-preview.json';
import type { AppSnapshot } from '../src/domain/models.ts';
import type { CrmCommand, CrmWriteResult } from '../src/domain/crmWrite.ts';
import { getBrowserDemoApi } from '../src/services/browserDemo.ts';
import { mapWorkspace } from '../electron/amocrm/mapping.ts';
import type { CrmAccount, CrmRecord, CrmRelation } from '../src/domain/crm.ts';

const account: CrmAccount = { id: '1_t', externalId: 1, domain: 't.amocrm.ru', name: 'Тест', currentUserId: 9, authorized: true, expiresAt: 0, lastSyncAt: new Date().toISOString(), state: 'success', error: null, currency: 'RUB', authMode: 'browser' };
const pipelines: CrmRecord[] = [{ id: 5, name: 'Продажи', _embedded: { statuses: [{ id: 50, name: 'Переговоры', sort: 10 }, { id: 51, name: 'Согласование', sort: 20 }, { id: 142, name: 'Успешно', sort: 90 }, { id: 143, name: 'Закрыто', sort: 100 }] } }];
const leads: CrmRecord[] = [{ id: 10, name: 'Основная сделка', responsible_user_id: 9, pipeline_id: 5, status_id: 50, price: 1000, updated_at: 1700000200, created_at: 1700000000 }, { id: 11, name: 'Вторая сделка', responsible_user_id: 9, pipeline_id: 5, status_id: 51, price: 500, updated_at: 1700000100, created_at: 1700000000 }];
const contacts: CrmRecord[] = [{ id: 20, name: 'Ирина Без Компании', updated_at: 1700000000, custom_fields_values: [{ field_id: 1, field_code: 'PHONE', values: [{ value: '+7 900 000-00-00', enum_code: 'MOB' }] }] }];
const relations: CrmRelation[] = [{ leadId: 10, entityType: 'contacts', entityId: 20, primary: true }, { leadId: 11, entityType: 'contacts', entityId: 20, primary: true }];
const fields = [{ entity: 'contacts', definition: { id: 1, name: 'Телефон', type: 'multitext', code: 'PHONE', enums: [{ id: 1, value: 'WORK' }, { id: 3, value: 'MOB' }] } }];
let data: AppSnapshot; let write: ReturnType<typeof vi.fn<(command: CrmCommand) => Promise<CrmWriteResult>>>;
const clientId = 'amocrm:1_t:contact:20';
beforeEach(() => {
  const crm = { account, contacts, companies: [], pipelines, notes: [], fields, leads, relations, taskTypes: [{ id: 1, name: 'Звонок' }], contactNotes: [], companyNotes: [], editableNotes: [] };
  data = { ...(structuredClone(demo) as AppSnapshot), ...mapWorkspace(account, leads, crm, relations, []), crm, meetings: [], settings: { data_mode: 'amocrm' } };
  write = vi.fn(async (command: CrmCommand): Promise<CrmWriteResult> => ({ ok: true, status: 'confirmed', message: 'Сохранено в amoCRM', operationId: command.operationId }));
  window.location.hash = `#/clients/${clientId}`;
  window.talkcrm = { ...getBrowserDemoApi(), getSnapshot: vi.fn(async () => data), writeCrm: write, refreshWorkspace: vi.fn(async () => ({ ok: true, message: 'ok' })), getTimeline: vi.fn(async () => ({ events: [], loadedAt: new Date().toISOString(), error: null })), onSyncProgress: () => () => {}, onKonturProgress: () => () => {} };
});
afterEach(() => { cleanup(); delete window.talkcrm; });

it('works for a contact-only client: no company block, contact and deal cards render', async () => {
  render(<App/>); await screen.findByRole('heading', { name: 'Ирина Без Компании', level: 1 });
  expect(screen.getByRole('heading', { name: 'Контакт' })).toBeTruthy(); expect(screen.queryByRole('heading', { name: 'Компания' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Сделка · Основная сделка' })).toBeTruthy(); expect(screen.queryByText(/Написать|Позвонить/)).toBeNull();
});

it('switches between multiple deals without merging them', async () => {
  render(<App/>); await screen.findByRole('heading', { name: 'Сделка · Основная сделка' });
  fireEvent.click(screen.getByRole('button', { name: /Вторая сделка/ }));
  expect(await screen.findByRole('heading', { name: 'Сделка · Вторая сделка' })).toBeTruthy(); expect(screen.queryByRole('heading', { name: 'Сделка · Основная сделка' })).toBeNull();
});

it('changes an open stage immediately and asks before closing the deal', async () => {
  render(<App/>); await screen.findByRole('heading', { name: 'Сделка · Основная сделка' });
  fireEvent.click(screen.getByRole('button', { name: 'Изменить этап' })); fireEvent.click(screen.getByRole('option', { name: 'Согласование' }));
  await waitFor(() => expect(write).toHaveBeenCalledWith(expect.objectContaining({ type: 'entity.update', entity: 'leads', entityId: 10, changes: { statusId: 51 }, original: { status: '5:50' }, confirmTerminal: false })));
  fireEvent.click(screen.getByRole('button', { name: 'Изменить этап' })); fireEvent.click(screen.getByRole('option', { name: 'Успешно реализовано' }));
  const dialog = await screen.findByRole('dialog'); expect(write).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Перевести' }));
  await waitFor(() => expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ changes: { statusId: 142 }, confirmTerminal: true })));
});

it('edits only changed fields in explicit edit mode and shows the confirmed save state', async () => {
  render(<App/>); await screen.findByRole('heading', { name: 'Сделка · Основная сделка' });
  const card = screen.getByRole('heading', { name: 'Сделка · Основная сделка' }).closest('section')!;
  fireEvent.click(within(card).getByRole('button', { name: 'Редактировать' }));
  const save = within(card).getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement; expect(save.disabled).toBe(true);
  fireEvent.change(within(card).getByLabelText('Бюджет, ₽'), { target: { value: '2 500' } }); fireEvent.click(save);
  await waitFor(() => expect(write).toHaveBeenCalledWith(expect.objectContaining({ entityId: 10, changes: { price: 2500 }, original: { price: '1000' }, baseUpdatedAt: 1700000200 })));
  expect(await within(card).findByText('Сохранено в amoCRM')).toBeTruthy();
});

it('keeps edits and explains a remote conflict instead of overwriting', async () => {
  write.mockResolvedValueOnce({ ok: false, status: 'conflict', message: 'Карточка изменилась в amoCRM.', operationId: 'x' });
  render(<App/>); await screen.findByRole('heading', { name: 'Контакт' });
  const card = screen.getByRole('heading', { name: 'Контакт' }).closest('section')!;
  fireEvent.click(within(card).getByRole('button', { name: 'Редактировать' })); fireEvent.change(within(card).getByLabelText('Имя контакта'), { target: { value: 'Ирина Новая' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Сохранить' }));
  expect(await within(card).findByText('Карточка изменилась в amoCRM.', { selector: 'strong' })).toBeTruthy();
  expect(within(card).getByRole('button', { name: 'Обновить данные' })).toBeTruthy(); expect((within(card).getByLabelText('Имя контакта') as HTMLInputElement).value).toBe('Ирина Новая');
});

it('adds a note to the selected deal with Ctrl+Enter', async () => {
  render(<App/>); await screen.findByRole('heading', { name: 'Сделка · Основная сделка' });
  fireEvent.click(screen.getByRole('button', { name: 'Добавить примечание' }));
  const box = within(screen.getByRole('dialog')).getByLabelText('Текст примечания'); fireEvent.change(box, { target: { value: 'Созвонились, ждут КП' } }); fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(write).toHaveBeenCalledWith(expect.objectContaining({ type: 'note.create', entity: 'leads', entityId: 10, text: 'Созвонились, ждут КП' })));
});

it('blocks remote mutations offline and keeps data viewable', async () => {
  render(<App/>); await screen.findByRole('heading', { name: 'Ирина Без Компании', level: 1 });
  act(() => { window.dispatchEvent(new Event('offline')); });
  expect(await screen.findByText('Нет соединения с amoCRM. Данные доступны только для просмотра.')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Добавить задачу' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getAllByRole('button', { name: 'Редактировать' })[0] as HTMLButtonElement).disabled).toBe(true);
  act(() => { window.dispatchEvent(new Event('online')); });
});
