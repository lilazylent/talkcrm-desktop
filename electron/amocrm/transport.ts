import { randomUUID } from 'node:crypto';
import { CrmError, endpoint, normalizeDomain, record, statusError, writeEndpoint, writeStatusError, type WriteMethod } from './security.ts';
export class Transport {
  private tail: Promise<void> = Promise.resolve(); private nextAt = 0;
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms)), private readonly now = Date.now, private readonly log: (line: string) => void = () => {}) {}
  private async throttle(start:()=>Promise<Response>): Promise<Response> {
    let response!:Promise<Response>;
    const turn = this.tail.then(async () => { await this.sleep(Math.max(0, this.nextAt - this.now())); this.nextAt = this.now() + 200; response=start(); }); this.tail = turn.catch(() => {}); await turn;return response;
  }
  async request(url: URL, token?: string, oauth?: Record<string, string>): Promise<unknown> {
    normalizeDomain(url.origin);
    if(oauth){if(url.pathname!=='/oauth2/access_token'||url.search||!['authorization_code','refresh_token'].includes(oauth.grant_type))throw new CrmError('endpoint','Недопустимый запрос авторизации.');}else endpoint(url.hostname,url.href);
    for (let attempt = 0; attempt < 3; attempt++) {
      const correlation = randomUUID(); const start = this.now(); let response: Response;
      try { response = await this.throttle(()=>this.fetcher(url, { method: oauth ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(20000), headers: {Accept:'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {}), ...(oauth ? {'Content-Type':'application/json'} : {})}, ...(oauth ? {body:JSON.stringify(oauth)} : {}) })); }
      catch { this.log(`request=${correlation} method=${oauth?'POST':'GET'} path=${url.pathname} network_error duration=${this.now()-start}`); throw new CrmError('network','Нет ответа amoCRM. Проверьте интернет. Сохранённый кэш доступен.'); }
      this.log(`request=${correlation} method=${oauth?'POST':'GET'} path=${url.pathname} status=${response.status} duration=${this.now()-start}`);
      if (!oauth && (response.status === 429 || response.status >= 500) && attempt < 2) {
        const header = response.headers.get('Retry-After'); const seconds = header && /^\d+$/.test(header) ? Number(header)*1000 : header ? Date.parse(header)-this.now() : NaN;
        await this.sleep(Math.min(60000, Math.max(200, Number.isFinite(seconds) ? seconds : 1000*2**attempt))); continue;
      }
      if (!response.ok) throw statusError(response.status); if (response.status === 204) return {};
      try { return record(await response.json()); } catch { throw new CrmError('format','amoCRM вернула некорректный JSON.'); }
    }
    throw new CrmError('retry','Исчерпаны попытки запроса amoCRM.');
  }
  /**
   * Mutation request sharing the same limiter as reads. 429 is retried (the request was not processed).
   * PATCH is retried on 5xx because it sets absolute values; POST never is: a lost response is reported as
   * `ambiguous` so the caller reconciles before any new attempt.
   */
  async send(url: URL, method: WriteMethod, body: unknown, token?: string, headers: Record<string,string> = {}): Promise<unknown> {
    writeEndpoint(url.hostname, method, url.pathname + url.search);
    for (let attempt = 0; attempt < 3; attempt++) {
      const correlation = randomUUID(); const start = this.now(); let response: Response;
      try { response = await this.throttle(()=>this.fetcher(url, { method, redirect: 'error', signal: AbortSignal.timeout(20000), headers: {Accept:'application/json','Content-Type':'application/json',...headers,...(token ? {Authorization:`Bearer ${token}`} : {})}, body: JSON.stringify(body) })); }
      catch { this.log(`request=${correlation} method=${method} path=${url.pathname} network_error duration=${this.now()-start}`); throw method === 'POST' ? new CrmError('ambiguous','Нет ответа amoCRM. Проверяем, сохранилось ли изменение.') : new CrmError('network','Нет соединения с amoCRM. Изменение не сохранено.'); }
      this.log(`request=${correlation} method=${method} path=${url.pathname} status=${response.status} duration=${this.now()-start}`);
      const retryable = response.status === 429 || (method === 'PATCH' && [502,503,504].includes(response.status));
      if (retryable && attempt < 2) {
        const header = response.headers.get('Retry-After'); const seconds = header && /^\d+$/.test(header) ? Number(header)*1000 : NaN;
        await this.sleep(Math.min(30000, Math.max(500, Number.isFinite(seconds) ? seconds : 1000*2**attempt))); continue;
      }
      if (method === 'POST' && response.status >= 500) throw new CrmError('ambiguous','amoCRM не подтвердила сохранение. Проверяем результат.', response.status);
      if (!response.ok) throw writeStatusError(response.status); if (response.status === 204) return {};
      try { return record(await response.json()); } catch { throw new CrmError('format','amoCRM вернула некорректный JSON.'); }
    }
    throw writeStatusError(429);
  }
}
