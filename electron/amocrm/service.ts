import type { CrmAccount, CrmRecord, CrmResult, SyncProgress } from '../../src/domain/crm.ts';
import type { CrmCommand, CrmWriteResult, TimelineData, WriteStatus } from '../../src/domain/crmWrite.ts';
import { changeKeys, fingerprint, validateCommand } from './writes.ts';
import { collectEvents, collectScoped, performMutation } from './mutations.ts';
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
  // ---- Phase 5: user-initiated amoCRM writes. Same client, limiter and auth refresh as synchronization. ----
  private writing=new Set<string>();
  async execute(value:unknown):Promise<CrmWriteResult>{
    const operationId=value&&typeof value==='object'&&typeof (value as {operationId?:unknown}).operationId==='string'?(value as {operationId:string}).operationId:'';
    const fail=(message:string,status:WriteStatus='failed'):CrmWriteResult=>({ok:false,status,message,operationId});
    const account=this.repository.getCrmAccount();
    if(!account)return fail('Подключите amoCRM в настройках.');
    if(!account.authorized)return fail('Нет подключения к amoCRM. Данные доступны только для просмотра.');
    if(this.syncing||this.connecting)return fail('Дождитесь окончания синхронизации amoCRM.');
    let command:CrmCommand;
    try{command=validateCommand(value,this.repository.writeContext());}catch(error){return fail(safeMessage(error),error instanceof CrmError&&error.code==='confirm'?'pending':'failed');}
    const previous=this.repository.getOperation(command.operationId);
    if(previous?.status==='confirmed')return{ok:true,status:'confirmed',message:'Уже сохранено в amoCRM',operationId,resultId:previous.result_external_id??undefined};
    if(previous)return fail(previous.status==='sending'?'Изменение уже отправляется.':'Эта операция уже завершилась. Повторите действие заново.');
    const print=fingerprint(command);
    // A second click within a few seconds with identical content is treated as the same action.
    const duplicate=command.type==='note.create'||command.type==='task.create'?this.repository.recentConfirmed(print,15):undefined;
    if(duplicate)return{ok:true,status:'confirmed',message:'Уже сохранено в amoCRM',operationId,resultId:duplicate.result_external_id??undefined};
    const target=command.type==='task.update'||command.type==='task.complete'?{type:'tasks',id:command.taskId}:{type:command.entity,id:command.entityId};
    const lock=`${target.type}:${target.id}`;if(this.writing.has(lock))return fail('Дождитесь сохранения предыдущего изменения.');
    this.writing.add(lock);const startedAt=Math.floor(Date.now()/1000);
    const changed=command.type==='entity.update'?changeKeys(command.changes):command.type==='task.update'?['text','completeTill','taskTypeId'].filter(k=>(command as Record<string,unknown>)[k]!==undefined):[];
    try{
      await this.repository.startOperation({id:command.operationId,accountId:account.id,entityType:target.type,entityId:target.id,type:command.type,fingerprint:print,changedFields:changed,userId:account.currentUserId});
      const outcome=await performMutation(await this.loadClient(account),this.repository,account,command,startedAt);
      await this.repository.finishOperation(command.operationId,'confirmed',{resultId:outcome.resultId??null,remoteUpdatedAt:outcome.remoteUpdatedAt??null});
      return{ok:true,status:'confirmed',message:outcome.message,operationId,resultId:outcome.resultId};
    }catch(error){
      const code=error instanceof CrmError?error.code:'unknown';
      const status:WriteStatus=code==='conflict'?'conflict':code==='needs_refresh'||code==='ambiguous'?'needs_refresh':'failed';
      const message=error instanceof CrmError?(code==='ambiguous'?'Не удалось подтвердить сохранение. Обновите карточку перед повтором.':error.message):'Не удалось сохранить изменение в amoCRM.';
      await this.repository.finishOperation(command.operationId,status,{errorCategory:code}).catch(()=>{});
      if(error instanceof CrmError&&(error.status===401||code.startsWith('oauth_')||code==='browser_missing')){this.client=null;await this.repository.markCrmUnauthorized('Сессия amoCRM закончилась. Подключите аккаунт снова.');return fail('Сессия amoCRM закончилась. Подключите аккаунт снова.');}
      return fail(message,status);
    }finally{this.writing.delete(lock);}
  }
  /** Entity-level refresh of one client workspace plus its history events; never a whole-account sync. */
  async refreshWorkspace(clientId:unknown):Promise<CrmResult>{
    if(typeof clientId!=='string'||clientId.length>200)return{ok:false,message:'Некорректный клиент.'};
    const account=this.repository.getCrmAccount();if(!account?.authorized)return{ok:false,message:'Нет подключения к amoCRM. Показаны сохранённые данные.'};
    if(this.syncing||this.connecting)return{ok:false,message:'Дождитесь окончания синхронизации.'};
    const scope=this.repository.clientScope(clientId);if(!scope.leadIds.length&&!scope.contactIds.length&&!scope.companyIds.length)return{ok:false,message:'Клиент не найден в кэше amoCRM.'};
    try{
      const client=await this.loadClient(account);
      await this.repository.mergeScoped(await collectScoped(client,account,scope));
      let historyError:string|null=null;
      for(const [entity,list] of [['lead',scope.leadIds],['contact',scope.contactIds],['company',scope.companyIds]] as const){
        if(!list.length)continue;let events=new Map<number,CrmRecord[]>();
        try{events=await collectEvents(client,entity,list);}catch(error){if(error instanceof CrmError&&error.status===401)throw error;historyError=error instanceof CrmError&&error.status===403?'Нет прав на просмотр истории в amoCRM.':'История amoCRM временно недоступна.';}
        for(const id of list)await this.repository.putEvents(entity,id,events.get(id)??[],historyError);
      }
      return{ok:true,message:historyError?`Карточка обновлена. ${historyError}`:'Карточка обновлена из amoCRM.'};
    }catch(error){
      if(error instanceof CrmError&&(error.status===401||error.code==='browser_missing')){this.client=null;await this.repository.markCrmUnauthorized('Сессия amoCRM закончилась. Подключите аккаунт снова.');return{ok:false,message:'Сессия amoCRM закончилась. Подключите аккаунт снова.'};}
      return{ok:false,message:safeMessage(error)};
    }
  }
  timeline(clientId:unknown):TimelineData{
    if(typeof clientId!=='string'||clientId.length>200)return{events:[],loadedAt:null,error:null};const scope=this.repository.clientScope(clientId);
    return this.repository.eventsFor([...scope.leadIds.map(id=>({type:'lead',id})),...scope.contactIds.map(id=>({type:'contact',id})),...scope.companyIds.map(id=>({type:'company',id}))]);
  }
  async disconnect(purge:boolean):Promise<CrmResult>{
    if(typeof purge!=='boolean')return{ok:false,message:'Некорректное действие.'};if(this.syncing||this.connecting)return{ok:false,message:'Дождитесь текущей операции.'};
    try{const account=this.repository.getCrmAccount();if(account){await this.store.delete(credentialKey(account.id));await this.store.delete(browserCredentialKey(account.id));}await this.browser?.clear();this.browserDomain=null;this.client=null;await this.repository.disconnectAccount(purge);return{ok:true,message:purge?'Подключение и кэш удалены.':'Подключение отключено. Кэш сохранён.'};}catch(error){return{ok:false,message:safeMessage(error)};}
  }
}
