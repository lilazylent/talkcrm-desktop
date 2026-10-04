export class CrmError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number) { super(message); }
}
export const normalizeDomain = (input: string): string => {
  if (typeof input !== 'string' || input.length > 200) throw new CrmError('input', 'Укажите домен аккаунта amoCRM.');
  const raw = input.trim().toLowerCase(); const domain = raw.includes('.') ? raw : `${raw}.amocrm.ru`;
  let url: URL;
  try { url = new URL(domain.startsWith('https://') ? domain : `https://${domain}`); } catch { throw new CrmError('input', 'Некорректный домен amoCRM.'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !/^[a-z0-9][a-z0-9-]*\.amocrm\.ru$/.test(url.hostname)) throw new CrmError('input', 'Нужен HTTPS-домен вида company.amocrm.ru.');
  return url.hostname;
};
export const endpoint = (domain: string, relative: string): URL => {
  const base = `https://${normalizeDomain(domain)}`; const url = new URL(relative, base);
  if (url.origin !== base || (!/^\/api\/v4\/(account|leads|contacts|companies|tasks)(\/\d+)?(\/links|\/notes|\/custom_fields)?$/.test(url.pathname) && url.pathname !== '/api/v4/leads/pipelines')) throw new CrmError('endpoint', 'Недопустимый адрес API.');
  return url;
};
export const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CrmError('format', 'amoCRM вернула неожиданный формат данных.');
  return value as Record<string, unknown>;
};
export const positiveId = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new CrmError('format', 'amoCRM вернула некорректный идентификатор.'); return value;
};
export const safeMessage = (error: unknown): string => error instanceof CrmError ? error.message : 'Не удалось обработать данные. Сохранённый кэш доступен.';
export const statusError = (status: number): CrmError => new CrmError(`http_${status}`, ({401:'Авторизация истекла. Подключите amoCRM заново.',402:'API недоступен: проверьте оплату аккаунта amoCRM.',403:'Нет прав на чтение этих данных amoCRM.',404:'Данные amoCRM не найдены или недоступны.',422:'amoCRM отклонила параметры запроса.',429:'Превышен лимит amoCRM. Повторите синхронизацию позже.'} as Record<number,string>)[status] ?? 'amoCRM временно недоступна. Повторите попытку.', status);
