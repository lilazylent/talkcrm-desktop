import type { CrmAccount, CrmResult, SyncProgress } from '../../src/domain/crm.ts';
import type { SecureCredentialStore } from '../../src/services/contracts.ts';
import { SqliteRepository } from '../repository.ts';
import { AmoClient } from './client.ts';
import { credentialKey, OAuthSession, validateConnect, type CredentialBundle } from './oauth.ts';
import { CrmError, normalizeDomain, positiveId, record, safeMessage } from './security.ts';
import { collectSync } from './sync.ts';
import { Transport } from './transport.ts';
import type { BrowserAccess } from './browserAccess.ts';
import { browserCredentialKey } from './browserPolicy.ts';
export class CrmService {
  private client: AmoClient|null=null; private syncing:Promise<CrmResult>|null=null; private connecting=false;
  private browserDomain:string|null=null;
  constructor(private readonly repository:SqliteRepository,private readonly store:SecureCredentialStore,private readonly transport:Transport,private readonly progress:(p:SyncProgress)=>void,private readonly browser?:BrowserAccess){}
  async openBrowser(value:unknown):Promise<CrmResult>{
    if(this.connecting||this.syncing)return{ok:false,message:'Дождитесь текущей операции.'};this.connecting=true;
    try{if(!this.browser)throw new CrmError('browser_unavailable','Вход через браузер доступен в установленном приложении.');if(typeof value!=='string')throw new CrmError('input','Укажите домен amoCRM.');const domain=normalizeDomain(value);const old=this.repository.getCrmAccount();await this.browser.open(domain,old?.domain===domain&&old.authMode==='browser'?old.id:undefined);this.browserDomain=domain;return{ok:true,message:'Войдите в открытом окне amoCRM. Затем вернитесь сюда и нажмите «Проверить доступ и загрузить».'};}
    catch(error){return{ok:false,message:safeMessage(error)};}finally{this.connecting=false;}
  }
  async verifyBrowser():Promise<CrmResult>{
    if(this.connecting||this.syncing)return{ok:false,message:'Дождитесь текущей операции.'};this.connecting=true;
    try{
      if(!this.browser||!this.browserDomain)throw new CrmError('browser_missing','Сначала откройте окно входа.');const domain=this.browserDomain;const client=await this.browser.client(domain);const raw=await client.get('/api/v4/account');
      const externalId=positiveId(raw.id);const currentUserId=positiveId(raw.current_user_id);const id=`${externalId}_${domain.split('.')[0]}`;const old=this.repository.getCrmAccount();
      const account:CrmAccount={id,externalId,domain,name:typeof raw.name==='string'?raw.name:domain,currentUserId,authorized:true,expiresAt:0,lastSyncAt:old?.id===id?old.lastSyncAt:null,state:'idle',error:null,currency:typeof raw.currency==='string'?raw.currency:null,authMode:'browser'};
      await this.browser.persist(domain,id);await this.repository.connectAccount(account);this.client=client;
      await this.store.delete(credentialKey(id));if(old&&old.id!==id){await this.store.delete(credentialKey(old.id));await this.store.delete(browserCredentialKey(old.id));}
      this.browser.close();this.browserDomain=null;return{ok:true,message:'Чтение через браузерную сессию доступно. Можно запускать синхронизацию.'};
    }catch(error){const reason=error instanceof CrmError&&[401,403].includes(error.status??0)?'Сессия пока не даёт доступа к чтению API. Если вход уже выполнен, потребуется отдельный адаптер интерфейса; он ещё не реализован.':safeMessage(error);return{ok:false,message:reason};}finally{this.connecting=false;}
  }
  private session(bundle:CredentialBundle,accountId:string):OAuthSession{return new OAuthSession(bundle,this.store,accountId,this.transport,expires=>this.repository.setCrmExpiry(expires));}
  async connect(value:unknown):Promise<CrmResult>{
    if(this.connecting||this.syncing)return{ok:false,message:'Дождитесь текущей операции.'};this.connecting=true;
    try{
      const input=validateConnect(value);let bundle:CredentialBundle;
      try{bundle=await OAuthSession.exchange(input,this.transport);}finally{input.code='';input.clientSecret='';const rawInput=record(value);rawInput.code='';rawInput.clientSecret='';}
      const raw=record(await this.transport.request(new URL(`https://${bundle.domain}/api/v4/account`),bundle.accessToken));
      const externalId=positiveId(raw.id);const currentUserId=positiveId(raw.current_user_id);const id=`${externalId}_${bundle.domain.split('.')[0]}`;
      const old=this.repository.getCrmAccount();const account:CrmAccount={id,externalId,domain:bundle.domain,name:typeof raw.name==='string'?raw.name:bundle.domain,currentUserId,authorized:true,expiresAt:bundle.expiresAt,lastSyncAt:old?.id===id?old.lastSyncAt:null,state:'idle',error:null,currency:typeof raw.currency==='string'?raw.currency:null};
      await this.store.set(credentialKey(id),JSON.stringify(bundle));await this.repository.connectAccount(account);
      this.client=new AmoClient(bundle.domain,this.session(bundle,id),this.transport);
      await this.store.delete(browserCredentialKey(id));await this.browser?.clear();this.browserDomain=null;
      if(old&&old.id!==id){await this.store.delete(credentialKey(old.id));await this.store.delete(browserCredentialKey(old.id));}
      return{ok:true,message:'amoCRM подключена. Запустите первую синхронизацию.'};
    }catch(error){return{ok:false,message:safeMessage(error)};}finally{this.connecting=false;}
  }
  private async loadClient(account:CrmAccount):Promise<AmoClient>{
    if(account.authMode==='browser'){if(this.client)return this.client;if(!this.browser)throw new CrmError('browser_missing','Войдите в amoCRM заново.');this.client=await this.browser.client(account.domain,account.id);return this.client;}
    if(this.client)return this.client;const secret=await this.store.get(credentialKey(account.id));if(!secret)throw new CrmError('oauth_missing','Ключи подключения недоступны. Подключите amoCRM заново.');
    const dto=record(JSON.parse(secret));
    if(normalizeDomain(String(dto.domain))!==account.domain||['clientId','clientSecret','redirectUri','accessToken','refreshToken'].some(key=>typeof dto[key]!=='string'||!dto[key])||typeof dto.expiresAt!=='number')throw new CrmError('oauth_store','Сохранённое подключение повреждено. Подключите amoCRM заново.');
    const bundle=dto as unknown as CredentialBundle;this.client=new AmoClient(account.domain,this.session(bundle,account.id),this.transport);return this.client;
  }
  async sync():Promise<CrmResult>{
    if(this.syncing)return this.syncing;if(this.connecting)return{ok:false,message:'Дождитесь подключения.'};
    this.syncing=this.runSync();try{return await this.syncing;}finally{this.syncing=null;}
  }
  private async runSync():Promise<CrmResult>{
    const account=this.repository.getCrmAccount();if(!account?.authorized)return{ok:false,message:'Подключите amoCRM в настройках.'};
    const runId=await this.repository.startSync();
    try{const batch=await collectSync(await this.loadClient(account),account,this.progress);const latest=this.repository.getCrmAccount();if(latest)batch.account.expiresAt=latest.expiresAt;if(account.authMode==='browser')await this.browser?.persist(account.domain,account.id);await this.repository.commitCrmSync(batch,runId);const message=batch.warnings.length?`Синхронизация завершена частично: ${batch.warnings.join(' ')}`:`Обновлено: ${batch.leads.length} сделок, ${batch.contacts.length} контактов, ${batch.companies.length} компаний.`;this.progress({state:batch.warnings.length?'partial_error':'success',stage:message,completed:batch.leads.length,total:batch.leads.length});return{ok:true,message};}
    catch(error){const message=safeMessage(error);const unauthorized=error instanceof CrmError&&(error.status===401||error.code.startsWith('oauth_')||error.code==='browser_missing');await this.repository.failSync(runId,message,unauthorized);this.progress({state:'failed',stage:message,completed:0,total:null});return{ok:false,message};}
  }
  async disconnect(purge:boolean):Promise<CrmResult>{
    if(typeof purge!=='boolean')return{ok:false,message:'Некорректное действие.'};if(this.syncing||this.connecting)return{ok:false,message:'Дождитесь текущей операции.'};
    try{const account=this.repository.getCrmAccount();if(account){await this.store.delete(credentialKey(account.id));await this.store.delete(browserCredentialKey(account.id));}await this.browser?.clear();this.browserDomain=null;this.client=null;await this.repository.disconnectAccount(purge);return{ok:true,message:purge?'Подключение и кэш удалены.':'Подключение отключено. Кэш сохранён.'};}catch(error){return{ok:false,message:safeMessage(error)};}
  }
}
