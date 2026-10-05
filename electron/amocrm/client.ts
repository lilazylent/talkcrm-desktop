import type { CrmRecord } from '../../src/domain/crm.ts';
import { CrmError, endpoint, positiveId, record, writeEndpoint, type WriteMethod } from './security.ts';
import { OAuthSession } from './oauth.ts';
import { Transport } from './transport.ts';
export class AmoClient {
  constructor(readonly domain: string, private readonly session: OAuthSession|null, private readonly transport: Transport, private readonly sessionHeaders: Record<string,string> = {}) {}
  async get(relative: string): Promise<Record<string,unknown>> {
    const url = endpoint(this.domain,relative); if(!this.session)return record(await this.transport.request(url)); const token = await this.session.token();
    try { return record(await this.transport.request(url,token)); }
    catch (error) { if (!(error instanceof CrmError) || error.status !== 401) throw error; return record(await this.transport.request(url,await this.session.refresh(token))); }
  }
  /** Same single-flight OAuth refresh as reads; a browser session sends cookies through its own fetcher. */
  async send(method: WriteMethod, relative: string, body: unknown): Promise<Record<string,unknown>> {
    const url = writeEndpoint(this.domain,method,relative); if(!this.session)return record(await this.transport.send(url,method,body,undefined,this.sessionHeaders)); const token = await this.session.token();
    try { return record(await this.transport.send(url,method,body,token)); }
    catch (error) { if (!(error instanceof CrmError) || error.status !== 401) throw error; return record(await this.transport.send(url,method,body,await this.session.refresh(token))); }
  }
  /** Raw paginated list without numeric-id validation (events and field groups use string ids). */
  async list(path: string, kind: string, query: Record<string,string> = {}, maxPages = 20): Promise<Record<string,unknown>[]> {
    const result: Record<string,unknown>[] = []; const seen = new Set<string>();
    for (let page = 1; page <= maxPages; page++) {
      const url = endpoint(this.domain,path); for (const [key,value] of Object.entries(query)) url.searchParams.set(key,value); url.searchParams.set('page',String(page));
      const dto = await this.get(url.pathname+url.search); const embedded = dto._embedded ? record(dto._embedded) : {}; const items = embedded[kind] ?? [];
      if (!Array.isArray(items)) throw new CrmError('format','Некорректный список amoCRM.');
      let fresh = 0; for (const value of items) { const item = record(value); const id = String(item.id ?? ''); if (!id || seen.has(id)) continue; seen.add(id); result.push(item); fresh++; }
      const links = dto._links ? record(dto._links) : {}; if (!links.next || !fresh) return result;
    }
    return result;
  }
  async all(path: string, kind: string, query: Record<string,string> = {}, onPage: (count: number) => void = () => {}): Promise<CrmRecord[]> {
    const first = endpoint(this.domain,path); for (const [key,value] of Object.entries(query)) first.searchParams.set(key,value);
    first.searchParams.set('limit','250'); first.searchParams.set('page','1');
    let url = first; let page = 1; const seen = new Set<string>(); const result: CrmRecord[] = [];
    for (let iterations=0; iterations<10000; iterations++) {
      const dto = await this.get(url.pathname+url.search); const embedded = dto._embedded ? record(dto._embedded) : {}; const items = embedded[kind] ?? [];
      if (!Array.isArray(items)) throw new CrmError('format','Некорректный список amoCRM.');
      let fresh = 0;
      for (const value of items) { const item = record(value); const id = positiveId(kind==='links'?item.to_entity_id:item.id); const identity=kind==='links'?`${item.to_entity_type}:${id}`:String(id); if (!seen.has(identity)) { seen.add(identity); result.push({...item,id}); fresh++; } }
      onPage(result.length); const links = dto._links ? record(dto._links) : {};
      if (!links.next) return result;
      if (!fresh) throw new CrmError('pagination','amoCRM повторила страницу данных. Синхронизация остановлена.');
      const next = record(links.next).href; if (typeof next !== 'string') throw new CrmError('pagination','Некорректная следующая страница amoCRM.');
      const candidate = endpoint(this.domain,next); const nextPage = Number(candidate.searchParams.get('page'));
      if (candidate.pathname !== first.pathname || !Number.isSafeInteger(nextPage) || nextPage !== page+1) throw new CrmError('pagination','Нарушен порядок страниц amoCRM.');
      for (const [key,value] of first.searchParams) if (key !== 'page') candidate.searchParams.set(key,value);
      url = candidate; page = nextPage;
    }
    throw new CrmError('pagination','Слишком много страниц amoCRM. Кэш сохранён.');
  }
  async byIds(kind: 'contacts'|'companies', ids: number[]): Promise<CrmRecord[]> {
    const result: CrmRecord[] = [];
    for (let offset=0; offset<ids.length; offset+=50) { const query = Object.fromEntries(ids.slice(offset,offset+50).map((id,index)=>[`filter[id][${index}]`,String(id)])); result.push(...await this.all(`/api/v4/${kind}`,kind,query)); }
    return result.filter(item=>ids.includes(item.id));
  }
}
