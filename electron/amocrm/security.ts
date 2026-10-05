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
  if (url.origin !== base || !readPaths.some(pattern => pattern.test(url.pathname))) throw new CrmError('endpoint', 'Недопустимый адрес API.');
  return url;
};
const readPaths = [
  /^\/api\/v4\/(account|leads|contacts|companies|tasks)(\/\d+)?(\/links|\/notes|\/custom_fields)?$/,
  /^\/api\/v4\/leads\/pipelines$/, /^\/api\/v4\/events$/, /^\/api\/v4\/talks(\/\d+)?$/, /^\/api\/v4\/(leads|contacts|companies)\/custom_fields\/groups$/,
  /^\/api\/v4\/(leads|contacts|companies)\/notes\/\d+$/
];
// Mutation allowlist: updates and creation only. No DELETE, no schema, pipeline, user or account administration.
const writeRoutes: Array<[string, RegExp]> = [
  ['PATCH', /^\/api\/v4\/(leads|contacts|companies)\/\d+$/],
  ['POST', /^\/api\/v4\/tasks$/], ['PATCH', /^\/api\/v4\/tasks\/\d+$/],
  ['POST', /^\/api\/v4\/(leads|contacts|companies)\/notes$/], ['PATCH', /^\/api\/v4\/(leads|contacts|companies)\/notes\/\d+$/]
];
export type WriteMethod = 'POST'|'PATCH';
export const writeEndpoint = (domain: string, method: string, relative: string): URL => {
  const base = `https://${normalizeDomain(domain)}`; const url = new URL(relative, base);
  if (url.origin !== base || url.search || !writeRoutes.some(([m, pattern]) => m === method && pattern.test(url.pathname))) throw new CrmError('endpoint', 'Недопустимое изменение amoCRM.');
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
export const writeStatusError = (status: number): CrmError => new CrmError(`write_${status}`, ({400:'amoCRM отклонила изменение. Проверьте значения полей.',401:'Сессия amoCRM закончилась. Подключите аккаунт снова.',402:'API недоступен: проверьте оплату аккаунта amoCRM.',403:'У вас нет прав на это изменение в amoCRM.',404:'Запись не найдена в amoCRM. Обновите данные.',422:'amoCRM отклонила изменение. Проверьте значения полей.',429:'amoCRM просит подождать. Повторите через минуту.'} as Record<number,string>)[status] ?? 'amoCRM временно недоступна. Изменение не сохранено.', status);
export const statusError = (status: number): CrmError => new CrmError(`http_${status}`, ({401:'Авторизация истекла. Подключите amoCRM заново.',402:'API недоступен: проверьте оплату аккаунта amoCRM.',403:'Нет прав на чтение этих данных amoCRM.',404:'Данные amoCRM не найдены или недоступны.',422:'amoCRM отклонила параметры запроса.',429:'Превышен лимит amoCRM. Повторите синхронизацию позже.'} as Record<number,string>)[status] ?? 'amoCRM временно недоступна. Повторите попытку.', status);
