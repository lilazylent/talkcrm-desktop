import { randomUUID } from 'node:crypto';
import { CrmError, endpoint, normalizeDomain, record, statusError } from './security.ts';
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
}
